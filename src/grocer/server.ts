// Sandbox grocer: an independent merchant with its own SQLite DB. Owns stock, prices, labels and holds.
// The agent's credential can read the catalog, quote and place/read holds. It has no payment scope.
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CATALOG, CATALOG_VERSION } from "../lib/domain/fixture";
import { fingerprint } from "../lib/domain/rules";
import type { HoldLine, HoldRequest, MerchantHold, Order, Sku } from "../lib/domain/types";

export const AGENT_TOKEN = process.env.GROCER_AGENT_TOKEN ?? "sandbox-agent-token";
export const OPERATOR_TOKEN = process.env.GROCER_OPERATOR_TOKEN ?? "sandbox-operator-token";
const AGENT_SCOPES = ["catalog:read", "quote:create", "hold:create", "hold:read", "hold:cancel", "order:create_pay_at_pickup"];

export interface GrocerHandle {
  url: string;
  close(): Promise<void>;
}

interface StockEvent {
  seq: number;
  at: string;
  skuId: string;
  stock: number;
  kind: "stockout" | "restock";
}

export function hashFingerprint(lines: HoldLine[], totalCents: number, slot: string): string {
  return createHash("sha256").update(fingerprint(lines, totalCents, slot)).digest("hex").slice(0, 16);
}

export function openGrocerDb(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, sku TEXT NOT NULL, stock INTEGER NOT NULL, price_cents INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS holds (
      hold_id TEXT PRIMARY KEY, operation_key TEXT NOT NULL UNIQUE, run_id TEXT NOT NULL, status TEXT NOT NULL,
      lines TEXT NOT NULL, total_cents INTEGER NOT NULL, slot TEXT NOT NULL, expires_at TEXT NOT NULL,
      fingerprint TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS faults (name TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS orders (order_id TEXT PRIMARY KEY, operation_key TEXT NOT NULL UNIQUE, hold_key TEXT NOT NULL UNIQUE,
      run_id TEXT NOT NULL, status TEXT NOT NULL, placed_by TEXT NOT NULL, doc TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS stock_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, sku_id TEXT NOT NULL, stock INTEGER NOT NULL, kind TEXT NOT NULL);
  `);
  const count = (db.prepare("SELECT COUNT(*) AS n FROM products").get() as { n: number }).n;
  if (count === 0) seed(db);
  return db;
}

function seed(db: DatabaseSync) {
  db.exec("DELETE FROM products; DELETE FROM holds; DELETE FROM faults; DELETE FROM stock_events; DELETE FROM orders;");
  const ins = db.prepare("INSERT INTO products (id, sku, stock, price_cents) VALUES (?, ?, ?, ?)");
  // Fixture state for the unattended full-auto proof: a SKU can start the day sold out (no stock event emitted).
  const presetOut = process.env.GROCER_PRESET_STOCKOUT;
  for (const s of CATALOG) ins.run(s.id, JSON.stringify(s), s.id === presetOut ? 0 : s.stock, s.priceCents);
}

function readSkus(db: DatabaseSync): Sku[] {
  const rows = db.prepare("SELECT sku, stock, price_cents FROM products ORDER BY id").all() as {
    sku: string;
    stock: number;
    price_cents: number;
  }[];
  return rows.map((r) => ({ ...(JSON.parse(r.sku) as Sku), stock: r.stock, priceCents: r.price_cents, catalogVersion: CATALOG_VERSION }));
}

function rowToHold(r: Record<string, unknown>): MerchantHold {
  return {
    holdId: String(r.hold_id),
    operationKey: String(r.operation_key),
    runId: String(r.run_id),
    status: r.status as MerchantHold["status"],
    lines: JSON.parse(String(r.lines)) as HoldLine[],
    totalCents: Number(r.total_cents),
    slot: String(r.slot),
    expiresAt: String(r.expires_at),
    fingerprint: String(r.fingerprint),
    createdAt: String(r.created_at),
  };
}

function getFault(db: DatabaseSync, name: string): string | undefined {
  const r = db.prepare("SELECT value FROM faults WHERE name = ?").get(name) as { value: string } | undefined;
  return r?.value;
}

type Result = { status: number; body: unknown; dropResponse?: boolean };

function placeHold(db: DatabaseSync, key: string | undefined, req: HoldRequest): Result {
  if (!key || key !== req.operationKey) return { status: 400, body: { error: "idempotency_key_required" } };
  const fp = hashFingerprint(req.lines, req.totalCents, req.slot);
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db.prepare("SELECT * FROM holds WHERE operation_key = ?").get(key) as Record<string, unknown> | undefined;
    if (existing) {
      db.exec("COMMIT");
      if (existing.fingerprint !== fp) return { status: 409, body: { error: "key_reused_with_different_payload" } };
      return { status: 200, body: { hold: rowToHold(existing), replayed: true } };
    }
    const active = db.prepare("SELECT COUNT(*) AS n FROM holds WHERE run_id = ? AND status = 'active'").get(req.runId) as { n: number };
    if (active.n > 0) {
      db.exec("COMMIT");
      return { status: 409, body: { error: "run_already_has_active_hold" } };
    }
    if (req.catalogVersion !== CATALOG_VERSION) {
      db.exec("ROLLBACK");
      return { status: 422, body: { error: "catalog_version_mismatch" } };
    }
    let total = 0;
    for (const l of req.lines) {
      const p = db.prepare("SELECT stock, price_cents FROM products WHERE id = ?").get(l.skuId) as
        | { stock: number; price_cents: number }
        | undefined;
      if (!p) throw new HoldError(422, { error: "unknown_sku", skuId: l.skuId });
      if (p.price_cents !== l.unitPriceCents) throw new HoldError(422, { error: "price_changed", skuId: l.skuId });
      if (p.stock < l.packs) throw new HoldError(422, { error: "insufficient_stock", skuId: l.skuId, stock: p.stock });
      total += l.packs * l.unitPriceCents;
    }
    if (total !== req.totalCents) throw new HoldError(422, { error: "total_mismatch", expected: total });
    const dec = db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?");
    for (const l of req.lines) dec.run(l.packs, l.skuId);
    const now = new Date();
    const hold: MerchantHold = {
      holdId: `H-${randomUUID().slice(0, 8).toUpperCase()}`,
      operationKey: key,
      runId: req.runId,
      status: "active",
      lines: req.lines,
      totalCents: total,
      slot: req.slot,
      expiresAt: slotEnd(req.slot) ?? new Date(now.getTime() + 48 * 3600_000).toISOString(),
      fingerprint: fp,
      createdAt: now.toISOString(),
    };
    db.prepare(
      "INSERT INTO holds (hold_id, operation_key, run_id, status, lines, total_cents, slot, expires_at, fingerprint, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).run(hold.holdId, key, req.runId, "active", JSON.stringify(req.lines), total, req.slot, hold.expiresAt, fp, hold.createdAt);
    db.exec("COMMIT");
    // Fault injection: the hold is committed, then the response is lost.
    const drop = getFault(db, "drop_next_hold_response") === "1";
    if (drop) db.prepare("DELETE FROM faults WHERE name = 'drop_next_hold_response'").run();
    return { status: 201, body: { hold, replayed: false }, dropResponse: drop };
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* already closed */
    }
    if (e instanceof HoldError) return { status: e.status, body: e.body };
    throw e;
  }
}

/** A hold lives until the end of its pickup slot ("Sun 2026-11-22 16:00-18:00", store time PT). */
export function slotEnd(slot: string): string | null {
  const m = /(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}-(\d{2}:\d{2})/.exec(slot);
  return m ? new Date(`${m[1]}T${m[2]}:00-08:00`).toISOString() : null;
}

/** Turn an active hold into a pay-at-pickup order. Idempotent by operation key; one order per hold. */
function placeOrder(db: DatabaseSync, key: string | undefined, body: { operationKey: string; holdKey: string; placedBy?: "agent" | "parent" }): Result {
  if (!key || key !== body.operationKey) return { status: 400, body: { error: "idempotency_key_required" } };
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db.prepare("SELECT doc, hold_key FROM orders WHERE operation_key = ?").get(key) as { doc: string; hold_key: string } | undefined;
    if (existing) {
      db.exec("COMMIT");
      if (existing.hold_key !== body.holdKey) return { status: 409, body: { error: "key_reused_with_different_payload" } };
      return { status: 200, body: { order: JSON.parse(existing.doc) as Order, replayed: true } };
    }
    const h = db.prepare("SELECT * FROM holds WHERE operation_key = ?").get(body.holdKey) as Record<string, unknown> | undefined;
    if (!h || h.status !== "active") {
      db.exec("COMMIT");
      return { status: 422, body: { error: "no_active_hold" } };
    }
    const hold = rowToHold(h);
    const dupe = db.prepare("SELECT doc FROM orders WHERE hold_key = ?").get(body.holdKey) as { doc: string } | undefined;
    if (dupe) {
      db.exec("COMMIT");
      return { status: 409, body: { error: "hold_already_ordered" } };
    }
    const now = new Date().toISOString();
    const order: Order = {
      orderId: `LS-${randomUUID().slice(0, 6).toUpperCase()}`,
      operationKey: key,
      holdId: hold.holdId,
      runId: hold.runId,
      status: "placed",
      payment: "pay_at_pickup",
      placedBy: body.placedBy === "parent" ? "parent" : "agent",
      lines: hold.lines,
      totalCents: hold.totalCents,
      slot: hold.slot,
      placedAt: now,
      timeline: [
        { step: "placed", at: now, label: "Order placed · pay at pickup" },
        { step: "held", at: hold.createdAt, label: "Items held at the store" },
        { step: "ready", at: null, label: `Ready for pickup · ${hold.slot.replace(/^\w+ /, "")}` },
      ],
    };
    db.prepare("INSERT INTO orders (order_id, operation_key, hold_key, run_id, status, placed_by, doc, created_at) VALUES (?,?,?,?,?,?,?,?)").run(
      order.orderId, key, body.holdKey, order.runId, order.status, order.placedBy, JSON.stringify(order), now,
    );
    db.exec("COMMIT");
    const drop = getFault(db, "drop_next_order_response") === "1";
    if (drop) db.prepare("DELETE FROM faults WHERE name = 'drop_next_order_response'").run();
    return { status: 201, body: { order, replayed: false }, dropResponse: drop };
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* closed */
    }
    throw e;
  }
}

class HoldError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super("hold_error");
  }
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function handle(db: DatabaseSync, method: string, url: URL, auth: string, key: string | undefined, body: unknown): Result {
  const token = auth.replace(/^Bearer\s+/i, "");
  const isAgent = token === AGENT_TOKEN;
  const isOperator = token === OPERATOR_TOKEN;
  const p = url.pathname;

  if (p.startsWith("/admin/")) {
    if (!isOperator) return { status: 403, body: { error: "operator_only" } };
    if (method === "POST" && p === "/admin/reset") {
      seed(db);
      return { status: 200, body: { ok: true } };
    }
    if (method === "POST" && p === "/admin/stock") {
      const b = body as { skuId: string; stock: number };
      db.prepare("UPDATE products SET stock = ? WHERE id = ?").run(b.stock, b.skuId);
      db.prepare("INSERT INTO stock_events (at, sku_id, stock, kind) VALUES (?,?,?,?)").run(
        new Date().toISOString(),
        b.skuId,
        b.stock,
        b.stock === 0 ? "stockout" : "restock",
      );
      return { status: 200, body: { ok: true } };
    }
    if (method === "POST" && p === "/admin/faults") {
      const b = body as { dropNextHoldResponse?: boolean; dropNextOrderResponse?: boolean };
      if (b.dropNextHoldResponse) db.prepare("INSERT OR REPLACE INTO faults (name, value) VALUES ('drop_next_hold_response','1')").run();
      else if (b.dropNextHoldResponse === false) db.prepare("DELETE FROM faults WHERE name = 'drop_next_hold_response'").run();
      if (b.dropNextOrderResponse) db.prepare("INSERT OR REPLACE INTO faults (name, value) VALUES ('drop_next_order_response','1')").run();
      return { status: 200, body: { ok: true } };
    }
    if (method === "GET" && p === "/admin/state") {
      const holds = (db.prepare("SELECT * FROM holds ORDER BY created_at").all() as Record<string, unknown>[]).map(rowToHold);
      return { status: 200, body: { holds, faults: { dropNextHoldResponse: getFault(db, "drop_next_hold_response") === "1" } } };
    }
    return { status: 404, body: { error: "not_found" } };
  }

  if (!isAgent && !isOperator) return { status: 401, body: { error: "unauthorized" } };
  if (p === "/payments" || p.startsWith("/payments/") || p === "/checkout") {
    return { status: 403, body: { error: "insufficient_scope", detail: "agent credential has no payment scope", scopes: AGENT_SCOPES } };
  }
  if (method === "GET" && p === "/whoami") return { status: 200, body: { role: isAgent ? "agent" : "operator", scopes: AGENT_SCOPES } };
  if (method === "GET" && p === "/catalog") return { status: 200, body: { catalogVersion: CATALOG_VERSION, skus: readSkus(db) } };
  if (method === "GET" && p === "/events") {
    const since = Number(url.searchParams.get("since") ?? 0);
    const rows = db.prepare("SELECT * FROM stock_events WHERE seq > ? ORDER BY seq").all(since) as Record<string, unknown>[];
    const events: StockEvent[] = rows.map((r) => ({
      seq: Number(r.seq),
      at: String(r.at),
      skuId: String(r.sku_id),
      stock: Number(r.stock),
      kind: r.kind as StockEvent["kind"],
    }));
    return { status: 200, body: { events } };
  }
  if (method === "POST" && p === "/holds") return placeHold(db, key, body as HoldRequest);
  if (method === "POST" && p === "/orders") return placeOrder(db, key, body as { operationKey: string; holdKey: string; placedBy?: "agent" | "parent" });
  if (method === "GET" && p === "/orders") {
    const runId = url.searchParams.get("runId");
    const rows = (runId
      ? db.prepare("SELECT doc FROM orders WHERE run_id = ? ORDER BY created_at DESC").all(runId)
      : db.prepare("SELECT doc FROM orders ORDER BY created_at DESC").all()) as { doc: string }[];
    return { status: 200, body: { orders: rows.map((r) => JSON.parse(r.doc) as Order) } };
  }
  if (method === "GET" && p.startsWith("/orders/")) {
    const k = decodeURIComponent(p.slice("/orders/".length));
    const r = db.prepare("SELECT doc FROM orders WHERE operation_key = ?").get(k) as { doc: string } | undefined;
    return r ? { status: 200, body: { order: JSON.parse(r.doc) as Order } } : { status: 404, body: { error: "not_found" } };
  }
  if (method === "GET" && p === "/holds") {
    const runId = url.searchParams.get("runId") ?? "";
    const rows = db.prepare("SELECT * FROM holds WHERE run_id = ? ORDER BY created_at").all(runId) as Record<string, unknown>[];
    return { status: 200, body: { holds: rows.map(rowToHold) } };
  }
  if (method === "POST" && p.startsWith("/holds/") && p.endsWith("/release")) {
    const k = decodeURIComponent(p.slice("/holds/".length, -"/release".length));
    db.exec("BEGIN IMMEDIATE");
    try {
      const r = db.prepare("SELECT * FROM holds WHERE operation_key = ?").get(k) as Record<string, unknown> | undefined;
      if (!r) {
        db.exec("COMMIT");
        return { status: 404, body: { error: "not_found" } };
      }
      if (r.status === "active") {
        for (const l of JSON.parse(String(r.lines)) as HoldLine[]) db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").run(l.packs, l.skuId);
        db.prepare("UPDATE holds SET status = 'released' WHERE operation_key = ?").run(k);
        const o = db.prepare("SELECT order_id, doc FROM orders WHERE hold_key = ?").get(k) as { order_id: string; doc: string } | undefined;
        if (o) {
          const doc = JSON.parse(o.doc) as Order;
          doc.status = "cancelled";
          doc.timeline = [...doc.timeline, { step: "cancelled", at: new Date().toISOString(), label: "Cancelled by the parent" }];
          db.prepare("UPDATE orders SET status = 'cancelled', doc = ? WHERE order_id = ?").run(JSON.stringify(doc), o.order_id);
        }
      }
      db.exec("COMMIT");
      const after = db.prepare("SELECT * FROM holds WHERE operation_key = ?").get(k) as Record<string, unknown>;
      return { status: 200, body: { hold: rowToHold(after) } };
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  if (method === "GET" && p.startsWith("/holds/")) {
    const k = decodeURIComponent(p.slice("/holds/".length));
    const r = db.prepare("SELECT * FROM holds WHERE operation_key = ?").get(k) as Record<string, unknown> | undefined;
    return r ? { status: 200, body: { hold: rowToHold(r) } } : { status: 404, body: { error: "not_found" } };
  }
  return { status: 404, body: { error: "not_found" } };
}

export function startGrocer(opts: { port?: number; dbPath?: string; reseed?: boolean } = {}): Promise<GrocerHandle> {
  const db = openGrocerDb(opts.dbPath ?? ".data/grocer.db");
  if (opts.reseed) seed(db);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://grocer.local");
      const body = req.method === "POST" ? await readJson(req) : undefined;
      const key = (req.headers["idempotency-key"] as string | undefined) ?? undefined;
      const r = handle(db, req.method ?? "GET", url, String(req.headers.authorization ?? ""), key, body);
      if (r.dropResponse) {
        // Committed, but the client never hears back: the connection stalls, then dies (like a real lost reply).
        setTimeout(() => req.socket.destroy(), Number(process.env.GROCER_DROP_STALL_MS ?? 3000));
        return;
      }
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(JSON.stringify(r.body));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "internal", detail: e instanceof Error ? e.message : String(e) }));
    }
  });
  return new Promise((resolve) => {
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : opts.port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((r) => {
            server.closeAllConnections();
            server.close(() => {
              db.close();
              r();
            });
          }),
      });
    });
  });
}
