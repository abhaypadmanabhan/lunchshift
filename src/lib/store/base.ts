// Shared AppStore logic. Subclasses supply only the SQL transport and the upsert dialect.
// Every table is (key columns..., doc JSON): the typed object is the document, keys make it queryable.
import type {
  AppStore, AuditEvent, Basket, Household, KpiSet, Receipt, Recipe, Run, Sku,
} from "../domain/types";

export const T = {
  household: "ls_household",
  recipes: "ls_recipes",
  skus: "ls_skus",
  runs: "ls_runs",
  events: "ls_events",
  runDocs: "ls_run_docs", // basket / receipt / kpis, one row per (run, kind)
} as const;

export function parseDoc<D>(raw: unknown): D {
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as D;
}

type Row = Record<string, unknown>;
type Kind = "basket" | "receipt" | "kpis";

export abstract class BaseStore implements AppStore {
  abstract readonly provider: "singlestore" | "sqlite";
  abstract init(): Promise<void>;
  protected abstract all(sql: string, params?: unknown[]): Promise<Row[]>;
  protected abstract run(sql: string, params?: unknown[]): Promise<void>;
  protected abstract isDuplicateKey(err: unknown): boolean;
  /** Upsert one row keyed by `keys`; `cols` are every column written (keys included). */
  protected abstract upsert(table: string, cols: string[], keys: string[], values: unknown[]): Promise<void>;

  private doc(table: string, where: string, params: unknown[]): Promise<Row[]> {
    return this.all(`SELECT doc FROM ${table} WHERE ${where}`, params);
  }

  async reset(): Promise<void> {
    for (const t of [T.runs, T.events, T.runDocs]) await this.run(`DELETE FROM ${t}`);
  }

  async saveHousehold(h: Household): Promise<void> {
    await this.upsert(T.household, ["id", "doc"], ["id"], [h.id, JSON.stringify(h)]);
  }
  async getHousehold(id: string): Promise<Household | null> {
    const [row] = await this.doc(T.household, "id = ?", [id]);
    return row ? parseDoc<Household>(row.doc) : null;
  }

  async saveRecipes(recipes: Recipe[]): Promise<void> {
    for (const [i, r] of recipes.entries()) {
      await this.upsert(T.recipes, ["id", "position", "doc"], ["id"], [r.id, i, JSON.stringify(r)]);
    }
  }
  async getRecipes(): Promise<Recipe[]> {
    const rows = await this.all(`SELECT doc FROM ${T.recipes} ORDER BY position`);
    return rows.map((r) => parseDoc<Recipe>(r.doc));
  }

  async saveLabelSnapshot(skus: Sku[]): Promise<void> {
    for (const s of skus) {
      await this.upsert(
        T.skus,
        ["sku_id", "catalog_version", "label_version", "doc"],
        ["sku_id", "catalog_version"],
        [s.id, s.catalogVersion, s.label.version, JSON.stringify(s)],
      );
    }
  }

  async upsertRun(run: Run): Promise<void> {
    await this.upsert(
      T.runs,
      ["id", "household_id", "created_at", "doc"],
      ["id"],
      [run.id, run.householdId, run.createdAt, JSON.stringify(run)],
    );
  }
  async getRun(id: string): Promise<Run | null> {
    const [row] = await this.doc(T.runs, "id = ?", [id]);
    return row ? parseDoc<Run>(row.doc) : null;
  }
  async listRuns(householdId: string): Promise<Run[]> {
    const rows = await this.all(`SELECT doc FROM ${T.runs} WHERE household_id = ? ORDER BY created_at, id`, [householdId]);
    return rows.map((r) => parseDoc<Run>(r.doc));
  }

  /** Gap-free per-run seq: read MAX, insert MAX+1; the (run_id, seq) key rejects a racing writer, who retries. */
  async appendEvent(e: Omit<AuditEvent, "seq" | "at">): Promise<AuditEvent> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const [row] = await this.all(`SELECT MAX(seq) AS m FROM ${T.events} WHERE run_id = ?`, [e.runId]);
      const seq = Number(row?.m ?? 0) + 1;
      const full: AuditEvent = { ...e, seq, at: new Date().toISOString() };
      try {
        await this.run(`INSERT INTO ${T.events} (run_id, seq, at, doc) VALUES (?, ?, ?, ?)`, [
          full.runId, seq, full.at, JSON.stringify(full),
        ]);
        return full;
      } catch (err) {
        if (!this.isDuplicateKey(err)) throw err;
      }
    }
    throw new Error(`appendEvent: could not claim a seq for ${e.runId}`);
  }
  async listEvents(runId: string): Promise<AuditEvent[]> {
    const rows = await this.all(`SELECT doc FROM ${T.events} WHERE run_id = ? ORDER BY seq`, [runId]);
    return rows.map((r) => parseDoc<AuditEvent>(r.doc));
  }

  private saveRunDoc(runId: string, kind: Kind, value: unknown): Promise<void> {
    return this.upsert(T.runDocs, ["run_id", "kind", "doc"], ["run_id", "kind"], [runId, kind, JSON.stringify(value)]);
  }
  private async getRunDoc<D>(runId: string, kind: Kind): Promise<D | null> {
    const [row] = await this.doc(T.runDocs, "run_id = ? AND kind = ?", [runId, kind]);
    return row ? parseDoc<D>(row.doc) : null;
  }

  saveBasket(runId: string, basket: Basket) { return this.saveRunDoc(runId, "basket", basket); }
  getBasket(runId: string) { return this.getRunDoc<Basket>(runId, "basket"); }
  saveReceipt(r: Receipt) { return this.saveRunDoc(r.runId, "receipt", r); }
  getReceipt(runId: string) { return this.getRunDoc<Receipt>(runId, "receipt"); }
  saveKpis(runId: string, k: KpiSet) { return this.saveRunDoc(runId, "kpis", k); }
  getKpis(runId: string) { return this.getRunDoc<KpiSet>(runId, "kpis"); }
}
