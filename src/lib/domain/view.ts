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
  proposal: SwapProposal | null;
  plan: PlanRow[];
  basket: Basket | null;
  receipt: Receipt | null;
  kpis: KpiSet | null; // for this run
  kpiSuite: KpiSuiteResult | null; // latest `npm run kpi`
  events: AuditEvent[];
  integrations: IntegrationStatus[];
}
