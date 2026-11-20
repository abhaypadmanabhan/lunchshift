"use client";

import { useState } from "react";
import { cn } from "cn";
import { ChevronDown } from "lucide-react";
import type { RunView } from "@/lib/domain/view";
import { actorPlain, dayLabel, describeEvent, timeOfDay } from "./copy";
import { SectionTitle } from "./ui";

export function ActivityTab({ view }: { view: RunView }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const items = [...view.events].sort((a, b) => (a.at === b.at ? b.seq - a.seq : b.at.localeCompare(a.at)));

  if (!items.length) {
    return (
      <div className="rounded-lg bg-card px-5 py-10 text-center border">
        <p className="text-base font-medium">Nothing has happened yet this week</p>
        <p className="mt-1 text-[0.9375rem] text-muted-foreground">Everything LunchShift does on your behalf shows up here, in order.</p>
      </div>
    );
  }

  return (
    <section className="space-y-3" aria-labelledby="activity-title">
      <SectionTitle aside={dayLabel(items[0].at)}>
        <span id="activity-title">What LunchShift did</span>
      </SectionTitle>
      <ol className="divide-y overflow-hidden rounded-lg bg-card border">
        {items.map((e) => {
          const key = `${e.runId}:${e.seq}`;
          const open = openKey === key;
          const { title, detail } = describeEvent(e, view);
          return (
            <li key={key}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenKey(open ? null : key)}
                className="flex w-full items-start gap-4 px-5 py-4 text-left hover:bg-secondary/60"
              >
                <span className="w-[4.25rem] shrink-0 pt-px text-[0.9375rem] text-muted-foreground tabular-nums">{timeOfDay(e.at)}</span>
                <span className="min-w-0 flex-1 text-base leading-snug">{title}</span>
                <ChevronDown
                  className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-[var(--dur-base)]", open && "rotate-180")}
                  aria-hidden
                />
              </button>
              {open ? (
                <div className="ls-enter -mt-1 pr-5 pb-4 pl-[6.75rem]">
                  <p className="text-[0.9375rem] leading-snug">{detail}</p>
                  <p className="mt-1 text-[0.9375rem] text-muted-foreground">By {actorPlain(e).toLowerCase() === "you" ? "you" : actorPlain(e)}</p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
