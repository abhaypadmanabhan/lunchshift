// The agent's only merchant capability: catalog read, hold create, hold read. No payment route exists in this client.
import type { HoldRequest, MerchantHold, Sku } from "../lib/domain/types";

export type HoldDispatch =
  | { kind: "ok"; hold: MerchantHold; replayed: boolean }
  | { kind: "rejected"; status: number; error: string; detail?: unknown }
  | { kind: "lost"; error: string }; // timeout / connection dropped: outcome unknown

export interface StockEvent {
  seq: number;
  at: string;
  skuId: string;
  stock: number;
  kind: "stockout" | "restock";
}

export class GrocerClient {
  constructor(
    readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs = 4000,
  ) {}

  private async req(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  async catalog(): Promise<{ catalogVersion: string; skus: Sku[] }> {
    const r = await this.req("/catalog");
    if (!r.ok) throw new Error(`catalog ${r.status}`);
    return (await r.json()) as { catalogVersion: string; skus: Sku[] };
  }

  async events(since: number): Promise<StockEvent[]> {
    const r = await this.req(`/events?since=${since}`);
    if (!r.ok) throw new Error(`events ${r.status}`);
    return ((await r.json()) as { events: StockEvent[] }).events;
  }

  async placeHold(req: HoldRequest): Promise<HoldDispatch> {
    try {
      const r = await this.req("/holds", {
        method: "POST",
        body: JSON.stringify(req),
        headers: { "idempotency-key": req.operationKey },
      });
      const body = (await r.json()) as { hold?: MerchantHold; replayed?: boolean; error?: string };
      if (r.ok && body.hold) return { kind: "ok", hold: body.hold, replayed: Boolean(body.replayed) };
      return { kind: "rejected", status: r.status, error: body.error ?? "unknown", detail: body };
    } catch (e) {
      return { kind: "lost", error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Read-back by the original operation key. null = merchant has no record. */
  async readHold(operationKey: string): Promise<MerchantHold | null> {
    const r = await this.req(`/holds/${encodeURIComponent(operationKey)}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`readHold ${r.status}`);
    return ((await r.json()) as { hold: MerchantHold }).hold;
  }

  async listHolds(runId: string): Promise<MerchantHold[]> {
    const r = await this.req(`/holds?runId=${encodeURIComponent(runId)}`);
    if (!r.ok) throw new Error(`listHolds ${r.status}`);
    return ((await r.json()) as { holds: MerchantHold[] }).holds;
  }

  /** Scoped-credential proof: the agent token cannot pay. */
  async tryPayment(): Promise<{ status: number; error?: string }> {
    const r = await this.req("/payments", { method: "POST", body: "{}" });
    const b = (await r.json()) as { error?: string };
    return { status: r.status, error: b.error };
  }
}

/** Operator-only fixture controls (demo operator actions, never counted as shopper clicks). */
export class GrocerOperator {
  constructor(
    readonly baseUrl: string,
    private readonly token: string,
  ) {}
  private async post(path: string, body: unknown) {
    const r = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) throw new Error(`${path} ${r.status}`);
    return r.json();
  }
  reset() {
    return this.post("/admin/reset", {});
  }
  setStock(skuId: string, stock: number) {
    return this.post("/admin/stock", { skuId, stock });
  }
  dropNextHoldResponse(on = true) {
    return this.post("/admin/faults", { dropNextHoldResponse: on });
  }
  async state(): Promise<{ holds: MerchantHold[]; faults: { dropNextHoldResponse: boolean } }> {
    const r = await fetch(`${this.baseUrl}/admin/state`, {
      headers: { authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(4000),
    });
    return (await r.json()) as { holds: MerchantHold[]; faults: { dropNextHoldResponse: boolean } };
  }
}
