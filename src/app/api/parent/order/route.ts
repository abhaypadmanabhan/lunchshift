// The parent places this week's order from the verified hold: pay at pickup, idempotent by key order:<runId>.
import { NextResponse } from "next/server";
import { placeOrderByParent } from "@/worker/parent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    const r = await placeOrderByParent();
    return NextResponse.json(r, { status: r.ok ? 200 : 409 });
  } catch (e) {
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
