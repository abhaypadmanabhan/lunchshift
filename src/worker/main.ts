// Background worker: runs with the browser closed. Triggers: the Sunday schedule, store stockout
// events, and re-checks of waiting runs (so a live Statsig flip is observed on the next tick).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { HOUSEHOLD } from "../lib/domain/fixture";
import { activeCatalog } from "../lib/domain/catalog";
import { activeHousehold, liveDeps, runIdNow } from "./deps";
import { currentWeekOf } from "../lib/domain/families";
import { checkBudget, markRun, routinesOf } from "./routines";
import { processRun } from "./runWeekly";
import { errorClass } from "../lib/store";

const TICK_MS = Number(process.env.WORKER_TICK_MS ?? 3000);
// Demo schedule: "Sunday 16:00" for the fixture week. WORKER_SCHEDULE_AT=now makes the run due at start.
const SCHEDULE_AT = process.env.WORKER_SCHEDULE_AT ?? "";
const STATE = ".data/worker-state.json";
const WAITING = new Set(["scheduled", "running", "proposed", "swapped_waiting", "hold_pending"]);
const WATCHED_SKUS = new Set(Object.values(activeCatalog().usualByRole));

type State = { lastStockEventSeq: number };
const load = (): State => {
  try {
    return JSON.parse(readFileSync(STATE, "utf8")) as State;
  } catch {
    return { lastStockEventSeq: 0 };
  }
};
const persist = (s: State) => {
  mkdirSync(".data", { recursive: true });
  writeFileSync(STATE, JSON.stringify(s));
};

async function main() {
  const deps = await liveDeps();
  if (process.env.WORKER_RESET_ON_START === "1") {
    await deps.store.reset(); // clean app state for the unattended full-auto proof
    await deps.store.saveHousehold(HOUSEHOLD);
    persist({ lastStockEventSeq: 0 });
  }
  const state = load();
  const dueAt = SCHEDULE_AT === "now" ? Date.now() : SCHEDULE_AT ? Date.parse(SCHEDULE_AT) : Number.POSITIVE_INFINITY;
  console.log(`[worker] up; tick ${TICK_MS} ms; schedule ${SCHEDULE_AT || "manual/stockout only"}`);
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const runId = await runIdNow(deps.store);
      const run = await deps.store.getRun(runId);
      // Reset detection: the store lost the run, so restart the event cursor too.
      if (!run && state.lastStockEventSeq > 0) {
        const evs = await deps.grocer.events(0);
        if (evs.length === 0) state.lastStockEventSeq = 0;
      }
      const household = await activeHousehold(deps.store);
      const routines = routinesOf(household);
      let trigger: "schedule" | "stockout_event" | null = null;
      const events = await deps.grocer.events(state.lastStockEventSeq);
      for (const e of events) {
        state.lastStockEventSeq = Math.max(state.lastStockEventSeq, e.seq);
        // Stock and label watch routine: a sold-out item in this family's cart triggers a re-check.
        if (e.kind === "stockout" && WATCHED_SKUS.has(e.skuId) && routines.stock_watch.enabled && household.onboarded !== false) trigger = "stockout_event";
      }
      if (events.length) persist(state);
      if (!run && Date.now() >= dueAt) trigger = trigger ?? "schedule";
      if (trigger || (run && WAITING.has(run.status))) {
        const r = await processRun(deps, {
          runId,
          householdId: (await activeHousehold(deps.store)).id,
          weekOf: currentWeekOf(),
          trigger: trigger ?? run?.trigger ?? "schedule",
        });
        if (!run || r.run.status !== run.status) {
          console.log(`[worker] ${r.run.id} -> ${r.run.status} (${r.run.effectiveMode})`);
          if (trigger === "stockout_event") await markRun(deps.store, household.id, "stock_watch", `Item sold out · ${r.run.status === "hold_verified" ? "re-planned and held" : r.run.status.replace(/_/g, " ")}`);
          if (trigger === "schedule") await markRun(deps.store, household.id, "weekly_plan", `Planned · ${r.run.status.replace(/_/g, " ")}`);
          await checkBudget(deps.store, household, r.run.id, await deps.store.getKpis(r.run.id));
        }
      }
    } catch (e) {
      console.error(`[worker] tick error: ${errorClass(e)}`);
    } finally {
      busy = false;
    }
  };
  await tick();
  const t = setInterval(tick, TICK_MS);
  const stop = () => {
    clearInterval(t);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main();
