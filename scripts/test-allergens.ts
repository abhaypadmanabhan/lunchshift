// npm run test:allergens - any-allergy matrix. Exit 1 on any failure.
// The oracle below is written by hand from the fixture labels; it does not reuse the parser it checks.
import { CATALOG, HOUSEHOLD, RECIPES } from "../src/lib/domain/fixture";
import { normalizeAllergy, parseLabel } from "../src/lib/domain/allergens";
import { applyHouseholdUpdate, currentRunId } from "../src/lib/domain/household";
import type { Household } from "../src/lib/domain/types";
import { startGrocer, AGENT_TOKEN } from "../src/grocer/server";
import { GrocerClient } from "../src/grocer/client";
import { approveProposal, processRun, allProposals, type WorkerDeps } from "../src/worker/runWeekly";
import { FixtureMemory, MemoryStore, RecordingAnalytics, StaticAutonomy, TemplateExplainer } from "../src/worker/testing";
import { LocalVectorRanker } from "../src/lib/ranking/local";
import { buildRankQuery } from "../src/lib/ranking/features";

// ---- Oracle: what each exact SKU contains (C) and may contain (M), read by a person from its label line ----
const ORACLE: Record<string, { C: string[]; M: string[]; unknown?: boolean }> = {
  "bread-harvest-ww": { C: ["wheat"], M: [] },
  "bread-value-wheat": { C: ["wheat", "soy"], M: ["peanut"] },
  "bread-artisan-sour": { C: [], M: [], unknown: true },
  "seed-butter-sun": { C: [], M: [] },
  "apple-gala": { C: [], M: [] },
  "tortilla-flour": { C: ["wheat"], M: [] },
  "cheddar-sticks": { C: ["milk"], M: [] },
  "grapes-red": { C: [], M: [] },
  "pasta-rotini": { C: ["wheat"], M: ["egg"] },
  "tomato-cherry": { C: [], M: [] },
  "pita-mini": { C: ["wheat"], M: [] },
  "hummus-classic": { C: ["sesame"], M: [] },
  "carrot-baby": { C: [], M: [] },
  "turkey-sliced": { C: [], M: [] },
  "rice-jasmine": { C: [], M: [] },
  "beans-black": { C: [], M: [] },
  "corn-sweet": { C: [], M: [] },
  "bread-gf": { C: ["egg"], M: [] },
  "noodles-rice": { C: [], M: [] },
  "sauce-thai-peanut": { C: ["peanut", "soy"], M: [] },
};
// Custom (free-text) allergens: which products a person would say contain them.
const CUSTOM_ORACLE: Record<string, string[]> = { kiwi: [], grape: ["grapes-red"], carrot: ["carrot-baby"], sunflower: ["seed-butter-sun"], tomato: ["tomato-cherry"] };

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log(`  FAIL ${msg}`);
};

function unitNormalize() {
  console.log("\n1. Normalizing what a parent types");
  const cases: [string, string | null][] = [
    ["peanuts", "peanut"], ["Peanut", "peanut"], ["peanut butter", "peanut"], ["groundnuts", "peanut"],
    ["tree nuts", "tree_nut"], ["nuts", "tree_nut"], ["almonds", "tree_nut"], ["Cashew", "tree_nut"],
    ["dairy", "milk"], ["Milk", "milk"], ["lactose intolerance", "milk"], ["cheese", "milk"],
    ["eggs", "egg"], ["egg allergy", "egg"], ["gluten", "wheat"], ["wheat", "wheat"], ["Gluten-free", "wheat"],
    ["soy", "soy"], ["soya", "soy"], ["sesame", "sesame"], ["sesame seeds", "sesame"], ["tahini", "sesame"],
    ["fish", "fish"], ["salmon", "fish"], ["shellfish", "shellfish"], ["shrimp", "shellfish"], ["Crab", "shellfish"],
    ["kiwi", "custom:kiwi"], ["Kiwis", "custom:kiwi"], ["grapes", "custom:grape"], ["strawberries", "custom:strawberry"],
    ["", null], ["   ", null], ["allergic to", null],
  ];
  let ok = 0;
  for (const [input, want] of cases) {
    const got = normalizeAllergy(input)?.id ?? null;
    if (got === want) ok++;
    else fail(`normalize(${JSON.stringify(input)}) = ${got}, want ${want}`);
  }
  console.log(`  ${ok}/${cases.length} inputs normalized correctly`);
}

function unitLabels() {
  console.log("\n2. Reading every product label (parser vs hand-written oracle)");
  let ok = 0;
  for (const sku of CATALOG) {
    const o = ORACLE[sku.id];
    if (!o) {
      fail(`no oracle row for ${sku.id}`);
      continue;
    }
    if (o.unknown) {
      ok++;
      continue;
    }
    const p = parseLabel(sku.label.sourceText);
    const c = [...p.contains].sort().join(",");
    const m = [...p.mayContain].sort().join(",");
    if (c === [...o.C].sort().join(",") && m === [...o.M].sort().join(",")) ok++;
    else fail(`${sku.id}: parsed contains [${c}] may [${m}], want [${o.C}] / [${o.M}]`);
  }
  console.log(`  ${ok}/${CATALOG.length} labels parsed exactly`);
}

/** Does this SKU violate any of the household's allergies, by the oracle? */
function violates(skuId: string, allergies: { id: string; crossContact: boolean }[]): string | null {
  const o = ORACLE[skuId];
  if (!o || o.unknown) return "no label evidence";
  for (const a of allergies) {
    if (a.id.startsWith("custom:")) {
      const key = a.id.slice("custom:".length);
      if ((CUSTOM_ORACLE[key] ?? []).includes(skuId)) return a.id;
      continue;
    }
    if (o.C.includes(a.id)) return a.id;
    if (a.crossContact && o.M.includes(a.id)) return `${a.id} (may contain)`;
  }
  return null;
}

async function engineCase(name: string, allergies: { text: string; crossContact: boolean }[], expect: { swapsAtLeast?: number; swapsExactly?: number; escalate?: boolean }) {
  const grocer = await startGrocer({ port: 0, dbPath: ":memory:" });
  try {
    const client = new GrocerClient(grocer.url, AGENT_TOKEN, 1500);
    const store = new MemoryStore();
    const { household } = applyHouseholdUpdate(HOUSEHOLD as Household, { allergies });
    await store.saveHousehold(household);
    await store.saveRecipes(RECIPES);
    const deps: WorkerDeps = {
      store,
      grocer: client,
      memory: new FixtureMemory(household.facts),
      autonomy: new StaticAutonomy("auto_swap_and_hold"),
      analytics: new RecordingAnalytics(),
      ranker: new LocalVectorRanker(),
      explainer: new TemplateExplainer(),
      buildRankQuery: (h, kept, roles) => buildRankQuery(h, kept, roles, RECIPES),
    };
    const runId = currentRunId(household);
    const opts = { runId, householdId: household.id, weekOf: "2026-11-22", trigger: "manual" as const };
    const r1 = await processRun(deps, opts);
    const allergyIds = household.facts.filter((f) => f.allergen).map((f) => ({ id: f.allergen!.id, crossContact: f.allergen!.crossContact }));
    const proposals = await allProposals(store, runId);
    const problems: string[] = [];

    if (expect.escalate) {
      if (r1.run.status !== "escalated") problems.push(`expected escalation, got ${r1.run.status}`);
    } else {
      // Rules changed since the standing approval: the plan must wait for the parent, untouched at the store.
      if (r1.run.status !== "proposed") problems.push(`expected proposed (rules changed), got ${r1.run.status}`);
      if ((await client.listHolds(runId)).length) problems.push("store hold before approval");
      const r2 = await approveProposal(deps, runId);
      if (r2.run.status !== "hold_verified") problems.push(`after approval: ${r2.run.status}`);
      const holds = (await client.listHolds(runId)).filter((h) => h.status === "active");
      if (holds.length !== 1) problems.push(`${holds.length} active holds`);
      for (const l of holds[0]?.lines ?? []) {
        const v = violates(l.skuId, allergyIds);
        if (v) problems.push(`held ${l.skuId} violates ${v}`);
      }
      const k = await store.getKpis(runId);
      if (k?.mealCompletenessPct !== 100) problems.push(`meal completeness ${k?.mealCompletenessPct}`);
      if (!k?.budgetKept.kept) problems.push(`over budget ${k?.budgetKept.totalCents}`);
      if (k?.unsafeItemsInCart !== 0) problems.push(`unsafe items ${k?.unsafeItemsInCart}`);
      if (expect.swapsExactly !== undefined && proposals.length !== expect.swapsExactly) problems.push(`${proposals.length} swaps, want ${expect.swapsExactly}`);
      if (expect.swapsAtLeast !== undefined && proposals.length < expect.swapsAtLeast) problems.push(`${proposals.length} swaps, want >= ${expect.swapsAtLeast}`);
      // Every planned lunch in the final week is safe by the oracle (recipe-level check through the held SKUs above).
    }
    const swaps = proposals.map((p) => `${p.affectedDay} ${p.fromRecipeId.replace("r-", "")}->${p.toRecipeId.replace("r-", "")}`).join("; ");
    if (problems.length) fail(`${name}: ${problems.join("; ")}${swaps ? ` [${swaps}]` : ""}`);
    else console.log(`  PASS ${name.padEnd(34)} ${proposals.length} swap(s)${swaps ? `: ${swaps}` : ""}`);
  } finally {
    await grocer.close();
  }
}

async function main() {
  unitNormalize();
  unitLabels();
  console.log("\n3. Full weekly plan per allergy (rules change -> proposal -> parent approves -> one verified hold)");
  const A = (text: string, crossContact = true) => ({ text, crossContact });
  await engineCase("peanuts (cross-contact on)", [A("peanuts")], { swapsExactly: 0 });
  await engineCase("tree nuts", [A("tree nuts")], { swapsExactly: 0 });
  await engineCase("dairy", [A("dairy")], { swapsExactly: 3 });
  await engineCase("eggs (cross-contact on)", [A("eggs")], { swapsExactly: 1 });
  await engineCase("eggs (cross-contact off)", [A("eggs", false)], { swapsExactly: 0 });
  await engineCase("gluten", [A("gluten")], { swapsExactly: 4 });
  await engineCase("soy", [A("soy")], { swapsExactly: 0 });
  await engineCase("sesame", [A("sesame")], { swapsExactly: 1 });
  await engineCase("fish", [A("fish")], { swapsExactly: 0 });
  await engineCase("shellfish", [A("shrimp")], { swapsExactly: 0 });
  await engineCase("kiwi (custom)", [A("kiwi")], { swapsExactly: 0 });
  await engineCase("grapes (custom, product name)", [A("grapes")], { swapsExactly: 1 });
  await engineCase("carrots (custom)", [A("carrots")], { swapsExactly: 1 });
  await engineCase("peanut + dairy", [A("peanuts"), A("dairy")], { swapsExactly: 3 });
  await engineCase("peanut + sesame + eggs", [A("peanuts"), A("sesame"), A("eggs")], { swapsExactly: 2 });
  await engineCase("dairy + gluten", [A("dairy"), A("gluten")], { swapsAtLeast: 4 });
  await engineCase("all nine majors", [A("peanuts"), A("tree nuts"), A("dairy"), A("eggs"), A("gluten"), A("soy"), A("sesame"), A("fish"), A("shellfish")], { swapsAtLeast: 4 });
  await engineCase("no allergies", [], { swapsExactly: 0 });
  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
