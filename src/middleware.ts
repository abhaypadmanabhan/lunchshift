// Public-URL guard: every write is rate limited per visitor, and the endpoints that spend paid credits
// (Claude, Superlinked SIE, Cognee) also have a daily cap for the whole site. In-memory: one Node process serves the app.
import { NextResponse, type NextRequest } from "next/server";

const PER_MIN_WRITE = 40;
const PER_MIN_PAID = 8;
const configuredCap = Number(process.env.LUNCHSHIFT_PAID_DAILY_CAP ?? 400);
const PAID_DAILY_CAP = Number.isSafeInteger(configuredCap) && configuredCap >= 0 ? configuredCap : 400;
const PAID = /^\/api\/(?:chat(?:\/|$)|parent\/(?:plan|pay|household)(?:\/|$)|family\/new$|demo\/|routines\/run$)/;
const WINDOW_MS = 60_000;
const MAX_BUCKETS = 5000;

type Bucket = { start: number; n: number };
const g = globalThis as { __lsRate?: Map<string, Bucket>; __lsDaily?: { day: string; n: number }; __lsSweepAt?: number };
const buckets = (g.__lsRate ??= new Map());

function hit(key: string, limit: number): boolean {
  const now = Date.now();
  if (now >= (g.__lsSweepAt ?? 0)) {
    for (const [id, bucket] of buckets) if (now - bucket.start >= WINDOW_MS) buckets.delete(id);
    g.__lsSweepAt = now + WINDOW_MS;
  }
  const b = buckets.get(key);
  if (!b || now - b.start >= WINDOW_MS) {
    if (!b && buckets.size >= MAX_BUCKETS) return false;
    buckets.set(key, { start: now, n: 1 });
    return true;
  }
  b.n++;
  return b.n <= limit;
}

export function middleware(req: NextRequest) {
  if (req.method !== "POST") return NextResponse.next();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const path = req.nextUrl.pathname;
  const paid = PAID.test(path.replace(/\/$/, ""));
  if (!hit(`w:${ip}`, PER_MIN_WRITE) || (paid && !hit(`p:${ip}`, PER_MIN_PAID))) {
    return NextResponse.json({ ok: false, reason: "Too many requests. Wait a minute and try again." }, { status: 429 });
  }
  if (paid) {
    const day = new Date().toISOString().slice(0, 10);
    const d = (g.__lsDaily = g.__lsDaily?.day === day ? g.__lsDaily : { day, n: 0 });
    d.n++;
    if (d.n > PAID_DAILY_CAP) return NextResponse.json({ ok: false, reason: "The demo's daily limit is reached. Please try again tomorrow." }, { status: 429 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*"] };
