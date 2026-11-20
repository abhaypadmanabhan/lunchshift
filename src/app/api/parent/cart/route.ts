// The parent edits this week's cart. Every change passes the same deterministic allergen, stock and budget checks.
import { NextResponse } from "next/server";
import { updateCart } from "@/worker/parent";
import { buildView } from "@/lib/view/buildView";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const b = (await req.json()) as { skuId?: unknown; packs?: unknown };
    if (typeof b.skuId !== "string" || typeof b.packs !== "number") return NextResponse.json({ ok: false, reason: "skuId and packs required" }, { status: 400 });
    const r = await updateCart(b.skuId, b.packs);
    const cart = (await buildView()).cart;
    return NextResponse.json({ ok: r.ok, reason: r.reason, cart }, { status: r.ok ? 200 : 422 });
  } catch (e) {
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
