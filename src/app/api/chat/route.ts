// The parent talks to LunchShift. Claude proposes typed facts; code validates them; nothing is saved until confirmed.
import { NextResponse } from "next/server";
import { interpret } from "@/lib/llm/chat";
import { activeHousehold, ensureSeeded } from "@/worker/deps";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { message?: string; mode?: string };
  const message = String(b.message ?? "").slice(0, 1200).trim();
  if (!message) return NextResponse.json({ ok: false, reason: "Say something first" }, { status: 400 });
  const store = await ensureSeeded();
  const h = await activeHousehold(store);
  const r = await interpret(message, b.mode === "onboarding" ? "onboarding" : "assistant", h);
  return NextResponse.json({ ok: true, ...r });
}
