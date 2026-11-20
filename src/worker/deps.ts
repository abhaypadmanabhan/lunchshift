// Live wiring: every sponsor adapter behind its interface, each with a labelled fallback.
import { HOUSEHOLD, RECIPES } from "../lib/domain/fixture";
import { currentRunId } from "../lib/domain/household";
import { activeHouseholdId, currentWeekOf, PRESETS } from "../lib/domain/families";
import type { Household } from "../lib/domain/types";
import type { AppStore } from "../lib/domain/types";
import { getAnalytics, getAutonomy } from "../lib/autonomy";
import { getExplainer } from "../lib/llm";
import { getMemory } from "../lib/memory";
import { buildRankQuery, getRanker } from "../lib/ranking";
import { getStore } from "../lib/store";
import { getAllergenScreen } from "../lib/allergen";
import { AGENT_TOKEN, OPERATOR_TOKEN } from "../grocer/server";
import { GrocerClient, GrocerOperator } from "../grocer/client";
import type { WorkerDeps } from "./runWeekly";

export const GROCER_URL = process.env.GROCER_URL ?? "http://127.0.0.1:4100";
/** The family the parent app is showing (Maya, Leo, Ava or a new one). */
export async function activeHousehold(store: AppStore): Promise<Household> {
  const id = activeHouseholdId();
  return (await store.getHousehold(id)) ?? PRESETS.find((p) => p.id === id) ?? HOUSEHOLD;
}

/** This week's run id for the household as it is now (a rules change starts a fresh run). */
export async function runIdNow(store: AppStore): Promise<string> {
  const h = await activeHousehold(store);
  return currentRunId(h, currentWeekOf());
}

export function grocerClient() {
  return new GrocerClient(GROCER_URL, AGENT_TOKEN, 4000);
}
export function grocerOperator() {
  return new GrocerOperator(GROCER_URL, OPERATOR_TOKEN);
}

/** Idempotent: ensures the household record and recipe library exist. Never overwrites the parent's edits. */
let seeded = false;
export async function ensureSeeded() {
  const store = await getStore();
  if (!seeded) {
    await store.init();
    for (const p of PRESETS) if (!(await store.getHousehold(p.id))) await store.saveHousehold(p);
    await store.saveRecipes(RECIPES);
    seeded = true;
  }
  return store;
}

export async function liveDeps(): Promise<WorkerDeps> {
  const store = await ensureSeeded();
  return {
    store,
    grocer: grocerClient(),
    memory: getMemory(),
    autonomy: getAutonomy(),
    analytics: getAnalytics(),
    ranker: await getRanker(),
    explainer: getExplainer(),
    allergenScreen: getAllergenScreen(),
    buildRankQuery: (h, keptPlan, roles) => buildRankQuery(h, keptPlan, roles, RECIPES),
  };
}
