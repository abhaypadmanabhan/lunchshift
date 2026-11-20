// Toggle or edit one of the family's routines (weekly plan, stock watch, school calendar, budget alert).
import { NextResponse } from "next/server";
import { updateRoutine } from "@/worker/parent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { id?: string; enabled?: boolean; config?: Record<string, unknown> };
  const r = await updateRoutine(String(b.id ?? ""), b.enabled, b.config && typeof b.config === "object" ? b.config : undefined);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
