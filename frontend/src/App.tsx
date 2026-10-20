import { useEffect, useRef, useState } from "react";
import { getHistory, getResult, getUi, runTriage, type View } from "./api";
import type { Result, Step } from "./types";
import PromptBar from "@/components/primitives/PromptBar";
import Thinking from "@/components/primitives/Thinking";
import {
  Criteria,
  EvidenceList,
  References,
  Shortlist,
  Summary,
} from "@/components/Results";

// Two depths of the same result. Named by content, not by role: a PI sometimes wants the audit.
const VIEWS = [
  ["summary", "Summary", "The answer: cited summary, what wasn't done, reference materials and the shortlist"],
  ["audit", "Audit", "Everything behind it: criteria and funnel, every evidence record, and the raw audit record"],
] as const;
// Older links and settings used "pi" and "technical".
const asView = (v?: string | null): View | null =>
  v === "summary" || v === "pi" ? "summary" : v === "audit" || v === "technical" ? "audit" : null;
const saved = () => {
  try {
    return asView(localStorage.getItem("view"));
  } catch {
    return null;
  }
};

export default function App() {
  const [text, setText] = useState("");
  const [examples, setExamples] = useState<string[]>([]);
  // The URL wins (shared links), then the reader's last choice, then the site default from config.
  const [view, setView] = useState<View>(
    () => asView(new URLSearchParams(location.search).get("view")) ?? saved() ?? "summary",
  );
  const [recent, setRecent] = useState<
    { request_id: string; request: string }[]
  >([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState("");
  const [error, setError] = useState("");
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const show = (r: Result) => {
    setRes(r);
    setSteps(r.steps);
    setAsked(r.request);
    setFocus(null);
    const url = new URL(location.href);
    url.searchParams.set("r", r.request_id);
    window.history.replaceState(null, "", url);
  };

  useEffect(() => {
    getUi()
      .then((u) => {
        setExamples(u.examples);
        if (!new URLSearchParams(location.search).get("view") && !saved()) setView(asView(u.view) ?? "summary");
      })
      .catch((e) => setError(String(e)));
    getHistory()
      .then(setRecent)
      .catch(() => {});
    const id = new URLSearchParams(location.search).get("r");
    // A link to a result that no longer exists just opens the empty page.
    if (id)
      getResult(id)
        .then(show)
        .catch(() => window.history.replaceState(null, "", "/"));
  }, []);

  const submit = async () => {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setAsked(q);
    setText("");
    setError("");
    setRes(null);
    setSteps([]);
    try {
      const r = await runTriage(q, (s) =>
        setSteps((cur) =>
          cur.some((x) => x.id === s.id)
            ? cur.map((x) => (x.id === s.id ? s : x))
            : [...cur, s],
        ),
      );
      show(r);
      setRecent((cur) =>
        [
          { request_id: r.request_id, request: r.request },
          ...cur.filter((h) => h.request !== r.request),
        ].slice(0, 15),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  // A new object each time, so clicking the same citation twice still scrolls to it.
  const changeView = (v: View, remember = true) => {
    setView(v);
    const url = new URL(location.href);
    url.searchParams.set("view", v);
    window.history.replaceState(null, "", url);
    if (remember)
      try {
        localStorage.setItem("view", v);
      } catch {
        /* private mode: the URL still carries it */
      }
  };

  // The evidence list is in the audit view, so a citation opens that view (without changing the saved choice).
  const openEvidence = (id: string) => {
    changeView("audit", false);
    setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
  };

  const reset = () => {
    setRes(null);
    setSteps([]);
    setAsked("");
    setError("");
    window.history.replaceState(null, "", "/");
    input.current?.focus();
  };

  const composer = (
    <PromptBar
      docked={!!asked}
      value={text}
      onChange={setText}
      onSend={submit}
      busy={busy}
      inputRef={input}
      placeholder={
        asked
          ? "Ask something else…"
          : "e.g. stable oxide photocatalysts with a band gap of 1.8–2.8 eV"
      }
      recent={busy ? [] : recent}
      onPickRecent={(id) =>
        getResult(id)
          .then((r) => {
            setError("");
            show(r);
          })
          .catch(() => setError("That saved result could not be opened."))
      }
    />
  );
  const errorBox = error && (
    <div className="rounded-card bg-red-tint px-3 py-2 text-[13px] text-red">
      {error}
    </div>
  );

  // Empty state: the prompt, centred.
  if (!asked)
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-[720px] flex-col justify-center gap-6 px-4 py-10">
        <div className="text-center" style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}>
          <h1 className="m-0 text-[26px] font-semibold tracking-tight text-ink">
            Which materials should we look at?
          </h1>
          <p className="m-0 mt-1.5 text-[14px] text-ink-3">
            Ranks candidate materials from public databases and open literature, with every value cited.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          {composer}
          {examples.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1.5">
              {examples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => {
                    setText(ex);
                    input.current?.focus();
                  }}
                  className="h-7 max-w-full truncate rounded-full bg-surface px-3 text-left leading-7 text-[12px] text-ink-2 shadow-btn transition-colors hover:bg-hover hover:text-ink"
                >
                  {ex}
                </button>
              ))}
            </div>
          )}
          {errorBox}
        </div>
      </div>
    );

  // A thread: the request, the agent's trace, its answer; the composer docked below.
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex h-12 items-center gap-2 bg-page/85 px-4 backdrop-blur md:px-6">
        <span className="truncate text-[14px] font-semibold text-ink">Materials Triage</span>
        <div
          role="tablist"
          aria-label="View"
          className="ml-3 flex shrink-0 rounded-full bg-field p-0.5"
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            const next = view === "summary" ? "audit" : "summary";
            changeView(next);
            (e.currentTarget.querySelector(`[data-view=${next}]`) as HTMLElement | null)?.focus();
          }}
        >
          {VIEWS.map(([v, label, hint]) => (
            <button
              key={v}
              type="button"
              role="tab"
              data-view={v}
              title={hint}
              aria-selected={view === v}
              tabIndex={view === v ? 0 : -1}
              onClick={() => changeView(v)}
              className={`h-6 rounded-full px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors ${view === v ? "bg-surface text-ink shadow-btn" : "text-ink-2 hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={reset}
          disabled={busy}
          className="ml-auto flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] px-2 text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink disabled:opacity-50"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="max-sm:sr-only">New request</span>
        </button>
      </header>

      <main className="mx-auto flex w-full max-w-[920px] min-w-0 flex-1 flex-col gap-6 px-4 pt-4 pb-10">
        <div
          className="ml-auto max-w-[80%] rounded-[18px] bg-field px-4 py-2.5 text-[14px] leading-relaxed text-ink [overflow-wrap:anywhere] whitespace-pre-wrap"
          style={{ animation: "fade-up 300ms cubic-bezier(0.23,1,0.32,1) both" }}
        >
          {asked}
        </div>
        <Thinking key={res?.request_id ?? "live"} steps={steps} working={busy} />
        {errorBox}
        {res && (
          <>
            <Summary res={res} onOpen={openEvidence} />
            <References res={res} onOpen={openEvidence} />
            <Shortlist res={res} onOpen={openEvidence} />
            {view === "audit" && (
              <>
                <Criteria res={res} />
                <EvidenceList res={res} focus={focus} />
                <a
                  href={`/api/results/${res.request_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="w-fit text-[12px] text-ink-3 hover:text-accent-ink"
                >
                  Audit record {res.request_id} (JSON) ↗
                </a>
              </>
            )}
          </>
        )}
      </main>

      <div className="sticky bottom-0 z-30 bg-gradient-to-t from-page from-60% to-transparent px-4 pt-6 pb-4">
        <div className="mx-auto w-full max-w-[920px]">{composer}</div>
      </div>
    </div>
  );
}
