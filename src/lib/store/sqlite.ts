// AppStore over the built-in node:sqlite. Used when SingleStore is not configured or unreachable.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { BaseStore, T } from "./base";

// @types/node 20 has no node:sqlite typings; this is the slice we use.
interface Statement {
  all(...params: unknown[]): Record<string, unknown>[];
  run(...params: unknown[]): unknown;
}
interface Database {
  prepare(sql: string): Statement;
  exec(sql: string): void;
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS ${T.household} (id TEXT PRIMARY KEY, doc TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ${T.recipes} (id TEXT PRIMARY KEY, position INTEGER NOT NULL, doc TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ${T.skus} (sku_id TEXT NOT NULL, catalog_version TEXT NOT NULL, label_version TEXT NOT NULL,
     doc TEXT NOT NULL, PRIMARY KEY (sku_id, catalog_version))`,
  `CREATE TABLE IF NOT EXISTS ${T.runs} (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, created_at TEXT NOT NULL, doc TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ${T.events} (run_id TEXT NOT NULL, seq INTEGER NOT NULL, at TEXT NOT NULL, doc TEXT NOT NULL,
     PRIMARY KEY (run_id, seq))`,
  `CREATE TABLE IF NOT EXISTS ${T.runDocs} (run_id TEXT NOT NULL, kind TEXT NOT NULL, doc TEXT NOT NULL, PRIMARY KEY (run_id, kind))`,
];

export class SqliteStore extends BaseStore {
  readonly provider = "sqlite" as const;
  private db: Database | null = null;
  constructor(private readonly path = ".data/app.db") { super(); }

  private async open(): Promise<Database> {
    if (this.db) return this.db;
    mkdirSync(dirname(this.path), { recursive: true });
    // getBuiltinModule: @types/node 20 has no node:sqlite typings, and Next must not bundle the builtin.
    const mod = process.getBuiltinModule("node:sqlite") as { DatabaseSync: new (path: string) => Database } | undefined;
    if (!mod) throw new Error("node:sqlite is unavailable (needs Node 22.5+)");
    this.db = new mod.DatabaseSync(this.path);
    return this.db;
  }

  async init(): Promise<void> {
    const db = await this.open();
    for (const sql of DDL) db.exec(sql);
  }
  protected async all(sql: string, params: unknown[] = []) {
    return (await this.open()).prepare(sql).all(...params);
  }
  protected async run(sql: string, params: unknown[] = []) {
    (await this.open()).prepare(sql).run(...params);
  }
  protected isDuplicateKey(err: unknown) {
    return /UNIQUE constraint failed|PRIMARY KEY/i.test(String((err as Error)?.message ?? err));
  }
  protected async upsert(table: string, cols: string[], keys: string[], values: unknown[]) {
    const set = cols.filter((c) => !keys.includes(c)).map((c) => `${c} = excluded.${c}`).join(", ");
    await this.run(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})
       ON CONFLICT (${keys.join(", ")}) DO UPDATE SET ${set}`,
      values,
    );
  }
}
