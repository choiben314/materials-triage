import { useState } from "react";
import type { Result } from "@/types";

/** Cited text: subtly highlighted; hover or focus previews the source, click opens it in the evidence list. */
export function Ref({ ids, res, onOpen, children }: {
  ids: string[]; res: Result; onOpen: (id: string) => void; children: React.ReactNode;
}) {
  const paper = ids.every((id) => id.startsWith("L"));
  // Open the preview toward the side with room, so it never widens the page.
  const [right, setRight] = useState(false);
  const place = (e: React.SyntheticEvent<HTMLElement>) =>
    setRight(e.currentTarget.getBoundingClientRect().left > window.innerWidth / 2);
  return (
    <span className="group/ref relative" onMouseEnter={place} onFocus={place}>
      {/* A link rather than a button, so long quotes wrap across lines. */}
      <a href={`#${ids[0]}`} onClick={(e) => { e.preventDefault(); onOpen(ids[0]); }}
        className={`rounded-[4px] px-[2px] text-inherit no-underline [box-decoration-break:clone] transition-colors ${
          paper ? "bg-green-tint hover:bg-green/15" : "bg-accent-tint hover:bg-accent/15"}`}>
        {children}
      </a>
      <span role="tooltip"
        className={`pointer-events-none absolute bottom-full z-20 mb-1 hidden w-max max-w-[min(20rem,80vw)] flex-col gap-1 rounded-control bg-surface px-2.5 py-2 text-left text-[11.5px] leading-snug text-ink-2 shadow-raised group-hover/ref:flex group-focus-within/ref:flex ${right ? "right-0" : "left-0"}`}
        style={{ animation: "fade-in 150ms ease-out 120ms both" }}>
        {ids.map((id) => {
          const e = res.evidence[id], p = res.papers[id];
          return (
            <span key={id} className="block">
              {e ? (
                <><span className="text-ink">{e.formula} · {e.field}</span> {fmt(e.value, e.unit)}
                  <span className="block text-ink-3">{e.source}, {e.material_id}</span></>
              ) : p ? (
                <><span className="text-ink">{p.title}</span>
                  <span className="block text-ink-3">{p.year ?? "year unknown"} · OpenAlex</span></>
              ) : id}
            </span>
          );
        })}
      </span>
    </span>
  );
}

const NUMBER = /(?<![\w.])-?\d+(?:\.\d+)?/g;

/** Where in `text` each citation shows up: the cited value, else the quote or the material's formula. */
function anchors(text: string, ids: string[], res: Result) {
  const spans: { start: number; end: number; ids: string[] }[] = [];
  const free = (a: number, b: number) => spans.every((s) => b <= s.start || a >= s.end);
  const add = (id: string, a: number, b: number) => {
    const same = spans.find((s) => s.start === a && s.end === b);
    if (same) same.ids.push(id);
    else if (free(a, b)) spans.push({ start: a, end: b, ids: [id] });
    else return false;
    return true;
  };
  const left: string[] = [];
  for (const id of ids) {
    const e = res.evidence[id];
    let hit = false;
    if (typeof e?.value === "number") {
      const unit = new RegExp(`^ ?${e.unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w/])`);
      // Prefer a number written with the value's unit, then any number that rounds to it.
      for (const withUnit of e.unit ? [true, false] : [false]) {
        for (const m of text.matchAll(NUMBER)) {
          const d = m[0].split(".")[1]?.length ?? 0;
          if (Math.abs(e.value - Number(m[0])) > 0.5 * 10 ** -d + 1e-9) continue;
          const u = withUnit && text.slice(m.index + m[0].length).match(unit);
          if (withUnit && !u) continue;
          if ((hit = add(id, m.index, m.index + m[0].length + (u ? u[0].length : 0)))) break;
        }
        if (hit) break;
      }
    } else if (typeof e?.value === "string" && e.value) {
      const i = text.toLowerCase().indexOf(e.value.toLowerCase());
      hit = i >= 0 && add(id, i, i + e.value.length);
    }
    if (!hit) left.push(id);
  }
  const rest: string[] = [];
  for (const id of left) {
    const q = res.papers[id]?.quote?.replace(/^[\s"'“‘]+|[\s."'”’]+$/g, "").toLowerCase();
    const i = q ? text.toLowerCase().indexOf(q) : -1;
    if (q && i >= 0 && add(id, i, i + q.length)) continue;
    // Text the sentence itself puts in quotation marks, when citing a paper.
    const quoted = res.papers[id] && [...text.matchAll(/(?<!\w)['"“‘]([^'"”’]{20,})['"”’]/g)].find(
      (m) => add(id, m.index + 1, m.index + 1 + m[1].length));
    if (quoted) continue;
    const f = (res.evidence[id] ?? res.papers[id])?.formula;
    const j = f ? text.search(new RegExp(`(?<![A-Za-z0-9])${f}(?![a-z0-9])`)) : -1;
    if (j >= 0 && add(id, j, j + f.length)) continue;
    rest.push(id);
  }
  return { spans: spans.sort((a, b) => a.start - b.start), rest };
}

/** A sentence with its citations anchored to the words they support. */
export function Cited({ text, ids, res, onOpen }: { text: string; ids: string[]; res: Result; onOpen: (id: string) => void }) {
  const { spans, rest } = anchors(text, ids, res);
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const s of spans) {
    out.push(text.slice(at, s.start),
      <Ref key={s.start} ids={s.ids} res={res} onOpen={onOpen}>{text.slice(s.start, s.end)}</Ref>);
    at = s.end;
  }
  out.push(text.slice(at));
  if (rest.length) out.push(" ", <Ref key="rest" ids={rest} res={res} onOpen={onOpen}>source</Ref>);
  return <>{out}</>;
}

export function fmt(v: number | string | null, unit = ""): string {
  if (typeof v === "string") return v;
  if (v === null) return "missing";
  const n = Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(3)));
  return unit ? `${n} ${unit}` : n;
}

export function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2" style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}>
      <div className="flex items-baseline gap-2 px-0.5">
        <h2 className="m-0 text-[13px] font-semibold text-ink">{title}</h2>
        {aside && <span className="ml-auto text-[12px] text-ink-3">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/** A collapsed-by-default list, to keep secondary detail out of the way. */
export function More({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group text-[12.5px] text-ink-2">
      <summary className="cursor-pointer list-none text-ink-3 hover:text-ink">
        <span className="inline-block transition-transform group-open:rotate-90">›</span> {label}
      </summary>
      <div className="mt-1.5 pl-3">{children}</div>
    </details>
  );
}
