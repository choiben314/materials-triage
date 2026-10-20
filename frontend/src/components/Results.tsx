import { useEffect, useRef, useState } from "react";
import FilterTable, { type Row } from "@/components/primitives/FilterTable";
import { ValuePill } from "@/components/atoms/ValuePill";
import { Cited, More, Ref, Section, fmt } from "./bits";
import type { Candidate, Reference, Result } from "@/types";

type Open = (id: string) => void;

// ------------------------------------------------------------------- summary

export function Summary({ res, onOpen }: { res: Result; onOpen: Open }) {
  const message = res.status !== "ok" && res.message;
  const notDone = res.not_done;
  return (
    <Section title="Summary">
      <div className="flex min-w-0 flex-col gap-3 rounded-card bg-surface px-4 py-3 shadow-card [overflow-wrap:anywhere]">
        {message && <p className="m-0 text-[13.5px] text-ink">{message}</p>}
        {res.summary.length > 0 && (
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-4 text-[13.5px] leading-relaxed text-ink">
            {res.summary.map((s, i) => (
              <li key={i}>
                <Cited text={s.text} ids={s.citations} res={res} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        )}
        {notDone.length > 0 && (
          <div className="rounded-control bg-accent-tint px-3 py-2 text-[12.5px] text-ink-2">
            <div className="mb-0.5 font-medium text-ink">Not done</div>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {notDone.map((u, i) => (
                <li key={i}>
                  <span className="text-ink">“{u.request_part}”</span>:{" "}
                  {u.explanation}
                </li>
              ))}
            </ul>
          </div>
        )}
        {res.notices.length > 0 && (
          <div className="rounded-control bg-orange-tint px-3 py-2 text-[12.5px] text-ink-2">
            {res.notices.map((n, i) => (
              <p key={i} className="m-0">
                {n}
              </p>
            ))}
          </div>
        )}
        {(res.caveats.length > 0 || res.removed.length > 0) && (
          <div className="flex flex-col gap-1">
            {res.caveats.length > 0 && (
              <More label={`Caveats (${res.caveats.length})`}>
                <ul className="m-0 flex list-disc flex-col gap-1 pl-4">
                  {res.caveats.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </More>
            )}
            {res.removed.length > 0 && (
              <More
                label={`Removed by the validator (${res.removed.length})`}
              >
                <ul className="m-0 flex list-disc flex-col gap-1 pl-4">
                  {res.removed.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </More>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ shortlist

const GROUPS = {
  ranked: ["Ranked shortlist: verified literature", "Pass every filter; a paper sentence names them and contains a specific application phrase"],
  unvalidated: ["No verified literature", "Pass every filter, but no relevant paper with a verified quote; in score order"],
  incomplete: ["Missing data", "Strong on the fields they have, but missing a filter or ranking value"],
} as const;

const TIER = {
  verified: ["verified literature", "bg-green-tint text-green", "A paper sentence names it and contains a specific application phrase"],
  unverified: ["no verified literature", "bg-field text-ink-3", "Searched, but no relevant paper with a verified quote"],
  // older results
  established: ["established", "bg-green-tint text-green", "At least 2 relevant papers with verified quotes"],
  plausible: ["plausible", "bg-accent-tint text-accent-ink", "1 relevant paper with a verified quote"],
  unvalidated: ["no verified literature", "bg-field text-ink-3", "Searched, but no relevant paper with a verified quote"],
} as const;

export function Shortlist({ res, onOpen }: { res: Result; onOpen: Open }) {
  if (!res.candidates.length && !res.not_ranked.length) return null;
  const group = (c: Candidate) => c.group ?? (c.rank === null ? "reference" : "ranked");
  const rows = (cands: Candidate[]): Row[] =>
    cands.map((c) => ({
      key: c.material_id,
      cells: [
        <span className="font-mono text-[12px] text-ink-2">{c.rank ?? "–"}</span>,
        <span className="flex min-w-0 flex-col items-start gap-0.5 leading-tight">
          <span className="font-medium break-words text-ink">
            {c.formula}
            {c.named && <ValuePill className="ml-1.5">reference</ValuePill>}
          </span>
          <a
            className="text-[11.5px] break-words text-ink-3 hover:text-accent-ink"
            href={c.url}
            target="_blank"
            rel="noreferrer"
          >
            {c.material_id}
          </a>
          {c.tier && (
            <span title={TIER[c.tier][2]} className={`rounded-full px-1.5 text-[10.5px] font-medium ${TIER[c.tier][1]}`}>
              {TIER[c.tier][0]}
            </span>
          )}
        </span>,
        c.score_low === null || c.score_high === null ? (
          <span className="text-[12px] text-ink-3">—</span>
        ) : (
          <span
            className="font-mono text-[12px] tabular-nums text-ink"
            title={formula(c)}
          >
            {c.score_low.toFixed(2)}
            {c.score_high - c.score_low > 1e-6 && (
              <span className="text-ink-3">–{c.score_high.toFixed(2)}</span>
            )}
          </span>
        ),
        <span className="flex min-w-0 flex-col items-start gap-0.5 text-[12px] leading-snug">
          {c.paper_ids.length || c.doped_ids?.length ? (
            <>
              {c.paper_ids.slice(0, 4).map((id) => (
                <span key={id} className="line-clamp-2 text-ink">
                  {c.quotes?.[id] && <span className="text-green" title={`Verifies ${c.formula}: “${c.quotes[id]}”`}>✓ </span>}
                  <Ref ids={[id]} res={res} onOpen={onOpen}>
                    {res.papers[id].title}
                  </Ref>
                </span>
              ))}
              {c.paper_ids.length > 4 && <span className="text-ink-3">+{c.paper_ids.length - 4} more</span>}
              {(c.doped_ids ?? []).slice(0, 2).map((id) => (
                <span key={id} className="line-clamp-2 text-ink-3" title="Names a doped variant; not direct support">
                  doped variant:{" "}
                  <Ref ids={[id]} res={res} onOpen={onOpen}>
                    {res.papers[id].title}
                  </Ref>
                </span>
              ))}
            </>
          ) : (
            <span className="text-ink-3">—</span>
          )}
        </span>,
        <span className="flex flex-col gap-0.5">
          {Object.entries(c.values).map(([field, id]) => (
            <span
              key={field}
              className="flex flex-wrap items-baseline gap-x-1.5 text-[12px] leading-snug"
            >
              <span className="text-ink-3">{field}</span>
              <span
                className={`font-mono ${res.evidence[id].value === null ? "text-orange" : "text-ink"}`}
              >
                <Ref ids={[id]} res={res} onOpen={onOpen}>
                  {fmt(res.evidence[id].value, res.evidence[id].unit)}
                </Ref>
              </span>
              {c.score_parts && field in c.score_parts && <Part value={c.score_parts[field]} />}
            </span>
          ))}
        </span>,
      ],
      note: c.notes.length > 0 && (
        <span className="text-orange">{c.notes.join(" ")}</span>
      ),
    }));
  const columns = [
    { label: "#", width: "1.75rem" },
    { label: "Material", width: "minmax(0,1fr)" },
    { label: "Score", width: "3.25rem" },
    { label: "Literature", width: "minmax(0,0.9fr)" },
    { label: "Values (ranking goals show their part of the score)", width: "minmax(0,1.5fr)" },
  ];
  const ranked = res.candidates.filter((c) => group(c) === "ranked");
  return (
    <>
      <Section
        title={GROUPS.ranked[0]}
        aside={`${res.dataset}: ${res.pool_size.toLocaleString()} pass the filters`}
      >
        <p className="m-0 px-0.5 text-[12px] leading-relaxed text-ink-2">
          <span className="font-medium text-ink">How the ranking works:</span> each ranking goal (
          {rankGoals(res)}) is scored by where the value falls in that field's range across the whole
          dataset (1st–99th percentile; log scale for long-tailed fields), from 0 (worst) to 1 (best).
          The score is the plain average. A missing value could be anywhere from 0 to 1, so the score
          becomes a range. Candidates with a paper sentence that names them and contains a specific
          application phrase (form words such as "thin film" don't count on their own) are listed here; the rest follow under "No verified literature". Both lists are in score order.
        </p>
        {ranked.length > 0 ? (
          <FilterTable columns={columns} rows={rows(ranked)} />
        ) : (
          <p className="m-0 px-0.5 text-[12.5px] text-ink-2">No material passes every filter with literature support.</p>
        )}
        {res.not_ranked.length > 0 && (
          <p className="m-0 px-0.5 text-[12px] text-ink-2">
            Not found in {res.dataset}: {res.not_ranked.join("; ")}.
          </p>
        )}
      </Section>
      {(["unvalidated", "incomplete"] as const).map((g) => {
        const cands = res.candidates.filter((c) => group(c) === g);
        return (
          cands.length > 0 && (
            <Section key={g} title={GROUPS[g][0]} aside={GROUPS[g][1]}>
              <FilterTable columns={columns} rows={rows(cands)} />
            </Section>
          )
        );
      })}
    </>
  );
}

const FATE: Record<Reference["fate"], string> = {
  shortlisted: "Ranked (verified literature)", unvalidated: "No verified literature", incomplete: "Missing data",
  flagged: "Flagged", fails: "Fails a filter", missing: "Missing a required value",
  excluded: "Excluded by an element rule", not_found: "Not in the dataset",
};

/** What happened to each reference material: the check an expert would make first. */
export function References({ res, onOpen }: { res: Result; onOpen: Open }) {
  if (!res.references?.length) return null;
  const good = (r: Reference) => r.fate === "shortlisted";
  return (
    <Section title="Reference materials" aside="Named by the agent (or you) as what an expert would expect to see">
      <div className="overflow-hidden rounded-card bg-surface shadow-card">
        <table className="w-full table-fixed border-collapse text-[12.5px]">
          <thead>
            <tr className="text-left text-[11.5px] text-ink-3">
              <th className="w-[18%] px-3 py-1.5 font-medium">Material</th>
              <th className="w-[38%] px-3 py-1.5 font-medium">Why it's a reference</th>
              <th className="px-3 py-1.5 font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {res.references.map((r) => {
              const c = res.candidates.find((c) => c.formula === r.formula);
              return (
                <tr key={r.formula} className="border-t border-line align-top">
                  <td className="px-3 py-1.5 font-medium break-words text-ink">{r.formula}</td>
                  <td className="px-3 py-1.5 text-ink-2">{r.reason}</td>
                  <td className="px-3 py-1.5">
                    <span className={good(r) ? "text-green" : r.fate === "not_found" ? "text-ink-3" : "text-orange"}>
                      {FATE[r.fate]}
                      {r.position ? ` #${r.position}` : ""}
                    </span>
                    {r.details.length > 0 && <span className="block text-[11.5px] text-ink-3">{r.details.join(" ")}</span>}
                    {c && !good(r) && Object.keys(c.values).length > 0 && (
                      <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11.5px] text-ink-3">
                        {Object.entries(c.values).map(([f, id]) => (
                          <span key={f}>
                            {f}{" "}
                            <Ref ids={[id]} res={res} onOpen={onOpen}>
                              {fmt(res.evidence[id].value, res.evidence[id].unit)}
                            </Ref>
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {res.exclusions && Object.keys(res.exclusions).length > 0 && (
          <p className="m-0 border-t border-line px-3 py-2 text-[12px] text-ink-2">
            <span className="font-medium text-ink">Excluded elements:</span>{" "}
            {Object.entries(res.exclusions).map(([el, why]) => `${el} (${why})`).join("; ")}
          </p>
        )}
      </div>
    </Section>
  );
}

/** One ranking goal's 0–1 part of the score, as a small bar. */
function Part({ value }: { value: number | null }) {
  return (
    <span
      className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-ink-3"
      title={value === null ? "Missing, so this part could be anywhere from 0 to 1" : "This goal's part of the score: where the value falls in the field's dataset-wide range, 0 worst to 1 best"}
    >
      <span className="relative h-1 w-8 overflow-hidden rounded-full bg-line">
        {value !== null && (
          <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${value * 100}%` }} />
        )}
      </span>
      {value === null ? "0–1" : value.toFixed(2)}
    </span>
  );
}

const rankGoals = (res: Result) =>
  res.criteria_rows.filter((r) => r.kind === "rank").map((r) => r.text.split(", scored")[0]).join("; ");

/** e.g. "(0.97 + 0.42 + 1.00) / 3 = 0.80" */
function formula(c: Candidate) {
  const parts = Object.values(c.score_parts ?? {});
  if (!parts.length || c.score_low === null) return "0 to 1";
  const terms = parts.map((p) => (p === null ? "0–1" : p.toFixed(2))).join(" + ");
  const range = c.score_high !== null && c.score_high - c.score_low > 1e-6 ? `${c.score_low.toFixed(2)}–${c.score_high.toFixed(2)}` : c.score_low.toFixed(2);
  return `(${terms}) / ${parts.length} = ${range}`;
}

// ------------------------------------------------------------------- criteria

const KIND = { filter: "Filter", rank: "Rank by", setting: "Setting" };

export function Criteria({ res }: { res: Result }) {
  if (!res.criteria_rows.length) return null;
  return (
    <Section title="Criteria">
      <div className="overflow-hidden rounded-card bg-surface shadow-card">
        {res.notes && (
          <p className="m-0 border-b border-line px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
            {res.notes}
          </p>
        )}
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="text-left text-[11.5px] text-ink-3">
              <th className="px-3 py-1.5 font-medium">Type</th>
              <th className="px-3 py-1.5 font-medium">Criterion</th>
              <th className="px-3 py-1.5 text-right font-medium">Removed</th>
              <th className="px-3 py-1.5 text-right font-medium">No value</th>
            </tr>
          </thead>
          <tbody>
            {res.criteria_rows.map((r, i) => (
              <tr key={i} className="border-t border-line align-top">
                <td className="px-3 py-1.5 whitespace-nowrap text-ink-3">
                  {KIND[r.kind]}
                </td>
                <td className="px-3 py-1.5 text-ink">
                  {r.text}
                  {r.source && (
                    <a href={r.source} target="_blank" rel="noreferrer" className="ml-1 text-[11.5px] text-accent-ink hover:underline">
                      source ↗
                    </a>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink-2">
                  {r.removed === null ? "" : r.removed.toLocaleString()}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-[11.5px] tabular-nums text-ink-3">
                  {r.missing ? `${r.missing.toLocaleString()} ${r.kept_missing ? "kept as unknown" : "removed"}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------- evidence

type Tab = "all" | "values" | "papers";

export function EvidenceList({
  res,
  focus,
}: {
  res: Result;
  focus: { id: string; n: number } | null;
}) {
  const [tab, setTab] = useState<Tab>("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const values = Object.values(res.evidence);
  const papers = Object.values(res.papers);

  useEffect(() => {
    if (!focus) return;
    const isPaper = focus.id.startsWith("L");
    setTab((t) => (t === "all" || (t === "papers") === isPaper ? t : "all"));
    setOpen((s) => new Set(s).add(focus.id));
    requestAnimationFrame(() => {
      const el = refs.current[focus.id];
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.animate(
        [{ background: "var(--accent-tint)" }, { background: "transparent" }],
        { duration: 1600 },
      );
    });
  }, [focus]);

  if (!values.length && !papers.length) return null;
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const items = [
    ...(tab !== "papers" ? values : []),
    ...(tab !== "values" ? papers : []),
  ];

  return (
    <Section title="Evidence">
      <div className="flex gap-1">
        {(
          [
            ["all", "All", values.length + papers.length],
            ["values", "Database values", values.length],
            ["papers", "Papers", papers.length],
          ] as const
        ).map(([k, l, n]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`flex h-6.5 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium ${tab === k ? "bg-surface text-ink shadow-btn" : "text-ink-2 hover:bg-hover"}`}
          >
            {l}
            <span className="text-[10.5px] tabular-nums text-ink-3">{n}</span>
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-card bg-surface shadow-card">
        {items.map((e) => {
          const isOpen = open.has(e.id);
          const paper = "title" in e;
          return (
            <div
              key={e.id}
              ref={(el) => {
                refs.current[e.id] = el;
              }}
              className="border-b border-line last:border-0"
            >
              <button
                type="button"
                onClick={() => toggle(e.id)}
                aria-expanded={isOpen}
                className="flex w-full items-baseline gap-2.5 px-3 py-2 text-left text-[12.5px] hover:bg-hover"
              >
                <span
                  className={`w-9 shrink-0 font-mono text-[11px] ${paper ? "text-green" : "text-ink-3"}`}
                >
                  {e.id}
                </span>
                <span className="w-24 shrink-0 truncate text-ink-2">
                  {e.formula}
                </span>
                {paper ? (
                  <>
                    <span className="min-w-0 flex-1 truncate text-ink">
                      {e.title}
                    </span>
                    <span className={`shrink-0 text-[11.5px] ${e.quote ? "text-green" : "text-ink-3"}`}>
                      {e.quote ? "quoted" : e.relevant === false ? "off-topic (no application term)" : "relevant, not quoted"}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-ink">
                      {e.dataset} · {e.field}
                    </span>
                    <span
                      className={`shrink-0 font-mono text-[12px] ${e.value === null ? "text-orange" : "text-ink"}`}
                    >
                      {fmt(e.value, e.unit)}
                    </span>
                  </>
                )}
                <span
                  className="w-3 shrink-0 text-ink-3"
                  style={{ transform: isOpen ? "rotate(90deg)" : "none" }}
                >
                  ›
                </span>
              </button>
              {isOpen && (
                <div className="flex flex-col gap-1 bg-inset px-3 py-2 pl-[58px] text-[12px] text-ink-2">
                  {paper ? (
                    <>
                      <a
                        className="text-ink hover:underline"
                        href={e.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {e.title} ↗
                      </a>
                      <span>
                        {e.formula} · {e.year ?? "year unknown"} · OpenAlex
                      </span>
                      {e.quote && (
                        <span className="border-l-2 border-line-strong pl-2 italic">
                          “{e.quote}”{" "}
                          <span className="not-italic text-ink-3">
                            (verified verbatim in the abstract)
                          </span>
                        </span>
                      )}
                      {e.note && <span className="text-orange">{e.note}</span>}
                    </>
                  ) : (
                    <>
                      <span>
                        {e.material_id} ·{" "}
                        <a
                          className="text-accent-ink hover:underline"
                          href={e.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {e.source} ↗
                        </a>
                      </span>
                      {e.description && <span className="text-ink-3">{e.description}</span>}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
