// The one JSON shape the UI reads from GET /api/state. Built by src/lib/view/buildView.ts.
import type {
  AuditEvent,
  AutonomyMode,
  Basket,
  CandidateDecision,
  HouseholdFact,
  KpiSet,
  Mandate,
  MemoryRecall,
  Receipt,
  Run,
  SwapProposal,
} from "./types";

export interface IntegrationStatus {
  name: "Cognee" | "SingleStore" | "Statsig" | "Superlinked SIE" | "Anthropic" | "Sandbox grocer";
  status: "live" | "fallback" | "missing";
  detail: string; // e.g. "SingleStore vector ranking (SIE key pending)"
}

export interface PlanRow {
  day: string;
  recipeId: string;
  recipeName: string;
  status: "kept" | "swapped" | "proposed_swap";
  replacedRecipeName?: string;
}

export interface KpiSuiteResult {
  ranAt: string;
  scenarios: { name: string; pass: boolean; detail: string }[];
  kpis: KpiSet;
}

export interface RunView {
  generatedAt: string;
  household: { id: string; childName: string; facts: HouseholdFact[]; mandate: Mandate };
  run: Run | null;
  mode: {
    observed: AutonomyMode;
    effective: AutonomyMode;
    parentMax: AutonomyMode;
    source: "statsig" | "default";
    ruleId?: string;
    fetchedAt: string;
  };
  stockout: { skuId: string; name: string } | null;
  refusals: CandidateDecision[]; // rejected near-matches (first one is the hero refusal)
  memory: MemoryRecall | null;
  proposal: SwapProposal | null; // first swap (kept for the console)
  proposals: SwapProposal[]; // every whole-lunch swap in this run (allergy changes can touch several lunches)
  /** Why this run waits for the parent, in one plain sentence (null when it doesn't). */
  needsApproval: string | null;
  /** Allergens the app understands (canonical list) for the parent's setup screen; free text is also accepted. */
  allergens: { id: string; label: string; examples: string[] }[];
  plan: PlanRow[];
  basket: Basket | null;
  receipt: Receipt | null;
  kpis: KpiSet | null; // for this run
  kpiSuite: KpiSuiteResult | null; // latest `npm run kpi`
  events: AuditEvent[];
  integrations: IntegrationStatus[];
}

// ---------- Parent app API (POST, JSON) ----------
// POST /api/parent/household  body: HouseholdUpdate -> HouseholdUpdateResult
//   Saves the child's allergies/budget, bumps the policy revision, re-seeds Cognee, and starts a fresh plan for the week.
// POST /api/parent/plan        -> { ok }   "Plan my week now" (manual trigger; the worker picks it up within ~3 s)
// POST /api/parent/approve     -> { ok }   approve the open proposal (also re-approves the standing mandate at this revision)
// POST /api/parent/cancel-hold -> { ok }   release this week's store hold
export interface HouseholdUpdate {
  childName?: string;
  allergies: { text: string; crossContact: boolean }[]; // free text: "peanuts", "dairy", "sesame", "kiwi"
  budgetCents?: number;
}
export interface HouseholdUpdateResult {
  ok: boolean;
  normalized: { input: string; id: string; label: string; custom: boolean }[];
  policyRevision: number;
  runId: string;
  reason?: string;
}
