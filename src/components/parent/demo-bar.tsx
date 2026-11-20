"use client";

import { useEffect } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { RunView } from "@/lib/domain/view";
import { AutonomyControl } from "./autonomy";
import { AppButton } from "./ui";

/** The 3-minute recording, one step per click. Captions are written to sit under the video. */
export const DEMO_STEPS: { title: string; caption: string }[] = [
  { title: "Landing", caption: "Sunday morning. A parent opens LunchShift for the first time." },
  { title: "Chat setup", caption: "They describe Maya in their own words; Claude picks out the facts." },
  { title: "Save to memory", caption: "Each fact is confirmed, then saved to Cognee memory." },
  { title: "Plan this week", caption: "The agent shops live and refuses anything unsafe for Maya." },
  { title: "Review and hold", caption: "Under budget, and held for Sunday pickup on its own. Nothing paid." },
  { title: "Order placed", caption: "The order is placed. The parent pays at pickup." },
  { title: "Next Sunday", caption: "A week later, Maya's usual bread is sold out." },
  { title: "Payoff", caption: "Peanut-risk bread refused, Monday swapped, pickup held. Zero clicks." },
];

export function DemoBar({
  step,
  total,
  onStep,
  consoleHref,
  view,
  onRefresh,
}: {
  step: number;
  total: number;
  onStep: (n: number) => void;
  consoleHref: string;
  view: RunView;
  onRefresh: () => Promise<void>;
}) {
  const last = step >= total - 1;

  // Right arrow advances, left goes back, unless the parent is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "ArrowRight" && step < total - 1) onStep(step + 1);
      if (e.key === "ArrowLeft" && step > 0) onStep(step - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, total, onStep]);

  const s = DEMO_STEPS[step];
  return (
    <div className="fixed inset-x-0 top-0 z-40 border-b bg-background ">
      <div className="mx-auto flex min-h-16 max-w-[1320px] items-center gap-5 px-5 py-2">
        <p className="shrink-0 text-[0.9375rem] text-muted-foreground tabular-nums">
          {step + 1} / {total}
          <span className="ml-2 font-medium text-foreground">{s.title}</span>
        </p>
        <p key={step} className="ls-enter min-w-0 flex-1 truncate text-[1.0625rem]" aria-live="polite">
          {s.caption}
        </p>
        <div className="hidden w-[26rem] shrink-0 whitespace-nowrap xl:block">
          <AutonomyControl view={view} onRefresh={onRefresh} compact />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <AppButton variant="secondary" aria-label="Previous step" disabled={step === 0} onClick={() => onStep(step - 1)} className="w-11 px-0">
            <ArrowLeft className="size-[1.125rem]" aria-hidden />
          </AppButton>
          {last ? (
            <a href={consoleHref} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-base font-medium text-primary-foreground hover:bg-primary/90">
              Open console <ArrowRight className="size-[1.125rem]" aria-hidden />
            </a>
          ) : (
            <AppButton onClick={() => onStep(step + 1)}>
              Next step <ArrowRight className="size-[1.125rem]" aria-hidden />
            </AppButton>
          )}
        </div>
      </div>
    </div>
  );
}
