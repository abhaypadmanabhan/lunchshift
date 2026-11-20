// Offline doubles for the KPI harness and fallbacks. Labelled; never presented as sponsor proof.
import { HOUSEHOLD } from "../lib/domain/fixture";
import type {
  Analytics,
  AnalyticsEvent,
  AppStore,
  AuditEvent,
  AutonomyMode,
  AutonomyProvider,
  AutonomyReading,
  Basket,
  Household,
  KpiSet,
  MemoryProvider,
  MemoryRecall,
  Ranker,
  RankQuery,
  RankResult,
  Receipt,
  Recipe,
  Run,
  Sku,
  SwapExplainer,
} from "../lib/domain/types";

export class MemoryStore implements AppStore {
  readonly provider = "sqlite" as const;
  households = new Map<string, Household>();
  recipes: Recipe[] = [];
  runs = new Map<string, Run>();
  events = new Map<string, AuditEvent[]>();
  baskets = new Map<string, Basket>();
  receipts = new Map<string, Receipt>();
  kpis = new Map<string, KpiSet>();
  labels: Sku[] = [];
  async init() {}
  async reset() {
    this.runs.clear();
    this.events.clear();
    this.baskets.clear();
    this.receipts.clear();
    this.kpis.clear();
  }
  async saveHousehold(h: Household) {
    this.households.set(h.id, structuredClone(h));
  }
  async getHousehold(id: string) {
    const h = this.households.get(id);
    return h ? structuredClone(h) : null;
  }
  async saveRecipes(r: Recipe[]) {
    this.recipes = structuredClone(r);
  }
  async getRecipes() {
    return structuredClone(this.recipes);
  }
  async saveLabelSnapshot(skus: Sku[]) {
    this.labels = structuredClone(skus);
  }
  async upsertRun(run: Run) {
    this.runs.set(run.id, structuredClone(run));
  }
  async getRun(id: string) {
    const r = this.runs.get(id);
    return r ? structuredClone(r) : null;
  }
  async listRuns(householdId: string) {
    return [...this.runs.values()].filter((r) => r.householdId === householdId);
  }
  async appendEvent(e: Omit<AuditEvent, "seq" | "at">) {
    const list = this.events.get(e.runId) ?? [];
    const full: AuditEvent = { ...e, seq: list.length + 1, at: new Date().toISOString() };
    list.push(full);
    this.events.set(e.runId, list);
    return full;
  }
  async listEvents(runId: string) {
    return structuredClone(this.events.get(runId) ?? []);
  }
  async saveBasket(runId: string, b: Basket) {
    this.baskets.set(runId, structuredClone(b));
  }
  async getBasket(runId: string) {
    const b = this.baskets.get(runId);
    return b ? structuredClone(b) : null;
  }
  async saveReceipt(r: Receipt) {
    this.receipts.set(r.runId, structuredClone(r));
  }
  async getReceipt(runId: string) {
    const r = this.receipts.get(runId);
    return r ? structuredClone(r) : null;
  }
  async saveKpis(runId: string, k: KpiSet) {
    this.kpis.set(runId, structuredClone(k));
  }
  async getKpis(runId: string) {
    const k = this.kpis.get(runId);
    return k ? structuredClone(k) : null;
  }
}

export class StaticAutonomy implements AutonomyProvider {
  constructor(public mode: AutonomyMode | "invalid" | "timeout") {}
  async read(): Promise<AutonomyReading> {
    const at = new Date().toISOString();
    if (this.mode === "invalid") return { mode: "suggest_only", source: "default", fetchedAt: at, error: "invalid config value" };
    if (this.mode === "timeout") return { mode: "suggest_only", source: "default", fetchedAt: at, error: "config read timed out" };
    return { mode: this.mode, source: "statsig", ruleId: "harness-static", fetchedAt: at };
  }
}

export class RecordingAnalytics implements Analytics {
  sent: AnalyticsEvent[] = [];
  async log(_userId: string, events: AnalyticsEvent[]) {
    this.sent.push(...events);
    return { ok: true };
  }
}

export class FixtureMemory implements MemoryProvider {
  constructor(private readonly facts = HOUSEHOLD.facts) {}
  async seed() {
    return { ok: true };
  }
  async recall(_id: string, query: string): Promise<MemoryRecall> {
    return {
      provider: "fallback",
      query,
      factIds: this.facts.map((f) => f.id),
      snippets: this.facts.map((f) => `[${f.id} r${f.revision}] ${f.text}`),
      error: "offline harness: fixture memory",
    };
  }
}

/** Simple in-process ranker used only until the real ranking module is wired. */
export class TagRanker implements Ranker {
  async rank(q: RankQuery, candidates: Recipe[]): Promise<RankResult> {
    const scored = candidates.map((r) => {
      const prep = r.prepMinutes <= q.maxPrepMinutes ? 1 : 0;
      const pref = r.tags.filter((t) => q.preferTags.includes(t)).length;
      const overlap = r.lines.filter((l) => q.pantryRoles.includes(l.role)).length / r.lines.length;
      return { id: r.id, score: Number((0.3 * prep + 0.5 * pref + 0.2 * overlap).toFixed(4)) };
    });
    scored.sort((a, b) => b.score - a.score);
    return {
      provider: "local_vector",
      query: q.text,
      ranked: scored.map((s, i) => ({ ...s, rank: i + 1 })),
      inputs: { preferTags: q.preferTags, maxPrepMinutes: q.maxPrepMinutes },
    };
  }
}

export class TemplateExplainer implements SwapExplainer {
  async explain(input: Parameters<SwapExplainer["explain"]>[0]) {
    const top = input.ranking.ranked[0]?.id ?? input.eligible[0].id;
    const r = input.eligible.find((e) => e.id === top) ?? input.eligible[0];
    return {
      choiceId: r.id,
      rationale: `${input.fromRecipe.name} can't be made safely this week, so ${input.affectedDay} becomes ${r.name}: it ranked first on your saved preferences and stays within budget.`,
      provider: "template" as const,
    };
  }
}
