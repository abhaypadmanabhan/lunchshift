// The weekly run state machine. Resumable: every step is persisted, and a replayed or repeated
// event re-enters at the persisted state. The merchant hold uses a stable operation key and is
// only marked confirmed after an independent read-back.
import { ALTERNATIVE_RECIPE_IDS } from "../lib/domain/fixture";
import { activeCatalog } from "../lib/domain/catalog";
import { activePlan, kidCount } from "../lib/domain/household";
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
import { hashFingerprint, slotEnd } from "../grocer/server";
import type { GrocerClient } from "../grocer/client";
import type { AllergenScreen, ScreenResult } from "../lib/allergen";

export interface WorkerDeps {
  store: AppStore;
  grocer: GrocerClient;
  memory: MemoryProvider;
  autonomy: AutonomyProvider;
  analytics: Analytics;
  ranker: Ranker;
  explainer: SwapExplainer;
  /** Optional task model (SIE classifier) that can only add refusals. */
  allergenScreen?: AllergenScreen;
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
  /** This run asked for the parent's approval (more swaps than the mandate covers); nothing autonomous until given. */
  awaitingApproval?: boolean;
};

async function ev(ctx: Ctx, e: Parameters<AppStore["appendEvent"]>[0]) {
  const saved = await ctx.deps.store.appendEvent(e);
  // Agent trace in Statsig: one event per persisted decision. Ids and types only; no summaries or allergy text.
  void track(ctx, [
    {
      eventName: "agent_step",
      value: saved.type,
      metadata: { runId: saved.runId, seq: String(saved.seq), actor: saved.actor, type: saved.type, effectiveMode: ctx.run.effectiveMode },
    },
  ]);
  return saved;
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
  // Re-read the authoritative household so a revocation or budget change made mid-run is seen before any write.
  const fresh = await ctx.deps.store.getHousehold(ctx.household.id);
  if (fresh) ctx.household = fresh;
  let reading: AutonomyReading;
  try {
    // The parent's in-app setting travels to Statsig as a custom field; Statsig's answer is the operator ceiling.
    reading = await ctx.deps.autonomy.read(ctx.analyticsUser, {
      autonomy_pref: ctx.household.mandate.maxAutonomy,
      household: ctx.household.id,
    });
  } catch (e) {
    reading = { mode: "suggest_only", source: "default", fetchedAt: new Date().toISOString(), error: String(e) };
  }
  // ...and again after the (slow) Statsig read, so a revocation that landed meanwhile is seen before any write.
  const latest = await ctx.deps.store.getHousehold(ctx.household.id);
  if (latest) ctx.household = latest;
  const m = ctx.household.mandate;
  const mandateLive = !m.revoked && new Date(m.expiresAt).getTime() > Date.now();
  // Household rules newer than the standing approval: nothing autonomous until the parent approves again.
  const policyOk = (m.policyRevision ?? ctx.household.policyRevision) === ctx.household.policyRevision;
  const cap = mandateLive && policyOk && !ctx.awaitingApproval ? m.maxAutonomy : "suggest_only";
  // A failed or defaulted read never authorizes anything. A parent's approval of this run's proposal requests
  // a hold for this one order, but the parent's own maximum still caps it.
  const readOk = reading.source === "statsig" && !reading.error;
  // On its own, the agent does the lower of Statsig's autonomy_mode (the operator ceiling) and the family's setting.
  // A failed or defaulted read caps everything at suggest_only. An order the parent explicitly approved is not
  // autonomous: it may be held, but only with a good config read and a live, current mandate.
  const ceiling: AutonomyMode = readOk ? reading.mode : "suggest_only";
  const effective: AutonomyMode = ctx.parentApproved && readOk && mandateLive && policyOk ? "auto_swap_and_hold" : minMode(ceiling, cap);
  const changed = effective !== ctx.run.effectiveMode || reading.mode !== ctx.run.observedMode;
  if (!changed && !logUnchanged) return { reading, effective };
  await ev(ctx, {
    runId: ctx.run.id,
    actor: "statsig",
    type: changed && ctx.run.status !== "running" ? "autonomy_changed" : "mode_observed",
    summary: `${why}: Statsig says ${reading.mode} (${reading.source}); parent max ${cap}; effective ${effective}${ctx.parentApproved && mandateLive ? " (parent approved this order)" : ""}`,
    data: {
      observed: reading.mode,
      source: reading.source,
      ruleId: reading.ruleId ?? null,
      error: reading.error ?? null,
      parentMax: cap,
      parentApproved: Boolean(ctx.parentApproved),
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
  proposal: SwapProposal | null; // first swap
  proposals?: SwapProposal[];
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
  if (existing) {
    const evs = await deps.store.listEvents(run.id);
    ctx.parentApproved = evs.some((e) => e.actor === "parent" && e.data.approved === true);
    ctx.awaitingApproval = !ctx.parentApproved && evs.some((e) => typeof e.data.approvalReason === "string" && e.data.swaps !== undefined);
  }

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

/** Every whole-lunch swap proposed in this run, in order (the last one's `after` is the final basket). */
export async function allProposals(store: AppStore, runId: string): Promise<SwapProposal[]> {
  return (await store.listEvents(runId)).filter((e) => e.type === "swap_proposed").map((e) => e.data.proposal as SwapProposal);
}
async function lastProposal(store: AppStore, runId: string): Promise<SwapProposal | null> {
  return (await allProposals(store, runId))[0] ?? null;
}

async function fullPass(ctx: Ctx): Promise<ProcessResult> {
  const { deps } = ctx;
  // This week's lunch days (school skips removed); every lunch is packed once per kid.
  const household = { ...ctx.household, plan: activePlan(ctx.household) };
  const servings = kidCount(household);
  const serve = (rs: Recipe[]) => (servings > 1 ? rs.flatMap((r) => Array.from({ length: servings }, () => r)) : rs);
  const runId = ctx.run.id;

  // 1. Memory recall (Cognee) resolved against the authoritative household record.
  let recall: MemoryRecall;
  try {
    recall = await deps.memory.recall(household.id, `What food allergies and lunch preferences does ${household.childName}'s household have?`);
  } catch (e) {
    recall = { provider: "fallback", query: "household recall", factIds: [], snippets: [], error: String(e) };
  }
  if (recall.provider === "fallback") {
    // Backup memory for any family: the household's own confirmed facts (never another family's sample data).
    recall = {
      ...recall,
      factIds: household.facts.map((f) => f.id),
      snippets: household.facts.map((f) => `[${f.id} r${f.revision}] ${f.text}`),
    };
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
  const approvedRev = household.mandate.policyRevision ?? household.policyRevision;
  if (household.policyRevision !== approvedRev && !ctx.parentApproved) {
    const approvalReason = `${household.childName}'s rules changed since you last approved (revision ${approvedRev} -> ${household.policyRevision}). Approve this week's plan to let LunchShift act on the new rules.`;
    await ev(ctx, { runId, actor: "worker", type: "note", summary: `Needs parent approval: ${approvalReason}`, data: { approvalReason } });
  }

  // 3. Live catalog + label snapshot.
  const cat = await deps.grocer.catalog();
  await deps.store.saveLabelSnapshot(cat.skus);
  const byId = new Map(cat.skus.map((s) => [s.id, s]));
  const recipes = await deps.store.getRecipes();
  const recipeById = new Map(recipes.map((r) => [r.id, r]));
  const planRecipes = household.plan.map((p) => recipeById.get(p.recipeId)).filter((r): r is Recipe => Boolean(r));

  const needs = roleNeeds(serve(planRecipes));
  const usual = new Map<string, Sku>();
  for (const role of needs.keys()) {
    const s = byId.get(activeCatalog().usualByRole[role]);
    if (s) usual.set(role, s);
  }
  const original = buildBasket(serve(planRecipes), usual, 1).basket;

  // 4. Second opinion: the SIE allergen classifier reads every exact-SKU label line once per run.
  let screen = new Map<string, ScreenResult>();
  if (deps.allergenScreen && deps.allergenScreen.provider !== "none" && hard.length > 0) {
    try {
      screen = await deps.allergenScreen.screen(cat.skus.map((s) => ({ id: s.id, text: s.label.sourceText })), hard);
      const flagged = [...screen.values()].filter((r) => r.risk);
      await ev(ctx, {
        runId,
        actor: "sie",
        type: "allergen_screened",
        summary: `SIE classifier screened ${screen.size} labels for ${hard.map((f) => f.allergen?.label ?? f.id).join(", ")}: ${flagged.length} flagged (${flagged.map((f) => `${f.skuId} ${f.score.toFixed(2)}`).join(", ")})`,
        data: { model: [...screen.values()][0]?.model ?? null, results: Object.fromEntries([...screen].map(([k, v]) => [k, { label: v.label, score: v.score, risk: v.risk }])) },
      });
    } catch (e) {
      await ev(ctx, { runId, actor: "sie", type: "allergen_screened", summary: `SIE classifier unavailable; structured rules alone decide (${e instanceof Error ? e.message : String(e)})`, data: { error: String(e) } });
    }
  }
  /** Structured rules decide; the classifier can only add a refusal on top. */
  const check = (s: Sku, packs: number): CandidateDecision => {
    const d = checkSku(household, s, packs);
    const r = screen.get(s.id);
    if (r) d.screen = { label: r.label, score: r.score, risk: r.risk, model: r.model };
    if (r?.risk && d.eligible) {
      d.eligible = false;
      d.reasons.push("classifier_flag");
      const f = hard.find((x) => (x.allergen?.id ?? x.blocksAllergens?.[0]) === r.allergenId) ?? hard[0];
      d.factId = f?.id;
      d.factText = f?.text;
      d.factRevision = f?.revision;
    }
    return d;
  };
  const refusedIds = new Set<string>();
  const refuse = async (d: CandidateDecision, name: string, extra: Record<string, unknown>) => {
    if (refusedIds.has(d.candidateId)) return;
    refusedIds.add(d.candidateId);
    refusals.push(d);
    await ev(ctx, {
      runId,
      actor: "worker",
      type: "candidate_rejected",
      summary: `Refused ${name}${d.priceCents != null && d.kind === "sku_substitute" ? ` ($${(d.priceCents / 100).toFixed(2)})` : ""}: ${d.reasons.join(", ")}${d.factId ? ` - fact ${d.factId} r${d.factRevision}` : ""}`,
      data: { ...d, ...extra, recallProvider: recall.provider, factRecalled: recall.factIds.includes(d.factId ?? "") },
    });
    await track(ctx, [{ eventName: "candidate_rejected", value: d.reasons[0], metadata: { runId, candidateId: d.candidateId, reason: d.reasons.join("|") } }]);
  };
  const refusals: CandidateDecision[] = [];

  // 4c. Shopping, shown live: for each item the week needs, compare the store's options, skip cheaper unsafe ones
  // (with the reason), and add the pick. The cart fills as the parent watches. Not repeated on stockout re-checks.
  if (ctx.run.trigger !== "stockout_event") {
    const paced = ctx.run.trigger === "manual" && process.env.LUNCHSHIFT_SHOP_PACE_MS !== "0";
    const pace = Number(process.env.LUNCHSHIFT_SHOP_PACE_MS ?? 450);
    const partial: Basket = { version: 0, lines: [], totalCents: 0 };
    for (const line of original.lines) {
      const pick = byId.get(line.skuId)!;
      const options = cat.skus.filter((s) => s.role === pick.role).sort((a, b) => a.priceCents - b.priceCents);
      const skipped: string[] = [];
      for (const o of options) {
        if (o.id === pick.id || o.priceCents > pick.priceCents) continue;
        const d = check(o, line.packs);
        if (!d.eligible && d.reasons.some((r) => r !== "out_of_stock")) {
          await refuse(d, o.name, { skuName: o.name, role: o.role, shopping: true });
          skipped.push(o.name);
        }
      }
      const ok = check(pick, line.packs).eligible;
      if (!ok) continue; // the usual pick itself is unsafe or sold out: the repair below handles it
      partial.lines.push(line);
      partial.totalCents += line.lineCents;
      await ev(ctx, {
        runId,
        actor: "worker",
        type: "item_added",
        summary: `Added ${pick.name} (${line.packs} × $${(pick.priceCents / 100).toFixed(2)}) for ${pick.role.replace(/_/g, " ")}; compared ${options.length} option${options.length === 1 ? "" : "s"}${skipped.length ? `, skipped ${skipped.length} unsafe` : ""}`,
        data: { skuId: pick.id, skuName: pick.name, brand: pick.brand, role: pick.role, packs: line.packs, lineCents: line.lineCents, options: options.length, skipped, imageUrl: pick.imageUrl ?? null },
      });
      await deps.store.saveBasket(runId, { ...partial, lines: [...partial.lines] });
      if (paced) await new Promise((r) => setTimeout(r, pace));
    }
  }

  // 5. Which usual products can't be used: sold out, or no longer safe under the household's current rules.
  const brokenUsual: string[] = [];
  for (const line of original.lines) {
    const sku = byId.get(line.skuId)!;
    const d = check(sku, line.packs);
    if (d.eligible) continue;
    brokenUsual.push(sku.role);
    if (d.reasons.length === 1 && d.reasons[0] === "out_of_stock") {
      await ev(ctx, {
        runId,
        actor: "grocer",
        type: "stockout_detected",
        summary: `${sku.name} is out of stock (store has ${sku.stock}, need ${line.packs})`,
        data: { skuId: sku.id, stock: sku.stock, catalogVersion: cat.catalogVersion },
      });
    } else {
      await refuse({ ...d, kind: "sku_substitute" }, `the usual ${sku.name}`, { skuName: sku.name, role: sku.role, usual: true });
    }
  }
  if (brokenUsual.length === 0) {
    await save(ctx, { basketVersion: 1 });
    await deps.store.saveBasket(runId, original);
    return applyAndMaybeHold(ctx, effective, original, [], byId, planRecipes);
  }

  // 6. Same-role substitutes first (cheapest safe one), else the role is broken.
  const chosen = new Map(usual);
  const brokenRoles = new Set<string>();
  for (const role of brokenUsual) {
    const usualSku = usual.get(role)!;
    const subs = cat.skus.filter((s) => s.role === role && s.id !== usualSku.id).sort((a, b) => a.priceCents - b.priceCents);
    let replacement: Sku | null = null;
    for (const s of subs) {
      const d = check(s, Math.ceil((needs.get(role)?.qty ?? 1) / s.packQty));
      if (d.eligible) {
        replacement = s;
        break;
      }
      await refuse(d, s.name, { skuName: s.name, role });
    }
    if (replacement) chosen.set(role, replacement);
    else {
      chosen.delete(role);
      brokenRoles.add(role);
    }
  }
  if (brokenRoles.size === 0) {
    const fixed = buildBasket(serve(planRecipes), chosen, 2).basket;
    await deps.store.saveBasket(runId, fixed);
    return applyAndMaybeHold(ctx, effective, fixed, [], byId, planRecipes);
  }

  // 7. Whole-lunch repair for every lunch that needs a broken role.
  const skuForRole = (role: string): Sku | undefined => {
    if (brokenRoles.has(role)) return undefined;
    const u = chosen.get(role) ?? byId.get(activeCatalog().usualByRole[role]);
    if (u && u.stock > 0 && check(u, 1).eligible) return u;
    return cat.skus
      .filter((s) => s.role === role)
      .sort((a, b) => a.priceCents - b.priceCents)
      .find((s) => check(s, 1).eligible);
  };
  const currentPlan = [...planRecipes];
  const affectedIdx = household.plan.map((_, i) => i).filter((i) => planRecipes[i].lines.some((l) => brokenRoles.has(l.role)));
  const proposals: SwapProposal[] = [];
  const usedAlts = new Set<string>();
  const loggedRuledOut = new Set<string>();
  let prev = original;
  const prefFacts = household.facts.filter((f) => f.kind === "preference" && f.active);
  for (const idx of affectedIdx) {
    const slot = household.plan[idx];
    const fromRecipe = currentPlan[idx];
    const eligible: Recipe[] = [];
    const altBaskets = new Map<string, Basket>();
    for (const altId of ALTERNATIVE_RECIPE_IDS) {
      const alt = recipeById.get(altId);
      if (!alt) continue;
      const d = checkRecipe(household, alt, skuForRole);
      let basket: Basket | null = null;
      if (d.eligible) {
        const map = new Map(chosen);
        for (const l of alt.lines) map.set(l.role, skuForRole(l.role)!);
        const newPlan = currentPlan.map((r, i) => (i === idx ? alt : r));
        basket = buildBasket(serve(newPlan), map, 2).basket;
        if (basket.lines.some((l) => (byId.get(l.skuId)?.stock ?? 0) < l.packs)) d.reasons.push("out_of_stock");
        if (basket.totalCents > household.mandate.budgetCents) d.reasons.push("over_budget");
        d.eligible = d.reasons.length === 0;
        d.priceCents = basket.totalCents;
      }
      if (d.eligible && basket) {
        eligible.push(alt);
        altBaskets.set(alt.id, basket);
      } else if (!loggedRuledOut.has(alt.id)) {
        loggedRuledOut.add(alt.id);
        await refuse(d, `whole lunch "${alt.name}"`, { recipeName: alt.name });
      }
    }
    // Prefer variety across swaps; repeat an alternative only when nothing else is safe.
    const fresh = eligible.filter((r) => !usedAlts.has(r.id));
    const pool = fresh.length ? fresh : eligible;
    if (pool.length === 0) return escalate(ctx, `No safe whole lunch for ${slot.day} within budget`);

    const keptPlan = household.plan.filter((_, i) => i !== idx);
    const pantryRoles = [...roleNeeds(currentPlan.filter((_, i) => i !== idx)).keys()];
    const q = (deps.buildRankQuery ?? defaultRankQuery)(household, keptPlan, pantryRoles);
    let ranking;
    try {
      ranking = await deps.ranker.rank(q, pool);
    } catch (e) {
      ranking = { provider: "local_vector" as const, query: q.text, ranked: pool.map((r, i) => ({ id: r.id, score: 0, rank: i + 1 })), inputs: {}, fallbackReason: String(e) };
    }
    await ev(ctx, {
      runId,
      actor: "ranker",
      type: "alternatives_ranked",
      summary: `${slot.day}: ranked ${pool.length} safe whole lunches via ${ranking.provider}: ${ranking.ranked.map((r) => `${r.id} ${r.score.toFixed(3)}`).join(", ")}`,
      data: { ...ranking, day: slot.day },
    });
    let choice;
    try {
      choice = await deps.explainer.explain({ affectedDay: slot.day, fromRecipe, eligible: pool, ranking, refusals, preferenceFacts: prefFacts });
    } catch {
      choice = null;
    }
    const choiceId = choice && altBaskets.has(choice.choiceId) && pool.some((r) => r.id === choice.choiceId) ? choice.choiceId : ranking.ranked[0].id;
    const toRecipe = recipeById.get(choiceId)!;
    const after = altBaskets.get(choiceId)!;
    const diff = diffBaskets(prev, after);
    const proposal: SwapProposal = {
      affectedDay: slot.day,
      fromRecipeId: fromRecipe.id,
      toRecipeId: toRecipe.id,
      removedSkuIds: diff.removed,
      addedSkuIds: diff.added,
      keptSharedSkuIds: diff.kept.filter((id) => toRecipe.lines.some((l) => byId.get(id)?.role === l.role)),
      before: prev,
      after,
      ranking,
      rationale: choice?.rationale ?? `Ranked first among safe complete lunches.`,
      rationaleProvider: choice?.provider ?? "template",
    };
    const brokenHere = fromRecipe.lines.map((l) => l.role).filter((r) => brokenRoles.has(r));
    const why = refusals.find((r) => r.factId && (r.kind === "sku_substitute" ? brokenHere.includes(byId.get(r.candidateId)?.role ?? "") : false)) ?? refusals.find((r) => r.factId);
    await ev(ctx, {
      runId,
      actor: "llm",
      type: "swap_proposed",
      summary: `Proposed ${slot.day}: ${fromRecipe.name} -> ${toRecipe.name} ($${(prev.totalCents / 100).toFixed(2)} -> $${(after.totalCents / 100).toFixed(2)})`,
      data: {
        proposal,
        trace: {
          fromRecipeId: fromRecipe.id,
          toRecipeId: toRecipe.id,
          affectedDay: slot.day,
          originalSkuId: usual.get(brokenHere[0])?.id,
          catalogVersion: cat.catalogVersion,
          labelVersions: Object.fromEntries(after.lines.map((l) => [l.skuId, byId.get(l.skuId)?.label.version])),
          factId: why?.factId ?? hard[0]?.id,
          factRevision: hard.find((f) => f.id === (why?.factId ?? hard[0]?.id))?.revision,
          eligibility: refusals.map((r) => ({ id: r.candidateId, reasons: r.reasons })).concat(pool.map((r) => ({ id: r.id, reasons: [] }))),
          rankProvider: ranking.provider,
          rationaleProvider: proposal.rationaleProvider,
        },
      },
    });
    proposals.push(proposal);
    currentPlan[idx] = toRecipe;
    for (const l of toRecipe.lines) chosen.set(l.role, skuForRole(l.role)!);
    usedAlts.add(toRecipe.id);
    prev = after;
  }
  for (const r of brokenRoles) chosen.delete(r);
  const built = buildBasket(serve(currentPlan), chosen, 2);
  if (built.missingRoles.length) return escalate(ctx, `No safe product for ${built.missingRoles.join(", ")}`);
  const finalBasket = built.basket;
  if (finalBasket.totalCents > household.mandate.budgetCents) return escalate(ctx, `Repaired week costs $${(finalBasket.totalCents / 100).toFixed(2)}, over the $${(household.mandate.budgetCents / 100).toFixed(2)} budget`);
  proposals[proposals.length - 1].after = finalBasket;

  // 8. More swaps than the standing approval covers, or household rules changed since it: ask the parent first.
  const reasons: string[] = [];
  if (proposals.length > household.mandate.maxSwapsPerWeek) reasons.push(`${proposals.length} lunches need changing and your standing approval covers ${household.mandate.maxSwapsPerWeek}`);
  effective = ctx.run.effectiveMode;
  if (reasons.length && !ctx.parentApproved && effective !== "suggest_only") {
    effective = "suggest_only";
    await save(ctx, { effectiveMode: effective });
  }
  if (reasons.length && !ctx.parentApproved) {
    ctx.awaitingApproval = true;
    const approvalReason = `${reasons.join("; ")}. Approve to apply ${proposals.length === 1 ? "this change" : `these ${proposals.length} changes`}.`;
    await ev(ctx, { runId, actor: "worker", type: "note", summary: `Needs parent approval: ${approvalReason}`, data: { approvalReason, swaps: proposals.length } });
  }
  return applyAndMaybeHold(ctx, effective, finalBasket, proposals, byId, currentPlan);
}

async function applyAndMaybeHold(
  ctx: Ctx,
  effective: AutonomyMode,
  basket: Basket,
  proposals: SwapProposal[],
  byId: Map<string, Sku>,
  finalPlan: Recipe[],
): Promise<ProcessResult> {
  const runId = ctx.run.id;
  const first = proposals[0] ?? null;
  if (effective === "suggest_only") {
    // Nothing changes at the store. The cart stays as it was; any repaired basket lives only in the proposals.
    const cart = first ? first.before : basket;
    await ctx.deps.store.saveBasket(runId, cart);
    await save(ctx, { status: "proposed", basketVersion: cart.version });
    await ev(ctx, {
      runId,
      actor: "worker",
      type: "note",
      summary: first
        ? `suggest_only: ${proposals.length} whole-lunch change(s) saved for the parent; cart and store untouched`
        : "suggest_only: basket ready; waiting for parent approval before any hold",
      data: { effective },
    });
    await computeKpis(ctx, basket, byId, finalPlan, null);
    return { run: ctx.run, proposal: first, proposals };
  }
  await ctx.deps.store.saveBasket(runId, basket);
  await save(ctx, { basketVersion: basket.version, status: "swapped_waiting" });
  if (first) {
    await ev(ctx, {
      runId,
      actor: "worker",
      type: "swap_applied",
      summary: `Applied ${proposals.map((p) => p.affectedDay).join(", ")} whole-lunch swap${proposals.length > 1 ? "s" : ""}; basket v${basket.version} total $${(basket.totalCents / 100).toFixed(2)}`,
      data: {
        basketVersion: basket.version,
        swaps: proposals.map((p) => ({ day: p.affectedDay, from: p.fromRecipeId, to: p.toRecipeId })),
        dropped: [...new Set(proposals.flatMap((p) => p.removedSkuIds))],
        added: [...new Set(proposals.flatMap((p) => p.addedSkuIds))],
        kept: first.keptSharedSkuIds,
      },
    });
    await ctx.deps.analytics
      .log(
        ctx.analyticsUser,
        proposals.map((p) => ({ eventName: "meal_swapped" as const, value: 1, metadata: { runId, from: p.fromRecipeId, to: p.toRecipeId } })),
      )
      .catch(() => undefined);
  }
  if (effective !== "auto_swap_and_hold") {
    await ev(ctx, { runId, actor: "worker", type: "note", summary: `${effective}: cart ready, waiting for hold authority`, data: { effective } });
    await computeKpis(ctx, basket, byId, finalPlan, null);
    return { run: ctx.run, proposal: first, proposals };
  }
  return { run: await dispatchHold(ctx, basket, byId, finalPlan), proposal: first, proposals };
}

/** The week's plan after every proposed swap in this run. */
async function planAfter(ctx: Ctx, proposals: SwapProposal[]): Promise<Recipe[]> {
  const recipes = new Map((await ctx.deps.store.getRecipes()).map((r) => [r.id, r]));
  return activePlan(ctx.household).map((p) => {
    const sw = proposals.find((x) => x.affectedDay === p.day);
    return recipes.get(sw ? sw.toRecipeId : p.recipeId)!;
  });
}

async function resumeWaiting(ctx: Ctx): Promise<ProcessResult> {
  const before = ctx.run.effectiveMode;
  const { effective } = await readMode(ctx, "Waiting-run check", false);
  const proposals = await allProposals(ctx.deps.store, ctx.run.id);
  const first = proposals[0] ?? null;
  if (MODE_RANK[effective] <= MODE_RANK[before]) return { run: ctx.run, proposal: first, proposals };
  const cat = await ctx.deps.grocer.catalog();
  const byId = new Map(cat.skus.map((s) => [s.id, s]));
  const finalPlan = await planAfter(ctx, proposals);
  const draft = await ctx.deps.store.getBasket(draftKey(ctx.run.id));
  const basket = draft ?? (proposals.length ? proposals[proposals.length - 1].after : await ctx.deps.store.getBasket(ctx.run.id));
  if (!basket) return { run: (await escalate(ctx, "no basket to resume")).run, proposal: first, proposals };
  if (ctx.run.status === "proposed") return applyAndMaybeHold(ctx, effective, basket, proposals, byId, finalPlan);
  if (effective === "auto_swap_and_hold") return { run: await dispatchHold(ctx, basket, byId, finalPlan), proposal: first, proposals };
  return { run: ctx.run, proposal: first, proposals };
}

function holdRequestFor(run: Run, basket: Basket, catalogVersion: string): HoldRequest {
  return {
    operationKey: opKeyFor(run.id),
    runId: run.id,
    lines: basket.lines.map((l) => ({ skuId: l.skuId, packs: l.packs, unitPriceCents: l.unitPriceCents })),
    totalCents: basket.totalCents,
    slot: `Sun ${run.weekOf} 16:00-18:00`,
    catalogVersion,
  };
}

async function dispatchHold(ctx: Ctx, basket: Basket, byId: Map<string, Sku>, finalPlan: Recipe[]): Promise<Run> {
  const runId = ctx.run.id;
  // Final gates right before the only write.
  const { effective } = await readMode(ctx, "Pre-hold check");
  if (effective !== "auto_swap_and_hold") {
    await ev(ctx, { runId, actor: "worker", type: "note", summary: `Hold skipped: effective mode is ${effective}`, data: { effective } });
    await save(ctx, { status: "swapped_waiting" });
    await computeKpis(ctx, basket, byId, finalPlan, null);
    return ctx.run;
  }
  const hh = ctx.household;
  const unsafe = unsafeLines(hh, basket, byId);
  if (unsafe.length) return (await escalate(ctx, `unsafe lines blocked at hold gate: ${unsafe.join(", ")}`)).run;
  // Mandate: at most N holds per week across all of this household's runs for the week.
  const weekRuns = (await ctx.deps.store.listRuns(hh.id)).filter((r) => r.weekOf === ctx.run.weekOf && r.id !== runId);
  const weekHolds = weekRuns.filter((r) => r.status === "hold_verified" || r.status === "hold_pending").length;
  if (weekHolds + 1 > hh.mandate.maxHoldsPerWeek) {
    return (await escalate(ctx, `mandate allows ${hh.mandate.maxHoldsPerWeek} hold(s) per week; ${weekHolds} already placed for ${ctx.run.weekOf}`)).run;
  }
  if (basket.totalCents > hh.mandate.budgetCents) return (await escalate(ctx, "over budget at hold gate")).run;

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
    activePlan(ctx.household).map((p) => (proposal && p.day === proposal.affectedDay ? recipes.get(proposal.toRecipeId)! : recipes.get(p.recipeId)!));

  for (let attempt = 0; attempt < 2; attempt++) {
    const hold = await ctx.deps.grocer.readHold(req.operationKey).catch(() => null);
    const fp = hashFingerprint(req.lines, req.totalCents, req.slot);
    if (hold) {
      const canon = (ls: { skuId: string; packs: number; unitPriceCents: number }[]) =>
        [...ls].sort((a, b) => a.skuId.localeCompare(b.skuId)).map((l) => `${l.skuId}:${l.packs}:${l.unitPriceCents}`).join("|");
      const linesMatch = canon(hold.lines) === canon(req.lines);
      const fpMatch = hold.fingerprint === fp && (!ctx.run.requestFingerprint || ctx.run.requestFingerprint === fp);
      const all = await ctx.deps.grocer.listHolds(runId);
      const active = all.filter((x) => x.status === "active").length;
      const end = slotEnd(req.slot);
      const coversPickup = !end || Date.parse(hold.expiresAt) >= Date.parse(end);
      const matched =
        hold.status === "active" && linesMatch && fpMatch && hold.totalCents === req.totalCents && hold.slot === req.slot && active === 1 && coversPickup;
      await ev(ctx, {
        runId,
        actor: "grocer",
        type: "hold_readback",
        summary: `Store read-back by key: hold ${hold.holdId} ${hold.status}, ${hold.lines.length} lines, $${(hold.totalCents / 100).toFixed(2)}, ${active} active hold(s) for this run; ${matched ? "matches" : "DOES NOT match"} our request`,
        data: { hold, matched, activeHoldsForRun: active, expectedFingerprint: fp },
      });
      if (!matched) {
        const why = active !== 1 ? `${active} active holds for this run` : !linesMatch ? "lines differ" : !fpMatch ? "fingerprint differs" : !coversPickup ? "hold expires before pickup ends" : "total, slot or status differs";
        return (await escalate(ctx, `merchant record does not match the request (${why})`)).run;
      }
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
      // Measure what the merchant actually holds (fresh catalog labels), not our own request.
      const fresh = new Map((await ctx.deps.grocer.catalog()).skus.map((x) => [x.id, x]));
      const held: Basket = {
        version: basket.version,
        lines: hold.lines.map((l) => ({ skuId: l.skuId, name: fresh.get(l.skuId)?.name ?? l.skuId, packs: l.packs, unitPriceCents: l.unitPriceCents, lineCents: l.packs * l.unitPriceCents, usedBy: [] })),
        totalCents: hold.totalCents,
      };
      await computeKpis(ctx, held, fresh, finalPlan, active);
      // Full autonomy (from Statsig, not a one-off parent approval): the agent also places the pay-at-pickup order.
      if (ctx.run.effectiveMode === "auto_swap_and_hold" && !ctx.parentApproved) await placeOrderFor(ctx.deps, runId, "agent");
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
  // Clicks the order NEEDED from the parent (approvals). Voluntary cart edits or refused add attempts are not required.
  const parentClicks = events.filter((e) => e.actor === "parent" && e.data.approved === true).length;
  const k: KpiSet = {
    unsafeItemsInCart: unsafeLines(h, basket, byId).length,
    mealCompletenessPct: Math.round(
      (completeLunches(finalPlan.flatMap((r) => Array.from({ length: kidCount(h) }, () => r)), basket, byId) / Math.max(1, activePlan(h).length * kidCount(h))) * 100,
    ),
    humanClicksPerOrder: parentClicks,
    duplicateHolds: activeHolds === null ? 0 : Math.max(0, activeHolds - Math.max(1, h.mandate.maxHoldsPerWeek)),
    budgetKept: { kept: basket.totalCents <= h.mandate.budgetCents, totalCents: basket.totalCents, budgetCents: h.mandate.budgetCents },
    swapsTracedPct: swaps.length === 0 && proposals.length === 0 ? 100 : Math.round((traced / Math.max(1, proposals.length)) * 100),
  };
  await ctx.deps.store.saveKpis(ctx.run.id, k);
  const delivery = await ctx.deps.analytics
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
          parent_setting: ctx.household.mandate.maxAutonomy,
          statsig_mode: ctx.run.observedMode,
        },
      },
    ])
    .catch((e: unknown) => ({ ok: false, error: String(e) }));
  await ev(ctx, {
    runId: ctx.run.id,
    actor: "worker",
    type: "metrics_computed",
    summary: `KPIs: unsafe ${k.unsafeItemsInCart}, complete ${k.mealCompletenessPct}%, clicks ${k.humanClicksPerOrder}, dup holds ${k.duplicateHolds}, budget ${k.budgetKept.kept ? "kept" : "MISSED"}, traced ${k.swapsTracedPct}%; Statsig weekly_run_metrics ${delivery.ok ? "sent" : "not sent"}`,
    data: { ...k, statsigDelivered: delivery.ok, statsigError: delivery.error ?? null },
  });
  return k;
}

/** The parent's one click in suggest_only: approve this run's proposal. Re-enters the normal path with authority for this order. */
export async function recordApproval(store: AppStore, runId: string): Promise<Run> {
  const run = await store.getRun(runId);
  if (!run || run.status !== "proposed") throw new Error(`run ${runId} has no open proposal`);
  const already = (await store.listEvents(runId)).some((e) => e.actor === "parent" && e.data.approved === true);
  if (already) return run;
  // Approving a plan made under new household rules also re-approves the standing mandate at that revision.
  const h = await store.getHousehold(run.householdId);
  if (h && (h.mandate.policyRevision ?? h.policyRevision) !== h.policyRevision) {
    await store.saveHousehold({ ...h, mandate: { ...h.mandate, policyRevision: h.policyRevision, approvedAt: new Date().toISOString() } });
  }
  await store.appendEvent({
    runId,
    actor: "parent",
    type: "note",
    summary: "Parent approved the proposed swap and pickup hold for this week",
    data: { approved: true },
  });
  return run;
}

export async function approveProposal(deps: WorkerDeps, runId: string): Promise<ProcessResult> {
  const run = await recordApproval(deps.store, runId);
  return processRun(deps, { runId, householdId: run.householdId, weekOf: run.weekOf, trigger: run.trigger });
}

/**
 * Turn this run's verified hold into a pay-at-pickup order. Idempotent by key `order:<runId>`; a lost reply is
 * resolved by reading the order back. The agent's credential can create pay-at-pickup orders, never payments.
 */
export async function placeOrderFor(
  deps: Pick<WorkerDeps, "store" | "grocer" | "analytics">,
  runId: string,
  placedBy: "agent" | "parent",
): Promise<{ ok: boolean; order?: import("../lib/domain/types").Order; reason?: string }> {
  const run = await deps.store.getRun(runId);
  if (!run || run.status !== "hold_verified" || !run.operationKey) return { ok: false, reason: "No verified store hold this week" };
  const events = await deps.store.listEvents(runId);
  const prior = events.find((e) => e.type === "order_placed");
  if (prior) return { ok: true, order: prior.data.order as import("../lib/domain/types").Order };
  const key = `order:${runId}`;
  const actor = placedBy === "agent" ? "worker" : "parent";
  const res = await deps.grocer.placeOrder({ operationKey: key, holdKey: run.operationKey, placedBy });
  let order = res.kind === "ok" ? res.order : null;
  if (res.kind === "lost") {
    await deps.store.appendEvent({ runId, actor: "grocer", type: "order_response_lost", summary: `No reply from the store when placing the order (${res.error}); reading it back by key`, data: { operationKey: key } });
    order = await deps.grocer.readOrder(key).catch(() => null);
  }
  if (res.kind === "rejected") return { ok: false, reason: `Store refused the order: ${res.error}` };
  if (!order) return { ok: false, reason: "Order not confirmed yet; will retry with the same key" };
  await deps.store.appendEvent({
    runId,
    actor,
    type: "order_placed",
    summary: `Order ${order.orderId} placed by ${placedBy === "agent" ? "LunchShift" : "the parent"}: pay at pickup, $${(order.totalCents / 100).toFixed(2)}, ${order.slot}`,
    data: { order, operationKey: key },
  });
  await deps.analytics.log(run.householdId, [{ eventName: "order_placed", value: order.totalCents, metadata: { runId, placedBy } }]).catch(() => undefined);
  return { ok: true, order };
}

/** Where the parent's edited cart for a run is kept (same basket table). */
export const draftKey = (runId: string) => `${runId}#draft`;
