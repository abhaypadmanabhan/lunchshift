"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AuditEvent, RunStatus } from "@/lib/domain/types";
import type { IntegrationStatus, RunView } from "@/lib/domain/view";
import { Skeleton } from "@/components/ui/skeleton";
import { AuditTrail, EvidenceDrawer } from "@/components/lunchshift/audit-trail";
import { AutonomyPanel } from "@/components/lunchshift/autonomy-panel";
import { clock, shortDate } from "@/components/lunchshift/format";
import { KpiStrip } from "@/components/lunchshift/kpi-strip";
import { OperatorControls } from "@/components/lunchshift/operator-controls";
import { ReceiptPanel } from "@/components/lunchshift/receipt-panel";
import { RefusalHero } from "@/components/lunchshift/refusal-hero";
import { WeekPlan } from "@/components/lunchshift/week-plan";

const POLL_MS = 1500;

const RUN_HEADLINE: Record<RunStatus, { text: string; tone: "ok" | "wait" | "refuse" | "plain" }> = {
  scheduled: { text: "Sunday run scheduled", tone: "plain" },
  running: { text: "Placing this week's order", tone: "plain" },
  proposed: { text: "Monday swap proposed, waiting for approval", tone: "wait" },
  swapped_waiting: { text: "Cart repaired, no hold yet", tone: "plain" },
  hold_pending: { text: "Checking with the store", tone: "wait" },
  hold_verified: { text: "Pickup hold verified", tone: "ok" },
  escalated: { text: "Needs a parent", tone: "refuse" },
  failed: { text: "Run failed", tone: "refuse" },
};

const TONE = { ok: "text-ok", wait: "text-wait", refuse: "text-refuse", plain: "text-foreground" } as const;

function IntegrationsRow({ items }: { items: IntegrationStatus[] }) {
  return (
    <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm" aria-label="Integrations">
      {items.map((i) => (
        <li key={i.name} title={i.detail} className="flex items-baseline gap-1.5">
          <span>{i.name}</span>
          <span
            className={
              i.status === "live" ? "text-muted-foreground" : i.status === "fallback" ? "font-medium text-wait" : "font-medium text-wait"
            }
          >
            {i.status === "live" ? "live" : i.status === "fallback" ? "fallback" : "missing"}
          </span>
          {i.status !== "live" ? <span className="text-muted-foreground">({i.detail})</span> : null}
        </li>
      ))}
    </ul>
  );
}

function LoadingView() {
  return (
    <div className="grid grid-cols-12 gap-6" aria-busy="true" aria-label="Loading this week's run">
      <Skeleton className="col-span-8 h-[26rem] rounded-xl" />
      <Skeleton className="col-span-4 h-[26rem] rounded-xl" />
      <Skeleton className="col-span-8 h-[30rem] rounded-xl" />
      <Skeleton className="col-span-4 h-[30rem] rounded-xl" />
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<RunView | null>(null);
  const [error, setError] = useState<{ at: string } | null>(null);
  const [event, setEvent] = useState<AuditEvent | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const qs = useRef("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/state${qs.current}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setView((await res.json()) as RunView);
      setError(null);
    } catch {
      setError((prev) => prev ?? { at: new Date().toISOString() });
    }
  }, []);

  useEffect(() => {
    // Demo passthrough: /?state=a|b|c|d forwards to /api/state for the sample views.
    const s = new URLSearchParams(window.location.search).get("state");
    qs.current = s ? `?state=${encodeURIComponent(s)}` : "";
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const openEvent = useCallback((e: AuditEvent) => {
    setEvent(e);
    setDrawerOpen(true);
  }, []);

  const headline = view?.run ? RUN_HEADLINE[view.run.status] : null;

  return (
    <div className="min-h-screen">
      <header className="border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[86rem] items-center justify-between gap-6 px-4 md:px-10 py-4">
          <div className="flex items-baseline gap-4">
            <span className="text-xl font-semibold tracking-[-0.02em]">LunchShift</span>
            <span className="text-[0.9375rem] text-muted-foreground">
              {view ? `${view.household.childName}'s school lunches` : "School lunches"}
              {view?.run ? ` · Sunday order, ${shortDate(view.run.weekOf).replace(/, \d{4}$/, "")}` : ""}
            </span>
          </div>
          {headline ? (
            <p key={view?.run?.status} className={`text-[1.0625rem] font-semibold animate-in fade-in-0 duration-300 ${TONE[headline.tone]}`}>
              {headline.text}
              {view?.run ? <span className="ml-2 text-sm font-normal text-muted-foreground">updated {clock(view.run.updatedAt)}</span> : null}
            </p>
          ) : view ? (
            <p className="text-[1.0625rem] font-semibold">No run yet this week</p>
          ) : null}
        </div>
        {view ? (
          <div className="mx-auto max-w-[86rem] px-4 md:px-10 pb-3">
            <IntegrationsRow items={view.integrations} />
          </div>
        ) : null}
      </header>

      {error ? (
        <div role="status" className="border-b bg-wait-soft">
          <p className="mx-auto max-w-[86rem] px-4 md:px-10 py-2.5 text-[0.9375rem]">
            <span className="font-medium text-wait">Can&apos;t reach the LunchShift server.</span>{" "}
            <span className="text-muted-foreground">
              {view ? `Showing the last state received. ` : ""}Retrying every {POLL_MS / 1000} s since {clock(error.at)}.
            </span>
          </p>
        </div>
      ) : null}

      <main className="mx-auto max-w-[86rem] px-4 pt-8 pb-16 md:px-10">
        {!view ? (
          <LoadingView />
        ) : (
          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-12 lg:col-span-8">
              <RefusalHero view={view} onOpenEvent={openEvent} />
            </div>
            <div className="col-span-12 lg:col-span-4">
              <ReceiptPanel view={view} />
            </div>

            <div className="col-span-12 mt-4 lg:col-span-8">
              <WeekPlan
                view={view}
                onApprove={async () => {
                  await fetch("/api/parent/approve", { method: "POST" });
                  await load();
                }}
              />
            </div>
            <div className="col-span-12 mt-4 lg:col-span-4">
              <AutonomyPanel view={view} />
            </div>

            <div className="col-span-12 mt-10">
              <KpiStrip kpis={view.kpis} suite={view.kpiSuite} signedOff={view.events.some((e) => e.actor === "parent")} />
            </div>

            <div className="col-span-12 mt-4 lg:col-span-8">
              <AuditTrail events={view.events} onOpenEvent={openEvent} />
            </div>
            <div className="col-span-12 mt-4 lg:col-span-4">
              <OperatorControls onDone={() => void load()} />
            </div>
          </div>
        )}
      </main>

      <EvidenceDrawer event={event} open={drawerOpen} onOpenChange={setDrawerOpen} />
    </div>
  );
}
