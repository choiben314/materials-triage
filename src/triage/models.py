"""What a run returns. Every value is an Evidence record (E#) and every paper a Paper (L#)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class NotDone(BaseModel):
    request_part: str
    category: Literal["instrument_or_lab_action", "private_or_internal_data", "paywalled_or_closed_source",
                      "fabrication_request", "policy_override", "unknown_property", "off_topic", "other"]
    explanation: str


class Sentence(BaseModel):
    text: str
    citations: list[str] = Field(description="Evidence IDs (E# or L#) supporting this sentence.")


class Evidence(BaseModel):
    id: str
    dataset: str
    material_id: str
    formula: str
    field: str
    value: float | str | None
    unit: str
    description: str  # the dataset's own description of the field
    source: str
    url: str


class Paper(BaseModel):
    id: str
    formula: str
    title: str
    year: int | None
    url: str
    quote: str | None = None  # set when the agent cites it and the quote is in the abstract
    note: str = ""
    relevant: bool = True  # its title or abstract contains one of the application terms
    names: list[str] = []  # materials it names: reduced compositions, or "mix:<elements>" for mixtures
    doped_names: list[str] = []  # doped hosts it names, same keys


class Candidate(BaseModel):
    rank: int | None  # position within its group; None for named materials that fail the filters
    group: Literal["ranked", "unvalidated", "incomplete", "flagged", "reference"] = "ranked"  # flagged: older results
    material_id: str
    formula: str
    url: str
    score_low: float | None
    score_high: float | None  # differs from score_low only when values are missing
    score_parts: dict[str, float | None] = {}  # ranking field -> its 0-1 position in the pool; None if missing
    values: dict[str, str]  # field -> evidence ID
    paper_ids: list[str] = []  # relevant papers that name this material's element set
    doped_ids: list[str] = []  # relevant papers that only name a doped variant (not direct support)
    quotes: dict[str, str] = {}  # paper ID -> a sentence naming this material with a specific application phrase
    # verified: a relevant paper naming it has a verified quote; None: literature not searched; the rest: older results
    tier: Literal["verified", "unverified", "established", "plausible", "unvalidated"] | None = None
    named: bool = False
    notes: list[str] = []


class Reference(BaseModel):
    """A material the agent named as a reference for the application, and what happened to it."""
    formula: str
    reason: str = ""
    fate: Literal["shortlisted", "unvalidated", "incomplete", "flagged", "fails", "missing", "excluded",
                  "not_found"] = "not_found"
    position: int | None = None  # within its group
    details: list[str] = []  # failing filters, missing fields or element rules


class CriteriaRow(BaseModel):
    kind: Literal["filter", "rank", "setting"]
    text: str
    removed: int | None = None
    missing: int | None = None  # materials with no value for the field at this step
    kept_missing: bool = False  # those were kept as unknown rather than removed
    source: str | None = None  # where the field's bias correction comes from


class Step(BaseModel):
    id: str
    label: str
    status: Literal["running", "done", "failed"] = "running"
    detail: str = ""


class Result(BaseModel):
    request_id: str
    created_at: str
    request: str
    status: Literal["ok", "clarify", "out_of_scope", "error"] = "ok"
    message: str = ""
    notes: str = ""
    not_done: list[NotDone] = []
    dataset: str = ""
    criteria_rows: list[CriteriaRow] = []
    candidates: list[Candidate] = []
    references: list[Reference] = []
    exclusions: dict[str, str] = {}  # element -> the agent's reason for excluding it
    penalized: dict[str, str] = {}  # older results only
    pool_size: int = 0
    not_ranked: list[str] = []
    summary: list[Sentence] = []
    removed: list[str] = []  # summary sentences the validator dropped, and why
    evidence: dict[str, Evidence] = {}  # from the final search only
    superseded_evidence: list[str] = []  # IDs from earlier searches in the same run, no longer shown or citable
    superseded_papers: list[str] = []  # likewise for literature records
    papers: dict[str, Paper] = {}
    caveats: list[str] = []
    notices: list[str] = []
    steps: list[Step] = []
