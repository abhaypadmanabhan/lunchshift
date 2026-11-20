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

/** Use the configured public origin, or a loopback request URL for local runs. */
export function checkoutOrigin(requestUrl: string): string | null {
  const configured = process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "");
  const url = URL.parse(configured || requestUrl);
  if (!url || url.username || url.password) return null;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!configured && !local) return null;
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
  if (configured && (url.pathname !== "/" || url.search || url.hash)) return null;
  return url.origin;
}

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
  | { ok: true; paid: boolean; paymentIntentId: string | null; amountCents: number | null; currency: string | null; metadata: Record<string, string> }
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
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${base()}/v1/checkout/sessions`, { method: "POST", headers, body, signal: AbortSignal.timeout(10000) });
      if (!res.ok) return { ok: false, error: `Stripe Checkout unavailable (HTTP ${res.status})` };
      const j = (await res.json()) as { id?: string; url?: string };
      if (!j.id || !j.url) return { ok: false, error: "Stripe returned no Checkout Session" };
      return { ok: true, sessionId: j.id, url: j.url };
    } catch {
      // A reply may have been lost after checkout creation. Retry once with the same key and body.
    }
  }
  return { ok: false, error: "No reply from Stripe" };
}

export async function retrieveSession(sessionId: string): Promise<SessionResult> {
  const s = stripeStatus();
  if (!s.enabled) return { ok: false, error: s.reason };
  if (sessionId.length > 160 || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return { ok: false, error: "Not a Checkout Session id" };
  try {
    const res = await fetch(`${base()}/v1/checkout/sessions/${sessionId}`, {
      headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
      signal: AbortSignal.timeout(10000),
    });
    const j = (await res.json()) as {
      payment_status?: string;
      payment_intent?: string | { id: string } | null;
      amount_total?: number;
      currency?: string;
      metadata?: Record<string, string>;
    };
    if (!res.ok) return { ok: false, error: `Stripe payment verification unavailable (HTTP ${res.status})` };
    const pi = typeof j.payment_intent === "string" ? j.payment_intent : (j.payment_intent?.id ?? null);
    return { ok: true, paid: j.payment_status === "paid", paymentIntentId: pi, amountCents: j.amount_total ?? null, currency: j.currency ?? null, metadata: j.metadata ?? {} };
  } catch {
    return { ok: false, error: "No payment verification reply from Stripe" };
  }
}
