// Stripe Checkout in TEST MODE only, for the parent's own "Pay (test)" tap. The agent never calls this.
// Plain REST over fetch (no SDK). The key is read from process.env server-side and never logged or returned.

export type StripeStatus = { enabled: true } | { enabled: false; reason: string };

/** Payments switch on only with a test key; a live key or none falls back to pay at pickup. */
export function stripeStatus(): StripeStatus {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key) return { enabled: false, reason: "Card payment not set up · pay at pickup" };
  if (!key.startsWith("sk_test_")) return { enabled: false, reason: "Only Stripe test mode is allowed · pay at pickup" };
  return { enabled: true };
}

const base = () => (process.env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/$/, "");

export interface CheckoutLine {
  name: string;
  unitCents: number;
  qty: number;
}

export interface CheckoutRequest {
  runId: string;
  holdRef: string;
  householdId: string;
  orderId: string;
  lines: CheckoutLine[];
  successUrl: string;
  cancelUrl: string;
}

export type CheckoutResult = { ok: true; sessionId: string; url: string } | { ok: false; error: string };
export type SessionResult =
  | { ok: true; paid: boolean; paymentIntentId: string | null; amountCents: number; runId: string | null }
  | { ok: false; error: string };

function form(r: CheckoutRequest): URLSearchParams {
  const f = new URLSearchParams();
  f.set("mode", "payment");
  f.set("success_url", r.successUrl);
  f.set("cancel_url", r.cancelUrl);
  r.lines.forEach((l, i) => {
    f.set(`line_items[${i}][quantity]`, String(l.qty));
    f.set(`line_items[${i}][price_data][currency]`, "usd");
    f.set(`line_items[${i}][price_data][unit_amount]`, String(l.unitCents));
    f.set(`line_items[${i}][price_data][product_data][name]`, l.name.slice(0, 120));
  });
  for (const [k, v] of Object.entries({ app: "lunchshift", hold_ref: r.holdRef, run_id: r.runId, household_id: r.householdId, order_id: r.orderId })) {
    f.set(`metadata[${k}]`, v);
    f.set(`payment_intent_data[metadata][${k}]`, v);
  }
  return f;
}

/** One Checkout Session per hold: the idempotency key is derived from the run, so a retry or a double tap returns the
 * same session (and so at most one PaymentIntent). A lost reply is retried once with the identical key and body. */
export async function createCheckout(r: CheckoutRequest): Promise<CheckoutResult> {
  const s = stripeStatus();
  if (!s.enabled) return { ok: false, error: s.reason };
  const body = form(r).toString();
  const headers = {
    authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
    "content-type": "application/x-www-form-urlencoded",
    "idempotency-key": `checkout:hold:${r.runId}`,
  };
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${base()}/v1/checkout/sessions`, { method: "POST", headers, body, signal: AbortSignal.timeout(10000) });
      const j = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
      if (!res.ok || !j.id || !j.url) return { ok: false, error: `Stripe HTTP ${res.status}: ${j.error?.message ?? "no session"}` };
      return { ok: true, sessionId: j.id, url: j.url };
    } catch (e) {
      last = e instanceof Error ? e.message : String(e); // reply lost: same key, same body, once
    }
  }
  return { ok: false, error: `No reply from Stripe (${last})` };
}

export async function retrieveSession(sessionId: string): Promise<SessionResult> {
  const s = stripeStatus();
  if (!s.enabled) return { ok: false, error: s.reason };
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return { ok: false, error: "Not a Checkout Session id" };
  try {
    const res = await fetch(`${base()}/v1/checkout/sessions/${sessionId}`, {
      headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
      signal: AbortSignal.timeout(10000),
    });
    const j = (await res.json()) as {
      payment_status?: string;
      payment_intent?: string | { id: string } | null;
      amount_total?: number;
      metadata?: Record<string, string>;
      error?: { message?: string };
    };
    if (!res.ok) return { ok: false, error: `Stripe HTTP ${res.status}: ${j.error?.message ?? ""}` };
    const pi = typeof j.payment_intent === "string" ? j.payment_intent : (j.payment_intent?.id ?? null);
    return { ok: true, paid: j.payment_status === "paid", paymentIntentId: pi, amountCents: Number(j.amount_total ?? 0), runId: j.metadata?.run_id ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
