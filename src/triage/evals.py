"""Run the requests in evals/cases.yaml through the live agent and check the outcomes.

Each run's result IDs are saved to logs/eval-runs/ (a mounted folder), so saved runs can be re-checked against
edited expectations without calling the model again (--rescore).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

import yaml

from . import agent, audit
from .config import resolve
from .datasets import comp_key
from .models import Result

ELEMENT_RULE = ("Contains ", "Lacks ", "Has none of ")


def _elements(formula: str) -> set[str]:
    return {p.split(":")[0] for p in (comp_key(formula) or "").split(",") if p}


def _main(res: Result) -> list:
    """The main ranked shortlist, in order."""
    return sorted((c for c in res.candidates if c.rank is not None and c.group == "ranked"), key=lambda c: c.rank)


def outcomes(res: Result, formula: str, top_n: int) -> set[str]:
    """Every outcome the page reports for one material (see the vocabulary in cases.yaml)."""
    key, out = comp_key(formula), set()
    main = _main(res)
    for c in res.candidates:
        if comp_key(c.formula) != key:
            continue
        out.add("shown")
        if c in main:
            out.add("shortlisted")
            if main.index(c) < top_n:
                out.add("top")
        if c.group == "flagged":
            out.add("flagged")
        for note in c.notes:
            if note.startswith("Fails "):
                field = note[6:].split(" ")[0]
                desc = next((res.evidence[e].description for f, e in c.values.items() if f == field), "")
                out.add(f"fails:{field} {desc}".lower())
            elif note.startswith(ELEMENT_RULE):
                out.add("excluded")
        for field, eid in c.values.items():
            if res.evidence[eid].value is None:
                out.add(f"missing:{field} {res.evidence[eid].description}".lower())
    # A material the agent never named still counts as excluded or flagged if a rule stated on the page removes it.
    els = _elements(formula)
    for row in res.criteria_rows:
        listed = set(row.text.split(" of ", 1)[-1].replace(",", " ").split()) if " of " in row.text else set()
        if (row.text.startswith("Contains none of") and els & listed) or \
           (row.text.startswith("Contains all of") and listed - els) or \
           (row.text.startswith("Contains at least one of") and not els & listed):
            out.add("excluded")
    if els & set(res.penalized):
        out.add("flagged")
    for r in res.references:
        if comp_key(r.formula) == key:
            out.add("shown") if r.fate != "not_found" else None
            out |= {f"{r.fate}:{d}".lower() if r.fate in ("fails", "missing") else r.fate for d in r.details or [""]}
    return out


def _passes(expected: str, got: set[str]) -> bool:
    kind, _, word = expected.partition(":")
    return any(o == expected or (word and o.startswith(kind + ":") and word.lower() in o) for o in got)


def checks(res: Result, case: dict) -> list[tuple[str, bool]]:
    exp, top_n = case.get("expect", {}), case.get("top_n", 10)
    ids = set(res.evidence) | set(res.papers)
    out = [("summary cites real evidence", all(set(s.citations) <= ids for s in res.summary))]
    if "status" in exp:
        out.append((f"status is {exp['status']}", res.status == exp["status"]))
    if cats := exp.get("declines"):
        out.append((f"declines {', '.join(cats)}", set(cats) <= {n.category for n in res.not_done}))
    if el := exp.get("all_contain"):
        out.append((f"all ranked contain {el}", all(el in _elements(c.formula) for c in _main(res))))
    out += [(f"reports {f} as not found", f in res.not_ranked or any(
        r.formula == f and r.fate == "not_found" for r in res.references)) for f in exp.get("not_ranked", [])]
    for formula, ok in (case.get("references") or {}).items():
        got = outcomes(res, formula, top_n)
        out.append((f"{formula}: {' or '.join(ok)}", any(_passes(e, got) for e in ok)))
    top = _main(res)[:top_n]
    for el in (case.get("not_in_top") or {}).get("elements", []):
        hits = [c.formula for c in top if el in _elements(c.formula)]
        out.append((f"no {el} in top {top_n}" + (f" (found {', '.join(hits)})" if hits else ""), not hits))
    for f in (case.get("not_in_top") or {}).get("formulas", []):
        out.append((f"{f} not in top {top_n}", all(comp_key(c.formula) != comp_key(f) for c in top)))
    return out


def _report(cases: list[dict], runs: dict[str, list[str]]) -> int:
    passed = 0
    for case in cases:
        results = [r for r in (audit.load(i) for i in runs.get(case["id"], [])) if r]
        fails = [[name for name, ok in checks(r, case) if not ok] for r in results]
        good = sum(not f for f in fails)
        passed += bool(results) and good == len(results)
        print(f"{good}/{len(results)}  {case['id']:<30} {case.get('domain', '')}")
        for rid, f in zip([r.request_id for r in results], fails, strict=True):
            if f:
                print(f"       {rid}: " + "; ".join(f))
    print(f"\n{passed}/{len(cases)} cases passed every run")
    return 0 if passed == len(cases) else 1


def main(only: list[str] | None = None, repeat: int = 2, rescore: str = "") -> int:
    cases = [c for c in yaml.safe_load(resolve("evals/cases.yaml").read_text())["cases"] if not only or c["id"] in only]
    if rescore:
        return _report(cases, json.loads(resolve(rescore).read_text()))
    runs = {c["id"]: [agent.run(" ".join(c["request"].split())).request_id for _ in range(repeat)] for c in cases}
    path = resolve("logs/eval-runs") / f"{datetime.now(UTC):%Y%m%d-%H%M%S}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(runs, indent=1))
    print(f"Saved run IDs to {path.relative_to(resolve('.'))}\n")
    return _report(cases, runs)
