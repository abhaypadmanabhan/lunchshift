import { NextResponse } from "next/server";
import { switchFamily } from "@/worker/parent";
import { switchFamilyInput } from "@/lib/http/inputs";
import { jsonBody } from "@/lib/http/jsonBody";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = await jsonBody(req, switchFamilyInput, 1024);
  if (b instanceof NextResponse) return b;
  try {
    const r = await switchFamily(b.householdId);
    return NextResponse.json(r, { status: r.ok ? 200 : 404 });
  } catch {
    return NextResponse.json({ ok: false, reason: "Could not switch families" }, { status: 500 });
  }
}
