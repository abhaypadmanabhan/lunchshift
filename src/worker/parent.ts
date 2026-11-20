// Parent actions from the app. Each one is a recorded parent event; the background worker stays the only writer
// of plans and holds (these functions only record intent, supersede a stale run, or release a hold).
import { applyHouseholdUpdate, currentRunId, WEEK_OF } from "../lib/domain/household";
import { HOUSEHOLD } from "../lib/domain/fixture";
import type { AppStore, Run } from "../lib/domain/types";
import type { HouseholdUpdate, HouseholdUpdateResult } from "../lib/domain/view";
import { getMemory } from "../lib/memory";
import { ensureSeeded, grocerClient } from "./deps";

async function scheduleRun(store: AppStore, runId: string, trigger: Run["trigger"]) {
  if (await store.getRun(runId)) return;
  const now = new Date().toISOString();
  await store.upsertRun({
    id: runId,
    householdId: HOUSEHOLD.id,
    weekOf: WEEK_OF,
    trigger,
    status: "scheduled",
    observedMode: "suggest_only",
    effectiveMode: "suggest_only",
    basketVersion: 0,
    createdAt: now,
    updatedAt: now,
  });
}

/** Release the run's store hold (if any) and mark the run superseded, with the parent's reason in the audit. */
async function supersede(store: AppStore, run: Run, reason: string) {
  if (run.status === "superseded") return;
  let released = false;
  if (run.operationKey) {
    const h = await grocerClient().releaseHold(run.operationKey).catch(() => null);
    released = h?.status === "released";
  }
  await store.appendEvent({
    runId: run.id,
    actor: "parent",
    type: "note",
    summary: `${reason}${released ? "; the store hold was released" : ""}`,
    data: { superseded: true, holdReleased: released },
  });
  await store.upsertRun({ ...run, status: "superseded", updatedAt: new Date().toISOString() });
}

export async function updateHousehold(u: HouseholdUpdate): Promise<HouseholdUpdateResult> {
  const store = await ensureSeeded();
  const before = (await store.getHousehold(HOUSEHOLD.id)) ?? HOUSEHOLD;
  const { household, normalized } = applyHouseholdUpdate(before, u);
  const oldRun = await store.getRun(currentRunId(before));
  if (oldRun) await supersede(store, oldRun, `Parent changed ${household.childName}'s rules (revision ${household.policyRevision}); this plan is replaced`);
  await store.saveHousehold(household);
  const runId = currentRunId(household);
  await scheduleRun(store, runId, "manual");
  // Memory: re-seed Cognee with the new confirmed facts in the background (cognify takes ~30 s).
  void getMemory()
    .seed(household)
    .catch(() => undefined);
  return { ok: true, normalized, policyRevision: household.policyRevision, runId };
}

export async function planNow(): Promise<{ ok: boolean; runId: string }> {
  const store = await ensureSeeded();
  const h = (await store.getHousehold(HOUSEHOLD.id)) ?? HOUSEHOLD;
  const runId = currentRunId(h);
  await scheduleRun(store, runId, "manual");
  return { ok: true, runId };
}

export async function cancelHold(): Promise<{ ok: boolean; reason?: string }> {
  const store = await ensureSeeded();
  const h = (await store.getHousehold(HOUSEHOLD.id)) ?? HOUSEHOLD;
  const run = await store.getRun(currentRunId(h));
  if (!run?.operationKey) return { ok: false, reason: "No store hold this week" };
  await supersede(store, run, "Parent cancelled this week's pickup");
  return { ok: true };
}
