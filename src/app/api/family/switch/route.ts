import { NextResponse } from "next/server";
import { switchFamily } from "@/worker/parent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { householdId?: string };
  const r = await switchFamily(String(b.householdId ?? ""));
  return NextResponse.json(r, { status: r.ok ? 200 : 404 });
}
