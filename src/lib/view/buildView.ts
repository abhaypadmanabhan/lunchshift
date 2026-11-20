// Builds the one RunView the page reads, from the app store (audit, run, basket, receipt, KPIs)
// and the latest KPI suite file. Server-only.
import { readFile } from "node:fs/promises";
import { HOUSEHOLD, RECIPES } from "../domain/fixture";
import type { AuditEvent, CandidateDecision, MemoryRecall, SwapProposal } from "../domain/types";
import type { IntegrationStatus, KpiSuiteResult, PlanRow, RunView } from "../domain/view";
import { storeStatus } from "../store";
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
      detail: memory ? (memory.provider === "cognee" ? `Recalled ${memory.factIds.length} facts from the household graph` : `Fallback: ${memory.error ?? "fixture facts"}`) : "Household memory",
    },
    { name: "SingleStore", status: ss.provider === "singlestore" ? "live" : "fallback", detail: ss.detail },
    {
      name: "Statsig",
      status: modeEv ? (modeEv.data.source === "statsig" ? "live" : "fallback") : process.env.STATSIG_SERVER_SECRET ? "live" : "missing",
      detail: modeEv
        ? modeEv.data.source === "statsig"
          ? `autonomy_mode read live (rule ${String(modeEv.data.ruleId ?? "default")})`
          : `Defaulted to suggest_only: ${String(modeEv.data.error ?? "no config")}`
        : "autonomy_mode dynamic config",
    },
    {
      name: "Superlinked SIE",
      status: process.env.SIE_API_KEY ? (rankProvider === "sie" ? "live" : "fallback") : "missing",
      detail: process.env.SIE_API_KEY ? "Reranker" : `Key pending; ranking via ${rankProvider === "singlestore_vector" ? "SingleStore vector SQL" : "local vector"} fallback`,
    },
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
    mode: {
      observed: run?.observedMode ?? "suggest_only",
      effective: run?.effectiveMode ?? "suggest_only",
      parentMax: household.mandate.maxAutonomy,
      source: (modeEv?.data.source as "statsig" | "default" | undefined) ?? "default",
      ruleId: (modeEv?.data.ruleId as string | null | undefined) ?? undefined,
      fetchedAt: String(modeEv?.data.fetchedAt ?? new Date().toISOString()),
    },
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
