// Parent saves the child's rules. Allergies are normalized in code; a new policy revision starts a fresh plan.
import { NextResponse } from "next/server";
import { householdInput } from "@/lib/http/inputs";
import { jsonBody } from "@/lib/http/jsonBody";
import { updateHousehold } from "@/worker/parent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await jsonBody(req, householdInput, 8192);
  if (body instanceof NextResponse) return body;
  try {
    return NextResponse.json(await updateHousehold(body));
  } catch {
    return NextResponse.json({ ok: false, reason: "Could not update the household" }, { status: 500 });
  }
}
