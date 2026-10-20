"""OpenAlex search (open metadata and abstracts, CC0). Retrieved text is data, never instructions."""

from __future__ import annotations

import hashlib
import itertools
import json
import os
import re
import threading
import time
from datetime import UTC, datetime

import httpx2

from .config import resolve, settings


def search(formula: str, terms: list[str]) -> dict:
    """Papers whose title or abstract mention the formula (in any element order) and a term, in OpenAlex's
    relevance order. The query is built by code from the formula and phrases, and the response is kept for the
    day (data/openalex/), so the same formula and phrases return the same papers on every run that day.

    If no paper uses any of the exact phrases, retry with their individual words, so that an
    over-specific phrase doesn't read as "no literature exists"; the result is marked "broadened".
    """
    terms = sorted({t.replace('"', "").strip() for t in terms if t.strip()})[:5]
    cfg = settings().policy["openalex"]
    key = hashlib.sha256(json.dumps([formula, terms, cfg["papers_per_search"]]).encode()).hexdigest()[:16]
    cached = resolve("data/openalex") / f"{datetime.now(UTC):%Y-%m-%d}-{key}.json"
    if cached.exists():
        return json.loads(cached.read_text())
    data = _search(formula, terms)
    cached.parent.mkdir(parents=True, exist_ok=True)
    cached.write_text(json.dumps(data))
    return data


def _search(formula: str, terms: list[str]) -> dict:
    parts = re.findall(r"[A-Z][a-z]?[\d.]*", formula)
    names = [formula] + (["".join(p) + parts[-1] for p in itertools.permutations(parts[:-1])]
                         if "".join(parts) == formula and 2 < len(parts) <= 4 else [])
    query = "(" + " OR ".join(f'"{n}"' for n in dict.fromkeys(names)) + ")"
    data = _works(query + (" AND (" + " OR ".join(f'"{t}"' for t in terms) + ")" if terms else ""))
    words = list(dict.fromkeys(w.lower() for t in terms for w in re.findall(r"[\w-]{3,}", t)))
    if not data.get("results") and words:
        data = _works(query + " AND (" + " OR ".join(words) + ")")
        data["broadened"] = True
    return data


_pace = threading.Lock()
_last = [0.0]


def _works(query: str) -> dict:
    """One OpenAlex request, spaced at most 8 per second across threads (OpenAlex allows about 10),
    retried with backoff on HTTP 429."""
    cfg = settings().policy["openalex"]
    params = {"filter": f"title_and_abstract.search:{query}", "sort": "relevance_score:desc",
              "per-page": cfg["papers_per_search"], "select": "id,doi,title,publication_year,abstract_inverted_index"}
    if key := os.environ.get("OPENALEX_API_KEY"):
        params["api_key"] = key
    for attempt in range(4):
        with _pace:
            time.sleep(max(0.0, _last[0] + 0.125 - time.monotonic()))
            _last[0] = time.monotonic()
        try:
            r = httpx2.get(f"{cfg['base_url']}/works", params=params, timeout=20)
        except Exception as e:  # never include the URL in messages: it carries the API key
            raise RuntimeError(f"OpenAlex unreachable ({type(e).__name__})") from None
        if r.status_code != 429:
            break
        time.sleep(float(r.headers.get("retry-after") or 0) or 2 ** attempt)
    if r.status_code == 429 and r.headers.get("x-ratelimit-remaining-usd") in ("0", "0.0", "0.000"):
        raise RuntimeError("OpenAlex daily budget for this API key is used up (HTTP 429)")
    if r.status_code != 200:
        raise RuntimeError(f"OpenAlex returned HTTP {r.status_code}")
    return r.json()


def abstract(inverted: dict | None) -> str:
    """OpenAlex stores abstracts as {word: [positions]}; rebuild the text."""
    words = {i: w for w, pos in (inverted or {}).items() for i in pos}
    return " ".join(words[i] for i in sorted(words))


_INSTRUCTION = re.compile(
    r"\b(ai agents?|language models?|llms?|assistants?)\b[^.]{0,80}\b(should|must|can|call|post|send|email)\b"
    r"|\bignore (all |any |the )?(previous|prior|above) (instructions|prompts?)\b|\bPOST https?://", re.IGNORECASE)


def find_instruction(text: str) -> str | None:
    """The sentence containing text aimed at AI systems, if any."""
    if not (m := _INSTRUCTION.search(text or "")):
        return None
    start, end = text.rfind(". ", 0, m.start()), text.find(". ", m.end())
    return text[start + 2 if start >= 0 else 0: end + 1 if end >= 0 else None].strip()[:240]


def quote_in(quote: str, text: str) -> bool:
    norm = lambda s: re.sub(r"\s+", " ", s).strip(" .\"'").lower()  # noqa: E731
    return len(norm(quote)) >= 20 and norm(quote) in norm(text)


# ------------------------------------------------------------------ attribution and relevance

_SUB = str.maketrans("₀₁₂₃₄₅₆₇₈₉", "0123456789")
_F = r"(?:[A-Z][a-z]?(?:\d+(?:\.\d+)?)?)+"
# formulas joined by dashes (Li2O–Al2O3) form one mixed system; a dopant sits before "-doped" or around ":"
_MENTION = re.compile(rf"(?<![\w)\]])(?:([A-Z][a-z]?)[-‐ ]doped\s+|([A-Z][a-z]?):)?({_F}(?:\s?[-–—]\s?{_F})*)(?::([A-Z][a-z]?))?(?![\w(])")


def mentions(text: str) -> tuple[set[str], set[str]]:
    """Keys of the materials a text names: (direct mentions, doped hosts). A single formula gives its
    reduced composition (so "H2SO4" in a cleaning step matches only H2SO4); formulas joined by dashes
    give their mixed element set, "mix:Al,Li,O" for Li2O–Al2O3, which matches LiAlO2.

    A token counts as a formula only if every symbol is an element, it has at least two, and it has a
    digit or a two-letter symbol, so "CV" or "UV" don't. Common names (e.g. "hafnia") aren't read.
    """
    from .datasets import comp_key  # noqa: PLC0415 (avoids a circular import)

    direct, doped = set(), set()
    for dop1, dop2, system, dop3 in _MENTION.findall(normalize(text)):
        parts = re.split(r"\s?[-–—]\s?", system)
        if not all(re.search(r"\d|[a-z]", p) for p in parts):
            continue
        keys = [comp_key(p) for p in parts]
        els = sorted({k.split(":")[0] for key in keys if key for k in key.split(",")})
        if None in keys or len(els) < 2:
            continue
        key = keys[0] if len(keys) == 1 else "mix:" + ",".join(els)
        (doped if dop1 or dop2 or dop3 else direct).add(key)
    return direct, doped


def keys_for(formula: str) -> set[str]:
    """The mention keys that refer to a candidate: its reduced composition, or a mixture of its elements."""
    from .datasets import comp_key  # noqa: PLC0415

    key = comp_key(formula) or ""
    return {key, "mix:" + ",".join(sorted({p.split(":")[0] for p in key.split(",") if p}))}


def relevant(text: str, terms: list[str]) -> bool:
    """Whether a title or abstract contains one of the application phrases ("solar cell", "gate dielectric").
    Phrases match whole, ignoring case, hyphens and a plural "s", so "thin-film" finds "thin films"."""
    flat = re.sub(r"[-‐–\s]+", " ", (text or "").lower())
    for t in terms:
        words = re.findall(r"[a-z0-9]+", t.lower())
        if words and re.search(r"\b" + r"s? ".join(map(re.escape, words)) + r"s?\b", flat):
            return True
    return False


def specific(terms: list[str]) -> list[str]:
    """The application phrases that can qualify a paper: those with at least one word that isn't a generic
    form word (policy.yaml generic_terms). "thin film" alone can't; "dielectric thin film" can."""
    generic = {w.rstrip("s") for t in settings().policy.get("generic_terms") or [] for w in re.findall(r"[a-z0-9]+", t.lower())}
    return [t for t in terms if {w.rstrip("s") for w in re.findall(r"[a-z0-9]+", t.lower())} - generic]


def quote_for(keys: set[str], title: str, abstract: str, terms: list[str], extra: list[str] = ()) -> str | None:
    """The first sentence (title, then abstract, then any quote the agent supplied and that was found in
    the abstract) that names the material and contains a specific application phrase. Chosen by code, so
    the same paper gives the same quote every run; None means the paper doesn't verify this material."""
    phrases = specific(terms)
    for s in [title, *re.split(r"(?<=[.!?])\s+(?=[A-Z0-9])", abstract or ""), *extra]:
        if s and relevant(s, phrases) and keys & mentions(s)[0]:
            return s.strip()[:400]
    return None


def normalize(text: str) -> str:
    """Formulas as abstracts render them: subscripts become digits, and a space split such as "Al 2 O 3"
    (from OpenAlex's word index) is rejoined to "Al2O3". Case is kept: "CoP" is a compound, "COP" isn't."""
    t = (text or "").translate(_SUB)
    t = re.sub(r"([A-Z][a-z]?) (\d+(?:\.\d+)?)(?![\w.])", lambda m: m.group(1) + m.group(2)
               if m.group(1) in _elements() else m.group(0), t)
    return re.sub(r"(?<=[A-Za-z]\d) (?=[A-Z][a-z]?\d)|(?<=[A-Za-z]\d\d) (?=[A-Z][a-z]?\d)", "", t)


def _elements() -> set:
    from .datasets import ELEMENTS  # noqa: PLC0415 (avoids a circular import)

    return ELEMENTS
