"""Materials datasets: small adapters plus one generic download, field catalog and search.

An adapter says where a dataset comes from and where its field descriptions and units
come from. Everything else is shared: every scalar field becomes searchable, values far
outside a field's normal range count as missing, and searches filter, rank and return
the top materials. Nothing lists properties by hand.
"""

from __future__ import annotations

import difflib
import hashlib
import json
import math
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache, reduce
from pathlib import Path
from types import SimpleNamespace
from typing import Callable

import duckdb
import httpx2

from .config import resolve, settings

DATA = resolve("data")
BASE = ["id", "formula", "elements", "url", "comp_key"]
NUMERIC = {"DOUBLE", "FLOAT", "BIGINT", "INTEGER", "SMALLINT", "TINYINT"}
SCALAR = NUMERIC | {"BOOLEAN", "VARCHAR"}


@dataclass
class Dataset:
    name: str
    title: str
    citation: str
    fetch: Callable  # (duckdb connection, output path) -> writes id, formula, elements, url + fields
    docs: Callable  # () -> {field: description}; units are read from the description or given as (desc, unit)
    stable: str  # one entry per composition: the lowest value of this field
    entry_fields: tuple = ()  # fields describing an entry rather than the material (filtered before choosing one per composition)


# ---------------------------------------------------------------------- Materials Project

MP_URL = ("https://materialsproject-build.s3.amazonaws.com/collections/summary/version=2026-09-28/"
          "part-00000-2cc5f2cc-2a79-4051-b013-2f9dec6a302e-c000.zstd.parquet")


def _mp_fetch(con, out: Path) -> None:
    src = f"read_parquet('{MP_URL}')"
    exprs = []
    for name, typ, *_ in con.execute(f"DESCRIBE SELECT * FROM {src}").fetchall():
        if typ in SCALAR:
            exprs.append(f'"{name}"')
        elif typ == "MAP(VARCHAR, DOUBLE)":
            keys = [k for (k,) in con.execute(f'SELECT DISTINCT unnest(map_keys("{name}")) FROM {src}').fetchall()]
            if len(keys) <= 10:  # skip per-element maps such as composition
                exprs += [f"\"{name}\"['{k}'] AS \"{name}.{k}\"" for k in keys]
        elif typ.startswith("STRUCT(") and not typ.endswith("]"):
            exprs += [f'"{name}"."{sub}" AS "{name}.{sub}"' for sub, st, *_ in
                      con.execute(f'DESCRIBE SELECT "{name}".* FROM {src}').fetchall() if st in SCALAR]
    mp_id = ("'mp-' || list_reduce(list_transform(string_split(substr(material_id, 4), ''), "
             "lambda c: ascii(c) - 97), lambda a, b: a * 26 + b)")
    con.execute(f"""COPY (SELECT {mp_id} AS id, formula_pretty AS formula, elements,
        'https://next-gen.materialsproject.org/materials/' || {mp_id} AS url,
        * EXCLUDE (material_id, formula_pretty, elements) FROM (SELECT {', '.join(exprs)}, elements FROM {src}
        WHERE NOT coalesce(deprecated, false))) TO '{out}' (FORMAT parquet)""")


def _mp_docs() -> dict:
    schemas = httpx2.get("https://api.materialsproject.org/openapi.json", timeout=30).json()["components"]["schemas"]
    out = {}
    for name, prop in schemas["SummaryDoc"]["properties"].items():
        out[name] = prop.get("description", "")
        for option in prop.get("anyOf", [prop]):
            if ref := option.get("$ref"):
                for sub, sp in schemas[ref.rsplit("/", 1)[-1]].get("properties", {}).items():
                    out[f"{name}.{sub}"] = sp.get("description", "")
    return out


# --------------------------------------------------------------------------------- AFLOW

AFLUX = "https://aflow.org/API/aflux/"


@lru_cache(maxsize=1)
def _aflow_schema() -> dict:
    s = httpx2.get(f"{AFLUX}?schema", timeout=60).json()
    return {k: v for k, v in s.items() if isinstance(v, dict) and v.get("type") in ("number", "string")
            and v.get("status") == "production"}


def _aflow_fetch(con, out: Path) -> None:
    # AFLUX rejects these two schema fields in queries; the rest are requested.
    skip = {"auid", "aurl", "compound", "catalog", "aflow_prototype_parameters_relax", "aflow_prototype_parameters_orig"}
    query = f"{AFLUX}?catalog(ICSD),species," + ",".join(k for k in _aflow_schema() if k not in skip)
    pages = []  # the experimentally reported (ICSD) catalogue, ~60k entries, 5,000 per request
    while (page := httpx2.get(f"{query},$paging({len(pages) + 1},5000)", timeout=600).json()):
        pages.append(DATA / f"aflow.page{len(pages)}.json")
        pages[-1].write_text(json.dumps(page))
    con.execute(f"""COPY (SELECT auid AS id, compound AS formula, species AS elements,
        'https://' || replace(aurl, ':AFLOWDATA', '/AFLOWDATA') AS url,
        * EXCLUDE (auid, compound, species, aurl, catalog)
        FROM read_json({[str(p) for p in pages]}, format='array', union_by_name=true)) TO '{out}' (FORMAT parquet)""")
    for p in pages:
        p.unlink()


def _aflow_docs() -> dict:
    return {k: (f"{v.get('title', '')}: {v.get('description', '')}".strip(": "),
                re.sub(r"<[^>]+>", "", v.get("units", "") or "")) for k, v in _aflow_schema().items()}


DATASETS = {d.name: d for d in [
    Dataset("mp", "Materials Project 2026-09-28",
            "A. Jain et al., APL Materials 1, 011002 (2013); Materials Project Terms of Use",
            _mp_fetch, _mp_docs, "energy_above_hull", ("theoretical", "is_stable")),
    Dataset("aflow", "AFLOW (ICSD catalogue)",
            "S. Curtarolo et al., Comput. Mater. Sci. 58, 227 (2012); scientific, academic and non-commercial use",
            _aflow_fetch, _aflow_docs, "enthalpy_formation_atom"),
]}


# ------------------------------------------------------------------------ download + catalog

ELEMENTS = set("""H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br
Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu
Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr""".split())


def comp_key(formula: str) -> str | None:
    """Reduced composition, e.g. 'Ti2O4' -> 'O:2,Ti:1', so formulas match across datasets."""
    counts: dict[str, float] = {}
    stack = [counts]
    for el, n, close, mult in re.findall(r"([A-Z][a-z]?)(\d*\.?\d*)|(\))(\d*\.?\d*)|\(", formula or ""):
        if el:
            if el not in ELEMENTS:
                return None
            stack[-1][el] = stack[-1].get(el, 0) + float(n or 1)
        elif close:
            group = stack.pop() if len(stack) > 1 else {}
            for k, v in group.items():
                stack[-1][k] = stack[-1].get(k, 0) + v * float(mult or 1)
        else:
            stack.append({})
    if not counts or len(stack) != 1 or re.sub(r"[A-Za-z0-9().]", "", formula) or min(counts.values()) <= 0:
        return None  # zero counts appear in text such as the "S0" ground state
    if all(v.is_integer() for v in counts.values()):
        g = reduce(math.gcd, (int(v) for v in counts.values()))
        counts = {k: v / g for k, v in counts.items()}
    return ",".join(f"{k}:{v:g}" for k, v in sorted(counts.items()))


def _unit(text: str) -> str:
    m = re.findall(r"\bin ([^\s,]+?)\.?(?:\s|$)", text)
    return m[-1] if m and re.search(r"[A-Zμ/²³Å]", m[-1]) else ""


def pull(ds: Dataset) -> dict:
    """Download a dataset and build its field catalog, unless both already exist."""
    out, meta = DATA / f"{ds.name}.parquet", DATA / f"{ds.name}.json"
    if out.exists() and meta.exists():
        return json.loads(meta.read_text())
    DATA.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET enable_progress_bar = false;")
    raw = DATA / f"{ds.name}.raw.parquet"
    ds.fetch(con, raw)
    docs = ds.docs()
    columns = {}
    for name, typ, *_ in con.execute(f"DESCRIBE SELECT * FROM '{raw}'").fetchall():
        if name in BASE or typ not in SCALAR:
            continue
        doc = docs.get(name) or docs.get(name.split(".")[0], "")
        desc, unit = doc if isinstance(doc, tuple) else (doc, _unit(doc))
        if col := _describe(con, raw, name, typ):
            columns[name] = {"description": desc, "unit": unit, **col}
    ids, formulas = zip(*con.execute(f"SELECT id, formula FROM '{raw}'").fetchall(), strict=True)
    con.execute("CREATE TABLE keys AS SELECT unnest(?::VARCHAR[]) AS id, unnest(?::VARCHAR[]) AS comp_key",
                [list(ids), [comp_key(f) for f in formulas]])
    keep = ", ".join(f'r."{c}"' for c in columns)
    con.execute(f"COPY (SELECT r.id, r.formula, r.elements, r.url, k.comp_key, {keep} FROM '{raw}' r "
                f"JOIN keys k USING (id)) TO '{out}' (FORMAT parquet, COMPRESSION zstd)")
    raw.unlink()
    info = {"title": ds.title, "citation": ds.citation, "rows": con.execute(f"SELECT count(*) FROM '{out}'").fetchone()[0],
            "sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
            "pulled_at": datetime.now(UTC).isoformat(timespec="seconds"), "columns": columns}
    meta.write_text(json.dumps(info, indent=1))
    return info


def _describe(con, path: Path, name: str, typ: str) -> dict | None:
    """Kind, coverage, typical range and outlier bounds of one column; None if useless."""
    col, total = f'"{name}"', con.execute(f"SELECT count(*) FROM '{path}'").fetchone()[0]
    present, distinct = con.execute(f"SELECT count({col}), count(DISTINCT {col}) FROM '{path}'").fetchone()
    if distinct < 2:
        return None
    out = {"coverage": round(present / total, 4)}
    if typ == "VARCHAR":
        if distinct > 300:  # IDs and free text, not categories
            return None
        vals = con.execute(f"SELECT {col} FROM '{path}' WHERE {col} IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC")
        return out | {"kind": "text", "values": [v for (v,) in vals.fetchall()]}
    if typ == "BOOLEAN":
        return out | {"kind": "flag"}
    finite = f"FROM '{path}' WHERE isfinite({col})"
    lo, p1, med, p99, hi = con.execute(f"SELECT min({col}), quantile_cont({col}, 0.01), median({col}), "
                                       f"quantile_cont({col}, 0.99), max({col}) {finite}").fetchone()
    out |= {"kind": "number" if typ in ("DOUBLE", "FLOAT") else "count", "min": lo, "median": med, "max": hi}
    # Generic outlier rule: more than 10x the 1st-99th percentile span beyond it counts as missing.
    span = p99 - p1
    if out["kind"] == "number" and span > 0:
        bounds = [p1 - 10 * span, p99 + 10 * span]
        cond = f"{finite} AND {col} BETWEEN {bounds[0]} AND {bounds[1]}"
        n_out = present - con.execute(f"SELECT count(*) {cond}").fetchone()[0]
        if n_out:
            out |= {"bounds": bounds, "outliers": n_out}
            out["min"], out["max"] = con.execute(f"SELECT min({col}), max({col}) {cond}").fetchone()
    return out


# ------------------------------------------------------------------------------------ search

class Store:
    """All pulled datasets as DuckDB views; outliers and non-finite values read as NULL."""

    def __init__(self) -> None:
        self.con = duckdb.connect()
        self.catalogs = {}
        for name in settings().policy["datasets"]:
            info = pull(DATASETS[name])
            self.catalogs[name] = info
            cols = ", ".join(f"{_sql(k, c)} AS \"{k}\"" for k, c in info["columns"].items())
            self.con.execute(f"CREATE VIEW {name} AS SELECT {', '.join(BASE)}, {cols} "
                             f"FROM read_parquet('{DATA / f'{name}.parquet'}')")
            # one entry per composition with no filters: used to report named materials that fail an entry-level filter
            self.con.execute(f'CREATE VIEW {name}_one AS SELECT * FROM {name} QUALIFY row_number() OVER '
                             f'(PARTITION BY coalesce(comp_key, id) ORDER BY "{DATASETS[name].stable}" NULLS LAST, id) = 1')
        # 1st, 50th and 99th percentiles of every numeric field across the whole dataset: ranking scales against these
        self.scales = {}
        for name, info in self.catalogs.items():
            nums = [k for k, c in info["columns"].items() if c["kind"] in ("number", "count")]
            q = self.con.execute("SELECT " + ", ".join(f'quantile_cont("{k}", [0.01, 0.5, 0.99])' for k in nums)
                                 + f" FROM {name}").fetchone()
            self.scales[name] = {k: v for k, v in zip(nums, q, strict=True) if v and None not in v and v[2] > v[0]}

    def note(self, dataset: str, field: str) -> dict:
        """The site admin's note on a field's known bias, with optional filter margins (policy.yaml)."""
        return (settings().policy.get("field_notes") or {}).get(f"{dataset}.{field}") or {}

    def fields(self, dataset: str, keyword: str = "") -> list[dict]:
        cols = self._columns(dataset)
        kw = keyword.lower()
        return [{"field": k, **{x: c[x] for x in ("kind", "unit", "description", "coverage", "min", "median",
                                                    "max", "values") if x in c},
                 **({"note": n["note"]} if (n := self.note(dataset, k)).get("note") else {})}
                for k, c in cols.items() if kw in k.lower() or kw in c["description"].lower()]

    def search(self, dataset: str, filters: list, rank_by: list, elements: dict, formulas: list[str],
               only_formulas: bool, limit: int) -> dict:
        """Filter entries on entry-level fields (e.g. stability), keep one entry per composition, filter
        compositions on everything else, score, and split the pool into complete (every filter and
        ranking field known) and incomplete (strong on known fields, missing others). Named formulas
        are always returned."""
        cols = self._columns(dataset)
        filters = [_as_flag(f) if f.any_of and cols.get(f.field, {}).get("kind") == "flag" else f for f in filters]
        for f in [*filters, *rank_by]:
            self._check(dataset, f.field, text_ok=f in filters and bool(f.any_of))
        conds = []  # (description, SQL, field or None, keeps missing values)
        policy = settings().policy.get("always_exclude") or {}
        for reason, els in policy.items():
            conds.append((f"Site policy ({reason}): contains none of {', '.join(els)}", f"NOT list_has_any(elements, {els!r})",
                          None, False))
        for label, sql_fn, key in [("Contains none of", "NOT list_has_any", "exclude"),
                                   ("Contains all of", "list_has_all", "include"),
                                   ("Contains at least one of", "list_has_any", "any_of")]:
            if els := [e for e in elements.get(key, []) if e in ELEMENTS]:
                conds.append((f"{label} {', '.join(els)}", f"{sql_fn}(elements, {els!r})", None, False))
        filters = [self._shift(dataset, f) for f in filters]
        rank_by = [self._shift(dataset, r) for r in rank_by]
        # sparse fields always keep missing values as unknown, whatever the filter asks; others follow the agent
        keeps = [cols[f.field]["coverage"] < 0.5 or f.missing == "keep" for f in filters]
        sources = {}
        for f, keep in zip(filters, keeps, strict=True):
            text = _describe_filter(f, cols[f.field]) + f.shifted
            sources[text] = f.source
            conds.append((text, _filter_sql(f), f.field, keep))
        ds = DATASETS[dataset]
        stable, entry = ds.stable, {ds.stable, *ds.entry_fields}
        total = prev = self.con.execute(f"SELECT count(*) FROM {dataset}").fetchone()[0]
        criteria = []

        def apply(src: str, items: list, where: list) -> None:
            """Add conditions one at a time, recording how many each removed and how many had no value."""
            nonlocal prev
            for text, sql, field, keep in items:
                base = " AND ".join(where) or "TRUE"
                missing = None
                if field:
                    missing = self.con.execute(f'SELECT count(*) FROM {src} WHERE {base} AND "{field}" IS NULL').fetchone()[0]
                where.append(f'(({sql}) OR "{field}" IS NULL)' if field and keep else f"({sql})")
                n = self.con.execute(f"SELECT count(*) FROM {src} WHERE {' AND '.join(where)}").fetchone()[0]
                criteria.append({"kind": "filter", "text": text, "removed": prev - n, "missing": missing,
                                 "kept_missing": keep and bool(missing), "source": sources.get(text)})
                prev = n

        # 1) entry-level filters on every entry, so a hypothetical or unstable polymorph can't stand in for a
        # composition that has a qualifying entry; 2) one entry per composition; 3) everything else on that entry
        entry_where: list = []
        apply(dataset, [] if only_formulas else [c for c in conds if c[2] in entry], entry_where)
        one = (f"(SELECT * FROM {dataset} WHERE {' AND '.join(entry_where) or 'TRUE'} QUALIFY row_number() OVER "
               f'(PARTITION BY coalesce(comp_key, id) ORDER BY "{stable}" NULLS LAST, id) = 1) AS one')
        n = self.con.execute(f"SELECT count(*) FROM {one}").fetchone()[0]
        if not only_formulas:
            criteria.append({"kind": "setting", "text": f"One entry per composition: lowest {stable}", "removed": prev - n})
        prev, where = n, []
        apply(one, [] if only_formulas else [c for c in conds if c[2] not in entry], where)
        rows = [] if only_formulas else self._rows(f"SELECT * FROM {one} WHERE {' AND '.join(where) or 'TRUE'}")
        pool, not_found, outside = len(rows), [], []  # outside: named materials that fail the filters
        by_comp = {r["comp_key"]: r for r in rows}
        for given in formulas:
            key = comp_key(given)
            found = by_comp.get(key) or next(iter(self._rows(f"SELECT * FROM {one} WHERE comp_key = ?", [key])
                                                  or self._rows(f"SELECT * FROM {dataset}_one WHERE comp_key = ?", [key])), None)
            if not key or not found:
                not_found.append(given)
                continue
            if found["comp_key"] not in by_comp:
                (rows if only_formulas else outside).append(found)
                by_comp[found["comp_key"]] = found
            found["named"] = given
            found["warnings"] = [w for f, keep in zip(filters, keeps, strict=True)
                                 if (w := _verdict(found, f, cols[f.field], keep))]
            els, want = set(found["elements"]), elements.get("any_of", [])
            found["warnings"] += ([f"Contains {e} (site policy: {reason})" for reason, ex in policy.items() for e in ex if e in els]
                                  + [f"Contains {e}" for e in elements.get("exclude", []) if e in els]
                                  + [f"Lacks {e}" for e in elements.get("include", []) if e not in els]
                                  + ([f"Has none of {', '.join(want)}"] if want and not els & set(want) else []))
        needed = list(dict.fromkeys([f.field for f in filters] + [r.field for r in rank_by]))
        for row in rows + outside:
            row["missing"] = [k for k in needed if row.get(k) is None]
        ranked = _score(rows, rank_by, cols, self.scales[dataset])
        _score(outside, rank_by, cols, self.scales[dataset])
        take = lambda rs, n: [r for i, r in enumerate(rs) if i < n or r.get("named")]  # noqa: E731
        groups = {"complete": take([r for r in ranked if not r["missing"]], limit),
                  "incomplete": take(sorted((r for r in ranked if r["missing"]), key=lambda r: (-r["known"], r["formula"])), 5)}
        criteria += [{"kind": "rank", "text": _describe_rank(r, cols[r.field], self.scales[dataset].get(r.field)) + r.shifted,
                      "removed": None, "source": r.source} for r in rank_by]
        return {"total": total, "pool": len(rows), "groups": groups, "outside": outside, "criteria": criteria,
                "not_found": not_found, "counts": {"complete": sum(not r["missing"] for r in ranked),
                                                   "incomplete": sum(bool(r["missing"]) for r in ranked)}}

    def _shift(self, dataset: str, f):
        """Correct a filter's bounds or a ranking target for the field's known bias (policy.yaml field_notes):
        both bounds and any target move in the bias direction. Skipped for strict filters."""
        keys = ("field", "min", "max", "any_of", "missing", "strict", "goal", "target")
        g = SimpleNamespace(**{k: getattr(f, k, None) for k in keys})
        note, g.shifted, g.source = self.note(dataset, f.field), "", None
        low, factor, offset = note.get("bias") == "low", note.get("factor"), note.get("offset")
        if g.any_of or g.strict or note.get("bias") not in ("low", "high") or not (factor or offset):
            return g

        def move(v):
            if v is None:
                return None
            v = v / factor if factor and low else v * factor if factor else v
            return round(v - offset if offset and low else v + offset if offset else v, 4)

        asked = " and ".join(f"{label} {v:g}" for label, v in (("≥", g.min), ("≤", g.max), ("target", g.target))
                             if v is not None)
        g.min, g.max, g.target = move(g.min), move(g.max), move(g.target)
        if asked:
            g.shifted = f" (asked {asked}; shifted for a known bias: {note.get('note', '')})"
            g.source = note.get("source")
        return g

    def _columns(self, dataset: str) -> dict:
        if dataset not in self.catalogs:
            raise ValueError(f"Unknown dataset {dataset!r}. Available: {', '.join(self.catalogs)}.")
        return self.catalogs[dataset]["columns"]

    def _check(self, dataset: str, field: str, text_ok: bool) -> None:
        cols = self._columns(dataset)
        if field not in cols:
            close = difflib.get_close_matches(field, cols, n=5, cutoff=0.4)
            raise ValueError(f"Unknown field {field!r} in {dataset}. Close matches: {close}. "
                             "Use materials_fields to look fields up.")
        if (cols[field]["kind"] == "text") != text_ok:
            raise ValueError(f"{field!r} is a {cols[field]['kind']} field: use any_of for text fields and "
                             "min/max (and ranking) for numbers, counts and 1/0 flags.")

    def _rows(self, sql: str, params: list | None = None) -> list[dict]:
        cur = self.con.execute(sql, params or [])
        names = [d[0] for d in cur.description]
        return [dict(zip(names, r, strict=True)) for r in cur.fetchall()]


def _sql(key: str, c: dict) -> str:
    col = f'"{key}"'
    if c["kind"] == "flag":
        return f"CAST({col} AS INTEGER)"
    if c["kind"] == "number":
        bounds = f" AND {col} BETWEEN {c['bounds'][0]} AND {c['bounds'][1]}" if "bounds" in c else ""
        return f"CASE WHEN isfinite({col}){bounds} THEN {col} END"
    return col


_TRUE, _FALSE = {"true", "yes", "y", "t", "1", "1.0"}, {"false", "no", "n", "f", "0", "0.0"}


def _as_flag(f):
    """A true/false field filtered with any_of (e.g. ["false"]) becomes the equivalent 0/1 range,
    so the agent doesn't need a retry to learn that flags are stored as numbers."""
    vals = {str(v).strip().lower() for v in f.any_of}
    if not vals <= _TRUE | _FALSE:
        return f  # unrecognized values: let the normal check explain the field
    want = {1 for v in vals if v in _TRUE} | {0 for v in vals if v in _FALSE}
    return SimpleNamespace(field=f.field, any_of=None, min=min(want) if want == {1} else None,
                           max=max(want) if want == {0} else None,
                           missing=getattr(f, "missing", None), strict=getattr(f, "strict", False))


def _filter_sql(f) -> str:
    col = f'"{f.field}"'
    if f.any_of:
        return f"{col} IN (" + ", ".join("'" + v.replace("'", "''") + "'" for v in f.any_of) + ")"
    parts = ([f"{col} >= {f.min!r}"] if f.min is not None else []) + ([f"{col} <= {f.max!r}"] if f.max is not None else [])
    return " AND ".join(parts) or f"{col} IS NOT NULL"


def _verdict(row: dict, f, c: dict, keep: bool) -> str:
    """Why a named material fails one filter, or "" if it passes."""
    v = row.get(f.field)
    if v is None:
        return "" if keep else f"Missing {f.field}, which the filter requires"
    ok = v in f.any_of if f.any_of else (f.min is None or v >= f.min) and (f.max is None or v <= f.max)
    return "" if ok else f"Fails {_describe_filter(f, c)}"


def _describe_filter(f, c: dict) -> str:
    unit = f" {c['unit']}" if c["unit"] else ""
    if f.any_of:
        return f"{f.field} is {' or '.join(f.any_of)}"
    if f.min is not None and f.max is not None:
        return f"{f.field} {f.min:g}–{f.max:g}{unit}"
    return f"{f.field} {'≥ ' + format(f.min, 'g') if f.min is not None else '≤ ' + format(f.max, 'g')}{unit}"


def _describe_rank(r, c: dict, q: list | None) -> str:
    goal = f"closest to {r.target:g}{' ' + c['unit'] if c['unit'] else ''}" if r.goal == "target" else \
        f"{'higher' if r.goal == 'max' else 'lower'} is better"
    scale = f", scored on its dataset-wide 1st–99th percentile range{' (log scale)' if _skewed(q) else ''}" if q else ""
    return f"{r.field}: {goal}{scale}"


def _skewed(q: list | None) -> bool:
    """Log-scale a field whose upper tail is far longer than its lower one (decided from catalogue percentiles)."""
    return bool(q) and q[0] > 0 and q[2] - q[1] > 4 * (q[1] - q[0])


def _part(v, r, c: dict, q: list | None) -> float | None:
    """One ranking goal's 0-1 part of the score: the value's position within the field's dataset-wide
    1st-99th percentile range (log scale if skewed), so a material's score doesn't depend on the pool."""
    if v is None:
        return None
    if c["kind"] == "flag" or not q:
        x, t = float(v), float(r.target or 0)
        lo, hi, f = (0.0, 1.0, float) if c["kind"] == "flag" else (c["min"], c["max"], float)
    else:
        lo, hi = q[0], q[2]
        f = math.log if _skewed(q) else float
        x, t = v, r.target if r.target is not None else lo
    clip = lambda z: min(max(float(z), lo), hi)  # noqa: E731
    span = (f(hi) - f(lo)) or 1.0
    if r.goal == "target":
        return round(max(0.0, 1 - abs(f(clip(x)) - f(clip(t))) / span), 4)
    p = (f(clip(x)) - f(lo)) / span
    return round(p if r.goal == "max" else 1 - p, 4)


def _score(rows: list[dict], rank_by: list, cols: dict, scales: dict) -> list[dict]:
    """Average of the goals' parts, weighted equally. A missing part could be 0-1, so the score is a
    range and rows rank on its low end; "known" is the average of the parts that are known."""
    n = len(rank_by) or 1
    for row in rows:
        parts = {r.field: _part(row.get(r.field), r, cols[r.field], scales.get(r.field)) for r in rank_by}
        known = [p for p in parts.values() if p is not None]
        row["parts"] = parts
        row["score"] = (round(sum(known) / n, 4), round((sum(known) + len(parts) - len(known)) / n, 4))
        row["known"] = round(sum(known) / len(known), 4) if known else 0.0
    return sorted(rows, key=lambda r: (-r["score"][0], -r["score"][1], r["formula"]))
