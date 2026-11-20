// Demo clock: jump to next Sunday; the store restocks and the usual bread sells out (a real stock event).
import { NextResponse } from "next/server";
import { nextWeek } from "@/worker/parent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    return NextResponse.json(await nextWeek());
  } catch (e) {
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
