// "How much can LunchShift do?" Saved per family; sent to Statsig as custom.autonomy_pref on every evaluation.
import { NextResponse } from "next/server";
import { setAutonomy } from "@/worker/parent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { mode?: string };
  const r = await setAutonomy(String(b.mode ?? ""));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
