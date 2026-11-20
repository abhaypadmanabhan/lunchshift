// GET /api/state -> the real RunView from the app store. `?state=a|b|c|d` serves a static sample (design fallback only).
import { NextResponse } from "next/server";
import { buildView } from "@/lib/view/buildView";
import { isSampleState, sampleRunView } from "@/lib/view/sample";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const param = new URL(req.url).searchParams.get("state");
  const view = isSampleState(param) ? sampleRunView(param) : await buildView();
  return NextResponse.json(view, { headers: { "cache-control": "no-store" } });
}
