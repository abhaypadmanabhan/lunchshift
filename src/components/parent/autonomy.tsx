"use client";

import { useEffect, useState } from "react";
import { cn } from "cn";
import { MODE_RANK, type AutonomyMode } from "@/lib/domain/types";
import type { RunView } from "@/lib/domain/view";
import { MODE_STEPS, modeLabel } from "./copy";
import { Notice } from "./ui";
import { postParent } from "./use-run-view";

/**
 * "How much can LunchShift do?" Ask me / Swap for me / Swap and hold, saved per family (POST /api/parent/autonomy).
 * Statsig sets the operator ceiling; when it is lower than the parent's choice, the line under the control says so.
 */
export function AutonomyControl({ view, onRefresh, compact = false }: { view: RunView; onRefresh: () => Promise<void>; compact?: boolean }) {
  const [chosen, setChosen] = useState<AutonomyMode>(view.mode.parentMax);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Follow the server unless a change is in flight.
  useEffect(() => {
    if (!pending) setChosen(view.mode.parentMax);
  }, [view.mode.parentMax, pending]);

  const pick = async (mode: AutonomyMode) => {
    if (mode === chosen || pending) return;
    const before = chosen;
    setChosen(mode);
    setPending(true);
    setErr(null);
    const res = await postParent("/api/parent/autonomy", { mode });
    if (!res.ok) {
      setChosen(before);
      setErr(res.message);
    } else {
      await onRefresh();
    }
    setPending(false);
  };

  const capped = MODE_RANK[view.mode.observed] < MODE_RANK[chosen];
  const detail = MODE_STEPS.find((s) => s.mode === chosen)?.detail;

  return (
    <div className={cn(compact ? "space-y-1.5" : "space-y-3")}>
      <div role="radiogroup" aria-label="How much can LunchShift do?" className="grid grid-cols-3 gap-1 rounded-lg bg-sunken p-1">
        {MODE_STEPS.map((s) => {
          const selected = s.mode === chosen;
          return (
            <button
              key={s.mode}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => void pick(s.mode)}
              className={cn(
                "flex items-center justify-center rounded-md px-2 text-center leading-tight transition-colors duration-[var(--dur-fast)]",
                compact ? "min-h-9 text-[0.9375rem]" : "min-h-11 text-[0.9375rem]",
                selected ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      {compact ? (
        capped ? (
          <p className="text-[0.9375rem] text-wait">Statsig allows up to {modeLabel(view.mode.observed)}</p>
        ) : null
      ) : (
        <>
          <p className="text-base">{detail}</p>
          {capped ? (
            <p className="rounded-lg bg-wait-soft px-4 py-3 text-[0.9375rem] leading-snug">
              Statsig allows up to <span className="font-medium">{modeLabel(view.mode.observed)}</span> right now, so LunchShift will{" "}
              {modeLabel(view.mode.effective).toLowerCase()} until that changes.
            </p>
          ) : null}
        </>
      )}
      {err ? <Notice tone="alert">{err}</Notice> : null}
    </div>
  );
}
