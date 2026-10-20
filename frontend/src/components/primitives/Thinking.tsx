/* ─────────────────────────────────────────────────────────
 * THINKING (Beautiful UI), Steps variant, driven by the
 * agent's live tool calls instead of the demo sequence.
 * Expanded while working, with the loading-state header;
 * collapses when done, and stays expandable.
 * ───────────────────────────────────────────────────────── */

import { useState } from "react";
import type { Step } from "@/types";
import LoadingState from "./LoadingState";

export default function Thinking({ steps, working }: { steps: Step[]; working: boolean }) {
  const [manual, setManual] = useState<boolean | null>(null);
  const expanded = manual ?? working;
  const failed = steps.filter((s) => s.status === "failed").length;
  const done = `Ran ${steps.length} tool call${steps.length === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}`;

  return (
    <div className="flex w-full flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManual(!expanded)}
        className="-mx-1.5 flex w-fit items-center gap-2 rounded-control px-1.5 py-1 transition-colors duration-100 hover:bg-hover-2"
      >
        {working ? (
          <LoadingState label={steps.filter((s) => s.status === "running").at(-1)?.label ?? "Thinking"} />
        ) : (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--ink-3)">
              <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
            </svg>
            <span className="text-[13px] font-medium whitespace-nowrap text-ink-2" style={{ animation: "fade-in 350ms ease-out both" }}>
              {done}
            </span>
          </>
        )}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-300"
          style={{ transform: expanded ? "rotate(180deg)" : "none" }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <div
        className="grid transition-[grid-template-rows,opacity] duration-400"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          opacity: expanded ? 1 : 0,
          transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
        }}
      >
        <div className="overflow-hidden">
          <div className="relative mt-1 ml-[5px] pl-4">
            <span aria-hidden className="absolute top-0 bottom-2 left-[3px] w-px bg-line" />
            <div className="flex flex-col gap-1 py-1">
              {steps.map((s) => (
                <div key={s.id} className="flex min-h-7 w-full items-start gap-2 rounded-[6px] px-1.5 py-0.5"
                  style={{ animation: "fade-up 320ms cubic-bezier(0.23,1,0.32,1) both" }}>
                  <span className="flex h-[19px] shrink-0 items-center">
                    {s.status === "running" ? (
                      <span className="size-3 rounded-full border-[1.5px] border-line-strong border-t-ink-2"
                        style={{ animation: "spin 700ms linear infinite" }} />
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round"
                        strokeLinejoin="round" stroke={s.status === "failed" ? "var(--red)" : "var(--ink-3)"}>
                        <path d={s.status === "failed" ? "M18 6L6 18M6 6l12 12" : "M20 6L9 17l-5-5"} />
                      </svg>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium text-ink">{s.label}</span>
                    {s.detail && (
                      <span className="block text-[11.5px] leading-snug text-ink-3 [overflow-wrap:anywhere]">{s.detail}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
