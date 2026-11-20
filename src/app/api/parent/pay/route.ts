// The parent's "Pay (test)" tap: opens Stripe Checkout in test mode for this week's placed order. Never the agent.
import { NextResponse } from "next/server";
import { startPayment } from "@/worker/parent";
import { checkoutOrigin } from "@/lib/payments/stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const origin = checkoutOrigin(req.url);
  if (!origin) return NextResponse.json({ ok: false, reason: "Test Checkout URL is not configured" }, { status: 503 });
  try {
    const r = await startPayment(origin);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch {
    return NextResponse.json({ ok: false, reason: "Could not open test Checkout" }, { status: 500 });
  }
}
