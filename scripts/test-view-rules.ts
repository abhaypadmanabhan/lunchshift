// npm run test:view - what the parent and the console read: one entry per child in the family switcher, an honest
// Cognee label while a new family's graph builds, and payment copy that matches a Stripe test payment.
// Offline: Cognee is a stubbed fetch in a temp folder; nothing here calls a real service.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RunView } from "../src/lib/domain/view";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
  if (!ok) failures++;
};

async function main() {
  // The Cognee adapter keeps its state in <cwd>/.data; run in a temp folder so the repo's state is never touched.
  const dir = mkdtempSync(path.join(tmpdir(), "lunchshift-view-"));
  process.chdir(dir);
  mkdirSync(".data");
  const stateFile = path.join(dir, ".data", "cognee.json");

  const { visibleFamilies, PRESETS } = await import("../src/lib/domain/families");
  const { CogneeMemory } = await import("../src/lib/memory/cognee");
  const { isMemoryBuilding } = await import("../src/lib/memory/status");
  const { paidByCard, paymentPhrase } = await import("../src/components/parent/copy");

  // ---- Family switcher: one entry per child name ----
  const presetIds = new Set(PRESETS.map((p) => p.id));
  const fam = (id: string, childName: string, active = false) => ({ id, childName, active });
  const names = (xs: { id: string }[]) => xs.map((x) => x.id).join(", ");
  const sample = PRESETS[0].id;
  {
    // Two guided-demo runs without a reset: the sample Maya plus two chat-made Mayas; the second is active.
    const got = visibleFamilies([fam(sample, "Maya"), fam("fam-leo", "Leo"), fam("fam-ava", "Ava"), fam("fam-a1", "Maya"), fam("fam-a2", "Maya", true)], presetIds);
    check("after two demo runs the switcher shows one Maya, the active one", names(got) === "fam-leo, fam-ava, fam-a2", names(got));
  }
  {
    // Back on the sample after a demo run: the sample is active, so the chat-made Maya is the one hidden.
    const got = visibleFamilies([fam(sample, "Maya", true), fam("fam-leo", "Leo"), fam("fam-a1", "Maya")], presetIds);
    check("sample Maya active: one Maya (the sample)", names(got) === `${sample}, fam-leo`, names(got));
  }
  {
    // Another family active: the newest chat-made Maya stands in for every Maya.
    const got = visibleFamilies([fam(sample, "Maya"), fam("fam-leo", "Leo", true), fam("fam-a1", "Maya"), fam("fam-a2", "maya ")], presetIds);
    check("Leo active: one Maya, the newest made in the app", names(got) === "fam-leo, fam-a2", names(got));
  }

  // ---- Cognee: a brand-new family's graph is building ----
  const calls: string[] = [];
  let onCognify: (() => Promise<void> | void) | null = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith("/api/v1/add")) return new Response(JSON.stringify({ dataset_id: "ds-new" }), { status: 200 });
    if (u.endsWith("/api/v1/cognify")) {
      await onCognify?.(); // runs before seed() moves on, so the check sees the mid-build state
      return new Response("{}", { status: 200 });
    }
    if (u.includes("/api/v1/datasets/status")) return new Response(JSON.stringify({ "ds-new": "DATASET_PROCESSING_COMPLETED" }), { status: 200 });
    return new Response("{}", { status: 503 });
  }) as typeof fetch;
  try {
    const mem = new CogneeMemory("http://cognee.test", "test-key");
    const hh = { ...PRESETS[0], id: "fam-new", policyRevision: 1 };
    const state = () => JSON.parse(readFileSync(stateFile, "utf8")) as Record<string, { cognify: string; datasetId: string }>;

    let midSeed: { cognify?: string; datasetId?: string; recallError?: string; recallCalls?: number } = {};
    onCognify = async () => {
      const e = state()["fam-new-household"];
      midSeed = { cognify: e?.cognify, datasetId: e?.datasetId };
      const before = calls.length;
      const r = await mem.recall("fam-new", "allergies?");
      midSeed.recallError = r.error;
      midSeed.recallCalls = calls.length - before;
    };
    const seeded = await mem.seed(hh);
    check(
      "while the graph builds, recall says so at once (no search calls)",
      midSeed.cognify === "building" && midSeed.datasetId === "ds-new" && isMemoryBuilding(midSeed.recallError) && midSeed.recallCalls === 0,
      JSON.stringify(midSeed),
    );
    check("after cognify completes, the state is completed", seeded.ok && state()["fam-new-household"].cognify === "DATASET_PROCESSING_COMPLETED", JSON.stringify(state()));

    calls.length = 0;
    const after = await mem.recall("fam-new", "allergies?");
    check("a finished graph is searched again (not labelled building)", calls.some((c) => c.endsWith("/api/v1/search")) && !isMemoryBuilding(after.error), after.error ?? "");

    // A re-seed of a family with a finished graph keeps recalling the old graph while it rebuilds.
    onCognify = () => {
      midSeed = { cognify: state()["fam-new-household"].cognify };
    };
    await mem.seed({ ...hh, policyRevision: 2 });
    check("re-seed keeps a finished graph marked completed", midSeed.cognify === "DATASET_PROCESSING_COMPLETED", JSON.stringify(midSeed));

    // A stale "building" mark (older than the cognify wait) does not stick.
    writeFileSync(stateFile, JSON.stringify({ "fam-old-household": { datasetId: "ds-old", policyRevision: 1, seededAt: "2026-01-01T00:00:00Z", cognify: "building" } }));
    calls.length = 0;
    const stale = await mem.recall("fam-old", "allergies?");
    check("a stale building mark falls through to search", calls.some((c) => c.endsWith("/api/v1/search")) && !isMemoryBuilding(stale.error), stale.error ?? "");
  } finally {
    globalThis.fetch = realFetch;
  }

  // ---- Payment copy matches a Stripe test payment ----
  const view = (status: "unavailable" | "ready" | "paid", orderId = "LS-1") =>
    ({ order: { orderId }, payment: { status, reason: null, paymentIntentId: "pi_x", amountCents: 100, testMode: true } }) as unknown as RunView;
  check("paid order: copy says paid, not pay at pickup", paidByCard(view("paid"), "LS-1") && paymentPhrase(view("paid"), "LS-1") === "Paid by card (test)", paymentPhrase(view("paid"), "LS-1"));
  check("last week's order is not shown as paid", paymentPhrase(view("paid", "LS-2"), "LS-1") !== "Paid by card (test)", paymentPhrase(view("paid", "LS-2"), "LS-1"));
  check("test card available: both ways are named", paymentPhrase(view("ready"), "LS-1") === "Pay at pickup or by test card");
  check("no test key: pay at pickup", paymentPhrase(view("unavailable"), "LS-1") === "Pay at pickup");

  console.log(failures ? `${failures} FAILURE(S)` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

void main();
