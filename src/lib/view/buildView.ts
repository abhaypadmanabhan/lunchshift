// Builds the one RunView the page reads, from the app store (audit, run, basket, receipt, KPIs)
// and the latest KPI suite file. Server-only.
import { readFile } from "node:fs/promises";
import { RECIPES } from "../domain/fixture";
import { MAJOR_ALLERGENS } from "../domain/allergens";
import type { AuditEvent, CandidateDecision, MemoryRecall, Order, Sku, SwapProposal } from "../domain/types";
import type { CartView } from "../domain/view";
import { checkSku, hardRestrictions } from "../domain/rules";
import { cartBasket } from "../../worker/parent";
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
import { activeHousehold, ensureSeeded, grocerClient, runIdNow } from "../../worker/deps";
import { PRESETS, activeHouseholdId, readPointer, WEEKS } from "../domain/families";

const recipeName = (id: string) => RECIPES.find((r) => r.id === id)?.name ?? id;

async function kpiSuite(): Promise<KpiSuiteResult | null> {
  try {
    return JSON.parse(await readFile(".data/kpi-latest.json", "utf8")) as KpiSuiteResult;
  } catch {
    return null;
  }
}

export async function buildView(runIdArg?: string): Promise<RunView> {
  const store = await ensureSeeded();
  const runId = runIdArg ?? (await runIdNow(store));
  const household = await activeHousehold(store);
  const run = await store.getRun(runId);
  const events: AuditEvent[] = run ? await store.listEvents(runId) : [];
  const last = (type: AuditEvent["type"]) => [...events].reverse().find((e) => e.type === type);

  const proposals = events.filter((e) => e.type === "swap_proposed").map((e) => e.data.proposal as SwapProposal);
  const proposal = proposals[0] ?? null;
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
    const sw = proposals.find((x) => x.affectedDay === p.day);
    if (sw) {
      return {
        day: p.day,
        recipeId: sw.toRecipeId,
        recipeName: recipeName(sw.toRecipeId),
        status: swapped ? "swapped" : "proposed_swap",
        replacedRecipeName: recipeName(sw.fromRecipeId),
      };
    }
    return { day: p.day, recipeId: p.recipeId, recipeName: recipeName(p.recipeId), status: "kept" };
  });

  const ss = await storeStatus();
  let grocerUp = true;
  let skus: Sku[] = [];
  try {
    skus = (await grocerClient().catalog()).skus;
  } catch {
    grocerUp = false;
  }
  const skuById = new Map(skus.map((x) => [x.id, x]));

  // Cart: the parent's draft, else the agent's basket for this run.
  let cart: CartView | null = null;
  if (run) {
    const { basket: b, source } = await cartBasket(store, run);
    if (b) {
      const planNames = new Map(plan.map((p) => [p.recipeId, p.recipeName]));
      const usedByNames = (ids: string[]) => ids.map((id) => planNames.get(id) ?? recipeName(id));
      cart = {
        lines: b.lines.map((l) => ({
          skuId: l.skuId,
          name: l.name,
          brand: skuById.get(l.skuId)?.brand ?? "",
          imageUrl: skuById.get(l.skuId)?.imageUrl,
          packs: l.packs,
          unitPriceCents: l.unitPriceCents,
          lineCents: l.lineCents,
          usedBy: usedByNames(l.usedBy),
        })),
        totalCents: b.totalCents,
        budgetCents: household.mandate.budgetCents,
        editable: run.status === "proposed" || run.status === "swapped_waiting",
        source,
        catalog: skus.map((x) => {
          const d = checkSku(household, x, 1);
          const fact = hardRestrictions(household).find((f) => f.id === d.factId);
          const reason = d.eligible
            ? undefined
            : d.reasons.includes("allergen_warning")
              ? `Contains ${fact?.allergen?.label.toLowerCase() ?? "a blocked allergen"}: ${household.childName}'s allergy`
              : d.reasons.includes("missing_label_evidence")
                ? "No allergen statement on file"
                : d.reasons.includes("conflicting_label_evidence")
                  ? "Allergen sources disagree"
                  : d.reasons.includes("out_of_stock")
                    ? "Out of stock"
                    : d.reasons.join(", ");
          return { skuId: x.id, name: x.name, brand: x.brand, priceCents: x.priceCents, imageUrl: x.imageUrl, sourceUrl: x.sourceUrl, safe: d.eligible, reason };
        }),
      };
    }
  }

  // Orders: this run's order and the household's history (order_placed events in the app store).
  const order = (last("order_placed")?.data.order as Order | undefined) ?? null;
  let orders: Order[] = [];
  try {
    const live = new Map((await grocerClient().listOrders()).map((o) => [o.orderId, o]));
    const runs = await store.listRuns(household.id);
    for (const r of runs) {
      const evs = r.id === run?.id ? events : await store.listEvents(r.id);
      for (const e of evs) if (e.type === "order_placed") orders.push(live.get((e.data.order as Order).orderId) ?? (e.data.order as Order));
    }
    orders = orders.sort((a, b) => b.placedAt.localeCompare(a.placedAt));
  } catch {
    orders = order ? [order] : [];
  }
  const liveOrder = order ? (orders.find((o) => o.orderId === order.orderId) ?? order) : null;
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
    household: { id: household.id, childName: household.childName, facts: household.facts, mandate: household.mandate, onboarded: household.onboarded !== false },
    families: await familiesView(store),
    routines: [],
    inbox: [],
    factHistory: [],
    week: weekView(),
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
    proposals,
    cart,
    order: liveOrder,
    orders,
    needsApproval:
      run?.status === "proposed"
        ? (([...events].reverse().find((e) => typeof e.data.approvalReason === "string")?.data.approvalReason as string | undefined) ??
          "LunchShift is in suggest-only mode, so it waits for you before changing the cart or the store.")
        : null,
    allergens: MAJOR_ALLERGENS.map((a) => ({ id: a.id, label: a.label, examples: a.terms.slice(0, 4) })),
    plan,
    basket: run ? ((await store.getBasket(runId)) ?? proposal?.after ?? null) : null,
    receipt: run ? await store.getReceipt(runId) : null,
    kpis: run ? await store.getKpis(runId) : null,
    kpiSuite: await kpiSuite(),
    events,
    integrations,
  };
}

async function familiesView(store: Awaited<ReturnType<typeof ensureSeeded>>) {
  const active = activeHouseholdId();
  const ids = [...PRESETS.map((p) => p.id)];
  const n = readPointer().newFamilies;
  for (let i = 1; i <= n; i++) ids.push(`fam-new-${i}`);
  const out = [];
  for (const id of ids) {
    const h = await store.getHousehold(id);
    if (!h) continue;
    out.push({
      id,
      childName: h.childName || "New family",
      allergies: h.facts.filter((f) => f.kind === "hard_restriction" && f.allergen).map((f) => f.allergen!.label),
      active: id === active,
      onboarded: h.onboarded !== false,
    });
  }
  return out;
}

function weekView() {
  const i = Math.min(readPointer().weekIndex, WEEKS.length - 1);
  const weekOf = WEEKS[i];
  const d = new Date(`${weekOf}T12:00:00-08:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
  return { weekOf, label: `${i === 0 ? "This Sunday" : "Next Sunday"} · ${d}`, index: i };
}
