// The parent edits this week's cart. Every change passes the same deterministic allergen, stock and budget checks.
import { NextResponse } from "next/server";
import { updateCart } from "@/worker/parent";
import { buildView } from "@/lib/view/buildView";
import { cartInput } from "@/lib/http/inputs";
import { jsonBody } from "@/lib/http/jsonBody";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = await jsonBody(req, cartInput, 1024);
  if (b instanceof NextResponse) return b;
  try {
    const r = await updateCart(b.skuId, b.packs);
    const cart = (await buildView()).cart;
    return NextResponse.json({ ok: r.ok, reason: r.reason, cart }, { status: r.ok ? 200 : 422 });
  } catch {
    return NextResponse.json({ ok: false, reason: "Could not update the cart" }, { status: 500 });
  }
}
