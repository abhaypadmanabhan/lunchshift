// Back from Stripe Checkout: the server retrieves the session from Stripe to confirm payment (the redirect alone proves nothing).
import { NextResponse } from "next/server";
import { confirmPayment } from "@/worker/parent";
import { confirmPaymentInput } from "@/lib/http/inputs";
import { jsonBody } from "@/lib/http/jsonBody";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = await jsonBody(req, confirmPaymentInput, 1024);
  if (b instanceof NextResponse) return b;
  try {
    const r = await confirmPayment(b.sessionId);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch {
    return NextResponse.json({ ok: false, reason: "Could not confirm the test payment" }, { status: 500 });
  }
}
