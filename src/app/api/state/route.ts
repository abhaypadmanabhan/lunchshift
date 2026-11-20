// GET /api/state -> RunView. Thin on purpose: the orchestrator replaces the body with the real builder.
import { NextResponse } from "next/server";
import { isSampleState, sampleRunView } from "@/lib/view/sample";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const param = new URL(req.url).searchParams.get("state");
  const state = isSampleState(param) ? param : "d";
  return NextResponse.json(sampleRunView(state), { headers: { "cache-control": "no-store" } });
}
