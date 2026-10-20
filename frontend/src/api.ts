import type { Result, Step } from "./types";

const json = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
};

export type View = "summary" | "audit";
export const getUi = () => json<{ examples: string[]; view: View }>("/api/ui");
export const getHistory = () => json<{ request_id: string; request: string }[]>("/api/history");
export const getResult = (id: string) => json<Result>(`/api/results/${encodeURIComponent(id)}`);

/** POST a request and read the Server-Sent Events stream: step events, then one result. */
export async function runTriage(request: string, onStep: (s: Step) => void): Promise<Result> {
  const r = await fetch("/api/triage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ request }),
  });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let end;
    while ((end = buf.indexOf("\n\n")) >= 0) {
      const data = buf.slice(0, end).split("\n").find((l) => l.startsWith("data: "));
      buf = buf.slice(end + 2);
      if (!data) continue;
      const event = JSON.parse(data.slice(6));
      if (event.type === "step") onStep(event.step);
      if (event.type === "result") return event.result;
    }
  }
  throw new Error("stream ended without a result");
}
