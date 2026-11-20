// Builds the one RunView the page reads, from the app store (audit, run, basket, receipt, KPIs)
// and the latest KPI suite file. Server-only.
import { readFile } from "node:fs/promises";
import { HOUSEHOLD, RECIPES } from "../domain/fixture";
import type { AuditEvent, CandidateDecision, MemoryRecall, SwapProposal } from "../domain/types";
import type { IntegrationStatus, KpiSuiteResult, PlanRow, RunView } from "../domain/view";
import { storeStatus } from "../store";
import { getAutonomy } from "../autonomy";
import type { AutonomyReading } from "../domain/types";

// Before a run exists, show what Statsig says right now (cached briefly; the page polls every 1.5 s).
let liveRead: { at: number; reading: AutonomyReading } | null = null;
async function liveMode(userId: string): Promise<AutonomyReading> {
  if (liveRead && Date.now() - liveRead.at < 3000) return liveRead.reading;
  const reading = await getAutonomy().read(userId);
  liveRead = { at: Date.now(), reading };
  return reading;
}
import { DEMO_RUN_ID, ensureSeeded, grocerClient } from "../../worker/deps";

const recipeName = (id: string) => RECIPES.find((r) => r.id === id)?.name ?? id;

async function kpiSuite(): Promise<KpiSuiteResult | null> {
  try {
    return JSON.parse(await readFile(".data/kpi-latest.json", "utf8")) as KpiSuiteResult;
  } catch {
    return null;
  }
}

export async function buildView(runId = DEMO_RUN_ID): Promise<RunView> {
  const store = await ensureSeeded();
  const household = (await store.getHousehold(HOUSEHOLD.id)) ?? HOUSEHOLD;
  const run = await store.getRun(runId);
  const events: AuditEvent[] = run ? await store.listEvents(runId) : [];
  const last = (type: AuditEvent["type"]) => [...events].reverse().find((e) => e.type === type);

  const proposal = (last("swap_proposed")?.data.proposal as SwapProposal | undefined) ?? null;
  const memEv = last("memory_recalled");
  const memory: MemoryRecall | null = memEv
    ? {
        provider: memEv.data.provider as MemoryRecall["provider"],
        datasetId: (memEv.data.datasetId as string | null) ?? undefined,
        query: String(memEv.data.query ?? ""),
        factIds: (memEv.data.factIds as string[]) ?? [],
        snippets: (memEv.data.snippets as string[]) ?? [],
        error: (memEv.data.error as string | null) ?? undefined,
      }
    : null;
  const refusals = events.filter((e) => e.type === "candidate_rejected").map((e) => e.data as unknown as CandidateDecision);
  const stockEv = events.find((e) => e.type === "stockout_detected");
  const modeEv = [...events].reverse().find((e) => e.type === "mode_observed" || e.type === "autonomy_changed");

  const swapped = run && ["swapped_waiting", "hold_pending", "hold_verified"].includes(run.status);
  const plan: PlanRow[] = household.plan.map((p) => {
    if (proposal && p.day === proposal.affectedDay) {
      return {
        day: p.day,
        recipeId: proposal.toRecipeId,
        recipeName: recipeName(proposal.toRecipeId),
        status: swapped ? "swapped" : "proposed_swap",
        replacedRecipeName: recipeName(proposal.fromRecipeId),
      };
    }
    return { day: p.day, recipeId: p.recipeId, recipeName: recipeName(p.recipeId), status: "kept" };
  });

  const ss = await storeStatus();
  let grocerUp = true;
  try {
    await grocerClient().catalog();
  } catch {
    grocerUp = false;
  }
  const rationaleProvider = proposal?.rationaleProvider;
  const rankProvider = proposal?.ranking.provider;
  const integrations: IntegrationStatus[] = [
    {
      name: "Cognee",
      status: memory ? (memory.provider === "cognee" ? "live" : "fallback") : process.env.COGNEE_API_KEY ? "live" : "missing",
      detail: memory ? (memory.provider === "cognee" ? `${memory.factIds.length} facts recalled` : "Fixture facts (Cognee unreachable)") : "Household memory",
    },
    { name: "SingleStore", status: ss.provider === "singlestore" ? "live" : "fallback", detail: ss.provider === "singlestore" ? "System of record + vector SQL" : "SQLite stand-in (SingleStore unreachable)" },
    {
      name: "Statsig",
      status: modeEv ? (modeEv.data.source === "statsig" ? "live" : "fallback") : !run && liveRead ? (liveRead.reading.source === "statsig" ? "live" : "fallback") : process.env.STATSIG_SERVER_SECRET ? "live" : "missing",
      detail: modeEv
        ? modeEv.data.source === "statsig"
          ? `autonomy_mode read live (rule ${String(modeEv.data.ruleId ?? "default")})`
          : "Safe default suggest_only (config not readable)"
        : "autonomy_mode dynamic config",
    },
    (() => {
      const screened = last("allergen_screened");
      const screenOk = Boolean(screened && !screened.data.error);
      const live = Boolean(process.env.SIE_API_KEY) && (rankProvider === "sie" || screenOk || !run);
      const parts = [screenOk ? "allergen classifier" : null, rankProvider === "sie" ? "reranker" : null].filter(Boolean);
      return {
        name: "Superlinked SIE" as const,
        status: process.env.SIE_API_KEY ? (live ? ("live" as const) : ("fallback" as const)) : ("missing" as const),
        detail: process.env.SIE_API_KEY
          ? parts.length
            ? parts.join(" + ")
            : `SIE unavailable this run · ${rankProvider === "singlestore_vector" ? "SingleStore vector" : "local vector"} fallback`
          : `Key pending · ${rankProvider === "singlestore_vector" ? "SingleStore vector" : "local vector"} fallback`,
      };
    })(),
    {
      name: "Anthropic",
      status: rationaleProvider === "template" ? "fallback" : process.env.ANTHROPIC_API_KEY ? "live" : "missing",
      detail: rationaleProvider === "template" ? "Template rationale" : "Claude explains the chosen swap; code enforces the rules",
    },
    { name: "Sandbox grocer", status: grocerUp ? "live" : "missing", detail: grocerUp ? "Independent store API with its own database" : "Store API not reachable" },
  ];

  return {
    generatedAt: new Date().toISOString(),
    household: { id: household.id, childName: household.childName, facts: household.facts, mandate: household.mandate },
    run,
    mode: run
      ? {
          observed: run.observedMode,
          effective: run.effectiveMode,
          parentMax: household.mandate.maxAutonomy,
          source: (modeEv?.data.source as "statsig" | "default" | undefined) ?? "default",
          ruleId: (modeEv?.data.ruleId as string | null | undefined) ?? undefined,
          fetchedAt: String(modeEv?.data.fetchedAt ?? new Date().toISOString()),
        }
      : await (async () => {
          const r = await liveMode(household.id);
          const m = household.mandate;
          const cap = !m.revoked && Date.parse(m.expiresAt) > Date.now() ? m.maxAutonomy : "suggest_only";
          const observed = r.source === "statsig" && !r.error ? r.mode : "suggest_only";
          const rank = { suggest_only: 0, auto_swap: 1, auto_swap_and_hold: 2 } as const;
          return {
            observed,
            effective: rank[observed] <= rank[cap] ? observed : cap,
            parentMax: m.maxAutonomy,
            source: r.source,
            ruleId: r.ruleId,
            fetchedAt: r.fetchedAt,
          };
        })(),
    stockout: stockEv
      ? { skuId: String(stockEv.data.skuId), name: stockEv.summary.replace(/ is out of stock.*$/, "") }
      : null,
    refusals,
    memory,
    proposal,
    plan,
    basket: run ? ((await store.getBasket(runId)) ?? proposal?.after ?? null) : null,
    receipt: run ? await store.getReceipt(runId) : null,
    kpis: run ? await store.getKpis(runId) : null,
    kpiSuite: await kpiSuite(),
    events,
    integrations,
  };
}
