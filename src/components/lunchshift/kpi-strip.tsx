import { Check, X } from "lucide-react";
import type { KpiSet } from "@/lib/domain/types";
import type { KpiSuiteResult } from "@/lib/domain/view";
import { clock, money } from "./format";

interface Metric {
  label: string;
  value: string | null;
  target: string;
  onTarget: boolean | null;
}

function metrics(k: KpiSet | null): Metric[] {
  return [
    { label: "Unsafe items in cart", value: k ? String(k.unsafeItemsInCart) : null, target: "Target 0", onTarget: k ? k.unsafeItemsInCart === 0 : null },
    { label: "Meal completeness", value: k ? `${k.mealCompletenessPct}%` : null, target: "Target 100%", onTarget: k ? k.mealCompletenessPct === 100 : null },
    { label: "Shopper clicks per weekly order", value: k ? String(k.humanClicksPerOrder) : null, target: "Target 0", onTarget: k ? k.humanClicksPerOrder === 0 : null },
    { label: "Duplicate holds", value: k ? String(k.duplicateHolds) : null, target: "Target 0", onTarget: k ? k.duplicateHolds === 0 : null },
    {
      label: "Budget kept",
      value: k ? money(k.budgetKept.totalCents) : null,
      target: k ? `of ${money(k.budgetKept.budgetCents)} cap` : "Cap $35.00",
      onTarget: k ? k.budgetKept.kept : null,
    },
    { label: "Swaps traced to evidence", value: k ? `${k.swapsTracedPct}%` : null, target: "Target 100%", onTarget: k ? k.swapsTracedPct === 100 : null },
  ];
}

export function KpiStrip({ kpis, suite }: { kpis: KpiSet | null; suite: KpiSuiteResult | null }) {
  const passed = suite?.scenarios.filter((s) => s.pass).length ?? 0;
  return (
    <section className="rounded-xl border bg-card">
      <header className="flex items-baseline justify-between gap-4 px-6 pt-5">
        <h2 className="text-lg font-semibold tracking-[-0.01em]">This run, measured</h2>
        <span className="text-sm text-muted-foreground">
          {kpis ? "From the cart, the audit log and the store's read-back" : "Measured once the hold is verified"}
        </span>
      </header>
      <dl className="mt-4 grid grid-cols-2 overflow-hidden md:grid-cols-3 lg:grid-cols-6">
        {metrics(kpis).map((m) => (
          <div key={m.label} className="-ml-px border-t border-l px-4 py-5 md:px-6">
            <dt className="min-h-[2.75rem] text-sm leading-snug text-muted-foreground">{m.label}</dt>
            <dd
              key={m.value ?? "pending"}
              className={`mt-1 flex h-9 items-end leading-none font-semibold tracking-[-0.025em] animate-in fade-in-0 duration-300 ${m.value === null ? "text-[1.5rem] text-muted-foreground" : "text-[2.25rem]"}`}
            >
              {m.value ?? "Pending"}
            </dd>
            <dd className="mt-2 text-sm">
              <span className="text-muted-foreground">{m.target}</span>
              {m.onTarget === true ? <span className="ml-2 font-medium text-ok">Met</span> : null}
              {m.onTarget === false ? <span className="ml-2 font-medium text-refuse">Missed</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      <div className="border-t bg-sunken/50 px-6 py-4">
        {suite ? (
          <>
            <p className="text-sm">
              <span className="font-medium">KPI suite</span>{" "}
              <span className="text-muted-foreground">
                · <code className="font-mono text-[0.9375rem]">npm run kpi</code> · {passed} of {suite.scenarios.length} scenarios passed · ran{" "}
                {clock(suite.ranAt).slice(0, 5)}
              </span>
            </p>
            <ul className="mt-2 grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2">
              {suite.scenarios.map((s) => (
                <li key={s.name} className="flex items-start gap-2 text-[0.9375rem]" title={s.detail}>
                  {s.pass ? (
                    <Check className="mt-1 size-4 shrink-0 text-ok" aria-label="Passed" />
                  ) : (
                    <X className="mt-1 size-4 shrink-0 text-refuse" aria-label="Failed" />
                  )}
                  <span>
                    {s.name}
                    {!s.pass ? <span className="ml-2 text-sm text-refuse">{s.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No KPI suite run yet. Run <code className="font-mono text-[0.9375rem]">npm run kpi</code> to replay every scenario.
          </p>
        )}
      </div>
    </section>
  );
}
