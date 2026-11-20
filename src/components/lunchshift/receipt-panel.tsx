import { CircleCheck } from "lucide-react";
import type { Basket } from "@/lib/domain/types";
import type { RunView } from "@/lib/domain/view";
import { clock, money, shortDate, shortRef } from "./format";
import { Code, skuName } from "./primitives";

function BudgetBar({ total, budget }: { total: number; budget: number }) {
  const pct = Math.min(100, Math.round((total / budget) * 100));
  const over = total > budget;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[1.75rem] leading-none font-semibold tracking-[-0.02em]">{money(total)}</span>
        <span className="text-sm text-muted-foreground">of {money(budget)} budget</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken" role="img" aria-label={`${pct}% of budget`}>
        <div className={over ? "h-full bg-refuse" : "h-full bg-primary"} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CartLines({ basket }: { basket: Basket }) {
  return (
    <ul className="mt-4 space-y-1 text-[0.9375rem]" aria-label={`Cart version ${basket.version}`}>
      {basket.lines.map((l) => (
        <li key={l.skuId} className="flex justify-between gap-3">
          <span className="min-w-0 truncate">
            {l.name}
            {l.packs > 1 ? ` × ${l.packs}` : ""}
          </span>
          <span className="text-muted-foreground">{money(l.lineCents)}</span>
        </li>
      ))}
    </ul>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-sm text-muted-foreground">{k}</dt>
      <dd className="min-w-0 text-right text-[0.9375rem]">{v}</dd>
    </div>
  );
}

export function ReceiptPanel({ view }: { view: RunView }) {
  const { run, receipt, basket } = view;
  const budget = view.household.mandate.budgetCents;
  const status = run?.status ?? "none";

  // Keyed by status so pending -> verified fades in rather than snapping.
  return (
    <section className="flex h-full flex-col rounded-xl border bg-card p-6">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-[-0.01em]">Store pickup hold</h2>
        <span className="text-sm text-muted-foreground">Sandbox grocer</span>
      </header>
      <div key={status} className="flex flex-1 flex-col animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:slide-in-from-bottom-0">
        {receipt && status === "hold_verified" ? (
          <>
            <div className="rounded-lg bg-ok-soft px-4 py-3.5">
              <p className="flex items-center gap-2 text-[1.25rem] font-semibold text-ok">
                <CircleCheck className="size-5" aria-hidden /> Hold verified
              </p>
              <p className="mt-1 text-sm text-foreground/80">
                Read back from the store at {clock(receipt.verifiedAt)}.{" "}
                {receipt.matched ? "Lines, total and slot match." : "Read-back does not match the request."}
              </p>
            </div>
            <dl className="mt-4 divide-y">
              <Row k="Hold" v={<Code className="text-foreground">{shortRef(receipt.hold.holdId)}</Code>} />
              <Row k="Pickup" v={receipt.hold.slot.replace(/^Sun \d{4}-\d{2}-\d{2} /, "Sun ")} />
              <Row k="Expires" v={`${clock(receipt.hold.expiresAt).slice(0, 5)} · ${shortDate(receipt.hold.expiresAt)}`} />
              <Row
                k="Holds for this run"
                v={
                  <span className={receipt.activeHoldsForRun === 1 ? "font-medium text-ok" : "font-medium text-refuse"}>
                    {receipt.activeHoldsForRun} active
                  </span>
                }
              />
            </dl>
            <div className="mt-4">
              <BudgetBar total={receipt.hold.totalCents} budget={budget} />
            </div>
            <details className="group mt-4 text-sm">
              <summary className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground">
                {receipt.hold.lines.length} lines held
              </summary>
              <ul className="mt-2 space-y-1">
                {receipt.hold.lines.map((l) => (
                  <li key={l.skuId} className="flex justify-between gap-3">
                    <span>
                      {skuName(l.skuId)}
                      {l.packs > 1 ? ` × ${l.packs}` : ""}
                    </span>
                    <span className="text-muted-foreground">{money(l.unitPriceCents * l.packs)}</span>
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : status === "hold_pending" ? (
          <>
            <div className="rounded-lg bg-wait-soft px-4 py-3.5">
              <p className="flex items-center gap-2.5 text-[1.25rem] font-semibold text-wait">
                <span
                  aria-hidden
                  className="inline-block size-4 rounded-full border-2 border-wait/30 border-t-wait motion-safe:animate-spin"
                />
                Checking with the store
              </p>
              <p className="mt-1 text-sm text-foreground/80">
                The store&apos;s response was lost after the request. Reading the hold back by its operation key; it
                will not be placed twice.
              </p>
            </div>
            <dl className="mt-4 divide-y">
              {run?.operationKey ? <Row k="Operation key" v={<Code className="text-foreground">{run.operationKey}</Code>} /> : null}
              <Row k="Holds confirmed" v="Waiting for read-back" />
            </dl>
            {basket ? (
              <div className="mt-4">
                <BudgetBar total={basket.totalCents} budget={budget} />
                <CartLines basket={basket} />
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="rounded-lg bg-sunken px-4 py-3.5">
              <p className="text-[1.25rem] font-semibold">
                {status === "proposed" ? "No hold: suggestion only" : status === "swapped_waiting" ? "Cart repaired, no hold yet" : status === "escalated" ? "Escalated to the parent" : status === "failed" ? "Run failed" : "No run yet this week"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {status === "proposed"
                  ? "Suggest-only mode writes the swap as a proposal. The cart and the store stay untouched."
                  : status === "swapped_waiting"
                    ? "The swap is applied. Placing a hold needs the swap-and-hold mode."
                    : status === "escalated"
                      ? "The read-back did not match. Nothing more is sent to the store until a parent reviews it."
                      : status === "failed"
                        ? "See the audit trail for the step that failed."
                        : "The worker places the order in the Sunday 16:00-18:00 window."}
              </p>
            </div>
            {basket ? (
              <div className="mt-5">
                <p className="mb-2 text-sm text-muted-foreground">
                  Cart v{basket.version}
                  {status === "proposed" ? ", unchanged" : ", repaired"}
                </p>
                <BudgetBar total={basket.totalCents} budget={budget} />
                <CartLines basket={basket} />
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
