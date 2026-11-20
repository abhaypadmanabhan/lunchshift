// Parent saves the child's rules. Allergies are normalized in code; a new policy revision starts a fresh plan.
import { NextResponse } from "next/server";
import type { HouseholdUpdate } from "@/lib/domain/view";
import { updateHousehold } from "@/worker/parent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<HouseholdUpdate>;
    if (!Array.isArray(body.allergies)) return NextResponse.json({ ok: false, reason: "allergies must be a list" }, { status: 400 });
    const allergies = body.allergies
      .filter((a): a is { text: string; crossContact: boolean } => typeof a?.text === "string")
      .map((a) => ({ text: a.text.slice(0, 60), crossContact: a.crossContact !== false }));
    return NextResponse.json(
      await updateHousehold({
        childName: typeof body.childName === "string" ? body.childName.slice(0, 40) : undefined,
        allergies,
        budgetCents: typeof body.budgetCents === "number" ? body.budgetCents : undefined,
        approveStanding:
          body.approveStanding && ["suggest_only", "auto_swap", "auto_swap_and_hold"].includes(body.approveStanding.maxAutonomy)
            ? { maxAutonomy: body.approveStanding.maxAutonomy }
            : undefined,
      }),
    );
  } catch (e) {
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
