// The parent's one click in suggest_only. Records the approval only; the background worker (the single writer)
// applies the swap and places the hold on its next tick.
import { NextResponse } from "next/server";
import { recordApproval } from "@/worker/runWeekly";
import { DEMO_RUN_ID, ensureSeeded } from "@/worker/deps";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    const store = await ensureSeeded();
    await recordApproval(store, DEMO_RUN_ID);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : String(e) }, { status: 409 });
  }
}
