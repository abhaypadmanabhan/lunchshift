"use client";

import { useState } from "react";
import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import type { SwapProposal } from "@/lib/domain/types";
import type { PlanRow, RunView } from "@/lib/domain/view";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DAY_NAME, firstSentence, money, refusalName, refusalReason, statusHeadline, swapCause, timeOfDay } from "./copy";
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
        approve: "Approved. LunchShift is updating your cart now.",
        cancel: "Hold released. The store will put the groceries back; nothing was paid.",
        plan: "On it. Your week will appear here in a few seconds.",
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
        {head.body ? <p className="mt-1.5 text-base text-muted-foreground">{head.body}</p> : null}
        {holdActive && holdRef ? (
          <p className="mt-1 text-[0.9375rem] text-muted-foreground">
            Pickup ref <span className="font-mono text-foreground">{holdRef}</span> · you pay at the store
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
            Approve {view.proposals.length > 1 ? `${view.proposals.length} changes` : "change"}
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

function LunchRow({ row, proposal, view, onWhy }: { row: PlanRow; proposal?: SwapProposal; view: RunView; onWhy: () => void }) {
  const changed = row.status !== "kept";
  return (
    <li className={cn("px-5 py-4", changed && "bg-ok-soft/70")}>
      <div className="flex items-baseline gap-4">
        <span className="w-10 shrink-0 text-[0.9375rem] text-muted-foreground">{row.day}</span>
        <div className="min-w-0 flex-1">
          {changed ? (
            <p className="mb-0.5 text-[0.9375rem] font-medium text-ok">{row.status === "proposed_swap" ? "Suggested swap" : "Swapped for you"}</p>
          ) : null}
          <p className="text-base font-medium leading-snug">{row.recipeName}</p>
          {changed ? (
            <>
              <p className="mt-1 text-[0.9375rem] text-muted-foreground">
                {row.status === "proposed_swap" ? "Instead of" : "Was"}{" "}
                <span className="line-through decoration-foreground/40">{row.replacedRecipeName}</span>
              </p>
              <p className="mt-2 text-base leading-snug">
                {swapCause(view)} {proposal ? firstSentence(proposal.rationale) : null}
              </p>
              <button
                type="button"
                onClick={onWhy}
                className="mt-2 inline-flex min-h-11 items-center gap-1 rounded-md text-base font-medium text-primary underline-offset-4 hover:underline"
              >
                Why? <ChevronRight className="size-4" aria-hidden />
              </button>
            </>
          ) : null}
        </div>
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
        {row ? (
          <>
            <SheetHeader className="px-5 pt-6 pb-2">
              <SheetTitle className="pr-8 text-xl font-semibold tracking-[-0.01em]">Why {DAY_NAME[row.day] ?? row.day} changed</SheetTitle>
              <SheetDescription className="text-base">
                {row.replacedRecipeName} → {row.recipeName}
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

export function WeekTab({ view, onRefresh }: { view: RunView; onRefresh: () => Promise<void> }) {
  const [whyDay, setWhyDay] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const proposalFor = (day: string) => view.proposals.find((p) => p.affectedDay === day);
  const whyRow = view.plan.find((p) => p.day === whyDay);
  return (
    <div className="space-y-8">
      <StatusCard view={view} onRefresh={onRefresh} />

      <section aria-labelledby="lunches-title" className="space-y-3">
        <SectionTitle aside="Monday to Friday">
          <span id="lunches-title">{view.household.childName}&apos;s lunches</span>
        </SectionTitle>
        {view.plan.length ? (
          <ul className="divide-y overflow-hidden rounded-xl bg-card shadow-[0_1px_0_var(--border)]">
            {view.plan.map((row) => (
              <LunchRow
                key={row.day}
                row={row}
                proposal={proposalFor(row.day)}
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
            <p className="mt-1 text-[0.9375rem] text-muted-foreground">Once the week is planned, Monday to Friday show up here.</p>
          </div>
        )}
        {view.run ? (
          <p className="px-1 text-[0.9375rem] text-muted-foreground">Updated {timeOfDay(view.run.updatedAt)}</p>
        ) : null}
      </section>

      <WhySheet view={view} proposal={whyDay ? proposalFor(whyDay) : undefined} row={whyRow} open={open} onOpenChange={setOpen} />
    </div>
  );
}
