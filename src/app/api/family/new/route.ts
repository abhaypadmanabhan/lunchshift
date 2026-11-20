import { NextResponse } from "next/server";
import { newFamily } from "@/worker/parent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(await newFamily());
}
