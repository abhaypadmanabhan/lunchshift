// Demo operator action (fixture/gate control). Audited as actor "operator"; never a shopper click.
import { NextResponse } from "next/server";
import { operatorAction } from "@/worker/operator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    return NextResponse.json(await operatorAction("reset"));
  } catch (e) {
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
