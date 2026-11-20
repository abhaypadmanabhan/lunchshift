// Parent actions from the app. Each one is a recorded parent event; the background worker stays the only writer
// of plans and holds (these functions only record intent, supersede a stale run, or release a hold).
import { applyHouseholdUpdate, currentRunId } from "../lib/domain/household";
import { checkBudget, markRun, routinesOf, withRoutines, type RoutineId } from "./routines";
import { blankFamily, currentWeekOf, readPointer, writePointer } from "../lib/domain/families";
import { activeCatalog } from "../lib/domain/catalog";
import { HOUSEHOLD } from "../lib/domain/fixture";
import type { AppStore, Run } from "../lib/domain/types";
import type { HouseholdUpdate, HouseholdUpdateResult, ProposedFact } from "../lib/domain/view";
import type { Household } from "../lib/domain/types";
import { getMemory } from "../lib/memory";
import { activeHousehold, ensureSeeded, grocerClient, grocerOperator } from "./deps";
import { checkSku, hardRestrictions } from "../lib/domain/rules";
import { allProposals, draftKey, placeOrderFor } from "./runWeekly";
import { getAnalytics } from "../lib/autonomy";
import type { Basket } from "../lib/domain/types";

async function scheduleRun(store: AppStore, runId: string, trigger: Run["trigger"], householdId: string = HOUSEHOLD.id) {
  if (await store.getRun(runId)) return;
  const now = new Date().toISOString();
  await store.upsertRun({
    id: runId,
    householdId,
    weekOf: currentWeekOf(),
    trigger,
    status: "scheduled",
    observedMode: "suggest_only",
    effectiveMode: "suggest_only",
    basketVersion: 0,
    createdAt: now,
    updatedAt: now,
  });
}

/** Release the run's store hold (if any) and mark the run superseded, with the parent's reason in the audit. */
async function supersede(store: AppStore, run: Run, reason: string) {
  if (run.status === "superseded") return;
  let released = false;
  if (run.operationKey) {
    const h = await grocerClient().releaseHold(run.operationKey).catch(() => null);
    released = h?.status === "released";
  }
  await store.appendEvent({
    runId: run.id,
    actor: "parent",
    type: "note",
    summary: `${reason}${released ? "; the store hold was released" : ""}`,
    data: { superseded: true, holdReleased: released },
  });
  await store.upsertRun({ ...run, status: "superseded", updatedAt: new Date().toISOString() });
}

export async function updateHousehold(u: HouseholdUpdate): Promise<HouseholdUpdateResult> {
  const store = await ensureSeeded();
  const before = await activeHousehold(store);
  const { household, normalized } = applyHouseholdUpdate(before, u);
  const oldRun = await store.getRun(currentRunId(before, currentWeekOf()));
  if (oldRun) await supersede(store, oldRun, `Parent changed ${household.childName}'s rules (revision ${household.policyRevision}); this plan is replaced`);
  await store.saveHousehold(household);
  const runId = currentRunId(household, currentWeekOf());
  await scheduleRun(store, runId, "manual", household.id);
  // Memory: re-seed Cognee with the new confirmed facts in the background (cognify takes ~30 s).
  void getMemory()
    .seed(household)
    .catch(() => undefined);
  return { ok: true, normalized, policyRevision: household.policyRevision, runId };
}

export async function planNow(): Promise<{ ok: boolean; runId: string }> {
  const store = await ensureSeeded();
  const h = await activeHousehold(store);
  const runId = currentRunId(h, currentWeekOf());
  await scheduleRun(store, runId, "manual", h.id);
  return { ok: true, runId };
}

export async function cancelHold(): Promise<{ ok: boolean; reason?: string }> {
  const store = await ensureSeeded();
  const h = await activeHousehold(store);
  const run = await store.getRun(currentRunId(h, currentWeekOf()));
  if (!run?.operationKey) return { ok: false, reason: "No store hold this week" };
  await supersede(store, run, "Parent cancelled this week's pickup");
  return { ok: true };
}

const EDITABLE = new Set(["proposed", "swapped_waiting"]);

/** The cart the parent sees: their draft if they edited it, else the agent's latest basket for the run. */
export async function cartBasket(store: AppStore, run: Run): Promise<{ basket: Basket | null; source: "agent" | "parent_draft" }> {
  const draft = await store.getBasket(draftKey(run.id));
  if (draft) return { basket: draft, source: "parent_draft" };
  const proposals = await allProposals(store, run.id);
  if (proposals.length) return { basket: proposals[proposals.length - 1].after, source: "agent" };
  return { basket: await store.getBasket(run.id), source: "agent" };
}

/** Set a cart line to `packs` (0 removes). Unsafe, out-of-stock or over-budget changes are refused with the reason. */
export async function updateCart(skuId: string, packs: number): Promise<{ ok: boolean; reason?: string; basket?: Basket }> {
  const store = await ensureSeeded();
  const h = await activeHousehold(store);
  const run = await store.getRun(currentRunId(h, currentWeekOf()));
  if (!run) return { ok: false, reason: "No plan this week yet. Tap Plan my week first." };
  if (!EDITABLE.has(run.status)) {
    return { ok: false, reason: run.operationKey ? "Your pickup is held. Cancel the hold to edit the cart." : "The cart can't be edited right now." };
  }
  const n = Math.max(0, Math.min(20, Math.floor(packs)));
  const sku = (await grocerClient().catalog()).skus.find((s) => s.id === skuId);
  if (!sku) return { ok: false, reason: "That product isn't sold at this store." };
  const { basket } = await cartBasket(store, run);
  const lines = [...(basket?.lines ?? [])];
  const idx = lines.findIndex((l) => l.skuId === skuId);
  if (n > 0) {
    const d = checkSku(h, sku, n);
    if (!d.eligible) {
      const fact = hardRestrictions(h).find((f) => f.id === d.factId);
      const why = d.reasons.includes("allergen_warning")
        ? `${fact?.allergen ? `Contains ${fact.allergen.label.toLowerCase()}` : "Allergen warning"}: ${h.childName}'s allergy${fact ? ` (confirmed, revision ${fact.revision})` : ""}`
        : d.reasons.includes("missing_label_evidence")
          ? "No allergen statement on file for this exact product, so LunchShift can't confirm it's safe"
          : d.reasons.includes("conflicting_label_evidence")
            ? "The product's allergen sources disagree, so LunchShift won't risk it"
            : d.reasons.includes("out_of_stock")
              ? `Only ${sku.stock} in stock`
              : d.reasons.join(", ");
      await store.appendEvent({ runId: run.id, actor: "parent", type: "candidate_rejected", summary: `Parent tried to add ${sku.name}: refused (${why})`, data: { ...d, skuName: sku.name, parentAttempt: true } });
      return { ok: false, reason: why };
    }
    const line = { skuId, name: sku.name, packs: n, unitPriceCents: sku.priceCents, lineCents: n * sku.priceCents, usedBy: idx >= 0 ? lines[idx].usedBy : [] };
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
  } else if (idx >= 0) lines.splice(idx, 1);
  const total = lines.reduce((a, l) => a + l.lineCents, 0);
  if (total > h.mandate.budgetCents) {
    return { ok: false, reason: `That would make the cart $${(total / 100).toFixed(2)}, over your $${(h.mandate.budgetCents / 100).toFixed(2)} budget` };
  }
  const next: Basket = { version: (basket?.version ?? 1) + 1, lines: lines.sort((a, b) => a.skuId.localeCompare(b.skuId)), totalCents: total };
  await store.saveBasket(draftKey(run.id), next);
  await store.appendEvent({
    runId: run.id,
    actor: "parent",
    type: "cart_edited",
    summary: `Parent set ${sku.name} to ${n} pack${n === 1 ? "" : "s"}; cart v${next.version} $${(total / 100).toFixed(2)}`,
    data: { skuId, packs: n, totalCents: total, version: next.version },
  });
  return { ok: true, basket: next };
}

export async function placeOrderByParent(): Promise<{ ok: boolean; reason?: string; order?: import("../lib/domain/types").Order }> {
  const store = await ensureSeeded();
  const h = await activeHousehold(store);
  const r = await placeOrderFor({ store, grocer: grocerClient(), analytics: getAnalytics() }, currentRunId(h, currentWeekOf()), "parent");
  return { ok: r.ok, reason: r.reason, order: r.order };
}

const MODES = ["suggest_only", "auto_swap", "auto_swap_and_hold"] as const;
type Mode = (typeof MODES)[number];

/** "How much can LunchShift do?" Saved per family; no re-plan. The worker sees it on its next check. */
export async function setAutonomy(mode: string): Promise<{ ok: boolean; reason?: string }> {
  if (!MODES.includes(mode as Mode)) return { ok: false, reason: "Unknown mode" };
  const store = await ensureSeeded();
  const h = await activeHousehold(store);
  await store.saveHousehold({ ...h, mandate: { ...h.mandate, maxAutonomy: mode as Mode, approvedAt: new Date().toISOString() } });
  const run = await store.getRun(currentRunId(h, currentWeekOf()));
  if (run) {
    await store.appendEvent({
      runId: run.id,
      actor: "parent",
      type: "note",
      summary: `Parent set LunchShift to ${mode === "suggest_only" ? "Ask me" : mode === "auto_swap" ? "Swap for me" : "Swap and hold"}`,
      data: { autonomySetting: mode },
    });
  }
  return { ok: true };
}

export async function switchFamily(householdId: string): Promise<{ ok: boolean; reason?: string }> {
  const store = await ensureSeeded();
  const h = await store.getHousehold(householdId);
  if (!h) return { ok: false, reason: "No such family" };
  writePointer({ householdId });
  // Switching re-plans that family's week (a no-op if it already has a plan).
  if (h.onboarded !== false) await scheduleRun(store, currentRunId(h, currentWeekOf()), "manual", h.id);
  return { ok: true };
}

export async function newFamily(): Promise<{ ok: boolean; householdId: string }> {
  const store = await ensureSeeded();
  const p = readPointer();
  const h = blankFamily(`fam-${Date.now().toString(36)}`);
  await store.saveHousehold(h);
  writePointer({ householdId: h.id, newFamilies: p.newFamilies + 1, newFamilyIds: [...p.newFamilyIds, h.id] });
  return { ok: true, householdId: h.id };
}

/** Demo clock: jump to next Sunday. The store restocks, then the usual bread sells out (a real stock event). */
export async function nextWeek(): Promise<{ ok: boolean; weekOf: string }> {
  const store = await ensureSeeded();
  const op = grocerOperator();
  await op.reset();
  writePointer({ weekIndex: 1 });
  await op.setStock(activeCatalog().stockoutSku, 0);
  void store;
  return { ok: true, weekOf: currentWeekOf() };
}

/** Pure: the household after the parent's confirmed facts. Used by the chat route and the scenario suite. */
export function applyFacts(h: Household, facts: ProposedFact[]): Household {
  // Kids
  const startKids: { name: string; age?: number }[] = h.children ?? (h.childName ? h.childName.split(" and ").map((name) => ({ name })) : []);
  const kids = new Map(startKids.map((k) => [k.name.toLowerCase(), k]));
  for (const f of facts.filter((x) => x.kind === "child")) {
    const name = String(f.value.name ?? "").trim();
    if (name) kids.set(name.toLowerCase(), { name, age: typeof f.value.age === "number" ? f.value.age : undefined });
  }
  const children = [...kids.values()];
  const childName = children.map((k) => k.name).join(" and ") || h.childName;

  // Allergies: current list (+ who has each), then removals and additions
  type A = { text: string; crossContact: boolean; who: Set<string> };
  const allergies = new Map<string, A>();
  for (const f of h.facts.filter((x) => x.kind === "hard_restriction" && x.allergen)) {
    allergies.set(f.allergen!.id, { text: f.allergen!.label, crossContact: f.allergen!.crossContact, who: new Set(f.child ? f.child.split(" and ") : []) });
  }
  let allergyChanged = false;
  for (const f of facts.filter((x) => x.kind === "allergy")) {
    const id = String(f.value.id ?? "");
    if (f.value.remove) {
      allergyChanged = allergies.delete(id) || allergyChanged;
      continue;
    }
    const prev = allergies.get(id);
    const cc = f.value.crossContact !== false;
    const who = new Set(prev?.who ?? []);
    if (typeof f.value.child === "string" && f.value.child) who.add(f.value.child);
    if (!prev || prev.crossContact !== cc || who.size !== prev.who.size) allergyChanged = true;
    allergies.set(id, { text: String(f.value.text ?? id), crossContact: prev ? prev.crossContact || cc : cc, who });
  }

  let next: Household = { ...h, children, childName };
  if (allergyChanged || h.onboarded === false) {
    const r = applyHouseholdUpdate(next, { childName, allergies: [...allergies.values()].map((a) => ({ text: a.text, crossContact: a.crossContact })) });
    next = r.household;
    // Attribute each allergy to its kid(s); the safety gate still applies every allergy to every product (shared pantry).
    next.facts = next.facts.map((f) => {
      if (f.kind !== "hard_restriction" || !f.allergen) return f;
      const a = allergies.get(f.allergen.id);
      const who = a && a.who.size ? [...a.who].join(" and ") : undefined;
      if (!who) return f;
      return { ...f, child: who, text: f.text.replace(childName, who).replace(/^(.+?) is allergic/, `${who} ${a!.who.size > 1 ? "are" : "is"} allergic`) };
    });
  } else {
    next = { ...next, policyRevision: h.policyRevision + 1, mandate: { ...next.mandate, policyRevision: h.policyRevision + 1 } };
  }
  if (h.onboarded === false) next.mandate = { ...next.mandate, policyRevision: next.policyRevision }; // onboarding is the first approval

  // Preferences, budget, pickup, store, plan changes
  const today = new Date().toISOString().slice(0, 10);
  for (const f of facts.filter((x) => x.kind === "preference")) {
    next.facts.push({ id: `fact-pref-${Date.now().toString(36)}-${next.facts.length}`, kind: "preference", text: String(f.value.text ?? f.label), revision: next.policyRevision, confirmedBy: "parent", confirmedAt: today, active: true, child: typeof f.value.child === "string" ? f.value.child : undefined });
  }
  for (const f of facts) {
    if (f.kind === "budget" && typeof f.value.cents === "number") next.mandate = { ...next.mandate, budgetCents: f.value.cents };
    if (f.kind === "pickup" && f.value.day) next.mandate = { ...next.mandate, window: `${String(f.value.day).slice(0, 3)} 16:00-18:00` };
    if (f.kind === "store" && f.value.store) next.mandate = { ...next.mandate, storeId: String(f.value.store) };
    if (f.kind === "plan_change" && typeof f.value.skip === "string") next.skipDays = [...new Set([...(next.skipDays ?? []), f.value.skip])];
    if (f.kind === "plan_change" && typeof f.value.day === "string" && typeof f.value.recipeId === "string") {
      next.plan = next.plan.map((p) => (p.day === f.value.day ? { ...p, recipeId: String(f.value.recipeId) } : p));
    }
    if (f.kind === "cart_change") {
      next.facts.push({ id: `fact-extra-${Date.now().toString(36)}-${next.facts.length}`, kind: "preference", text: `Also buy for the family: ${String(f.value.text)}.`, revision: next.policyRevision, confirmedBy: "parent", confirmedAt: today, active: true });
    }
  }
  if (!next.facts.some((f) => f.kind === "member") && children.length) {
    next.facts.unshift({ id: "fact-members", kind: "member", text: `${children.map((k) => `${k.name}${k.age ? ` (${k.age})` : ""}`).join(" and ")} take a packed school lunch Monday to Friday.`, revision: next.policyRevision, confirmedBy: "parent", confirmedAt: today, active: true });
  }
  next.onboarded = true;

  return next;
}

/**
 * Apply facts the parent confirmed in chat. Allergy changes bump the policy revision (the agent re-plans and waits
 * for approval before acting alone); plan-only changes (skip a day, swap a lunch) re-plan without re-approval.
 */
export async function confirmFacts(
  facts: ProposedFact[],
  mode: "onboarding" | "assistant" = "assistant",
): Promise<{ ok: boolean; saved: { label: string; memory: "cognee" | "fallback" }[]; runId?: string; reason?: string }> {
  const store = await ensureSeeded();
  const h = await activeHousehold(store);
  if (!facts.length) return { ok: false, saved: [], reason: "Nothing to save" };
  if (h.onboarded === false) mode = "onboarding"; // first-time setup: the parent presses "Plan this week" next
  const next = applyFacts(h, facts);
  next.factLog = [...(h.factLog ?? []), ...h.facts.filter((f) => !next.facts.some((n) => n.id === f.id && n.revision === f.revision)).map((f) => ({ ...f, active: false }))];
  const childName = next.childName;
  // Replace this week's plan (release any hold), save, and re-plan unless this is first-time onboarding.
  const oldRun = await store.getRun(currentRunId(h, currentWeekOf()));
  if (oldRun && oldRun.status !== "superseded") await supersede(store, oldRun, `Parent updated ${childName}'s family through chat; this plan is replaced`);
  await store.saveHousehold(next);
  const runId = currentRunId(next, currentWeekOf());
  if (mode === "assistant" || oldRun) await scheduleRun(store, runId, "manual", next.id);
  void getMemory()
    .seed(next)
    .catch(() => undefined);
  const memory = process.env.COGNEE_API_KEY && process.env.COGNEE_BASE_URL ? ("cognee" as const) : ("fallback" as const);
  return { ok: true, saved: facts.map((f) => ({ label: f.label, memory })), runId };
}

const ROUTINE_IDS: RoutineId[] = ["weekly_plan", "stock_watch", "school_skips", "budget_alert"];

export async function updateRoutine(id: string, enabled?: boolean, config?: Record<string, unknown>): Promise<{ ok: boolean; reason?: string }> {
  if (!ROUTINE_IDS.includes(id as RoutineId)) return { ok: false, reason: "Unknown routine" };
  const store = await ensureSeeded();
  const h = await activeHousehold(store);
  const routines = routinesOf(h);
  const cur = routines[id as RoutineId];
  routines[id as RoutineId] = { ...cur, enabled: typeof enabled === "boolean" ? enabled : cur.enabled, config: { ...cur.config, ...(config ?? {}) } };
  await store.saveHousehold(withRoutines(h, routines));
  return { ok: true };
}

/** Run a routine now. School skips re-plan the week through the same path as a chat change. */
export async function runRoutine(id: string): Promise<{ ok: boolean; result: string }> {
  const store = await ensureSeeded();
  const h = await activeHousehold(store);
  const runId = currentRunId(h, currentWeekOf());
  const run = await store.getRun(runId);
  let result = "";
  switch (id as RoutineId) {
    case "weekly_plan": {
      if (run && run.status !== "superseded") result = `This week is already planned · ${run.status.replace(/_/g, " ")}`;
      else {
        await scheduleRun(store, runId, "schedule", h.id);
        result = "Planning started";
      }
      break;
    }
    case "stock_watch": {
      const basket = run ? await store.getBasket(runId) : null;
      const cat = await grocerClient().catalog();
      const byId = new Map(cat.skus.map((s) => [s.id, s]));
      const out = (basket?.lines ?? []).filter((l) => (byId.get(l.skuId)?.stock ?? 0) < l.packs);
      result = basket ? (out.length ? `${out.length} item${out.length === 1 ? "" : "s"} sold out: ${out.map((l) => l.name).join(", ")}` : `All ${basket.lines.length} items in stock`) : "Nothing in the cart yet";
      break;
    }
    case "school_skips": {
      const days = (routinesOf(h).school_skips.config.days as string[]) ?? [];
      const facts = days.map((d) => ({ id: `skip:${d}`, kind: "plan_change" as const, label: `No school ${d}`, value: { skip: d } }));
      if (facts.length) {
        await confirmFacts(facts, "assistant");
        result = `Re-planned without ${days.join(", ")}`;
      } else result = "No school days to skip";
      break;
    }
    case "budget_alert": {
      const k = run ? await store.getKpis(runId) : null;
      result = k ? ((await checkBudget(store, h, runId, k)) ?? `$${(k.budgetKept.totalCents / 100).toFixed(2)} of $${(k.budgetKept.budgetCents / 100).toFixed(2)} · fine`) : "No cart this week yet";
      break;
    }
    default:
      return { ok: false, result: "Unknown routine" };
  }
  await markRun(store, h.id, id as RoutineId, result);
  return { ok: true, result };
}
