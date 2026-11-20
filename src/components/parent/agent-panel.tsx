"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "cn";
import type { RunView } from "@/lib/domain/view";
import { Skeleton } from "@/components/ui/skeleton";
import { feedLines, type Sponsor } from "./agent-feed";
import { timeOfDay } from "./copy";

/** Sponsor wordmarks, set in type: weight and tracking differ a little so each reads as its own name. */
const MARK: Record<Sponsor, string> = {
  Cognee: "font-semibold tracking-[-0.01em]",
  "Superlinked SIE": "font-medium tracking-[-0.015em]",
  SingleStore: "font-semibold tracking-[-0.02em]",
  Claude: "font-medium tracking-[0em]",
  Statsig: "font-semibold tracking-[-0.01em]",
  Store: "font-medium",
  LunchShift: "font-semibold tracking-[-0.01em] text-primary",
  You: "font-medium",
  Stripe: "font-semibold tracking-[-0.02em]",
};

function Chip({ sponsor }: { sponsor: Sponsor }) {
  return (
    <span className={cn("inline-flex h-7 shrink-0 items-center rounded-full bg-sunken px-2.5 text-[0.9375rem] leading-none text-foreground/85", MARK[sponsor])}>
      {sponsor}
    </span>
  );
}

/**
 * "LunchShift at work": the agent's own side of the product, beside the parent's phone.
 * Lives in the desktop right rail (1280 px and wider), above the chat. Newest step at the bottom; new steps slide in.
 */
export function AgentPanel({ view, offlineSince, className }: { view: RunView | null; offlineSince: string | null; className?: string }) {
  const lines = view ? feedLines(view) : [];
  const seen = useRef<Set<string> | null>(null);
  const scroller = useRef<HTMLOListElement>(null);

  // Rows present on first paint stagger in once; rows that arrive later get the "just arrived" wash.
  const firstPaint = seen.current === null;
  const fresh = new Set(firstPaint ? [] : lines.filter((l) => !seen.current!.has(l.key)).map((l) => l.key));
  useEffect(() => {
    if (view) seen.current = new Set(lines.map((l) => l.key));
  });

  const count = lines.length;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: reduce || count === 0 ? "auto" : "smooth",
    });
  }, [count]);

  const last = lines.at(-1);
  const status = offlineSince
    ? `Offline · last heard ${view ? timeOfDay(view.generatedAt) : timeOfDay(offlineSince)}`
    : last
      ? `Working on its own · ${timeOfDay(last.at)}`
      : "Ready for Sunday";

  return (
    <aside aria-label="LunchShift at work" className={cn("flex min-h-0 flex-col overflow-hidden", className)}>
      <header className="px-6 pt-6 pb-4">
        <h2 className="text-[1.25rem] font-semibold leading-tight tracking-[-0.015em]">LunchShift at work</h2>
        <p className={cn("mt-0.5 text-[0.9375rem] tabular-nums", offlineSince ? "text-wait" : "text-muted-foreground")} role="status" aria-live="polite">
          {status}
        </p>
      </header>

      {!view ? (
        <div className="space-y-5 px-6 pt-2" aria-busy="true" aria-label="Loading LunchShift's steps">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-7 w-24 rounded-full" />
              <Skeleton className="h-5 flex-1 rounded-md" />
            </div>
          ))}
        </div>
      ) : !lines.length ? (
        <div className="flex flex-1 flex-col justify-center px-6 pb-10">
          <p className="text-lg font-semibold tracking-[-0.01em]">Nothing to show yet</p>
          <p className="mt-2 max-w-[24rem] text-base text-muted-foreground">
            Every step LunchShift takes for you appears here as it happens: what it remembered, what it refused, what it held.
          </p>
        </div>
      ) : (
        <ol
          ref={scroller}
          className={cn("relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-1 pb-6 [scrollbar-width:thin]", firstPaint && "ls-stagger")}
          aria-live="polite"
          aria-relevant="additions"
        >
          {lines.map((l, i) => {
            const isLast = i === lines.length - 1;
            return (
              <li key={l.key} className={cn("relative grid grid-cols-[1.25rem_1fr] gap-x-3", fresh.has(l.key) && "ls-enter")}>
                {/* the rail: a quiet line joining steps; the latest step's marker is filled */}
                <span aria-hidden className="relative flex justify-center">
                  {!isLast ? <span className="absolute top-5 bottom-0 w-px bg-border" /> : null}
                  <span
                    className={cn(
                      "relative mt-[0.4rem] size-2.5 rounded-full border-2 transition-colors duration-[var(--dur-slow)]",
                      isLast ? "border-primary bg-primary" : l.tone === "refuse" ? "border-refuse/70 bg-card" : "border-foreground/20 bg-card",
                    )}
                  />
                </span>
                <div className={cn("-mx-3 mb-1 rounded-lg px-3 pt-0 pb-4", fresh.has(l.key) && "ls-arrive")}>
                  <p className={cn("text-base leading-snug", l.tone === "done" && "font-medium")}>
                    {l.tone === "refuse" ? (
                      <>
                        <span className="font-medium text-refuse">{l.text.split(" ")[0]}</span> {l.text.split(" ").slice(1).join(" ")}
                      </>
                    ) : (
                      l.text
                    )}
                    {l.mono ? <span className="ml-1.5 font-mono text-[0.9375rem] text-foreground/80">{l.mono}</span> : null}
                  </p>
                  <div className="mt-1.5 flex items-center gap-2.5">
                    <Chip sponsor={l.sponsor} />
                    <span className="text-[0.9375rem] text-muted-foreground tabular-nums">{timeOfDay(l.at)}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <p className="border-t border-border/70 px-6 py-3 text-[0.9375rem] text-muted-foreground">The agent never pays. You approve payment.</p>
    </aside>
  );
}
