// The parent talks to LunchShift. Claude proposes typed facts; code validates them; nothing is saved until confirmed.
import { NextResponse } from "next/server";
import { interpret } from "@/lib/llm/chat";
import { chatInput, MAX_FACTS, proposedFactInput } from "@/lib/http/inputs";
import { jsonBody } from "@/lib/http/jsonBody";
import { activeHousehold, ensureSeeded } from "@/worker/deps";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = await jsonBody(req, chatInput, 8192);
  if (b instanceof NextResponse) return b;
  try {
    const store = await ensureSeeded();
    const h = await activeHousehold(store);
    const r = await interpret(b.message, b.mode, h);
    const facts = r.facts.filter((fact) => proposedFactInput.safeParse(fact).success).slice(0, MAX_FACTS);
    return NextResponse.json({ ok: true, ...r, facts });
  } catch {
    return NextResponse.json({ ok: false, reason: "Could not read the household" }, { status: 500 });
  }
}
