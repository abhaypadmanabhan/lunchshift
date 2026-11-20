// The parent cancels this week's pickup: the store hold is released (agent scope hold:cancel; still no payment scope).
import { NextResponse } from "next/server";
import { cancelHold } from "@/worker/parent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    const r = await cancelHold();
    return NextResponse.json(r, { status: r.ok ? 200 : 409 });
  } catch (e) {
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
