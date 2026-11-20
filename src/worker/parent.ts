// Parent actions from the app. Each one is a recorded parent event; the background worker stays the only writer
// of plans and holds (these functions only record intent, supersede a stale run, or release a hold).
import { applyHouseholdUpdate, currentRunId, WEEK_OF } from "../lib/domain/household";
import { HOUSEHOLD } from "../lib/domain/fixture";
import type { AppStore, Run } from "../lib/domain/types";
import type { HouseholdUpdate, HouseholdUpdateResult } from "../lib/domain/view";
import { getMemory } from "../lib/memory";
import { ensureSeeded, grocerClient } from "./deps";
import { checkSku, hardRestrictions } from "../lib/domain/rules";
import { allProposals, draftKey, placeOrderFor } from "./runWeekly";
import { getAnalytics } from "../lib/autonomy";
import type { Basket } from "../lib/domain/types";

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

const EDITABLE = new Set(["proposed", "swapped_waiting"]);

/** The cart the parent sees: their draft if they edited it, else the agent's latest basket for the run. */
export async function cartBasket(store: AppStore, run: Run): Promise<{ basket: Basket | null; source: "agent" | "parent_draft" }> {
  const draft = await store.getBasket(draftKey(run.id));
  if (draft) return { basket: draft, source: "parent_draft" };
  const proposals = await allProposals(store, run.id);
  if (proposals.length) return { basket: proposals[proposals.length - 1].after, source: "agent" };
  return { basket: await store.getBasket(run.id), source: "agent" };
}

/** Set a cart line to `packs` (0 removes). Unsafe, out-of-stock or over-budget changes are refused with the reason. */
export async function updateCart(skuId: string, packs: number): Promise<{ ok: boolean; reason?: string; basket?: Basket }> {
  const store = await ensureSeeded();
  const h = (await store.getHousehold(HOUSEHOLD.id)) ?? HOUSEHOLD;
  const run = await store.getRun(currentRunId(h));
  if (!run) return { ok: false, reason: "No plan this week yet. Tap Plan my week first." };
  if (!EDITABLE.has(run.status)) {
    return { ok: false, reason: run.operationKey ? "Your pickup is held. Cancel the hold to edit the cart." : "The cart can't be edited right now." };
  }
  const n = Math.max(0, Math.min(20, Math.floor(packs)));
  const sku = (await grocerClient().catalog()).skus.find((s) => s.id === skuId);
  if (!sku) return { ok: false, reason: "That product isn't sold at this store." };
  const { basket } = await cartBasket(store, run);
  const lines = [...(basket?.lines ?? [])];
  const idx = lines.findIndex((l) => l.skuId === skuId);
  if (n > 0) {
    const d = checkSku(h, sku, n);
    if (!d.eligible) {
      const fact = hardRestrictions(h).find((f) => f.id === d.factId);
      const why = d.reasons.includes("allergen_warning")
        ? `${fact?.allergen ? `Contains ${fact.allergen.label.toLowerCase()}` : "Allergen warning"}: ${h.childName}'s allergy${fact ? ` (confirmed, revision ${fact.revision})` : ""}`
        : d.reasons.includes("missing_label_evidence")
          ? "No allergen statement on file for this exact product, so LunchShift can't confirm it's safe"
          : d.reasons.includes("conflicting_label_evidence")
            ? "The product's allergen sources disagree, so LunchShift won't risk it"
            : d.reasons.includes("out_of_stock")
              ? `Only ${sku.stock} in stock`
              : d.reasons.join(", ");
      await store.appendEvent({ runId: run.id, actor: "parent", type: "candidate_rejected", summary: `Parent tried to add ${sku.name}: refused (${why})`, data: { ...d, skuName: sku.name, parentAttempt: true } });
      return { ok: false, reason: why };
    }
    const line = { skuId, name: sku.name, packs: n, unitPriceCents: sku.priceCents, lineCents: n * sku.priceCents, usedBy: idx >= 0 ? lines[idx].usedBy : [] };
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
  } else if (idx >= 0) lines.splice(idx, 1);
  const total = lines.reduce((a, l) => a + l.lineCents, 0);
  if (total > h.mandate.budgetCents) {
    return { ok: false, reason: `That would make the cart $${(total / 100).toFixed(2)}, over your $${(h.mandate.budgetCents / 100).toFixed(2)} budget` };
  }
  const next: Basket = { version: (basket?.version ?? 1) + 1, lines: lines.sort((a, b) => a.skuId.localeCompare(b.skuId)), totalCents: total };
  await store.saveBasket(draftKey(run.id), next);
  await store.appendEvent({
    runId: run.id,
    actor: "parent",
    type: "cart_edited",
    summary: `Parent set ${sku.name} to ${n} pack${n === 1 ? "" : "s"}; cart v${next.version} $${(total / 100).toFixed(2)}`,
    data: { skuId, packs: n, totalCents: total, version: next.version },
  });
  return { ok: true, basket: next };
}

export async function placeOrderByParent(): Promise<{ ok: boolean; reason?: string; order?: import("../lib/domain/types").Order }> {
  const store = await ensureSeeded();
  const h = (await store.getHousehold(HOUSEHOLD.id)) ?? HOUSEHOLD;
  const r = await placeOrderFor({ store, grocer: grocerClient(), analytics: getAnalytics() }, currentRunId(h), "parent");
  return { ok: r.ok, reason: r.reason, order: r.order };
}
