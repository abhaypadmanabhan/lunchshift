// Run a routine now and return its one-line result.
import { NextResponse } from "next/server";
import { runRoutine } from "@/worker/parent";
import { runRoutineInput } from "@/lib/http/inputs";
import { jsonBody } from "@/lib/http/jsonBody";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = await jsonBody(req, runRoutineInput, 1024);
  if (b instanceof NextResponse) return b;
  try {
    const r = await runRoutine(b.id);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch {
    return NextResponse.json({ ok: false, result: "Could not run the routine" }, { status: 500 });
  }
}
