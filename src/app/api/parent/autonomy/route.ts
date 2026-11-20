// "How much can LunchShift do?" Saved per family; sent to Statsig as custom.autonomy_pref on every evaluation.
import { NextResponse } from "next/server";
import { setAutonomy } from "@/worker/parent";
import { autonomyInput } from "@/lib/http/inputs";
import { jsonBody } from "@/lib/http/jsonBody";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = await jsonBody(req, autonomyInput, 1024);
  if (b instanceof NextResponse) return b;
  try {
    const r = await setAutonomy(b.mode);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch {
    return NextResponse.json({ ok: false, reason: "Could not update autonomy" }, { status: 500 });
  }
}
