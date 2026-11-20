// npm run kpi - fixed scenario suite against a real sandbox grocer process boundary (HTTP) and the real worker.
// Prints the six KPIs and writes .data/kpi-latest.json for the UI. Exit 1 if any KPI misses its target.
import { mkdirSync, writeFileSync } from "node:fs";
import { DEMO_STOCKOUT_SKU, HOUSEHOLD, RECIPES } from "../src/lib/domain/fixture";
import type { AutonomyMode, Household, KpiSet, Ranker } from "../src/lib/domain/types";
import { startGrocer, AGENT_TOKEN, OPERATOR_TOKEN } from "../src/grocer/server";
import { GrocerClient, GrocerOperator } from "../src/grocer/client";
import { approveProposal, allProposals, processRun, type WorkerDeps } from "../src/worker/runWeekly";
import { applyHouseholdUpdate } from "../src/lib/domain/household";
import { FixtureMemory, MemoryStore, RecordingAnalytics, StaticAutonomy, TemplateExplainer } from "../src/worker/testing";
import { LocalVectorRanker } from "../src/lib/ranking/local";
import { buildRankQuery } from "../src/lib/ranking/features";

type Scenario = { name: string; pass: boolean; detail: string; kpis?: KpiSet; auto?: boolean };

async function rankerForHarness(): Promise<Ranker> {
  return new LocalVectorRanker();
}

async function world(mode: AutonomyMode | "invalid" | "timeout", household: Household = HOUSEHOLD) {
  const grocer = await startGrocer({ port: 0, dbPath: ":memory:" });
  const client = new GrocerClient(grocer.url, AGENT_TOKEN, 1500);
  const op = new GrocerOperator(grocer.url, OPERATOR_TOKEN);
  const store = new MemoryStore();
  await store.saveHousehold(household);
  await store.saveRecipes(RECIPES);
  const autonomy = new StaticAutonomy(mode);
  const analytics = new RecordingAnalytics();
  const deps: WorkerDeps = {
    store,
    grocer: client,
    memory: new FixtureMemory(),
    autonomy,
    analytics,
    ranker: await rankerForHarness(),
    explainer: new TemplateExplainer(),
    buildRankQuery: (h, kept, roles) => buildRankQuery(h, kept, roles, RECIPES),
  };
  const runId = `kpi-${Math.random().toString(36).slice(2, 8)}`;
  const run = () => processRun(deps, { runId, householdId: household.id, weekOf: "2026-11-22", trigger: "schedule" });
  return { grocer, client, op, store, autonomy, analytics, deps, runId, run };
}

const scenarios: { name: string; auto: boolean; fn: () => Promise<Omit<Scenario, "name" | "auto">> }[] = [
  {
    name: "No stockout, full auto: one verified hold",
    auto: true,
    fn: async () => {
      const w = await world("auto_swap_and_hold");
      const r = await w.run();
      const holds = await w.client.listHolds(w.runId);
      const k = (await w.store.getKpis(w.runId))!;
      await w.grocer.close();
      return { pass: r.run.status === "hold_verified" && holds.length === 1, detail: `status ${r.run.status}, holds ${holds.length}`, kpis: k };
    },
  },
  {
    name: "Bread stockout, full auto: refuse peanut near-match, swap whole lunch, hold",
    auto: true,
    fn: async () => {
      const w = await world("auto_swap_and_hold");
      await w.op.setStock(DEMO_STOCKOUT_SKU, 0);
      const r = await w.run();
      const ev = await w.store.listEvents(w.runId);
      const refused = ev.find((e) => e.type === "candidate_rejected" && e.data.candidateId === "bread-value-wheat");
      const k = (await w.store.getKpis(w.runId))!;
      const holds = await w.client.listHolds(w.runId);
      await w.grocer.close();
      const ok =
        r.run.status === "hold_verified" &&
        refused?.data.factId === "fact-allergy-peanut" &&
        r.proposal?.toRecipeId === "r-rice-bean-bowl" &&
        holds.length === 1 &&
        !holds[0].lines.some((l) => l.skuId === "bread-value-wheat");
      return { pass: ok, detail: `status ${r.run.status}, chose ${r.proposal?.toRecipeId}, refusal fact ${String(refused?.data.factId)}`, kpis: k };
    },
  },
  {
    name: "Store commits then drops the response; replay and restart create no duplicate",
    auto: true,
    fn: async () => {
      const w = await world("auto_swap_and_hold");
      await w.op.setStock(DEMO_STOCKOUT_SKU, 0);
      await w.op.dropNextHoldResponse(true);
      const r1 = await w.run();
      const ev = await w.store.listEvents(w.runId);
      const lost = ev.some((e) => e.type === "hold_response_lost");
      await w.run(); // duplicate event
      // restart: a fresh worker instance on the same persisted state
      await processRun({ ...w.deps }, { runId: w.runId, householdId: HOUSEHOLD.id, weekOf: "2026-11-22", trigger: "replay" });
      const holds = (await w.client.listHolds(w.runId)).filter((h) => h.status === "active");
      const k = (await w.store.getKpis(w.runId))!;
      k.duplicateHolds = Math.max(0, holds.length - 1);
      await w.grocer.close();
      return { pass: lost && r1.run.status === "hold_verified" && holds.length === 1, detail: `response lost ${lost}, status ${r1.run.status}, active holds ${holds.length}`, kpis: k };
    },
  },
  {
    name: "Read-back fails once: identical retry with the same key, still one hold",
    auto: true,
    fn: async () => {
      const w = await world("auto_swap_and_hold");
      await w.op.setStock(DEMO_STOCKOUT_SKU, 0);
      await w.op.dropNextHoldResponse(true);
      // Simulate a crash right after dispatch: read-back fails once.
      const realRead = w.client.readHold.bind(w.client);
      let fail = true;
      w.client.readHold = async (k: string) => {
        if (fail) {
          fail = false;
          throw new Error("worker crashed");
        }
        return realRead(k);
      };
      const r1 = await w.run();
      const r2 = await w.run();
      const holds = (await w.client.listHolds(w.runId)).filter((h) => h.status === "active");
      await w.grocer.close();
      return { pass: holds.length === 1 && r2.run.status === "hold_verified", detail: `first ${r1.run.status}, then ${r2.run.status}, active holds ${holds.length}` };
    },
  },
  {
    name: "suggest_only: proposal only, cart and store untouched",
    auto: false,
    fn: async () => {
      const w = await world("suggest_only");
      await w.op.setStock(DEMO_STOCKOUT_SKU, 0);
      const r = await w.run();
      const holds = await w.client.listHolds(w.runId);
      const k = (await w.store.getKpis(w.runId))!;
      await w.grocer.close();
      return { pass: r.run.status === "proposed" && holds.length === 0 && Boolean(r.proposal), detail: `status ${r.run.status}, holds ${holds.length}`, kpis: k };
    },
  },
  {
    name: "No stockout in suggest_only: waits for approval, no hold",
    auto: false,
    fn: async () => {
      const w = await world("suggest_only");
      const r = await w.run();
      const holds = await w.client.listHolds(w.runId);
      await w.grocer.close();
      return { pass: r.run.status === "proposed" && holds.length === 0, detail: `status ${r.run.status}, holds ${holds.length}` };
    },
  },
  {
    name: "Allergen classifier can only add refusals: flags a clean-looking bread, never clears the peanut one",
    auto: false,
    fn: async () => {
      const w = await world("auto_swap_and_hold");
      // Fake task model: says the peanut-warning bread is "peanut-free" (must NOT clear it) and flags the usual SunButter.
      w.deps.allergenScreen = {
        provider: "sie",
        screen: async (items: { id: string; text: string }[]) =>
          new Map(
            items.map((i) => [
              i.id,
              i.id === "bread-value-wheat"
                ? { skuId: i.id, label: "peanut-free", score: 0.99, risk: false, model: "fake" }
                : { skuId: i.id, label: "peanut-free", score: 0.9, risk: i.id === "beans-black", model: "fake" },
            ]),
          ),
      };
      await w.op.setStock(DEMO_STOCKOUT_SKU, 0);
      const r = await w.run();
      const ev = await w.store.listEvents(w.runId);
      const valueRefused = ev.some((e) => e.type === "candidate_rejected" && e.data.candidateId === "bread-value-wheat");
      const holds = await w.client.listHolds(w.runId);
      const beansHeld = holds.some((h) => h.lines.some((l) => l.skuId === "beans-black"));
      await w.grocer.close();
      return { pass: valueRefused && !beansHeld, detail: `peanut bread refused ${valueRefused}; flagged beans held ${beansHeld}; status ${r.run.status}` };
    },
  },
  {
    name: "Label with no evidence value is never held (only 'confirmed' counts as evidence)",
    auto: false,
    fn: async () => {
      const w = await world("auto_swap_and_hold");
      const real = w.client.catalog.bind(w.client);
      w.client.catalog = async () => {
        const c = await real();
        return { ...c, skus: c.skus.map((s) => (s.id === "bread-harvest-ww" ? { ...s, label: { ...s.label, evidence: undefined as unknown as "confirmed" } } : s)) };
      };
      const r = await w.run();
      const holds = await w.client.listHolds(w.runId);
      const held = holds.some((h) => h.lines.some((l) => l.skuId === "bread-harvest-ww"));
      await w.grocer.close();
      return { pass: !held, detail: `status ${r.run.status}, unlabeled bread held ${held}` };
    },
  },
  {
    name: "Parent click never exceeds the parent's own maximum, or a failed config read",
    auto: false,
    fn: async () => {
      const out: string[] = [];
      let ok = true;
      for (const variant of ["max_auto_swap", "read_timeout"] as const) {
        const hh = variant === "max_auto_swap" ? { ...HOUSEHOLD, mandate: { ...HOUSEHOLD.mandate, maxAutonomy: "auto_swap" as const } } : HOUSEHOLD;
        const w = await world("suggest_only", hh);
        await w.op.setStock(DEMO_STOCKOUT_SKU, 0);
        await w.run();
        if (variant === "read_timeout") w.autonomy.mode = "timeout";
        const r = await approveProposal(w.deps, w.runId);
        const holds = await w.client.listHolds(w.runId);
        ok = ok && holds.length === 0;
        out.push(`${variant}: ${r.run.status}, holds ${holds.length}`);
        await w.grocer.close();
      }
      return { pass: ok, detail: out.join("; ") };
    },
  },
  {
    name: "Weekly limits: maxHoldsPerWeek 0 places nothing; a second run the same week cannot add a hold",
    auto: false,
    fn: async () => {
      const w0 = await world("auto_swap_and_hold", { ...HOUSEHOLD, mandate: { ...HOUSEHOLD.mandate, maxHoldsPerWeek: 0 } });
      const r0 = await w0.run();
      const h0 = (await w0.client.listHolds(w0.runId)).length;
      await w0.grocer.close();
      const w = await world("auto_swap_and_hold");
      await w.run();
      const second = `${w.runId}-b`;
      const r2 = await processRun(w.deps, { runId: second, householdId: HOUSEHOLD.id, weekOf: "2026-11-22", trigger: "manual" });
      const h2 = (await w.client.listHolds(w.runId)).length + (await w.client.listHolds(second)).length;
      await w.grocer.close();
      return { pass: h0 === 0 && h2 === 1, detail: `max0: ${r0.run.status} holds ${h0}; second run ${r2.run.status}, week holds ${h2}` };
    },
  },
  {
    name: "Parent revokes mid-run: the pre-hold check sees it and places nothing",
    auto: false,
    fn: async () => {
      const w = await world("auto_swap_and_hold");
      await w.op.setStock(DEMO_STOCKOUT_SKU, 0);
      const realRead = w.autonomy.read.bind(w.autonomy);
      let calls = 0;
      w.autonomy.read = async () => {
        calls++;
        if (calls === 2) await w.store.saveHousehold({ ...HOUSEHOLD, mandate: { ...HOUSEHOLD.mandate, revoked: true } });
        return realRead();
      };
      const r = await w.run();
      const holds = await w.client.listHolds(w.runId);
      await w.grocer.close();
      return { pass: holds.length === 0, detail: `status ${r.run.status}, effective ${r.run.effectiveMode}, holds ${holds.length}` };
    },
  },
  {
    name: "Read-back must match line by line, not just the fingerprint",
    auto: false,
    fn: async () => {
      const w = await world("auto_swap_and_hold");
      const real = w.client.readHold.bind(w.client);
      w.client.readHold = async (k: string) => {
        const h = await real(k);
        return h ? { ...h, lines: h.lines.map((l, i) => (i === 0 ? { ...l, skuId: "bread-value-wheat" } : l)) } : h;
      };
      const r = await w.run();
      await w.grocer.close();
      return { pass: r.run.status !== "hold_verified", detail: `status ${r.run.status}` };
    },
  },
  {
    name: "A hold that would expire before pickup is not confirmed",
    auto: false,
    fn: async () => {
      const w = await world("auto_swap_and_hold");
      const real = w.client.readHold.bind(w.client);
      w.client.readHold = async (k: string) => {
        const h = await real(k);
        return h ? { ...h, expiresAt: "2026-11-22T19:00:00.000Z" } : h;
      };
      const r = await w.run();
      await w.grocer.close();
      return { pass: r.run.status !== "hold_verified", detail: `status ${r.run.status}` };
    },
  },
  {
    name: "Two-allergy child (peanut + sesame), bread stockout: 2 lunches swapped, held only after the parent approves",
    auto: false,
    fn: async () => {
      const { household } = applyHouseholdUpdate(HOUSEHOLD, {
        allergies: [
          { text: "peanuts", crossContact: true },
          { text: "sesame", crossContact: true },
        ],
      });
      // The parent already approved this revision: the run is autonomous, but 2 swaps exceed the 1-swap mandate.
      const hh = { ...household, mandate: { ...household.mandate, policyRevision: household.policyRevision } };
      const w = await world("auto_swap_and_hold", hh);
      await w.op.setStock(DEMO_STOCKOUT_SKU, 0);
      const r1 = await w.run();
      const h1 = (await w.client.listHolds(w.runId)).length;
      const r2 = await approveProposal(w.deps, w.runId);
      const holds = (await w.client.listHolds(w.runId)).filter((h) => h.status === "active");
      const bad = holds.flatMap((h) => h.lines).filter((l) => ["bread-value-wheat", "hummus-classic", "sauce-thai-peanut"].includes(l.skuId));
      const swaps = (await allProposals(w.store, w.runId)).map((p) => `${p.affectedDay}->${p.toRecipeId.replace("r-", "")}`);
      const k = (await w.store.getKpis(w.runId))!;
      await w.grocer.close();
      return {
        pass: r1.run.status === "proposed" && h1 === 0 && r2.run.status === "hold_verified" && holds.length === 1 && bad.length === 0 && swaps.length === 2,
        detail: `${r1.run.status} (holds ${h1}) -> approve -> ${r2.run.status}; swaps ${swaps.join(", ")}; unsafe lines ${bad.length}`,
        kpis: k,
      };
    },
  },
  {
    name: "Human sign-off: suggest_only proposal + one parent approval places one verified hold",
    auto: false,
    fn: async () => {
      const w = await world("suggest_only");
      await w.op.setStock(DEMO_STOCKOUT_SKU, 0);
      const r1 = await w.run();
      const r2 = await approveProposal(w.deps, w.runId);
      await w.run(); // a later tick must not re-dispatch
      const holds = await w.client.listHolds(w.runId);
      const k = (await w.store.getKpis(w.runId))!;
      await w.grocer.close();
      return { pass: r1.run.status === "proposed" && r2.run.status === "hold_verified" && holds.length === 1 && k.humanClicksPerOrder === 1, detail: `${r1.run.status} -> approve -> ${r2.run.status}, holds ${holds.length}, parent clicks ${k.humanClicksPerOrder}` };
    },
  },
  {
    name: "auto_swap waits; live flip to auto_swap_and_hold places the hold on next tick",
    auto: true,
    fn: async () => {
      const w = await world("auto_swap");
      await w.op.setStock(DEMO_STOCKOUT_SKU, 0);
      const r1 = await w.run();
      const h1 = (await w.client.listHolds(w.runId)).length;
      w.autonomy.mode = "auto_swap_and_hold";
      const r2 = await w.run();
      const ev = await w.store.listEvents(w.runId);
      const flip = ev.some((e) => e.type === "autonomy_changed");
      const h2 = (await w.client.listHolds(w.runId)).length;
      const k = (await w.store.getKpis(w.runId))!;
      await w.grocer.close();
      return { pass: r1.run.status === "swapped_waiting" && h1 === 0 && flip && r2.run.status === "hold_verified" && h2 === 1, detail: `${r1.run.status} (holds ${h1}) -> ${r2.run.status} (holds ${h2}), flip logged ${flip}`, kpis: k };
    },
  },
  {
    name: "Invalid or timed-out config falls back to suggest_only",
    auto: false,
    fn: async () => {
      const results: string[] = [];
      let ok = true;
      for (const m of ["invalid", "timeout"] as const) {
        const w = await world(m);
        await w.op.setStock(DEMO_STOCKOUT_SKU, 0);
        const r = await w.run();
        const holds = await w.client.listHolds(w.runId);
        ok = ok && r.run.effectiveMode === "suggest_only" && holds.length === 0;
        results.push(`${m}: ${r.run.effectiveMode}, holds ${holds.length}`);
        await w.grocer.close();
      }
      return { pass: ok, detail: results.join("; ") };
    },
  },
  {
    name: "Revoked mandate caps autonomy at suggest_only",
    auto: false,
    fn: async () => {
      const w = await world("auto_swap_and_hold", { ...HOUSEHOLD, mandate: { ...HOUSEHOLD.mandate, revoked: true } });
      await w.op.setStock(DEMO_STOCKOUT_SKU, 0);
      const r = await w.run();
      const holds = await w.client.listHolds(w.runId);
      await w.grocer.close();
      return { pass: r.run.effectiveMode === "suggest_only" && holds.length === 0, detail: `effective ${r.run.effectiveMode}, holds ${holds.length}` };
    },
  },
  {
    name: "Late stockout after swap: store rejects atomically, zero holds",
    auto: false,
    fn: async () => {
      const w = await world("auto_swap");
      await w.op.setStock(DEMO_STOCKOUT_SKU, 0);
      await w.run();
      await w.op.setStock("rice-jasmine", 0);
      w.autonomy.mode = "auto_swap_and_hold";
      const r = await w.run();
      const holds = await w.client.listHolds(w.runId);
      await w.grocer.close();
      return { pass: holds.length === 0 && r.run.status !== "hold_verified", detail: `status ${r.run.status}, holds ${holds.length}` };
    },
  },
  {
    name: "Scoped credential: agent token cannot pay; key reuse with a new payload is refused",
    auto: false,
    fn: async () => {
      const w = await world("auto_swap_and_hold");
      const pay = await w.client.tryPayment();
      await w.run();
      const reuse = await w.client.placeHold({
        operationKey: `hold:${w.runId}`,
        runId: w.runId,
        lines: [{ skuId: "apple-gala", packs: 1, unitPriceCents: 299 }],
        totalCents: 299,
        slot: "x",
        catalogVersion: "cat-2026-11-22",
      });
      await w.grocer.close();
      const ok = pay.status === 403 && reuse.kind === "rejected" && reuse.status === 409;
      return { pass: ok, detail: `payment ${pay.status} ${pay.error}; key reuse ${reuse.kind === "rejected" ? reuse.status + " " + reuse.error : reuse.kind}` };
    },
  },
];

async function main() {
  const out: Scenario[] = [];
  for (const s of scenarios) {
    try {
      const r = await s.fn();
      out.push({ name: s.name, auto: s.auto, ...r });
    } catch (e) {
      out.push({ name: s.name, auto: s.auto, pass: false, detail: `threw: ${e instanceof Error ? e.stack : String(e)}` });
    }
  }
  const withK = out.filter((s) => s.kpis);
  const autoK = withK.filter((s) => s.auto).map((s) => s.kpis!);
  const swapK = withK.map((s) => s.kpis!);
  const agg: KpiSet = {
    unsafeItemsInCart: swapK.reduce((a, k) => a + k.unsafeItemsInCart, 0),
    mealCompletenessPct: Math.min(...swapK.map((k) => k.mealCompletenessPct)),
    humanClicksPerOrder: Math.max(...autoK.map((k) => k.humanClicksPerOrder)),
    duplicateHolds: swapK.reduce((a, k) => a + k.duplicateHolds, 0),
    budgetKept: {
      kept: swapK.every((k) => k.budgetKept.kept),
      totalCents: Math.max(...swapK.map((k) => k.budgetKept.totalCents)),
      budgetCents: HOUSEHOLD.mandate.budgetCents,
    },
    swapsTracedPct: Math.min(...swapK.map((k) => k.swapsTracedPct)),
  };
  const rows: [string, string, string, boolean][] = [
    ["Unsafe items reaching cart", String(agg.unsafeItemsInCart), "0", agg.unsafeItemsInCart === 0],
    ["Meal completeness after stockout", `${agg.mealCompletenessPct}%`, "100%", agg.mealCompletenessPct === 100],
    ["Human clicks per weekly order (auto)", String(agg.humanClicksPerOrder), "0", agg.humanClicksPerOrder === 0],
    ["Duplicate holds under dropped response", String(agg.duplicateHolds), "0", agg.duplicateHolds === 0],
    ["Budget kept", `${agg.budgetKept.kept ? "yes" : "NO"} (max $${(agg.budgetKept.totalCents / 100).toFixed(2)} / $${(agg.budgetKept.budgetCents / 100).toFixed(2)})`, "100%", agg.budgetKept.kept],
    ["Swaps traced to evidence", `${agg.swapsTracedPct}%`, "100%", agg.swapsTracedPct === 100],
  ];
  console.log("\nLunchShift KPI suite\n");
  for (const s of out) console.log(`${s.pass ? "PASS" : "FAIL"}  ${s.name}\n      ${s.detail}`);
  console.log("\nKPI                                      value                         target  ok");
  for (const [n, v, t, ok] of rows) console.log(`${n.padEnd(41)}${v.padEnd(30)}${t.padEnd(8)}${ok ? "yes" : "MISS"}`);
  const allOk = rows.every((r) => r[3]) && out.every((s) => s.pass);
  console.log(`\n${out.filter((s) => s.pass).length}/${out.length} scenarios pass; KPIs ${rows.every((r) => r[3]) ? "all green" : "MISSING TARGETS"}`);
  mkdirSync(".data", { recursive: true });
  writeFileSync(
    ".data/kpi-latest.json",
    JSON.stringify({ ranAt: new Date().toISOString(), scenarios: out.map(({ name, pass, detail }) => ({ name, pass, detail })), kpis: agg }, null, 2),
  );
  process.exit(allOk ? 0 : 1);
}

main();
