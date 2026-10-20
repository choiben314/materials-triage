"""Audit log: one JSON line per request, plus the full stored result. No prompts or keys."""

from __future__ import annotations

import json

from .config import resolve, settings
from .models import Result

RESULTS = resolve("logs/results")


def write(res: Result) -> None:
    s = settings()
    data = {k: json.loads(v.read_text()).get("sha256") for k in s.policy["datasets"] if (v := resolve(f"data/{k}.json")).exists()}
    entry = {"request_id": res.request_id, "created_at": res.created_at, "request": res.request, "status": res.status,
             "steps": [st.label for st in res.steps], "criteria": [r.text for r in res.criteria_rows],
             "not_done": [n.model_dump() for n in res.not_done],
             "shortlist": [[c.rank, c.material_id, c.formula, c.score_low] for c in res.candidates],
             "validator_removed": res.removed, "superseded_evidence": res.superseded_evidence,
             "superseded_papers": res.superseded_papers,
             "notices": res.notices, "data_sha256": data,
             "settings": s.fingerprint, "model": s.policy["llm"]["model"]}
    RESULTS.mkdir(parents=True, exist_ok=True)
    with resolve(s.policy["audit_log"]).open("a") as f:
        f.write(json.dumps(entry) + "\n")
    (RESULTS / f"{res.request_id}.json").write_text(res.model_dump_json())


def load(request_id: str) -> Result | None:
    """A stored result, or None if missing or saved in an older format."""
    p = RESULTS / f"{request_id}.json"
    try:
        return Result.model_validate_json(p.read_text()) if request_id.isalnum() and p.exists() else None
    except ValueError:
        return None


def recent(limit: int = 15) -> list[dict]:
    """The latest completed run of each distinct request (failed runs stay in the log, not in this list)."""
    log = resolve(settings().policy["audit_log"])
    out, seen = [], set()
    for e in map(json.loads, reversed(log.read_text().splitlines() if log.exists() else [])):
        if e["request"] not in seen and e.get("status") != "error" and load(e["request_id"]):
            seen.add(e["request"])
            out.append({"request_id": e["request_id"], "request": e["request"]})
    return out[:limit]
