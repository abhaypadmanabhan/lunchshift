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
  Order,
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
  household: { id: string; childName: string; facts: HouseholdFact[]; mandate: Mandate; onboarded: boolean };
  families: FamilySummary[];
  week: WeekInfo;
  routines: RoutineView[];
  inbox: InboxItem[];
  factHistory: FactHistoryItem[];
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
  /** The parent's cart for this week: the draft the parent edits, else the agent's (proposed) basket. */
  cart: CartView | null;
  /** This week's order (after a verified hold) and the household's order history, newest first. */
  order: Order | null;
  orders: Order[];
  receipt: Receipt | null;
  kpis: KpiSet | null; // for this run
  kpiSuite: KpiSuiteResult | null; // latest `npm run kpi`
  events: AuditEvent[];
  integrations: IntegrationStatus[];
}

export interface CartLineView {
  skuId: string;
  name: string;
  brand: string;
  imageUrl?: string;
  packs: number;
  unitPriceCents: number;
  lineCents: number;
  usedBy: string[]; // lunch names that need this line
}
export interface CartView {
  lines: CartLineView[];
  totalCents: number;
  budgetCents: number;
  editable: boolean; // false once a hold exists (cancel the hold to edit)
  source: "agent" | "parent_draft";
  /** Products the parent can add, each pre-checked against the child's rules. */
  catalog: { skuId: string; name: string; brand: string; priceCents: number; imageUrl?: string; sourceUrl?: string; safe: boolean; reason?: string }[];
}

// ---------- Parent app API (POST, JSON) ----------
// POST /api/parent/cart   body: { skuId, packs }  -> { ok, reason?, cart }  (packs 0 removes; unsafe or over-budget items are refused with the reason)
// POST /api/parent/order  -> { ok, order }        place this week's order from the verified hold (pay at pickup; idempotent)
// POST /api/parent/household  body: HouseholdUpdate -> HouseholdUpdateResult
//   Saves the child's allergies/budget, bumps the policy revision, re-seeds Cognee, and starts a fresh plan for the week.
// POST /api/parent/plan        -> { ok }   "Plan my week now" (manual trigger; the worker picks it up within ~3 s)
// POST /api/parent/approve     -> { ok }   approve the open proposal (also re-approves the standing mandate at this revision)
// POST /api/parent/cancel-hold -> { ok }   release this week's store hold
export interface HouseholdUpdate {
  childName?: string;
  allergies: { text: string; crossContact: boolean }[]; // free text: "peanuts", "dairy", "sesame", "kiwi"
  budgetCents?: number;
  /** Onboarding's "Let LunchShift place my Sunday hold": the parent's one-time standing approval at this revision. */
  approveStanding?: { maxAutonomy: "suggest_only" | "auto_swap" | "auto_swap_and_hold" };
}
export interface HouseholdUpdateResult {
  ok: boolean;
  normalized: { input: string; id: string; label: string; custom: boolean }[];
  policyRevision: number;
  runId: string;
  reason?: string;
}

// ---------- Story mode: families, chat with the agent, weeks ----------
// RunView.families / RunView.week / RunView.household.onboarded are filled by /api/state.
export interface FamilySummary {
  id: string; // householdId, e.g. "fam-maya"
  childName: string;
  allergies: string[]; // display labels, e.g. ["Peanuts"]
  active: boolean;
  onboarded: boolean;
}

/** A fact the agent extracted from the parent's words, shown as a chip to confirm before it is saved to memory. */
export interface ProposedFact {
  id: string; // stable within one reply, e.g. "allergy:peanut"
  kind: "child" | "allergy" | "preference" | "budget" | "pickup" | "store" | "plan_change" | "cart_change";
  label: string; // chip text, e.g. "Peanut allergy (avoid may-contain too)"
  value: Record<string, unknown>; // structured payload, e.g. { text: "peanuts", crossContact: true }
}

// POST /api/chat          body: { message: string, mode: "onboarding" | "assistant" }
//                         -> { ok, reply: string, facts: ProposedFact[], provider: "anthropic" | "rules" }
//   The agent (Claude) reads the parent's words and proposes facts; nothing is saved until confirmed.
// POST /api/chat/confirm  body: { facts: ProposedFact[] }
//                         -> { ok, saved: { label: string; memory: "cognee" | "fallback" }[], runId?: string, reason?: string }
//   Saves confirmed facts to the household record and Cognee memory (per household), and re-plans when rules change.
// POST /api/family/switch body: { householdId }   -> { ok }   switch the active family (Maya / Leo / Ava / a new one)
// POST /api/family/new    body: {}                -> { ok, householdId }   a blank family that starts with chat onboarding
// POST /api/parent/plan   -> { ok, runId }        "Plan this week": the agent shops live (events stream into /api/state)
// POST /api/demo/next-week -> { ok, weekOf }      advance the demo clock to next Sunday and sell out the usual bread
export interface WeekInfo {
  weekOf: string; // ISO date of the Sunday
  label: string; // "This Sunday · Nov 22" / "Next Sunday · Nov 29"
  index: number; // 0 = first week, 1 = next week
}
// POST /api/parent/autonomy body: { mode: "suggest_only" | "auto_swap" | "auto_swap_and_hold" } -> { ok }
//   "How much can LunchShift do?" Saved per household (mandate.maxAutonomy, no re-plan). It is sent to Statsig as
//   custom.autonomy_pref on every evaluation; effective = the lower of Statsig's autonomy_mode (the operator ceiling)
//   and this setting. RunView.mode: observed = Statsig, parentMax = this setting, effective = what the agent does.

// ---------- Routines and inbox ----------
export interface RoutineView {
  id: "weekly_plan" | "stock_watch" | "school_skips" | "budget_alert";
  title: string; // "Weekly plan"
  description: string; // one line: "Plans lunches and holds pickup every Sunday at 4:00 pm"
  enabled: boolean;
  config: Record<string, unknown>; // weekly_plan: {day, time}; school_skips: {days: string[]}; budget_alert: {withinCents}
  lastRun: { at: string; result: string } | null;
  nextRun: string | null; // ISO time, or null when event-driven / off
}
export interface InboxItem {
  id: string;
  at: string;
  kind: "needs_you" | "done" | "alert";
  title: string; // "Approve 2 lunch changes"
  body: string; // one line
  action?: { label: string; endpoint: string; body?: Record<string, unknown> }; // e.g. { label: "Approve", endpoint: "/api/parent/approve" }
}
export interface FactHistoryItem {
  id: string;
  text: string;
  kind: string;
  revision: number;
  confirmedAt: string;
  child?: string;
  active: boolean;
}
// RunView.routines, RunView.inbox and RunView.factHistory are filled by /api/state.
// POST /api/routines      body: { id, enabled?, config? } -> { ok }   toggle or edit a routine (saved per family)
// POST /api/routines/run  body: { id }                    -> { ok, result }   run a routine now
