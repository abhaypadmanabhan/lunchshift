// Back from Stripe Checkout: the server retrieves the session from Stripe to confirm payment (the redirect alone proves nothing).
import { NextResponse } from "next/server";
import { confirmPayment } from "@/worker/parent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { sessionId?: string };
  try {
    const r = await confirmPayment(String(b.sessionId ?? ""));
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
