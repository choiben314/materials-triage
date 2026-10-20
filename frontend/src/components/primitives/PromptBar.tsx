/* ─────────────────────────────────────────────────────────
 * PROMPT BAR (Beautiful UI), tall variant, cut down to what
 * this app uses: an auto-growing input, a send button, and
 * the @-menu styling reused for recent requests.
 * Enter sends, Shift+Enter adds a line, ↑↓ + Enter pick.
 * ───────────────────────────────────────────────────────── */

import { useEffect, useLayoutEffect, useRef, useState } from "react";

type Recent = { request_id: string; request: string };

function Icon({ children, size = 15, strokeWidth = 1.8 }: { children: React.ReactNode; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export default function PromptBar({ value, onChange, onSend, busy, placeholder, recent, onPickRecent, inputRef, docked = false }: {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  busy: boolean;
  placeholder: string;
  recent: Recent[];
  onPickRecent: (id: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  /** compact, docked at the bottom of a thread: menus open upward */
  docked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [engaged, setEngaged] = useState(false);
  const [rowBox, setRowBox] = useState<{ top: number; height: number } | null>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const canSend = value.trim().length > 0 && !busy;
  const minHeight = docked ? 40 : 68;

  /* grow with the text, up to a compact maximum */
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(Math.max(input.scrollHeight, minHeight), 200)}px`;
    input.style.overflowY = input.scrollHeight > 200 ? "auto" : "hidden";
  }, [value, inputRef, minHeight]);

  /* one highlight glides to the active row */
  useLayoutEffect(() => {
    const row = rowRefs.current[active];
    if (open && row) setRowBox({ top: row.offsetTop, height: row.offsetHeight });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const pick = (id: string) => {
    setOpen(false);
    onPickRecent(id);
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (!open) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      setEngaged(true);
      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : recent.length - 1)) % recent.length);
    } else if (e.key === "Enter") pick(recent[active].request_id);
    else if (e.key === "Escape") setOpen(false);
    else return false;
    e.preventDefault();
    return true;
  };

  return (
    <div ref={rootRef} className="relative">
      <div className={`relative isolate flex flex-col overflow-hidden rounded-[22px] border border-line bg-surface shadow-card ${docked ? "gap-1 p-2.5" : "gap-2.5 p-3.5"} transition-[border-color] duration-150 focus-within:border-line-strong`}>
        <textarea
          ref={inputRef}
          rows={1}
          value={value}
          aria-label="Request"
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (onMenuKey(e)) return;
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
          style={{ minHeight }}
          className="w-full min-w-0 resize-none bg-transparent px-2 py-2 text-[14px] leading-5 text-ink outline-none [overflow-wrap:anywhere] placeholder:text-ink-3"
        />
        <div className="flex items-center gap-1">
          {recent.length > 0 && (
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={open}
              onClick={() => {
                setActive(0);
                setEngaged(false);
                setOpen((o) => !o);
              }}
              onKeyDown={onMenuKey}
              className={`flex h-7 items-center gap-1.5 rounded-[8px] px-2 text-[12px] font-medium transition-colors duration-150 hover:bg-hover hover:text-ink ${open ? "bg-hover text-ink" : "text-ink-2"}`}
            >
              <Icon size={14}><g><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></g></Icon>
              Recent
            </button>
          )}
          <span className="ml-auto hidden text-[11.5px] text-ink-3 sm:inline">
            {busy ? "" : "Enter to send · Shift+Enter for a new line"}
          </span>
          <button
            type="button"
            aria-label={busy ? "Working" : "Send"}
            disabled={!canSend}
            onClick={onSend}
            className="ml-2 flex size-7 shrink-0 items-center justify-center rounded-[8px] transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.94] max-sm:ml-auto"
            style={{
              background: canSend ? "var(--ink)" : "var(--line-strong)",
              color: canSend ? "var(--surface)" : "var(--ink-2)",
            }}
          >
            {busy ? (
              <span className="size-3 rounded-full border-[1.5px] border-ink-3 border-t-ink"
                style={{ animation: "spin 700ms linear infinite" }} />
            ) : (
              <Icon size={16} strokeWidth={2.4}><path d="M12 19V5M5 12l7-7 7 7" /></Icon>
            )}
          </button>
        </div>
      </div>

      {open && (
        <div
          role="listbox"
          aria-label="Recent requests"
          onMouseLeave={() => setEngaged(false)}
          className={`absolute inset-x-0 z-10 max-h-[320px] ${docked ? "bottom-full mb-2" : "top-full mt-2"} overflow-y-auto rounded-[10px] bg-surface p-1 shadow-raised`}
          style={{ animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: docked ? "bottom center" : "top center" }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-1 rounded-[6px] bg-hover"
            style={{
              top: rowBox?.top ?? 0,
              height: rowBox?.height ?? 0,
              opacity: rowBox && engaged ? 1 : 0,
              transition: "top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease",
            }}
          />
          {recent.map((r, i) => (
            <button
              key={r.request_id}
              type="button"
              role="option"
              aria-selected={i === active}
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              onMouseEnter={() => {
                setActive(i);
                setEngaged(true);
              }}
              onClick={() => pick(r.request_id)}
              className="relative z-10 flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2 text-left"
            >
              <span className="shrink-0 text-ink-3">
                <Icon size={14}><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" /></Icon>
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{r.request}</span>
            </button>
          ))}
          <div className="mt-1 border-t border-line px-2 pt-1.5 pb-1 text-[11px] text-ink-3">
            Opens the saved result · ↑↓ to move, Enter to open
          </div>
        </div>
      )}
    </div>
  );
}
