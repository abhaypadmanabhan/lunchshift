// Routines the worker runs for each family: weekly plan, stock and label watch, school-calendar skips, budget alert.
// State (on/off, settings, last run) lives on the household record, so it persists per family.
import type { AppStore, Household, KpiSet } from "../lib/domain/types";
import type { RoutineView } from "../lib/domain/view";

export type RoutineId = RoutineView["id"];
export interface RoutineState {
  enabled: boolean;
  config: Record<string, unknown>;
  lastRun?: { at: string; result: string };
}
export type Routines = Record<RoutineId, RoutineState>;

const DAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function routinesOf(h: Household): Routines {
  const r = (h as Household & { routines?: Partial<Routines> }).routines ?? {};
  return {
    weekly_plan: r.weekly_plan ?? { enabled: true, config: { day: (h.mandate.window ?? "Sun").slice(0, 3), time: "16:00" } },
    stock_watch: r.stock_watch ?? { enabled: true, config: {} },
    school_skips: r.school_skips ?? { enabled: true, config: { days: h.skipDays ?? [] } },
    budget_alert: r.budget_alert ?? { enabled: true, config: { withinCents: 300 } },
  };
}

export function withRoutines(h: Household, routines: Routines): Household {
  const skips = routines.school_skips.enabled ? ((routines.school_skips.config.days as string[]) ?? []) : [];
  return { ...(h as Household & { routines?: Routines }), routines, skipDays: skips } as Household;
}

/** Next weekly-plan time (Pacific), from `now`. */
export function nextWeeklyRun(day: string, time: string, now = new Date()): string {
  const [hh, mm] = time.split(":").map(Number);
  const target = DAY_INDEX[day] ?? 0;
  // Work in Pacific time by offsetting: PST is UTC-8 in late November.
  const pacific = new Date(now.getTime() - 8 * 3600_000);
  const d = new Date(Date.UTC(pacific.getUTCFullYear(), pacific.getUTCMonth(), pacific.getUTCDate(), hh, mm));
  let add = (target - pacific.getUTCDay() + 7) % 7;
  if (add === 0 && d.getTime() <= pacific.getTime()) add = 7;
  d.setUTCDate(d.getUTCDate() + add);
  return new Date(d.getTime() + 8 * 3600_000).toISOString();
}

export function describe(id: RoutineId, s: RoutineState): { title: string; description: string } {
  switch (id) {
    case "weekly_plan":
      return { title: "Weekly plan", description: `Plans lunches and holds pickup every ${s.config.day ?? "Sun"} at ${s.config.time ?? "16:00"}` };
    case "stock_watch":
      return { title: "Stock and label watch", description: "Re-checks the cart when an item sells out or a label changes" };
    case "school_skips": {
      const days = (s.config.days as string[]) ?? [];
      return { title: "School calendar", description: days.length ? `No lunch on ${days.join(", ")} this week` : "Skips lunches on days with no school" };
    }
    case "budget_alert":
      return { title: "Budget alert", description: `Tells you when the week gets within $${(Number(s.config.withinCents ?? 300) / 100).toFixed(0)} of your budget` };
  }
}

/** Budget alert: after a run is measured, flag a cart close to (or over) the budget. Idempotent per run. */
export async function checkBudget(store: AppStore, h: Household, runId: string, k: KpiSet | null): Promise<string | null> {
  const r = routinesOf(h).budget_alert;
  if (!r.enabled || !k) return null;
  const within = Number(r.config.withinCents ?? 300);
  const total = k.budgetKept.totalCents;
  const budget = k.budgetKept.budgetCents;
  const events = await store.listEvents(runId);
  if (events.some((e) => e.data.budgetAlert === true)) return null;
  const result =
    total > budget
      ? `Over budget: $${(total / 100).toFixed(2)} of $${(budget / 100).toFixed(2)}`
      : budget - total <= within
        ? `Close to budget: $${(total / 100).toFixed(2)} of $${(budget / 100).toFixed(2)}`
        : null;
  await markRun(store, h.id, "budget_alert", result ?? `$${(total / 100).toFixed(2)} of $${(budget / 100).toFixed(2)} · fine`);
  if (!result) return null;
  await store.appendEvent({ runId, actor: "worker", type: "note", summary: `Budget alert: ${result}`, data: { budgetAlert: true, totalCents: total, budgetCents: budget } });
  return result;
}

/** Record a routine's last run on the household (re-reads the record so concurrent edits aren't lost). */
export async function markRun(store: AppStore, householdId: string, id: RoutineId, result: string) {
  const h = await store.getHousehold(householdId);
  if (!h) return;
  const routines = routinesOf(h);
  routines[id] = { ...routines[id], lastRun: { at: new Date().toISOString(), result } };
  await store.saveHousehold(withRoutines(h, routines));
}
