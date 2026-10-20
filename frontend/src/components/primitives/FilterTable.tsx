/* ─────────────────────────────────────────────────────────
 * TABLE (adapted from Beautiful UI's FilterTable): callers pass
 * columns and rows. Each row may carry a note line.
 * ───────────────────────────────────────────────────────── */

export type Column = { label: string; width: string };
export type Row = { key: string; cells: React.ReactNode[]; note?: React.ReactNode };

export default function FilterTable({ columns, rows, inline = 3 }: { columns: Column[]; rows: Row[]; inline?: number }) {
  const grid = { gridTemplateColumns: columns.map((c) => c.width).join(" ") };
  // Wide screens: a grid. Below 640px the first `inline` cells share a line and the rest stack.
  const cell = (i: number) =>
    `flex min-w-0 items-center break-words px-2.5 py-2 ${i < columns.length - 1 ? "sm:border-r sm:border-line" : ""} ` +
    (i < inline ? (i === 1 ? "max-sm:flex-1" : "") : "max-sm:basis-full max-sm:py-1");

  return (
    <div className="w-full">
      <div className="overflow-hidden rounded-card bg-surface shadow-card">
        <div>
          <div className="grid border-b border-line text-[12.5px] font-medium text-ink-2 max-sm:hidden" style={grid}>
            {columns.map((c, i) => <span key={c.label} className={cell(i)}>{c.label}</span>)}
          </div>
          {rows.map((r) => (
            <div key={r.key} className="border-b border-line text-[13px] last:border-0">
              <div className="max-sm:flex max-sm:flex-wrap max-sm:pb-1 sm:grid" style={grid}>
                {r.cells.map((c, i) => <span key={i} className={cell(i)}>{c}</span>)}
              </div>
              {r.note && <div className="px-2.5 pb-2 text-[12px] text-ink-2">{r.note}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
