"use client";

import type { AuditEvent } from "@/lib/domain/types";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { clock } from "./format";

export function AuditTrail({
  events,
  onOpenEvent,
  storedIn = "the app store",
}: {
  events: AuditEvent[];
  onOpenEvent: (e: AuditEvent) => void;
  storedIn?: string;
}) {
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
        <ol className="border-t font-mono text-[0.9375rem]">
          {events.map((e) => (
            <li key={`${e.runId}-${e.seq}`} className="border-b last:border-b-0">
              <button
                type="button"
                onClick={() => onOpenEvent(e)}
                className="grid w-full grid-cols-[2.5rem_5.5rem_5.5rem_1fr] items-baseline gap-3 px-6 py-2 text-left transition-colors duration-150 hover:bg-sunken/70 focus-visible:bg-sunken/70 focus-visible:outline-offset-[-2px]"
              >
                <span className="text-muted-foreground">{String(e.seq).padStart(2, "0")}</span>
                <span className="text-muted-foreground">{clock(e.at)}</span>
                <span className={e.type === "candidate_rejected" ? "text-refuse" : e.type === "hold_verified" ? "text-ok" : e.type === "hold_response_lost" ? "text-wait" : ""}>
                  {e.actor}
                </span>
                <span className="truncate text-foreground">{e.summary}</span>
              </button>
            </li>
          ))}
        </ol>
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
                Event {event.seq} · {event.actor} · {clock(event.at)} ·{" "}
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
