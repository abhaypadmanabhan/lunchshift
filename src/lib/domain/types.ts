// Shared contracts for LunchShift. Every lane builds against these types.
// Rule: the model proposes and explains; deterministic code in rules.ts enforces allergen,
// budget, stock and mandate limits and holds the only write capability.

export type AutonomyMode = "suggest_only" | "auto_swap" | "auto_swap_and_hold";
export const MODE_RANK: Record<AutonomyMode, number> = {
  suggest_only: 0,
  auto_swap: 1,
  auto_swap_and_hold: 2,
};
export const isAutonomyMode = (v: unknown): v is AutonomyMode =>
  v === "suggest_only" || v === "auto_swap" || v === "auto_swap_and_hold";

// ---------- Catalog (owned by the sandbox grocer; the app stores a versioned snapshot) ----------

/** Evidence state of an exact-SKU label. "missing" or "conflicting" BLOCKS a candidate. */
export type LabelEvidence = "confirmed" | "missing" | "conflicting";

export interface SkuLabel {
  skuId: string;
  version: string; // e.g. "lbl-bread-store-v2"
  evidence: LabelEvidence;
  /** Allergen tags printed on the exact SKU, e.g. ["peanut_cross_contact"], ["peanut"], [] */
  allergenWarnings: string[];
  sourceText: string; // the label line shown in the evidence drawer
}

export interface Sku {
  id: string;
  name: string;
  brand: string;
  role: string; // ingredient role this SKU fills, e.g. "bread", "seed_butter", "apple"
  priceCents: number; // per pack
  packQty: number; // units per pack
  unit: string; // "slice", "tbsp", "each", "cup", "portion"
  stock: number; // packs available at the store right now
  label: SkuLabel;
  catalogVersion: string;
  /** Real-product provenance (Open Food Facts snapshot). Prices are demo prices. */
  barcode?: string;
  imageUrl?: string; // served from /public, e.g. "/products/<barcode>.jpg"
  sourceUrl?: string; // OFF product page
  allergenTags?: string[]; // raw OFF allergens_tags, e.g. ["en:gluten", "en:soybeans"]
  traceTags?: string[]; // raw OFF traces_tags, e.g. ["en:peanuts"]
}

/** A sandbox order created from a verified hold. Pay at pickup: the agent never pays. */
export interface Order {
  orderId: string; // "LS-7F3A2C"
  operationKey: string; // "order:<runId>" (idempotent)
  holdId: string;
  runId: string;
  status: "placed" | "ready" | "picked_up" | "cancelled";
  payment: "pay_at_pickup";
  placedBy: "agent" | "parent";
  lines: HoldLine[];
  totalCents: number;
  slot: string;
  placedAt: string;
  timeline: { step: "placed" | "held" | "ready" | "picked_up" | "cancelled"; at: string | null; label: string }[];
}

// ---------- Meals ----------

export interface RecipeLine {
  role: string;
  qty: number; // units per lunch, in the role's unit
}

export interface Recipe {
  id: string;
  name: string;
  lines: RecipeLine[];
  prepMinutes: number;
  /** Ingredient-level allergens independent of SKU labels (e.g. a peanut sauce recipe). */
  containsAllergens: string[];
  tags: string[]; // "sandwich", "rice_bowl", "kid_favorite", ...
  /** Structured feature vector for the SingleStore fallback ranker. See ranking/features.ts. */
  description: string;
}

export interface PlannedLunch {
  day: "Mon" | "Tue" | "Wed" | "Thu" | "Fri";
  recipeId: string;
}

// ---------- Household (authoritative record lives in the app store; Cognee recalls + cites) ----------

export interface HouseholdFact {
  id: string; // stable marker, e.g. "fact-allergy-peanut"
  kind: "hard_restriction" | "preference" | "member";
  text: string; // human sentence shown in the UI
  /** For hard restrictions: allergen tags that make a SKU/recipe ineligible. */
  blocksAllergens?: string[];
  revision: number;
  confirmedBy: string; // "parent"
  confirmedAt: string; // ISO date
  active: boolean;
  /** Which kid a fact is about (allergy, dislike). Absent = the whole family. */
  child?: string;
  /** For allergy facts: the normalized allergen (canonical id like "milk", or "custom:kiwi"). */
  allergen?: { id: string; label: string; terms: string[]; crossContact: boolean };
}

export interface Mandate {
  id: string;
  storeId: string;
  window: string; // "Sun 16:00-18:00"
  maxSwapsPerWeek: number;
  maxHoldsPerWeek: number;
  maxAutonomy: AutonomyMode; // effective = min(statsig, this)
  budgetCents: number; // all-in cap
  expiresAt: string;
  revoked: boolean;
  approvedAt: string;
  /** Agent credential scopes. No payment scope exists. */
  scopes: string[];
  /** Household policy revision the parent's standing approval covers. A newer household revision needs fresh approval. */
  policyRevision?: number;
}

export interface Household {
  id: string; // synthetic, e.g. "lunchshift-demo"
  childName: string;
  plan: PlannedLunch[];
  facts: HouseholdFact[];
  mandate: Mandate;
  policyRevision: number;
  /** False for a brand-new family until the parent finishes onboarding. */
  onboarded?: boolean;
  /** Every kid this family packs lunches for. One shared menu, packed once per kid; every product must be safe for every kid. */
  children?: { name: string; age?: number }[];
  /** Days with no school this week ("Fri"): no lunch planned. */
  skipDays?: string[];
}

// ---------- Basket ----------

export interface BasketLine {
  skuId: string;
  name: string;
  packs: number;
  unitPriceCents: number;
  lineCents: number;
  /** Which lunches need this line. */
  usedBy: string[]; // recipe ids
}

export interface Basket {
  version: number;
  lines: BasketLine[];
  totalCents: number;
}

// ---------- Decisions ----------

export type RejectReason =
  | "allergen_warning" // label warning matches a hard restriction
  | "recipe_allergen" // recipe itself contains a blocked allergen
  | "missing_label_evidence"
  | "conflicting_label_evidence"
  | "out_of_stock"
  | "classifier_flag" // SIE allergen classifier flagged the label line; can only add a refusal
  | "over_budget"
  | "mandate_limit";

export interface CandidateDecision {
  candidateId: string; // sku id or recipe id
  kind: "sku_substitute" | "lunch_alternative";
  eligible: boolean;
  reasons: RejectReason[];
  /** Fact and label behind a refusal, for the evidence drawer. */
  factId?: string;
  factText?: string;
  factRevision?: number;
  labelVersion?: string;
  labelText?: string;
  priceCents?: number;
  /** Second opinion from the SIE allergen classifier on the exact label line, when available. */
  screen?: { label: string; score: number; risk: boolean; model: string };
}

export interface RankedCandidate {
  id: string;
  score: number;
  rank: number;
}

export interface RankResult {
  provider: "sie" | "singlestore_vector" | "local_vector";
  model?: string;
  query: string;
  ranked: RankedCandidate[];
  inputs: Record<string, unknown>; // score inputs preserved for audit
  fallbackReason?: string;
}

export interface Ranker {
  rank(query: RankQuery, candidates: Recipe[]): Promise<RankResult>;
}

export interface RankQuery {
  text: string; // natural-language brief built from preference facts
  maxPrepMinutes: number;
  preferTags: string[];
  pantryRoles: string[]; // roles already in the basket (pantry overlap)
}

export interface SwapProposal {
  affectedDay: PlannedLunch["day"];
  fromRecipeId: string;
  toRecipeId: string;
  removedSkuIds: string[];
  addedSkuIds: string[];
  keptSharedSkuIds: string[];
  before: Basket;
  after: Basket;
  ranking: RankResult;
  rationale: string; // LLM explanation (or deterministic text if LLM unavailable)
  rationaleProvider: "anthropic" | "template";
}

// ---------- Autonomy, memory, analytics adapters ----------

export interface AutonomyReading {
  mode: AutonomyMode; // observed (already defaulted to suggest_only when invalid/missing/stale)
  source: "statsig" | "default";
  ruleId?: string;
  fetchedAt: string;
  error?: string;
}

export interface AutonomyProvider {
  /** `custom` is sent as Statsig user custom fields (e.g. autonomy_pref) so console rules can target them. */
  read(userId: string, custom?: Record<string, string>): Promise<AutonomyReading>;
}

export interface MemoryRecall {
  provider: "cognee" | "fallback";
  datasetId?: string;
  query: string;
  /** Fact ids recalled (resolved against the authoritative household record by the worker). */
  factIds: string[];
  snippets: string[]; // raw retrieved text, for the drawer
  error?: string;
}

export interface MemoryProvider {
  seed(household: Household): Promise<{ datasetId?: string; ok: boolean; error?: string }>;
  recall(householdId: string, query: string): Promise<MemoryRecall>;
}

export interface AnalyticsEvent {
  eventName:
    | "candidate_rejected"
    | "autonomy_changed"
    | "meal_swapped"
    | "hold_verified"
    | "weekly_run_metrics"
    | "order_placed"
    | "agent_step"; // one per audit event: the run's trace (type, actor, seq, mode)
  value?: string | number;
  metadata: Record<string, string>; // synthetic ids and numbers only. No allergy text, names, secrets.
}

export interface Analytics {
  log(userId: string, events: AnalyticsEvent[]): Promise<{ ok: boolean; error?: string }>;
}

export interface SwapExplainer {
  explain(input: {
    affectedDay: string;
    fromRecipe: Recipe;
    eligible: Recipe[];
    ranking: RankResult;
    refusals: CandidateDecision[];
    preferenceFacts: HouseholdFact[];
  }): Promise<{ choiceId: string; rationale: string; provider: "anthropic" | "template" }>;
}

// ---------- Runs, audit, receipts (persisted in the app store) ----------

export type RunStatus =
  | "scheduled"
  | "running"
  | "proposed" // suggest_only: proposal written, cart untouched
  | "swapped_waiting" // auto_swap: cart repaired, no hold
  | "hold_pending" // dispatched, response lost or unverified
  | "hold_verified"
  | "escalated"
  | "superseded" // household rules changed; a fresh run replaced this one
  | "failed";

export interface Run {
  id: string; // e.g. "run-2026-11-22"
  householdId: string;
  weekOf: string; // ISO date of the Sunday
  trigger: "schedule" | "stockout_event" | "manual" | "replay";
  status: RunStatus;
  observedMode: AutonomyMode;
  effectiveMode: AutonomyMode;
  basketVersion: number;
  operationKey?: string; // stable hold key, e.g. "hold:run-2026-11-22"
  requestFingerprint?: string;
  createdAt: string;
  updatedAt: string;
}

export type AuditActor = "worker" | "grocer" | "parent" | "operator" | "statsig" | "cognee" | "ranker" | "llm" | "sie";

export interface AuditEvent {
  runId: string;
  seq: number; // append-only per run
  at: string;
  actor: AuditActor;
  type:
    | "run_started"
    | "memory_recalled"
    | "allergen_screened"
    | "mode_observed"
    | "autonomy_changed"
    | "stockout_detected"
    | "candidate_rejected"
    | "alternatives_ranked"
    | "swap_proposed"
    | "swap_applied"
    | "hold_dispatched"
    | "hold_response_lost"
    | "hold_readback"
    | "hold_verified"
    | "hold_escalated"
    | "order_placed"
    | "order_response_lost"
    | "cart_edited"
    | "item_added"
    | "metrics_computed"
    | "note";
  summary: string; // one human line
  data: Record<string, unknown>; // ids, versions, quantities, scores
}

export interface HoldLine {
  skuId: string;
  packs: number;
  unitPriceCents: number;
}

export interface HoldRequest {
  operationKey: string;
  runId: string;
  lines: HoldLine[];
  totalCents: number;
  slot: string;
  catalogVersion: string;
}

export interface MerchantHold {
  holdId: string;
  operationKey: string;
  runId: string;
  status: "active" | "released";
  lines: HoldLine[];
  totalCents: number;
  slot: string;
  expiresAt: string;
  fingerprint: string;
  createdAt: string;
}

export interface Receipt {
  runId: string;
  operationKey: string;
  hold: MerchantHold;
  verifiedAt: string;
  matched: boolean; // read-back equals our request (lines, total, slot)
  activeHoldsForRun: number; // from merchant list; must be 1
}

export interface KpiSet {
  unsafeItemsInCart: number; // target 0
  mealCompletenessPct: number; // target 100
  humanClicksPerOrder: number; // target 0 in auto mode
  duplicateHolds: number; // target 0
  budgetKept: { kept: boolean; totalCents: number; budgetCents: number };
  swapsTracedPct: number; // target 100
}

// ---------- App store (SingleStore, SQLite fallback) ----------

export interface AppStore {
  readonly provider: "singlestore" | "sqlite";
  init(): Promise<void>; // idempotent DDL
  reset(): Promise<void>; // clears runs/events/receipts for a clean demo (keeps catalog/household)
  saveHousehold(h: Household): Promise<void>;
  getHousehold(id: string): Promise<Household | null>;
  saveRecipes(recipes: Recipe[]): Promise<void>;
  getRecipes(): Promise<Recipe[]>;
  saveLabelSnapshot(skus: Sku[]): Promise<void>; // versioned label/catalog evidence
  upsertRun(run: Run): Promise<void>;
  getRun(id: string): Promise<Run | null>;
  listRuns(householdId: string): Promise<Run[]>;
  appendEvent(e: Omit<AuditEvent, "seq" | "at">): Promise<AuditEvent>;
  listEvents(runId: string): Promise<AuditEvent[]>;
  saveBasket(runId: string, basket: Basket): Promise<void>;
  getBasket(runId: string): Promise<Basket | null>;
  saveReceipt(r: Receipt): Promise<void>;
  getReceipt(runId: string): Promise<Receipt | null>;
  saveKpis(runId: string, k: KpiSet): Promise<void>;
  getKpis(runId: string): Promise<KpiSet | null>;
}
