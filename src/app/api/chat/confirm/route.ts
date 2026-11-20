// Save the facts the parent confirmed: household record (the authority) + Cognee memory for this family; re-plan.
import { NextResponse } from "next/server";
import { confirmInput } from "@/lib/http/inputs";
import { jsonBody } from "@/lib/http/jsonBody";
import { confirmFacts } from "@/worker/parent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = await jsonBody(req, confirmInput, 32_768);
  if (b instanceof NextResponse) return b;
  try {
    const r = await confirmFacts(b.facts, b.mode);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch {
    return NextResponse.json({ ok: false, saved: [], reason: "Could not save the household facts" }, { status: 500 });
  }
}
