// Mirrors src/triage/models.py.

export interface Step { id: string; label: string; status: "running" | "done" | "failed"; detail: string }

export interface CriteriaRow { kind: "filter" | "rank" | "setting"; text: string; removed: number | null; missing?: number | null; kept_missing?: boolean; source?: string | null }

export interface Evidence {
  id: string; dataset: string; material_id: string; formula: string; field: string;
  value: number | string | null; unit: string; description: string; source: string; url: string;
}

export interface Paper { id: string; formula: string; title: string; year: number | null; url: string; quote: string | null; note: string; relevant?: boolean }

export interface Candidate {
  rank: number | null; material_id: string; formula: string; url: string; score_low: number | null; score_high: number | null; score_parts?: Record<string, number | null>;
  values: Record<string, string>; paper_ids: string[]; named: boolean; notes: string[];
  quotes?: Record<string, string>;
  group?: "ranked" | "unvalidated" | "incomplete" | "flagged" | "reference"; doped_ids?: string[];
  tier?: "verified" | "unverified" | "established" | "plausible" | "unvalidated" | null;
}

export interface Reference {
  formula: string; reason: string; position: number | null; details: string[];
  fate: "shortlisted" | "unvalidated" | "incomplete" | "flagged" | "fails" | "missing" | "excluded" | "not_found";
}

export interface Sentence { text: string; citations: string[] }

export interface Result {
  request_id: string; request: string; status: "ok" | "clarify" | "out_of_scope" | "error"; message: string;
  notes: string; not_done: { request_part: string; explanation: string }[];
  dataset: string; criteria_rows: CriteriaRow[]; candidates: Candidate[]; pool_size: number; not_ranked: string[];
  summary: Sentence[]; removed: string[];
  evidence: Record<string, Evidence>; papers: Record<string, Paper>;
  caveats: string[]; notices: string[]; steps: Step[];
  references?: Reference[]; exclusions?: Record<string, string>;
}
