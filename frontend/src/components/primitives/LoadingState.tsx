/* ─────────────────────────────────────────────────────────
 * LOADING STATE (Beautiful UI), Drive variant only:
 * pixel-grid wavefront, shimmering label, elapsed time.
 * ───────────────────────────────────────────────────────── */

import { useEffect, useState } from "react";

const DELAYS = Array.from({ length: 9 }, (_, i) => (i % 3 + Math.abs(Math.floor(i / 3) - 1)) * 90);

function useElapsed() {
  const [ds, setDs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setDs((d) => d + 1), 100);
    return () => clearInterval(t);
  }, []);
  const total = ds / 10;
  return total < 60 ? `${total.toFixed(1)}s` : `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

function Shimmer({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="bg-clip-text text-[13px] font-medium text-transparent"
      style={{
        backgroundImage: "linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)",
        backgroundSize: "200% 100%",
        animation: "shimmer-text 1.4s linear infinite",
      }}
    >
      {children}
    </span>
  );
}

export default function LoadingState({ label }: { label: string }) {
  const elapsed = useElapsed();
  return (
    <div role="status" className="flex w-fit items-center gap-2.5">
      <span aria-hidden className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]">
        {DELAYS.map((delay, i) => (
          <span key={i} className="size-[4px] rounded-[1px] bg-ink"
            style={{ opacity: 0.15, animation: `pixel-on 650ms ease-in-out ${delay}ms infinite` }} />
        ))}
      </span>
      <Shimmer>{label}</Shimmer>
      <span className="font-mono text-[12px] text-ink-3 tabular-nums">{elapsed}</span>
    </div>
  );
}
