// Toggle or edit one of the family's routines (weekly plan, stock watch, school calendar, budget alert).
import { NextResponse } from "next/server";
import { updateRoutine } from "@/worker/parent";
import { routineInput } from "@/lib/http/inputs";
import { jsonBody } from "@/lib/http/jsonBody";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = await jsonBody(req, routineInput, 1024);
  if (b instanceof NextResponse) return b;
  try {
    const r = await updateRoutine(b.id, b.enabled, b.config);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch {
    return NextResponse.json({ ok: false, reason: "Could not update the routine" }, { status: 500 });
  }
}
