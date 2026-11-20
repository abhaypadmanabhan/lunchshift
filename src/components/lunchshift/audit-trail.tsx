"use client";

import { useState } from "react";
import type { AuditActor, AuditEvent } from "@/lib/domain/types";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { clock } from "./format";

/** Sponsor services read as their product name; LunchShift's own actors stay as they are. */
const ACTOR_LABEL: Record<AuditActor, string> = {
  worker: "worker",
  grocer: "grocer",
  parent: "parent",
  operator: "operator",
  statsig: "Statsig",
  cognee: "Cognee",
  ranker: "Ranker",
  llm: "Claude",
  sie: "SIE",
};

const DEFAULT_ROWS = 14;
const rowKey = (e: AuditEvent) => `${e.runId}-${e.seq}`;

export function AuditTrail({
  events,
  onOpenEvent,
  storedIn = "the app store",
}: {
  events: AuditEvent[];
  onOpenEvent: (e: AuditEvent) => void;
  storedIn?: string;
}) {
  // Rows present when the trail first renders are history; anything after that just arrived and gets the
  // 4 s wash (it plays once, on the row's mount, because row keys are stable).
  const [initial] = useState(() => new Set(events.map(rowKey)));
  const [showAll, setShowAll] = useState(false);
  const hidden = showAll ? 0 : Math.max(0, events.length - DEFAULT_ROWS);
  const shown = hidden > 0 ? events.slice(hidden) : events;

  return (
    <section className="rounded-xl border bg-card">
      <header className="flex items-baseline justify-between gap-4 px-6 pt-5 pb-3">
        <h2 className="text-lg font-semibold tracking-[-0.01em]">Audit trail</h2>
        <span className="text-sm text-muted-foreground">
          {events.length > 0 ? `${events.length} events, append-only in ${storedIn} · select a row for its evidence` : `Append-only in ${storedIn}`}
        </span>
      </header>
      {events.length === 0 ? (
        <p className="border-t px-6 py-5 text-muted-foreground">
          No events yet. The first line appears the moment the Sunday run starts.
        </p>
      ) : (
        <>
          {events.length > DEFAULT_ROWS ? (
            <div className="border-t px-6 py-2.5">
              <button
                type="button"
                aria-expanded={showAll}
                onClick={() => setShowAll((v) => !v)}
                className="rounded-sm text-sm font-medium underline decoration-muted-foreground/40 underline-offset-4 transition-colors duration-150 hover:decoration-foreground"
              >
                {showAll ? `Show the newest ${DEFAULT_ROWS} only` : `Show all ${events.length} events`}
              </button>
              {hidden > 0 ? <span className="ml-2 text-sm text-muted-foreground">{hidden} earlier rows hidden</span> : null}
            </div>
          ) : null}
          <ol className="border-t font-mono text-[0.9375rem]">
            {shown.map((e) => (
              <li key={rowKey(e)} className={initial.has(rowKey(e)) ? "border-b last:border-b-0" : "ls-arrive border-b last:border-b-0"}>
                <button
                  type="button"
                  onClick={() => onOpenEvent(e)}
                  className="grid w-full grid-cols-[2.5rem_5.5rem_5.5rem_1fr] items-baseline gap-3 px-6 py-2 text-left transition-colors duration-150 hover:bg-sunken/70 focus-visible:bg-sunken/70 focus-visible:outline-offset-[-2px]"
                >
                  <span className="text-muted-foreground">{String(e.seq).padStart(2, "0")}</span>
                  <span className="text-muted-foreground">{clock(e.at)}</span>
                  <span className={e.type === "candidate_rejected" ? "text-refuse" : e.type === "hold_verified" ? "text-ok" : e.type === "hold_response_lost" ? "text-wait" : ""}>
                    {ACTOR_LABEL[e.actor] ?? e.actor}
                  </span>
                  <span className="truncate text-foreground">{e.summary}</span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

/** `event` stays set while the sheet animates closed, so the content does not blank out mid-exit. */
export function EvidenceDrawer({
  event,
  open,
  onOpenChange,
}: {
  event: AuditEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => onOpenChange(next)}>
      <SheetContent side="right" className="w-[36rem] gap-0 bg-card sm:max-w-[36rem]">
        {event ? (
          <>
            <SheetHeader className="border-b px-6 py-5">
              <SheetTitle className="text-lg font-semibold">{event.summary}</SheetTitle>
              <SheetDescription className="text-sm">
                Event {event.seq} · {ACTOR_LABEL[event.actor] ?? event.actor} · {clock(event.at)} ·{" "}
                <code className="font-mono text-[0.9375rem]">{event.type}</code>
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
              <p className="mb-2 text-sm text-muted-foreground">
                Stored evidence for run <code className="font-mono text-[0.9375rem]">{event.runId}</code>
              </p>
              <pre className="rounded-lg bg-sunken p-4 font-mono text-[0.9375rem] leading-relaxed whitespace-pre-wrap break-words">
                {JSON.stringify(event.data, null, 2)}
              </pre>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
