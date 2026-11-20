// Sample RunView objects for the four demo states. Used by GET /api/state until the
// orchestrator swaps in the real builder. Ids, names, labels and prices come from the fixture.
import { CATALOG, CATALOG_VERSION, HOUSEHOLD, PICKUP_SLOT, RECIPES } from "@/lib/domain/fixture";
import type {
  AuditEvent,
  AutonomyMode,
  Basket,
  BasketLine,
  CandidateDecision,
  KpiSet,
  MemoryRecall,
  Receipt,
  Run,
  RunStatus,
  SwapProposal,
} from "@/lib/domain/types";
import type { IntegrationStatus, KpiSuiteResult, PlanRow, RunView } from "@/lib/domain/view";

export type SampleState = "a" | "b" | "c" | "d";
export const isSampleState = (v: unknown): v is SampleState => v === "a" || v === "b" || v === "c" || v === "d";

const RUN_ID = "run-2026-11-22";
const OPERATION_KEY = `hold:${RUN_ID}`;

const sku = (id: string) => {
  const s = CATALOG.find((c) => c.id === id);
  if (!s) throw new Error(`sample: unknown sku ${id}`);
  return s;
};
const recipeName = (id: string) => RECIPES.find((r) => r.id === id)?.name ?? id;

const line = (skuId: string, usedBy: string[], packs = 1): BasketLine => {
  const s = sku(skuId);
  return { skuId, name: s.name, packs, unitPriceCents: s.priceCents, lineCents: s.priceCents * packs, usedBy };
};
const basket = (version: number, lines: BasketLine[]): Basket => ({
  version,
  lines,
  totalCents: lines.reduce((t, l) => t + l.lineCents, 0),
});

const KEPT_LINES: BasketLine[] = [
  line("apple-gala", ["r-sunbutter-sandwich", "r-turkey-rollups"]),
  line("tortilla-flour", ["r-quesadilla"]),
  line("cheddar-sticks", ["r-quesadilla", "r-pasta-salad", "r-turkey-rollups"]),
  line("grapes-red", ["r-quesadilla"]),
  line("pasta-rotini", ["r-pasta-salad"]),
  line("tomato-cherry", ["r-pasta-salad"]),
  line("pita-mini", ["r-hummus-box"]),
  line("hummus-classic", ["r-hummus-box"]),
  line("carrot-baby", ["r-hummus-box"]),
  line("turkey-sliced", ["r-turkey-rollups"]),
];

const BEFORE = basket(1, [
  line("bread-harvest-ww", ["r-sunbutter-sandwich"]),
  line("seed-butter-sun", ["r-sunbutter-sandwich"]),
  ...KEPT_LINES,
]);

const AFTER = basket(2, [
  line("rice-jasmine", ["r-rice-bean-bowl"]),
  line("beans-black", ["r-rice-bean-bowl"]),
  line("corn-sweet", ["r-rice-bean-bowl"]),
  ...KEPT_LINES.map((l) =>
    l.skuId === "apple-gala" ? { ...l, usedBy: ["r-rice-bean-bowl", "r-turkey-rollups"] } : l,
  ),
]);

const allergy = HOUSEHOLD.facts.find((f) => f.id === "fact-allergy-peanut")!;
const valueBread = sku("bread-value-wheat");
const sourdough = sku("bread-artisan-sour");

const REFUSALS: CandidateDecision[] = [
  {
    candidateId: valueBread.id,
    kind: "sku_substitute",
    eligible: false,
    reasons: ["allergen_warning"],
    factId: allergy.id,
    factText: allergy.text,
    factRevision: allergy.revision,
    labelVersion: valueBread.label.version,
    labelText: valueBread.label.sourceText,
    priceCents: valueBread.priceCents,
  },
  {
    candidateId: sourdough.id,
    kind: "sku_substitute",
    eligible: false,
    reasons: ["missing_label_evidence"],
    labelVersion: sourdough.label.version,
    labelText: sourdough.label.sourceText,
    priceCents: sourdough.priceCents,
  },
  {
    candidateId: "r-peanut-noodles",
    kind: "lunch_alternative",
    eligible: false,
    reasons: ["recipe_allergen"],
    factId: allergy.id,
    factText: allergy.text,
    factRevision: allergy.revision,
  },
];

const MEMORY: MemoryRecall = {
  provider: "cognee",
  datasetId: "ds-lunchshift-demo",
  query: "Maya allergies and school lunch preferences",
  factIds: ["fact-allergy-peanut", "fact-pref-rice", "fact-pref-prep", "fact-pref-variety"],
  snippets: [
    "fact-allergy-peanut r3: Maya is allergic to peanuts. Refuse any product with a peanut or peanut cross-contact warning.",
    "fact-pref-rice r1: Maya has been asking for rice bowls.",
    "fact-pref-prep r1: Weekday lunch prep should stay under 20 minutes.",
  ],
};

const PROPOSAL: SwapProposal = {
  affectedDay: "Mon",
  fromRecipeId: "r-sunbutter-sandwich",
  toRecipeId: "r-rice-bean-bowl",
  removedSkuIds: ["bread-harvest-ww", "seed-butter-sun"],
  addedSkuIds: ["rice-jasmine", "beans-black", "corn-sweet"],
  keptSharedSkuIds: ["apple-gala"],
  before: BEFORE,
  after: AFTER,
  ranking: {
    provider: "singlestore_vector",
    query: "Warm kid-favourite lunch under 20 minutes, reuse pantry items, no peanut",
    ranked: [
      { id: "r-rice-bean-bowl", score: 0.874, rank: 1 },
      { id: "r-bean-quesadilla", score: 0.712, rank: 2 },
    ],
    inputs: {
      dims: ["prep_fit", "kid_favorite", "rice_pref", "pantry_overlap", "variety"],
      "r-rice-bean-bowl": [0.75, 1, 1, 0.25, 1],
      "r-bean-quesadilla": [0.9, 0, 0, 0.5, 0],
    },
    fallbackReason: "SIE key pending; SingleStore DOT_PRODUCT over fixed recipe feature vectors",
  },
  rationale:
    "Maya has been asking for rice bowls, and the rice-and-bean bowl reuses the apples already in the basket. It takes 15 minutes, inside the 20-minute prep limit. The bean quesadilla ranked lower because Tuesday is already a quesadilla.",
  rationaleProvider: "anthropic",
};

const T = (hhmmss: string) => `2026-11-22T${hhmmss}-08:00`;

const ALL_EVENTS: (Omit<AuditEvent, "runId" | "seq">)[] = [
  { at: T("16:00:00"), actor: "worker", type: "run_started", summary: "Sunday run started on schedule", data: { runId: RUN_ID, trigger: "schedule", weekOf: "2026-11-22" } },
  { at: T("16:00:01"), actor: "statsig", type: "mode_observed", summary: "autonomy_mode read: {mode}", data: { config: "autonomy_mode", ruleId: "{rule}", source: "statsig" } },
  { at: T("16:00:02"), actor: "cognee", type: "memory_recalled", summary: "Recalled peanut allergy (r3) and 3 preferences", data: { datasetId: MEMORY.datasetId, factIds: MEMORY.factIds, query: MEMORY.query } },
  { at: T("16:00:03"), actor: "grocer", type: "stockout_detected", summary: "Harvest Whole Wheat Bread out of stock", data: { skuId: "bread-harvest-ww", stock: 0, catalogVersion: CATALOG_VERSION } },
  { at: T("16:00:04"), actor: "worker", type: "candidate_rejected", summary: "Refused Value Wheat Bread: peanut cross-contact", data: { ...REFUSALS[0] } },
  { at: T("16:00:04"), actor: "worker", type: "candidate_rejected", summary: "Refused Artisan Sourdough: no label evidence", data: { ...REFUSALS[1] } },
  { at: T("16:00:04"), actor: "worker", type: "candidate_rejected", summary: "Refused Thai peanut noodles: recipe contains peanut", data: { ...REFUSALS[2] } },
  { at: T("16:00:06"), actor: "ranker", type: "alternatives_ranked", summary: "Ranked 2 eligible lunches (SingleStore vector)", data: { provider: "singlestore_vector", ranked: PROPOSAL.ranking.ranked, inputs: PROPOSAL.ranking.inputs } },
  { at: T("16:00:08"), actor: "llm", type: "swap_proposed", summary: "Proposed Monday: rice-and-bean bowl", data: { affectedDay: "Mon", from: PROPOSAL.fromRecipeId, to: PROPOSAL.toRecipeId, rationaleProvider: "anthropic" } },
  { at: T("16:00:09"), actor: "worker", type: "swap_applied", summary: "Cart v2 applied: Monday swapped, 4 lunches kept", data: { basketVersion: 2, removed: PROPOSAL.removedSkuIds, added: PROPOSAL.addedSkuIds, kept: PROPOSAL.keptSharedSkuIds, totalCents: AFTER.totalCents } },
  { at: T("16:01:30"), actor: "statsig", type: "autonomy_changed", summary: "autonomy_mode changed to auto_swap_and_hold", data: { from: "auto_swap", to: "auto_swap_and_hold", ruleId: "rule-demo-household", effective: "auto_swap_and_hold" } },
  { at: T("16:02:12"), actor: "worker", type: "hold_dispatched", summary: "Hold requested for cart v2 ($26.97)", data: { operationKey: OPERATION_KEY, fingerprint: "fp-9c41e07a", totalCents: AFTER.totalCents, slot: PICKUP_SLOT } },
  { at: T("16:02:14"), actor: "grocer", type: "hold_response_lost", summary: "Store response dropped after commit", data: { operationKey: OPERATION_KEY, error: "ECONNRESET" } },
  { at: T("16:02:16"), actor: "worker", type: "hold_readback", summary: "Reading hold back by operation key", data: { operationKey: OPERATION_KEY, attempt: 1 } },
  { at: T("16:02:17"), actor: "grocer", type: "hold_verified", summary: "1 active hold matches lines, total and slot", data: { holdId: "hold_7f3a9c2e41b8", operationKey: OPERATION_KEY, matched: true, activeHoldsForRun: 1 } },
  { at: T("16:02:18"), actor: "worker", type: "metrics_computed", summary: "Six run metrics computed and sent to Statsig", data: { unsafeItemsInCart: 0, mealCompletenessPct: 100, humanClicksPerOrder: 0, duplicateHolds: 0, totalCents: AFTER.totalCents, swapsTracedPct: 100 } },
];

function events(upToType: AuditEvent["type"], mode: AutonomyMode, ruleId: string, skipModeChange: boolean): AuditEvent[] {
  const end = ALL_EVENTS.findIndex((e) => e.type === upToType);
  return ALL_EVENTS.slice(0, end + 1)
    .filter((e) => !(skipModeChange && e.type === "autonomy_changed"))
    .map((e, i) => {
      const fill = (s: string) => s.replace("{mode}", mode).replace("{rule}", ruleId);
      const data = e.type === "mode_observed" ? { ...e.data, mode, ruleId } : e.data;
      return { ...e, runId: RUN_ID, seq: i + 1, summary: fill(e.summary), data };
    });
}

const run = (status: RunStatus, observed: AutonomyMode, updatedAt: string): Run => ({
  id: RUN_ID,
  householdId: HOUSEHOLD.id,
  weekOf: "2026-11-22",
  trigger: "schedule",
  status,
  observedMode: observed,
  effectiveMode: observed,
  basketVersion: status === "proposed" ? 1 : 2,
  operationKey: status === "hold_pending" || status === "hold_verified" ? OPERATION_KEY : undefined,
  requestFingerprint: status === "hold_pending" || status === "hold_verified" ? "fp-9c41e07a" : undefined,
  createdAt: T("16:00:00"),
  updatedAt,
});

const plan = (mondayStatus: PlanRow["status"]): PlanRow[] =>
  HOUSEHOLD.plan.map((p) =>
    p.day === "Mon"
      ? {
          day: p.day,
          recipeId: mondayStatus === "kept" ? p.recipeId : "r-rice-bean-bowl",
          recipeName: mondayStatus === "kept" ? recipeName(p.recipeId) : recipeName("r-rice-bean-bowl"),
          status: mondayStatus,
          replacedRecipeName: mondayStatus === "kept" ? undefined : recipeName(p.recipeId),
        }
      : { day: p.day, recipeId: p.recipeId, recipeName: recipeName(p.recipeId), status: "kept" },
  );

const integrations = (grocer: IntegrationStatus["status"] = "live"): IntegrationStatus[] => [
  { name: "Cognee", status: "live", detail: "Recalled from dataset ds-lunchshift-demo" },
  { name: "SingleStore", status: "live", detail: "App store, audit log and vector ranking" },
  { name: "Statsig", status: "live", detail: "autonomy_mode dynamic config" },
  { name: "Superlinked SIE", status: "missing", detail: "Key pending; SingleStore vector ranking used" },
  { name: "Anthropic", status: "live", detail: "Swap rationale" },
  { name: "Sandbox grocer", status: grocer, detail: "Local merchant API, separate database" },
];

const KPI_SUITE: KpiSuiteResult = {
  ranAt: "2026-11-20T11:40:12-08:00",
  scenarios: [
    { name: "Peanut cross-contact substitute refused", pass: true, detail: "bread-value-wheat blocked by fact-allergy-peanut r3" },
    { name: "Missing label evidence blocks a candidate", pass: true, detail: "bread-artisan-sour blocked, label v0 missing" },
    { name: "Whole lunch swapped, four lunches kept", pass: true, detail: "5/5 lunches covered by cart v2" },
    { name: "Dropped response recovers one hold", pass: true, detail: "read-back by operation key, 1 active hold" },
    { name: "Replayed event creates no second hold", pass: true, detail: "same key, same fingerprint, 1 hold" },
    { name: "Stale config falls back to suggest_only", pass: true, detail: "no cart change, no hold" },
    { name: "Revoked mandate blocks the hold", pass: true, detail: "hold route never called" },
  ],
  kpis: {
    unsafeItemsInCart: 0,
    mealCompletenessPct: 100,
    humanClicksPerOrder: 0,
    duplicateHolds: 0,
    budgetKept: { kept: true, totalCents: AFTER.totalCents, budgetCents: 3500 },
    swapsTracedPct: 100,
  },
};

const VERIFIED_KPIS: KpiSet = KPI_SUITE.kpis;

const RECEIPT: Receipt = {
  runId: RUN_ID,
  operationKey: OPERATION_KEY,
  hold: {
    holdId: "hold_7f3a9c2e41b8",
    operationKey: OPERATION_KEY,
    runId: RUN_ID,
    status: "active",
    lines: AFTER.lines.map((l) => ({ skuId: l.skuId, packs: l.packs, unitPriceCents: l.unitPriceCents })),
    totalCents: AFTER.totalCents,
    slot: PICKUP_SLOT,
    expiresAt: "2026-11-22T18:00:00-08:00",
    fingerprint: "fp-9c41e07a",
    createdAt: T("16:02:13"),
  },
  verifiedAt: T("16:02:17"),
  matched: true,
  activeHoldsForRun: 1,
};

const base = (): Omit<RunView, "run" | "mode" | "plan" | "basket" | "receipt" | "kpis" | "events" | "proposal" | "proposals" | "needsApproval"> => ({
  generatedAt: new Date().toISOString(),
  allergens: [],
  household: { id: HOUSEHOLD.id, childName: HOUSEHOLD.childName, facts: HOUSEHOLD.facts, mandate: HOUSEHOLD.mandate },
  stockout: { skuId: "bread-harvest-ww", name: "Harvest Whole Wheat Bread" },
  refusals: REFUSALS,
  memory: MEMORY,
  kpiSuite: KPI_SUITE,
  integrations: integrations(),
});

const mode = (observed: AutonomyMode, ruleId: string, fetchedAt: string): RunView["mode"] => ({
  observed,
  effective: observed,
  parentMax: HOUSEHOLD.mandate.maxAutonomy,
  source: "statsig",
  ruleId,
  fetchedAt,
});

export function sampleRunView(state: SampleState): RunView {
  switch (state) {
    case "a":
      return {
        ...base(),
        run: run("proposed", "suggest_only", T("16:00:08")),
        needsApproval: "LunchShift is in suggest-only mode, so it waits for you before changing the cart.",
        mode: mode("suggest_only", "rule-default-suggest", T("16:00:01")),
        proposal: PROPOSAL,
        proposals: [PROPOSAL],
        plan: plan("proposed_swap"),
        basket: BEFORE,
        receipt: null,
        kpis: null,
        events: events("swap_proposed", "suggest_only", "rule-default-suggest", true),
      };
    case "b":
      return {
        ...base(),
        needsApproval: null,
        run: run("swapped_waiting", "auto_swap", T("16:00:09")),
        mode: mode("auto_swap", "rule-demo-household", T("16:01:00")),
        proposal: PROPOSAL,
        proposals: [PROPOSAL],
        plan: plan("swapped"),
        basket: AFTER,
        receipt: null,
        kpis: null,
        events: events("swap_applied", "auto_swap", "rule-demo-household", true),
      };
    case "c":
      return {
        ...base(),
        needsApproval: null,
        run: run("hold_pending", "auto_swap_and_hold", T("16:02:16")),
        mode: mode("auto_swap_and_hold", "rule-demo-household", T("16:02:11")),
        proposal: PROPOSAL,
        proposals: [PROPOSAL],
        plan: plan("swapped"),
        basket: AFTER,
        receipt: null,
        kpis: null,
        events: events("hold_readback", "auto_swap", "rule-demo-household", false),
      };
    case "d":
      return {
        ...base(),
        needsApproval: null,
        run: run("hold_verified", "auto_swap_and_hold", T("16:02:18")),
        mode: mode("auto_swap_and_hold", "rule-demo-household", T("16:02:11")),
        proposal: PROPOSAL,
        proposals: [PROPOSAL],
        plan: plan("swapped"),
        basket: AFTER,
        receipt: RECEIPT,
        kpis: VERIFIED_KPIS,
        events: events("metrics_computed", "auto_swap", "rule-demo-household", false),
      };
  }
}
