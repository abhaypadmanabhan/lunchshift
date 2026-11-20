// "Plan my week now": records a manual trigger; the background worker picks it up within a few seconds.
import { NextResponse } from "next/server";
import { planNow } from "@/worker/parent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    return NextResponse.json(await planNow());
  } catch (e) {
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
