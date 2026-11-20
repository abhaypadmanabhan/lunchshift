// AppStore over SingleStore Helios (MySQL wire protocol). System of record for the app.
// TLS is always verified. If the platform trust store rejects the server, SingleStore's public
// CA bundle is fetched once into .data/ and used as the trust anchor; verification is never off.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import mysql, { type Pool } from "mysql2/promise";
import { BaseStore, T } from "./base";

const CA_URL = "https://portal.singlestore.com/static/ca/singlestore_bundle.pem";
const CA_PATH = ".data/singlestore_bundle.pem";

export function isSingleStoreConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SINGLESTORE_URL || env.SINGLESTORE_HOST || looksLikeUrl(env.SINGLESTORE_DATABASE));
}

const DEFAULT_DB = "lunchshift";

interface Conn { host: string; port: number; user: string; password: string; database?: string }

const looksLikeUrl = (v: string | undefined): v is string => Boolean(v && /^[a-z][a-z0-9+.-]*:\/\//i.test(v));

/** mysql://user:pass@host:port/dbname (or singlestore://...). The DB name is the last path segment. */
export function parseConnUrl(url: string, fallbackDb?: string): Conn {
  const u = new URL(url);
  const last = u.pathname.split("/").filter(Boolean).pop();
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: last ? decodeURIComponent(last) : fallbackDb && !looksLikeUrl(fallbackDb) ? fallbackDb : undefined,
  };
}

/** LUNCHSHIFT_DB_NAME keeps each deployment in its own database (e.g. the public demo vs a laptop). */
export function readConn(env: NodeJS.ProcessEnv): Conn {
  const c = readConnBase(env);
  return env.LUNCHSHIFT_DB_NAME ? { ...c, database: env.LUNCHSHIFT_DB_NAME.replace(/[^A-Za-z0-9_]/g, "") } : c;
}

function readConnBase(env: NodeJS.ProcessEnv): Conn {
  if (env.SINGLESTORE_URL) return parseConnUrl(env.SINGLESTORE_URL, env.SINGLESTORE_DATABASE);
  // Tolerate a full connection URL pasted into SINGLESTORE_DATABASE.
  if (looksLikeUrl(env.SINGLESTORE_DATABASE)) return parseConnUrl(env.SINGLESTORE_DATABASE);
  return {
    host: env.SINGLESTORE_HOST ?? "",
    port: Number(env.SINGLESTORE_PORT ?? 3306),
    user: env.SINGLESTORE_USER ?? "",
    password: env.SINGLESTORE_PASSWORD ?? "",
    database: env.SINGLESTORE_DATABASE,
  };
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS ${T.household} (id VARCHAR(64) NOT NULL, doc JSON NOT NULL, PRIMARY KEY (id), SHARD KEY (id))`,
  `CREATE TABLE IF NOT EXISTS ${T.recipes} (id VARCHAR(64) NOT NULL, position INT NOT NULL, doc JSON NOT NULL,
     PRIMARY KEY (id), SHARD KEY (id))`,
  `CREATE TABLE IF NOT EXISTS ${T.skus} (sku_id VARCHAR(64) NOT NULL, catalog_version VARCHAR(64) NOT NULL,
     label_version VARCHAR(96) NOT NULL, doc JSON NOT NULL, PRIMARY KEY (sku_id, catalog_version), SHARD KEY (sku_id))`,
  `CREATE TABLE IF NOT EXISTS ${T.runs} (id VARCHAR(96) NOT NULL, household_id VARCHAR(64) NOT NULL,
     created_at VARCHAR(40) NOT NULL, doc JSON NOT NULL, PRIMARY KEY (id), SHARD KEY (id))`,
  `CREATE TABLE IF NOT EXISTS ${T.events} (run_id VARCHAR(96) NOT NULL, seq INT NOT NULL, at VARCHAR(40) NOT NULL,
     doc JSON NOT NULL, PRIMARY KEY (run_id, seq), SHARD KEY (run_id))`,
  `CREATE TABLE IF NOT EXISTS ${T.runDocs} (run_id VARCHAR(96) NOT NULL, kind VARCHAR(16) NOT NULL, doc JSON NOT NULL,
     PRIMARY KEY (run_id, kind), SHARD KEY (run_id))`,
];

const isCertError = (e: unknown) =>
  /certificate|self.signed|unable to (verify|get)|UNABLE_TO|CERT_/i.test(
    `${(e as { code?: string })?.code ?? ""} ${(e as Error)?.message ?? ""}`,
  );

async function ensureCaBundle(): Promise<string> {
  if (!existsSync(CA_PATH)) {
    const res = await fetch(CA_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`CA bundle fetch failed (${res.status})`);
    const pem = await res.text();
    if (!pem.includes("BEGIN CERTIFICATE")) throw new Error("CA bundle fetch returned no certificates");
    mkdirSync(".data", { recursive: true });
    writeFileSync(CA_PATH, pem);
  }
  return readFileSync(CA_PATH, "utf8");
}

export class SingleStoreStore extends BaseStore {
  readonly provider = "singlestore" as const;
  private pool: Pool | null = null;
  private conn: Conn;
  /** "system" when the platform trust store accepted the server, "singlestore_bundle" otherwise. */
  tlsTrust: "system" | "singlestore_bundle" | "unconnected" = "unconnected";

  constructor(env: NodeJS.ProcessEnv = process.env) {
    super();
    this.conn = readConn(env);
  }

  /** The database we create and use when the connection names none (or LUNCHSHIFT_DB_NAME asks for its own). */
  private dbToCreate(): string {
    return this.conn.database ?? DEFAULT_DB;
  }

  private make(ca?: string, withoutDb = false): Pool {
    return mysql.createPool({
      ...this.conn,
      database: withoutDb ? undefined : this.conn.database,
      ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
      connectTimeout: 5000,
      connectionLimit: 4,
      waitForConnections: true,
      enableKeepAlive: true,
    });
  }

  /** Connected pool, shared with the SingleStore vector ranker. */
  async getPool(): Promise<Pool> {
    if (this.pool) return this.pool;
    if (!this.conn.database || process.env.LUNCHSHIFT_DB_NAME) {
      // No database named (or a deployment-specific one): create it if missing, then use it.
      const target = this.dbToCreate();
      const boot = this.make(undefined, true);
      try {
        await boot.query(`CREATE DATABASE IF NOT EXISTS ${target}`);
      } catch (e) {
        if (!isCertError(e)) throw e;
        await boot.end().catch(() => undefined);
        const boot2 = this.make(await ensureCaBundle(), true);
        await boot2.query(`CREATE DATABASE IF NOT EXISTS ${target}`).finally(() => boot2.end().catch(() => undefined));
      } finally {
        await boot.end().catch(() => undefined);
      }
      this.conn = { ...this.conn, database: target };
    }
    let pool = this.make();
    try {
      await pool.query("SELECT 1");
      this.tlsTrust = "system";
    } catch (e) {
      await pool.end().catch(() => undefined);
      if (!isCertError(e)) throw e;
      pool = this.make(await ensureCaBundle());
      await pool.query("SELECT 1");
      this.tlsTrust = "singlestore_bundle";
    }
    this.pool = pool;
    return pool;
  }

  /** Reachability probe for getStore: SELECT 1 only, no DDL. */
  async ping(): Promise<void> {
    await (await this.getPool()).query("SELECT 1");
  }

  async init(): Promise<void> {
    const pool = await this.getPool();
    for (const sql of DDL) await pool.query(sql);
  }

  async close(): Promise<void> {
    await this.pool?.end();
    this.pool = null;
  }

  protected async all(sql: string, params: unknown[] = []) {
    const [rows] = await (await this.getPool()).query(sql, params);
    return rows as Record<string, unknown>[];
  }
  protected async run(sql: string, params: unknown[] = []) {
    await (await this.getPool()).query(sql, params);
  }
  protected isDuplicateKey(err: unknown) {
    const e = err as { code?: string; errno?: number; message?: string };
    return e?.code === "ER_DUP_ENTRY" || e?.errno === 1062 || /duplicate (entry|key)/i.test(e?.message ?? "");
  }
  protected async upsert(table: string, cols: string[], keys: string[], values: unknown[]) {
    const set = cols.filter((c) => !keys.includes(c)).map((c) => `${c} = VALUES(${c})`).join(", ");
    await this.run(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})
       ON DUPLICATE KEY UPDATE ${set}`,
      values,
    );
  }
}
