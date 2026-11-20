// Save the facts the parent confirmed: household record (the authority) + Cognee memory for this family; re-plan.
import { NextResponse } from "next/server";
import type { ProposedFact } from "@/lib/domain/view";
import { confirmFacts } from "@/worker/parent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { facts?: ProposedFact[]; mode?: string };
  const facts = Array.isArray(b.facts) ? b.facts.filter((f) => f && typeof f.kind === "string" && f.value && typeof f.value === "object") : [];
  try {
    const r = await confirmFacts(facts, b.mode === "onboarding" ? "onboarding" : "assistant");
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, saved: [], reason: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
