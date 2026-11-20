// Smoke test: store round-trip plus the fixture ranking. Run with the env file for SingleStore,
// without it for the SQLite fallback.  npx tsx [--env-file=<env>] scripts/smoke-store.ts
import assert from "node:assert/strict";
import { HOUSEHOLD, RECIPES, CATALOG, CATALOG_VERSION, PICKUP_SLOT } from "../src/lib/domain/fixture";
import type { Basket, KpiSet, Receipt, Run } from "../src/lib/domain/types";
import { buildRankQuery } from "../src/lib/ranking/features";
import { getRanker } from "../src/lib/ranking";
import { getStore, storeStatus } from "../src/lib/store";

const PREF_DIMS = ["pref_tag_match", "kid_favorite", "variety"];

async function main() {
  const store = await getStore();
  const status = await storeStatus();
  console.log(`provider=${store.provider}  (${status.detail})`);
  const runId = `smoke-${Date.now()}`;
  const now = new Date().toISOString();

  await store.saveHousehold(HOUSEHOLD);
  await store.saveRecipes(RECIPES);
  await store.saveLabelSnapshot(CATALOG);
  const run: Run = {
    id: runId, householdId: HOUSEHOLD.id, weekOf: "2026-11-22", trigger: "manual", status: "running",
    observedMode: "auto_swap_and_hold", effectiveMode: "auto_swap_and_hold", basketVersion: 1, createdAt: now, updatedAt: now,
  };
  await store.upsertRun(run);
  for (const [type, summary] of [
    ["run_started", "run started"], ["stockout_detected", "bread-harvest-ww sold out"], ["alternatives_ranked", "ranked 2 lunches"],
  ] as const) {
    await store.appendEvent({ runId, actor: "worker", type, summary, data: { runId } });
  }
  const basket: Basket = { version: 1, lines: [], totalCents: 0 };
  await store.saveBasket(runId, basket);
  const receipt: Receipt = {
    runId, operationKey: `hold:${runId}`, verifiedAt: now, matched: true, activeHoldsForRun: 1,
    hold: { holdId: "hold-smoke", operationKey: `hold:${runId}`, runId, status: "active", lines: [], totalCents: 0,
      slot: PICKUP_SLOT, expiresAt: now, fingerprint: "smoke", createdAt: now },
  };
  await store.saveReceipt(receipt);
  const kpis: KpiSet = {
    unsafeItemsInCart: 0, mealCompletenessPct: 100, humanClicksPerOrder: 0, duplicateHolds: 0,
    budgetKept: { kept: true, totalCents: 0, budgetCents: HOUSEHOLD.mandate.budgetCents }, swapsTracedPct: 100,
  };
  await store.saveKpis(runId, kpis);

  // Read back
  const events = await store.listEvents(runId);
  assert.deepEqual(events.map((e) => e.seq), [1, 2, 3], "events come back in gap-free seq order");
  console.log(`events: ${events.map((e) => `${e.seq}:${e.type}`).join(", ")}`);
  assert.equal((await store.getHousehold(HOUSEHOLD.id))?.childName, "Maya");
  assert.equal((await store.getRecipes()).length, RECIPES.length);
  assert.equal((await store.getRun(runId))?.id, runId);
  assert.ok((await store.listRuns(HOUSEHOLD.id)).some((r) => r.id === runId));
  assert.deepEqual(await store.getBasket(runId), basket);
  assert.deepEqual(await store.getReceipt(runId), receipt);
  assert.deepEqual(await store.getKpis(runId), kpis);
  console.log(`read back: household, ${RECIPES.length} recipes, run, basket, receipt, kpis (catalog ${CATALOG_VERSION})`);

  // Concurrent appends stay gap-free
  await Promise.all([1, 2, 3, 4].map((n) => store.appendEvent({ runId, actor: "worker", type: "note", summary: `c${n}`, data: {} })));
  assert.deepEqual((await store.listEvents(runId)).map((e) => e.seq), [1, 2, 3, 4, 5, 6, 7], "concurrent appends: no gaps, no dupes");
  console.log("concurrent appends: seq 1..7 gap-free");

  // Ranking: Monday sandwich is broken by the bread stockout
  const remaining = HOUSEHOLD.plan.filter((p) => p.day !== "Mon");
  const roles = remaining.flatMap((p) => RECIPES.find((r) => r.id === p.recipeId)?.lines.map((l) => l.role) ?? []);
  const query = buildRankQuery(HOUSEHOLD, remaining, roles);
  console.log(`query: maxPrep=${query.maxPrepMinutes} preferTags=${JSON.stringify(query.preferTags)} pantry=${query.pantryRoles.length} roles`);
  const candidates = RECIPES.filter((r) => ["r-rice-bean-bowl", "r-bean-quesadilla"].includes(r.id));
  const result = await (await getRanker()).rank(query, candidates);
  console.log(`ranker provider=${result.provider}${result.fallbackReason ? `  fallbackReason="${result.fallbackReason}"` : ""}`);
  for (const r of result.ranked) console.log(`  #${r.rank} ${r.id} score=${r.score}`);
  const contrib = result.inputs.contributions as Record<string, Record<string, number>>;
  const sum = (id: string, dims: string[]) => dims.reduce((a, d) => a + (contrib[id]?.[d] ?? 0), 0);
  const others = Object.keys(contrib[candidates[0]!.id] ?? {}).filter((d) => !PREF_DIMS.includes(d));
  const prefGap = sum("r-rice-bean-bowl", PREF_DIMS) - sum("r-bean-quesadilla", PREF_DIMS);
  const otherGap = sum("r-rice-bean-bowl", others) - sum("r-bean-quesadilla", others);
  console.log(`gap from preferences=${prefGap.toFixed(3)}  from prep/price/pantry=${otherGap.toFixed(3)} (negative: quesadilla is cheaper and faster)`);

  assert.equal(result.ranked[0]?.id, "r-rice-bean-bowl", "rice bowl must rank first");
  assert.ok(prefGap > 0 && otherGap < 0, "the gap comes from preferences, not from price/prep");
  const shortlist = result.inputs.shortlist as { provider: string; ranked: { id: string; score: number }[] };
  console.log(`shortlist provider=${shortlist.provider}: ${shortlist.ranked.map((r) => `${r.id}=${r.score.toFixed(3)}`).join(" ")}`);
  assert.equal(shortlist.provider, store.provider === "singlestore" ? "singlestore_vector" : "local_vector");
  assert.equal(result.provider, process.env.SIE_API_KEY ? "sie" : shortlist.provider);
  console.log("OK: all assertions passed");
  process.exit(0);
}

main().catch((e) => {
  console.error("SMOKE FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
