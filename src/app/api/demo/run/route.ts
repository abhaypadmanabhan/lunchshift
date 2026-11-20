// Demo operator action stub. The orchestrator wires this to the worker/grocer.
import { NextResponse } from "next/server";

export function POST() {
  return NextResponse.json({ ok: false, reason: "not wired" }, { status: 501 });
}
