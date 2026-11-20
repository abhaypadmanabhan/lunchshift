// Run a routine now and return its one-line result.
import { NextResponse } from "next/server";
import { runRoutine } from "@/worker/parent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { id?: string };
  try {
    const r = await runRoutine(String(b.id ?? ""));
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, result: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
