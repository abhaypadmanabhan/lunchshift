"use client";

import { useState } from "react";
import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import type { Order, SwapProposal } from "@/lib/domain/types";
import type { PlanRow, RunView } from "@/lib/domain/view";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DAY_NAME, money, refusalName, refusalReason, statusHeadline, swapReasonShort, timeOfDay } from "./copy";
import { MealTile } from "./meal-tile";
import { SafetyHero } from "./safety-hero";
import { OrderCard } from "./order-view";
import { AppButton, Notice, SectionTitle } from "./ui";
import { postParent } from "./use-run-view";

type Msg = { tone: "ok" | "wait" | "alert"; text: string } | null;

const STEPS = ["Planned", "Lunches safe", "Pickup held"] as const;

function stepIndex(view: RunView): number {
  switch (view.run?.status) {
    case "proposed":
    case "scheduled":
    case "running":
    case "superseded":
      return 0;
    case "swapped_waiting":
    case "hold_pending":
    case "escalated":
      return 1;
    case "hold_verified":
      return 2;
    default:
      return -1;
  }
}

function StatusCard({ view, onRefresh }: { view: RunView; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState<"approve" | "cancel" | "plan" | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const head = statusHeadline(view);
  const run = view.run;
  const step = stepIndex(view);
  const holdRef = view.receipt?.hold.holdId.match(/[0-9a-f]{8,}/i)?.[0].slice(0, 8).toUpperCase();
  const holdActive = run?.status === "hold_verified" && view.receipt?.hold.status !== "released";

  const act = async (kind: "approve" | "cancel" | "plan") => {
    setBusy(kind);
    setMsg(null);
    const path = { approve: "/api/parent/approve", cancel: "/api/parent/cancel-hold", plan: "/api/parent/plan" }[kind];
    const res = await postParent(path);
    setBusy(null);
    if (!res.ok) {
      setMsg({ tone: "alert", text: res.message });
      return;
    }
    setMsg({
      tone: "ok",
      text: {
        approve: "Approved · updating your cart",
        cancel: "Hold released · nothing was paid",
        plan: "On it · your week appears in seconds",
      }[kind],
    });
    await onRefresh();
  };

  return (
    <section
      aria-labelledby="status-title"
      className={cn("rounded-xl p-5", head.tone === "wait" ? "bg-wait-soft" : head.tone === "alert" ? "bg-refuse-soft" : "bg-card shadow-[0_1px_0_var(--border)]")}
    >
      <div key={run?.status ?? "none"} className="ls-enter">
        <h2 id="status-title" className="text-[1.375rem] font-semibold leading-tight tracking-[-0.015em]">
          {head.title}
        </h2>
        {head.body ? <p className="mt-1 text-base text-muted-foreground tabular-nums">{head.body}</p> : null}
        {holdActive && holdRef ? (
          <p className="mt-1 text-[0.9375rem] text-muted-foreground">
            Pay at pickup · ref <span className="font-mono text-foreground">{holdRef}</span>
          </p>
        ) : null}
      </div>

      {step >= 0 ? (
        <ol className="mt-5 grid grid-cols-3 gap-2" aria-label="Progress this week">
          {STEPS.map((s, i) => (
            <li key={s} aria-current={i === step ? "step" : undefined}>
              <span
                className={cn(
                  "block h-1 rounded-full transition-colors duration-[var(--dur-slow)]",
                  i <= step ? "bg-primary" : "bg-foreground/10",
                )}
              />
              <span className={cn("mt-2 block text-[0.9375rem]", i <= step ? "text-foreground" : "text-muted-foreground")}>{s}</span>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {run?.status === "proposed" ? (
          <AppButton busy={busy === "approve"} onClick={() => void act("approve")} className="flex-1">
            Approve
          </AppButton>
        ) : null}
        {holdActive ? (
          <AppButton variant="secondary" busy={busy === "cancel"} onClick={() => void act("cancel")}>
            Cancel hold
          </AppButton>
        ) : null}
        {!run || run.status === "failed" ? (
          <AppButton busy={busy === "plan"} onClick={() => void act("plan")} className="flex-1">
            Plan my week now
          </AppButton>
        ) : null}
      </div>
      {msg ? (
        <div className="mt-4">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      ) : null}
    </section>
  );
}

function LunchRow({ row, view, onWhy }: { row: PlanRow; view: RunView; onWhy: () => void }) {
  const changed = row.status !== "kept";
  return (
    <li className={cn("flex items-center gap-4 px-4 py-3.5 transition-colors duration-[var(--dur-slow)]", changed && "bg-ok-soft/70")}>
      <span className="w-8 shrink-0 text-[0.9375rem] text-muted-foreground">{row.day}</span>
      <MealTile recipeId={row.recipeId} name={row.recipeName} />
      <div className="min-w-0 flex-1">
        <p className="text-[1.0625rem] font-medium leading-snug">{row.recipeName}</p>
        {changed ? (
          <p className="-mb-2 flex flex-wrap items-center gap-x-1.5 text-[0.9375rem] leading-snug text-muted-foreground">
            <span className="font-medium text-ok">{row.status === "proposed_swap" ? "Suggested" : "Swapped"}</span>
            <span>· {swapReasonShort(view)} ·</span>
            <button
              type="button"
              onClick={onWhy}
              className="inline-flex min-h-11 items-center gap-0.5 rounded-md font-medium text-primary underline-offset-4 hover:underline"
            >
              Why? <ChevronRight className="size-4" aria-hidden />
            </button>
          </p>
        ) : null}
      </div>
    </li>
  );
}

function WhySheet({ view, proposal, row, open, onOpenChange }: { view: RunView; proposal?: SwapProposal; row?: PlanRow; open: boolean; onOpenChange: (o: boolean) => void }) {
  const child = view.household.childName;
  const allergyRefusal = view.refusals.find((r) => r.factText);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[88vh] w-full max-w-[440px] gap-0 overflow-y-auto rounded-t-2xl bg-card text-base">
        {open ? (
          <>
            <SheetHeader className="px-5 pt-6 pb-2">
              <SheetTitle className="pr-8 text-xl font-semibold tracking-[-0.01em]">
                {row ? `Why ${DAY_NAME[row.day] ?? row.day} changed` : `How LunchShift kept ${child || "your child"} safe`}
              </SheetTitle>
              <SheetDescription className="text-base">
                {row ? `${row.replacedRecipeName} → ${row.recipeName}` : "Every product it turned down this week, and why."}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-6 px-5 pt-3 pb-8">
              {view.stockout ? (
                <div>
                  <h3 className="text-[0.9375rem] font-medium text-muted-foreground">What happened</h3>
                  <p className="mt-1">{view.stockout.name} sold out at the store.</p>
                </div>
              ) : null}
              {view.refusals.length ? (
                <div>
                  <h3 className="text-[0.9375rem] font-medium text-muted-foreground">What LunchShift refused</h3>
                  <ul className="mt-2 divide-y rounded-lg bg-sunken">
                    {view.refusals.map((r) => (
                      <li key={r.candidateId} className="px-4 py-3">
                        <p className="font-medium">{refusalName(view, r)}</p>
                        <p className="text-[0.9375rem] text-muted-foreground">Because {refusalReason(r)}.</p>
                        {r.labelText ? <blockquote className="mt-2 border-l-2 border-refuse/50 pl-3 text-[0.9375rem]">“{r.labelText}”</blockquote> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {allergyRefusal?.factText ? (
                <div>
                  <h3 className="text-[0.9375rem] font-medium text-muted-foreground">What it remembered about {child}</h3>
                  <p className="mt-1">{allergyRefusal.factText}</p>
                  <p className="mt-1 text-[0.9375rem] text-muted-foreground">
                    Your rule{allergyRefusal.factRevision ? `, version ${allergyRefusal.factRevision}` : ""}
                    {view.memory?.provider === "cognee" ? ", recalled from LunchShift's memory" : ""}.
                  </p>
                </div>
              ) : null}
              {proposal ? (
                <div>
                  <h3 className="text-[0.9375rem] font-medium text-muted-foreground">Why this lunch</h3>
                  <p className="mt-1">{proposal.rationale}</p>
                  <p className="mt-2 text-[0.9375rem] text-muted-foreground">
                    Cart {money(proposal.before.totalCents)} → {money(proposal.after.totalCents)} of {money(view.household.mandate.budgetCents)}
                  </p>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export function WeekTab({
  view,
  onRefresh,
  onOpenOrder,
  onOpenActivity,
}: {
  view: RunView;
  onRefresh: () => Promise<void>;
  onOpenOrder: (o: Order) => void;
  onOpenActivity: () => void;
}) {
  const [whyDay, setWhyDay] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const proposalFor = (day: string) => view.proposals.find((p) => p.affectedDay === day);
  const whyRow = view.plan.find((p) => p.day === whyDay);
  return (
    <div className="space-y-6">
      <SafetyHero
        view={view}
        onWhy={() => {
          setWhyDay(null);
          setOpen(true);
        }}
      />

      <StatusCard view={view} onRefresh={onRefresh} />

      <OrderCard view={view} onOpen={(o) => onOpenOrder(o)} onRefresh={onRefresh} />

      <section aria-labelledby="lunches-title" className="space-y-3 pt-2">
        <SectionTitle aside="Monday to Friday">
          <span id="lunches-title">{view.household.childName}&apos;s lunches</span>
        </SectionTitle>
        {view.plan.length ? (
          <ul className="ls-stagger divide-y overflow-hidden rounded-xl bg-card shadow-[0_1px_0_var(--border)]">
            {view.plan.map((row) => (
              <LunchRow
                key={row.day}
                row={row}
                view={view}
                onWhy={() => {
                  setWhyDay(row.day);
                  setOpen(true);
                }}
              />
            ))}
          </ul>
        ) : (
          <div className="rounded-xl bg-card px-5 py-8 text-center shadow-[0_1px_0_var(--border)]">
            <p className="text-base font-medium">No lunches yet</p>
            <p className="mt-1 text-[0.9375rem] text-muted-foreground">Monday to Friday appear once the week is planned</p>
          </div>
        )}
        {view.run ? (
          <p className="px-1 text-[0.9375rem] text-muted-foreground">Updated {timeOfDay(view.run.updatedAt)}</p>
        ) : null}
      </section>

      <button
        type="button"
        onClick={onOpenActivity}
        className="flex w-full items-center gap-4 rounded-xl bg-card px-5 py-4 text-left shadow-[0_1px_0_var(--border)] hover:bg-secondary/60 stage:hidden"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-base font-medium">What LunchShift did</span>
          <span className="block text-[0.9375rem] text-muted-foreground tabular-nums">
            {view.events.length ? `${view.events.length} steps, each one recorded` : "Nothing yet this week"}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      <WhySheet view={view} proposal={whyDay ? proposalFor(whyDay) : undefined} row={whyRow} open={open} onOpenChange={setOpen} />
    </div>
  );
}
