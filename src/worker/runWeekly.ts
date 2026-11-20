// The weekly run state machine. Resumable: every step is persisted, and a replayed or repeated
// event re-enters at the persisted state. The merchant hold uses a stable operation key and is
// only marked confirmed after an independent read-back.
import { ALTERNATIVE_RECIPE_IDS, PICKUP_SLOT, USUAL_SKU_BY_ROLE } from "../lib/domain/fixture";
import {
  buildBasket,
  checkRecipe,
  checkSku,
  completeLunches,
  diffBaskets,
  hardRestrictions,
  roleNeeds,
  unsafeLines,
} from "../lib/domain/rules";
import {
  MODE_RANK,
  type Analytics,
  type AnalyticsEvent,
  type AppStore,
  type AutonomyMode,
  type AutonomyProvider,
  type AutonomyReading,
  type Basket,
  type CandidateDecision,
  type HoldRequest,
  type Household,
  type KpiSet,
  type PlannedLunch,
  type MemoryProvider,
  type MemoryRecall,
  type Ranker,
  type RankQuery,
  type Recipe,
  type Run,
  type Sku,
  type SwapExplainer,
  type SwapProposal,
} from "../lib/domain/types";
import { hashFingerprint } from "../grocer/server";
import type { GrocerClient } from "../grocer/client";

export interface WorkerDeps {
  store: AppStore;
  grocer: GrocerClient;
  memory: MemoryProvider;
  autonomy: AutonomyProvider;
  analytics: Analytics;
  ranker: Ranker;
  explainer: SwapExplainer;
  buildRankQuery?: (h: Household, keptPlan: PlannedLunch[], basketRoles: string[]) => RankQuery;
}

const TERMINAL = new Set(["hold_verified", "escalated", "failed"]);
export const opKeyFor = (runId: string) => `hold:${runId}`;

export function minMode(a: AutonomyMode, b: AutonomyMode): AutonomyMode {
  return MODE_RANK[a] <= MODE_RANK[b] ? a : b;
}

export function defaultRankQuery(h: Household, keptPlan: PlannedLunch[], basketRoles: string[]): RankQuery {
  const prefs = h.facts.filter((f) => f.kind === "preference" && f.active);
  const preferTags: string[] = [];
  if (prefs.some((f) => /rice bowl/i.test(f.text))) preferTags.push("rice_bowl");
  if (prefs.some((f) => /favou?rite/i.test(f.text))) preferTags.push("kid_favorite");
  const prepFact = prefs.find((f) => /prep/i.test(f.text));
  const maxPrep = Number(prepFact?.text.match(/(\d+)\s*min/)?.[1] ?? 20);
  return {
    text: `Whole school lunch for ${h.childName}. ${prefs.map((f) => f.text).join(" ")} Week already has: ${keptPlan.map((p) => p.recipeId).join(", ")}.`,
    maxPrepMinutes: maxPrep,
    preferTags,
    pantryRoles: basketRoles,
  };
}

type Ctx = {
  deps: WorkerDeps;
  run: Run;
  household: Household;
  analyticsUser: string;
  /** The parent explicitly approved this run's proposal (one click). Authorizes this order only. */
  parentApproved?: boolean;
};

async function ev(ctx: Ctx, e: Parameters<AppStore["appendEvent"]>[0]) {
  return ctx.deps.store.appendEvent(e);
}

async function track(ctx: Ctx, events: AnalyticsEvent[]) {
  // Best effort; analytics can never block or repeat a write.
  try {
    await ctx.deps.analytics.log(ctx.analyticsUser, events);
  } catch {
    /* ignored */
  }
}

async function save(ctx: Ctx, patch: Partial<Run>) {
  ctx.run = { ...ctx.run, ...patch, updatedAt: new Date().toISOString() };
  await ctx.deps.store.upsertRun(ctx.run);
}

async function readMode(ctx: Ctx, why: string, logUnchanged = true): Promise<{ reading: AutonomyReading; effective: AutonomyMode }> {
  let reading: AutonomyReading;
  try {
    reading = await ctx.deps.autonomy.read(ctx.analyticsUser);
  } catch (e) {
    reading = { mode: "suggest_only", source: "default", fetchedAt: new Date().toISOString(), error: String(e) };
  }
  const m = ctx.household.mandate;
  const mandateLive = !m.revoked && new Date(m.expiresAt).getTime() > Date.now();
  const cap = mandateLive ? m.maxAutonomy : "suggest_only";
  // A parent's explicit approval of this run's proposal authorizes this one order, within a live mandate.
  const effective = ctx.parentApproved && mandateLive ? "auto_swap_and_hold" : minMode(reading.mode, cap);
  const changed = effective !== ctx.run.effectiveMode || reading.mode !== ctx.run.observedMode;
  if (!changed && !logUnchanged) return { reading, effective };
  await ev(ctx, {
    runId: ctx.run.id,
    actor: "statsig",
    type: changed && ctx.run.status !== "running" ? "autonomy_changed" : "mode_observed",
    summary: `${why}: Statsig says ${reading.mode} (${reading.source}); parent max ${cap}; effective ${effective}`,
    data: {
      observed: reading.mode,
      source: reading.source,
      ruleId: reading.ruleId ?? null,
      error: reading.error ?? null,
      parentMax: cap,
      effective,
      previousEffective: ctx.run.effectiveMode,
      fetchedAt: reading.fetchedAt,
    },
  });
  if (changed && ctx.run.status !== "running") {
    await track(ctx, [
      { eventName: "autonomy_changed", value: effective, metadata: { runId: ctx.run.id, from: ctx.run.effectiveMode, to: effective } },
    ]);
  }
  await save(ctx, { observedMode: reading.mode, effectiveMode: effective });
  return { reading, effective };
}

export interface ProcessResult {
  run: Run;
  proposal: SwapProposal | null;
}

/** Process one weekly run. Safe to call repeatedly (ticks, replays, duplicate events, restarts). */
export async function processRun(
  deps: WorkerDeps,
  opts: { runId: string; householdId: string; weekOf: string; trigger: Run["trigger"] },
): Promise<ProcessResult> {
  const household = await deps.store.getHousehold(opts.householdId);
  if (!household) throw new Error(`household ${opts.householdId} missing`);
  const now = new Date().toISOString();
  const existing = await deps.store.getRun(opts.runId);
  const run: Run =
    existing ??
    ({
      id: opts.runId,
      householdId: household.id,
      weekOf: opts.weekOf,
      trigger: opts.trigger,
      status: "running",
      observedMode: "suggest_only",
      effectiveMode: "suggest_only",
      basketVersion: 0,
      createdAt: now,
      updatedAt: now,
    } satisfies Run);
  const ctx: Ctx = { deps, run, household, analyticsUser: household.id };
  if (existing) ctx.parentApproved = (await deps.store.listEvents(run.id)).some((e) => e.actor === "parent" && e.data.approved === true);

  if (!existing || existing.status === "scheduled") {
    run.status = "running";
    await deps.store.upsertRun(run);
    await ev(ctx, {
      runId: run.id,
      actor: "worker",
      type: "run_started",
      summary: `Weekly run started by ${opts.trigger} for week of ${opts.weekOf}`,
      data: { trigger: opts.trigger, mandateId: household.mandate.id, policyRevision: household.policyRevision },
    });
  } else if (TERMINAL.has(run.status)) {
    if (run.status === "hold_verified" && run.operationKey) {
      // Replay of a finished run: read-only reconciliation, no new write.
      const holds = await deps.grocer.listHolds(run.id);
      await ev(ctx, {
        runId: run.id,
        actor: "worker",
        type: "note",
        summary: `Replayed ${opts.trigger} event ignored: run already verified; store shows ${holds.filter((h) => h.status === "active").length} active hold`,
        data: { trigger: opts.trigger, activeHolds: holds.filter((h) => h.status === "active").length },
      });
    }
    return { run, proposal: await lastProposal(deps.store, run.id) };
  }

  // A run already dispatched (or waiting) resumes from persisted state.
  if (run.status === "hold_pending") {
    return { run: await reconcileHold(ctx), proposal: await lastProposal(deps.store, run.id) };
  }
  if (run.status === "proposed" || run.status === "swapped_waiting") {
    return resumeWaiting(ctx);
  }

  return fullPass(ctx);
}

async function lastProposal(store: AppStore, runId: string): Promise<SwapProposal | null> {
  const events = await store.listEvents(runId);
  const p = [...events].reverse().find((e) => e.type === "swap_proposed");
  return (p?.data.proposal as SwapProposal | undefined) ?? null;
}

async function fullPass(ctx: Ctx): Promise<ProcessResult> {
  const { deps, household } = ctx;
  const runId = ctx.run.id;

  // 1. Memory recall (Cognee) resolved against the authoritative household record.
  let recall: MemoryRecall;
  try {
    recall = await deps.memory.recall(household.id, `What food allergies and lunch preferences does ${household.childName}'s household have?`);
  } catch (e) {
    recall = { provider: "fallback", query: "household recall", factIds: [], snippets: [], error: String(e) };
  }
  const hard = hardRestrictions(household);
  const recalledHard = hard.filter((f) => recall.factIds.includes(f.id));
  await ev(ctx, {
    runId,
    actor: "cognee",
    type: "memory_recalled",
    summary: `Recalled ${recall.factIds.length} household facts via ${recall.provider}; ${hard.length} hard restriction(s) loaded from the household record`,
    data: {
      provider: recall.provider,
      datasetId: recall.datasetId ?? null,
      query: recall.query,
      factIds: recall.factIds,
      snippets: recall.snippets.slice(0, 4),
      error: recall.error ?? null,
      hardRestrictions: hard.map((f) => ({ id: f.id, revision: f.revision, recalled: recalledHard.includes(f) })),
    },
  });

  // 2. Autonomy at execution time.
  let { effective } = await readMode(ctx, "Run start");

  // 3. Live catalog + label snapshot.
  const cat = await deps.grocer.catalog();
  await deps.store.saveLabelSnapshot(cat.skus);
  const byId = new Map(cat.skus.map((s) => [s.id, s]));
  const recipes = await deps.store.getRecipes();
  const recipeById = new Map(recipes.map((r) => [r.id, r]));
  const planRecipes = household.plan.map((p) => recipeById.get(p.recipeId)).filter((r): r is Recipe => Boolean(r));

  const needs = roleNeeds(planRecipes);
  const usual = new Map<string, Sku>();
  for (const role of needs.keys()) {
    const s = byId.get(USUAL_SKU_BY_ROLE[role]);
    if (s) usual.set(role, s);
  }
  const original = buildBasket(planRecipes, usual, 1).basket;

  // 4. Stockout detection on the usual basket.
  const outRoles = original.lines.filter((l) => (byId.get(l.skuId)?.stock ?? 0) < l.packs).map((l) => byId.get(l.skuId)!.role);
  if (outRoles.length === 0) {
    await save(ctx, { basketVersion: 1 });
    await deps.store.saveBasket(runId, original);
    return applyAndMaybeHold(ctx, effective, original, null, byId, planRecipes);
  }

  const chosen = new Map(usual);
  const refusals: CandidateDecision[] = [];
  let brokenRole: string | null = null;
  for (const role of outRoles) {
    const sku = usual.get(role)!;
    await ev(ctx, {
      runId,
      actor: "grocer",
      type: "stockout_detected",
      summary: `${sku.name} is out of stock (store has ${sku.stock}, need ${original.lines.find((l) => l.skuId === sku.id)?.packs})`,
      data: { skuId: sku.id, stock: sku.stock, catalogVersion: cat.catalogVersion },
    });
    const subs = cat.skus.filter((s) => s.role === role && s.id !== sku.id).sort((a, b) => a.priceCents - b.priceCents);
    let replacement: Sku | null = null;
    for (const s of subs) {
      const packs = Math.ceil((needs.get(role)?.qty ?? 1) / s.packQty);
      const d = checkSku(household, s, packs);
      if (d.eligible) {
        replacement = s;
        break;
      }
      refusals.push(d);
      await ev(ctx, {
        runId,
        actor: "worker",
        type: "candidate_rejected",
        summary: `Refused ${s.name} ($${(s.priceCents / 100).toFixed(2)}): ${d.reasons.join(", ")}${d.factId ? ` - fact ${d.factId} r${d.factRevision}` : ""}`,
        data: { ...d, skuName: s.name, role, recallProvider: recall.provider, factRecalled: recall.factIds.includes(d.factId ?? "") },
      });
      await track(ctx, [
        { eventName: "candidate_rejected", value: d.reasons[0], metadata: { runId, candidateId: s.id, reason: d.reasons.join("|") } },
      ]);
    }
    if (replacement) chosen.set(role, replacement);
    else brokenRole = role;
  }

  if (!brokenRole) {
    const fixed = buildBasket(planRecipes, chosen, 2).basket;
    await deps.store.saveBasket(runId, fixed);
    return applyAndMaybeHold(ctx, effective, fixed, null, byId, planRecipes);
  }

  // 5. Whole-lunch repair: the broken role kills every lunch that needs it (mandate: at most N swaps).
  const affected = household.plan.filter((p) => recipeById.get(p.recipeId)?.lines.some((l) => l.role === brokenRole));
  if (affected.length > household.mandate.maxSwapsPerWeek) {
    return escalate(ctx, `${affected.length} lunches need swaps; mandate allows ${household.mandate.maxSwapsPerWeek}`);
  }
  const slot = affected[0];
  const fromRecipe = recipeById.get(slot.recipeId)!;
  const keepRecipes = planRecipes.filter((_, i) => household.plan[i] !== slot);

  const skuForRole = (role: string): Sku | undefined => {
    const u = usual.get(role) ?? byId.get(USUAL_SKU_BY_ROLE[role]);
    if (u && u.stock > 0 && checkSku(household, u, 1).eligible) return u;
    return cat.skus
      .filter((s) => s.role === role)
      .sort((a, b) => a.priceCents - b.priceCents)
      .find((s) => checkSku(household, s, 1).eligible);
  };

  const eligible: Recipe[] = [];
  const altBaskets = new Map<string, Basket>();
  for (const altId of ALTERNATIVE_RECIPE_IDS) {
    const alt = recipeById.get(altId);
    if (!alt) continue;
    const d = checkRecipe(household, alt, skuForRole);
    let basket: Basket | null = null;
    if (d.eligible) {
      const map = new Map(chosen);
      map.delete(brokenRole);
      for (const l of alt.lines) map.set(l.role, skuForRole(l.role)!);
      const newPlan = household.plan.map((p) => (p === slot ? alt : recipeById.get(p.recipeId)!));
      basket = buildBasket(newPlan, map, 2).basket;
      const shortStock = basket.lines.find((l) => (byId.get(l.skuId)?.stock ?? 0) < l.packs);
      if (shortStock) d.reasons.push("out_of_stock");
      if (basket.totalCents > household.mandate.budgetCents) d.reasons.push("over_budget");
      d.eligible = d.reasons.length === 0;
      d.priceCents = basket.totalCents;
    }
    if (d.eligible && basket) {
      eligible.push(alt);
      altBaskets.set(alt.id, basket);
    } else {
      refusals.push(d);
      await ev(ctx, {
        runId,
        actor: "worker",
        type: "candidate_rejected",
        summary: `Ruled out whole lunch "${alt.name}": ${d.reasons.join(", ")}${d.factId ? ` - fact ${d.factId} r${d.factRevision}` : ""}`,
        data: { ...d, recipeName: alt.name },
      });
      await track(ctx, [{ eventName: "candidate_rejected", value: d.reasons[0], metadata: { runId, candidateId: alt.id, reason: d.reasons.join("|") } }]);
    }
  }
  if (eligible.length === 0) return escalate(ctx, "No safe whole-lunch alternative within budget");

  // 6. Rank eligible complete lunches, then let the model explain (and only choose among eligible ids).
  const pantryRoles = [...roleNeeds(keepRecipes).keys()];
  const keptPlan = household.plan.filter((p) => p !== slot);
  const q = (deps.buildRankQuery ?? defaultRankQuery)(household, keptPlan, pantryRoles);
  let ranking;
  try {
    ranking = await deps.ranker.rank(q, eligible);
  } catch (e) {
    ranking = {
      provider: "local_vector" as const,
      query: q.text,
      ranked: eligible.map((r, i) => ({ id: r.id, score: 0, rank: i + 1 })),
      inputs: {},
      fallbackReason: String(e),
    };
  }
  await ev(ctx, {
    runId,
    actor: "ranker",
    type: "alternatives_ranked",
    summary: `Ranked ${eligible.length} safe whole lunches via ${ranking.provider}: ${ranking.ranked.map((r) => `${r.id} ${r.score.toFixed(3)}`).join(", ")}`,
    data: { ...ranking },
  });
  const prefFacts = household.facts.filter((f) => f.kind === "preference" && f.active);
  let choice;
  try {
    choice = await deps.explainer.explain({ affectedDay: slot.day, fromRecipe, eligible, ranking, refusals, preferenceFacts: prefFacts });
  } catch {
    choice = null;
  }
  const choiceId = choice && altBaskets.has(choice.choiceId) ? choice.choiceId : ranking.ranked[0].id;
  const toRecipe = recipeById.get(choiceId)!;
  const after = altBaskets.get(choiceId)!;
  const diff = diffBaskets(original, after);
  const proposal: SwapProposal = {
    affectedDay: slot.day,
    fromRecipeId: fromRecipe.id,
    toRecipeId: toRecipe.id,
    removedSkuIds: diff.removed,
    addedSkuIds: diff.added,
    keptSharedSkuIds: diff.kept.filter((id) => toRecipe.lines.some((l) => byId.get(id)?.role === l.role)),
    before: original,
    after,
    ranking,
    rationale: choice?.rationale ?? `Ranked first among safe complete lunches.`,
    rationaleProvider: choice?.provider ?? "template",
  };
  const heroFact = refusals.find((r) => r.factId)?.factId;
  await ev(ctx, {
    runId,
    actor: "llm",
    type: "swap_proposed",
    summary: `Proposed ${slot.day}: ${fromRecipe.name} -> ${toRecipe.name} ($${(original.totalCents / 100).toFixed(2)} -> $${(after.totalCents / 100).toFixed(2)})`,
    data: {
      proposal,
      trace: {
        fromRecipeId: fromRecipe.id,
        toRecipeId: toRecipe.id,
        affectedDay: slot.day,
        originalSkuId: usual.get(brokenRole)?.id,
        catalogVersion: cat.catalogVersion,
        labelVersions: Object.fromEntries(after.lines.map((l) => [l.skuId, byId.get(l.skuId)?.label.version])),
        factId: heroFact ?? hard[0]?.id,
        factRevision: hard.find((f) => f.id === (heroFact ?? hard[0]?.id))?.revision,
        eligibility: refusals.map((r) => ({ id: r.candidateId, reasons: r.reasons })).concat(eligible.map((r) => ({ id: r.id, reasons: [] }))),
        rankProvider: ranking.provider,
        rationaleProvider: proposal.rationaleProvider,
      },
    },
  });
  void effective;
  ({ effective } = { effective: ctx.run.effectiveMode });
  return applyAndMaybeHold(ctx, effective, after, proposal, byId, household.plan.map((p) => (p === slot ? toRecipe : recipeById.get(p.recipeId)!)));
}

async function applyAndMaybeHold(
  ctx: Ctx,
  effective: AutonomyMode,
  basket: Basket,
  proposal: SwapProposal | null,
  byId: Map<string, Sku>,
  finalPlan: Recipe[],
): Promise<ProcessResult> {
  const runId = ctx.run.id;
  if (effective === "suggest_only" && proposal) {
    await save(ctx, { status: "proposed" });
    await ev(ctx, {
      runId,
      actor: "worker",
      type: "note",
      summary: "suggest_only: proposal saved for the parent; cart and store untouched",
      data: { effective },
    });
    // Measure the repaired basket the parent is asked to approve (the cart itself is untouched).
    await computeKpis(ctx, proposal.after, byId, finalPlan, null);
    return { run: ctx.run, proposal };
  }
  if (proposal) {
    await ctx.deps.store.saveBasket(runId, basket);
    await save(ctx, { basketVersion: basket.version, status: "swapped_waiting" });
    await ev(ctx, {
      runId,
      actor: "worker",
      type: "swap_applied",
      summary: `Applied ${proposal.affectedDay} whole-lunch swap; basket v${basket.version} total $${(basket.totalCents / 100).toFixed(2)}`,
      data: { basketVersion: basket.version, removed: proposal.removedSkuIds, added: proposal.addedSkuIds, kept: proposal.keptSharedSkuIds },
    });
    await ctx.deps.analytics
      .log(ctx.analyticsUser, [
        { eventName: "meal_swapped", value: 1, metadata: { runId, from: proposal.fromRecipeId, to: proposal.toRecipeId } },
      ])
      .catch(() => undefined);
  } else {
    await ctx.deps.store.saveBasket(runId, basket);
    await save(ctx, { basketVersion: basket.version, status: "swapped_waiting" });
  }
  if (effective !== "auto_swap_and_hold") {
    await ev(ctx, { runId, actor: "worker", type: "note", summary: `${effective}: cart ready, waiting for hold authority`, data: { effective } });
    await computeKpis(ctx, basket, byId, finalPlan, null);
    return { run: ctx.run, proposal };
  }
  return { run: await dispatchHold(ctx, basket, byId, finalPlan), proposal };
}

async function resumeWaiting(ctx: Ctx): Promise<ProcessResult> {
  const before = ctx.run.effectiveMode;
  const { effective } = await readMode(ctx, "Waiting-run check", false);
  const proposal = await lastProposal(ctx.deps.store, ctx.run.id);
  if (MODE_RANK[effective] <= MODE_RANK[before]) return { run: ctx.run, proposal };
  const cat = await ctx.deps.grocer.catalog();
  const byId = new Map(cat.skus.map((s) => [s.id, s]));
  const recipes = new Map((await ctx.deps.store.getRecipes()).map((r) => [r.id, r]));
  const finalPlan = ctx.household.plan.map((p) =>
    proposal && p.day === proposal.affectedDay ? recipes.get(proposal.toRecipeId)! : recipes.get(p.recipeId)!,
  );
  const basket = proposal?.after ?? (await ctx.deps.store.getBasket(ctx.run.id));
  if (!basket) return { run: await escalate(ctx, "no basket to resume").then((r) => r.run), proposal };
  if (ctx.run.status === "proposed") {
    return applyAndMaybeHold(ctx, effective, basket, proposal, byId, finalPlan);
  }
  if (effective === "auto_swap_and_hold") return { run: await dispatchHold(ctx, basket, byId, finalPlan), proposal };
  return { run: ctx.run, proposal };
}

function holdRequestFor(run: Run, basket: Basket, catalogVersion: string): HoldRequest {
  return {
    operationKey: opKeyFor(run.id),
    runId: run.id,
    lines: basket.lines.map((l) => ({ skuId: l.skuId, packs: l.packs, unitPriceCents: l.unitPriceCents })),
    totalCents: basket.totalCents,
    slot: PICKUP_SLOT,
    catalogVersion,
  };
}

async function dispatchHold(ctx: Ctx, basket: Basket, byId: Map<string, Sku>, finalPlan: Recipe[]): Promise<Run> {
  const runId = ctx.run.id;
  const h = ctx.household;
  // Final gates right before the only write.
  const { effective } = await readMode(ctx, "Pre-hold check");
  if (effective !== "auto_swap_and_hold") {
    await ev(ctx, { runId, actor: "worker", type: "note", summary: `Hold skipped: effective mode is ${effective}`, data: { effective } });
    await save(ctx, { status: "swapped_waiting" });
    await computeKpis(ctx, basket, byId, finalPlan, null);
    return ctx.run;
  }
  const unsafe = unsafeLines(h, basket, byId);
  if (unsafe.length) return (await escalate(ctx, `unsafe lines blocked at hold gate: ${unsafe.join(", ")}`)).run;
  if (basket.totalCents > h.mandate.budgetCents) return (await escalate(ctx, "over budget at hold gate")).run;

  const catalogVersion = [...byId.values()][0]?.catalogVersion ?? "unknown";
  const req = holdRequestFor(ctx.run, basket, catalogVersion);
  const fp = hashFingerprint(req.lines, req.totalCents, req.slot);
  // Persist the key and fingerprint BEFORE dispatch so a crash or lost response recovers the same operation.
  await save(ctx, { status: "hold_pending", operationKey: req.operationKey, requestFingerprint: fp });
  await ev(ctx, {
    runId,
    actor: "worker",
    type: "hold_dispatched",
    summary: `Placing one pickup hold, key ${req.operationKey}, total $${(req.totalCents / 100).toFixed(2)}, slot ${req.slot}`,
    data: { operationKey: req.operationKey, fingerprint: fp, lines: req.lines, totalCents: req.totalCents, slot: req.slot, catalogVersion },
  });
  const res = await ctx.deps.grocer.placeHold(req);
  if (res.kind === "lost") {
    await ev(ctx, {
      runId,
      actor: "grocer",
      type: "hold_response_lost",
      summary: `No response from the store (${res.error}). Checking with the store by key.`,
      data: { error: res.error, operationKey: req.operationKey },
    });
  } else if (res.kind === "rejected") {
    await ev(ctx, {
      runId,
      actor: "grocer",
      type: "note",
      summary: `Store rejected the hold: ${res.error} (${res.status})`,
      data: { status: res.status, error: res.error, detail: res.detail as Record<string, unknown> },
    });
  }
  return reconcileHold(ctx, req, byId, finalPlan);
}

/** Read back by the original key; mark confirmed only on an exact match. Retry identical once if authority is current. */
async function reconcileHold(ctx: Ctx, reqIn?: HoldRequest, byIdIn?: Map<string, Sku>, planIn?: Recipe[]): Promise<Run> {
  const runId = ctx.run.id;
  const basket = await ctx.deps.store.getBasket(runId);
  if (!basket || !ctx.run.operationKey) return (await escalate(ctx, "pending hold without basket or key")).run;
  let byId = byIdIn;
  if (!byId) {
    const snapshot = await ctx.deps.grocer.catalog();
    byId = new Map(snapshot.skus.map((s) => [s.id, s]));
  }
  const catalogVersion = [...byId.values()][0]?.catalogVersion ?? "unknown";
  const req = reqIn ?? holdRequestFor(ctx.run, basket, catalogVersion);
  const recipes = new Map((await ctx.deps.store.getRecipes()).map((r) => [r.id, r]));
  const proposal = await lastProposal(ctx.deps.store, runId);
  const finalPlan =
    planIn ??
    ctx.household.plan.map((p) => (proposal && p.day === proposal.affectedDay ? recipes.get(proposal.toRecipeId)! : recipes.get(p.recipeId)!));

  for (let attempt = 0; attempt < 2; attempt++) {
    const hold = await ctx.deps.grocer.readHold(req.operationKey).catch(() => null);
    const fp = hashFingerprint(req.lines, req.totalCents, req.slot);
    if (hold) {
      const matched = hold.status === "active" && hold.fingerprint === fp && hold.totalCents === req.totalCents && hold.slot === req.slot;
      const all = await ctx.deps.grocer.listHolds(runId);
      const active = all.filter((x) => x.status === "active").length;
      await ev(ctx, {
        runId,
        actor: "grocer",
        type: "hold_readback",
        summary: `Store read-back by key: hold ${hold.holdId} ${hold.status}, ${hold.lines.length} lines, $${(hold.totalCents / 100).toFixed(2)}, ${active} active hold(s) for this run; ${matched ? "matches" : "DOES NOT match"} our request`,
        data: { hold, matched, activeHoldsForRun: active, expectedFingerprint: fp },
      });
      if (!matched) return (await escalate(ctx, "merchant record does not match the request")).run;
      await ctx.deps.store.saveReceipt({
        runId,
        operationKey: req.operationKey,
        hold,
        verifiedAt: new Date().toISOString(),
        matched,
        activeHoldsForRun: active,
      });
      await save(ctx, { status: "hold_verified" });
      await ev(ctx, {
        runId,
        actor: "worker",
        type: "hold_verified",
        summary: `Hold ${hold.holdId} verified: ${hold.lines.length} lines, $${(hold.totalCents / 100).toFixed(2)} of $${(ctx.household.mandate.budgetCents / 100).toFixed(2)}, pickup ${hold.slot}`,
        data: { holdId: hold.holdId, operationKey: req.operationKey, totalCents: hold.totalCents, expiresAt: hold.expiresAt },
      });
      await ctx.deps.analytics
        .log(ctx.analyticsUser, [{ eventName: "hold_verified", value: hold.totalCents, metadata: { runId, holdRef: hold.holdId } }])
        .catch(() => undefined);
      await computeKpis(ctx, basket, byId, finalPlan, active);
      return ctx.run;
    }
    if (attempt === 1) break;
    // Absent: retry the identical request with the same key, only if authority is still current.
    const { effective } = await readMode(ctx, "Retry authority check");
    if (effective !== "auto_swap_and_hold") {
      await ev(ctx, { runId, actor: "worker", type: "note", summary: "Store has no hold; authority no longer current, staying pending", data: {} });
      return ctx.run;
    }
    await ev(ctx, { runId, actor: "worker", type: "hold_dispatched", summary: `Store has no record; retrying identical request with key ${req.operationKey}`, data: { retry: true, operationKey: req.operationKey } });
    const res = await ctx.deps.grocer.placeHold(req);
    if (res.kind === "rejected") return (await escalate(ctx, `store rejected retry: ${res.error}`)).run;
  }
  await ev(ctx, { runId, actor: "worker", type: "note", summary: "Hold still unconfirmed; staying pending for the next tick", data: {} });
  return ctx.run;
}

async function escalate(ctx: Ctx, reason: string): Promise<ProcessResult> {
  await save(ctx, { status: "escalated" });
  await ev(ctx, { runId: ctx.run.id, actor: "worker", type: "hold_escalated", summary: `Escalated to parent: ${reason}`, data: { reason } });
  return { run: ctx.run, proposal: await lastProposal(ctx.deps.store, ctx.run.id) };
}

async function computeKpis(ctx: Ctx, basket: Basket, byId: Map<string, Sku>, finalPlan: Recipe[], activeHolds: number | null) {
  const h = ctx.household;
  const events = await ctx.deps.store.listEvents(ctx.run.id);
  const swaps = events.filter((e) => e.type === "swap_applied" || (ctx.run.status === "proposed" && e.type === "swap_proposed"));
  const proposals = events.filter((e) => e.type === "swap_proposed");
  const traced = proposals.filter((e) => {
    const t = e.data.trace as Record<string, unknown> | undefined;
    return Boolean(t && t.fromRecipeId && t.toRecipeId && t.originalSkuId && t.catalogVersion && t.labelVersions && t.factId && t.factRevision && t.eligibility && t.rankProvider);
  }).length;
  const parentClicks = events.filter((e) => e.actor === "parent").length;
  const k: KpiSet = {
    unsafeItemsInCart: unsafeLines(h, basket, byId).length,
    mealCompletenessPct: Math.round((completeLunches(finalPlan, basket, byId) / h.plan.length) * 100),
    humanClicksPerOrder: parentClicks,
    duplicateHolds: activeHolds === null ? 0 : Math.max(0, activeHolds - 1),
    budgetKept: { kept: basket.totalCents <= h.mandate.budgetCents, totalCents: basket.totalCents, budgetCents: h.mandate.budgetCents },
    swapsTracedPct: swaps.length === 0 && proposals.length === 0 ? 100 : Math.round((traced / Math.max(1, proposals.length)) * 100),
  };
  await ctx.deps.store.saveKpis(ctx.run.id, k);
  await ev(ctx, { runId: ctx.run.id, actor: "worker", type: "metrics_computed", summary: `KPIs: unsafe ${k.unsafeItemsInCart}, complete ${k.mealCompletenessPct}%, clicks ${k.humanClicksPerOrder}, dup holds ${k.duplicateHolds}, budget ${k.budgetKept.kept ? "kept" : "MISSED"}, traced ${k.swapsTracedPct}%`, data: { ...k } });
  await ctx.deps.analytics
    .log(ctx.analyticsUser, [
      {
        eventName: "weekly_run_metrics",
        value: ctx.run.status,
        metadata: {
          runId: ctx.run.id,
          unsafe_items: String(k.unsafeItemsInCart),
          meal_completeness_pct: String(k.mealCompletenessPct),
          human_clicks: String(k.humanClicksPerOrder),
          duplicate_holds: String(k.duplicateHolds),
          total_cents: String(k.budgetKept.totalCents),
          budget_cents: String(k.budgetKept.budgetCents),
          swaps_traced_pct: String(k.swapsTracedPct),
          effective_mode: ctx.run.effectiveMode,
        },
      },
    ])
    .catch(() => undefined);
  return k;
}

/** The parent's one click in suggest_only: approve this run's proposal. Re-enters the normal path with authority for this order. */
export async function approveProposal(deps: WorkerDeps, runId: string): Promise<ProcessResult> {
  const run = await deps.store.getRun(runId);
  if (!run || run.status !== "proposed") throw new Error(`run ${runId} has no open proposal`);
  await deps.store.appendEvent({
    runId,
    actor: "parent",
    type: "note",
    summary: "Parent approved the proposed swap and pickup hold for this week",
    data: { approved: true },
  });
  return processRun(deps, { runId, householdId: run.householdId, weekOf: run.weekOf, trigger: run.trigger });
}
