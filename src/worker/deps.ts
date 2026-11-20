// Live wiring: every sponsor adapter behind its interface, each with a labelled fallback.
import { HOUSEHOLD, RECIPES } from "../lib/domain/fixture";
import { currentRunId, WEEK_OF } from "../lib/domain/household";
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
export const DEMO_WEEK = WEEK_OF;

/** This week's run id for the household as it is now (a rules change starts a fresh run). */
export async function runIdNow(store: AppStore): Promise<string> {
  const h = (await store.getHousehold(HOUSEHOLD.id)) ?? HOUSEHOLD;
  return currentRunId(h);
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
    if (!(await store.getHousehold(HOUSEHOLD.id))) await store.saveHousehold(HOUSEHOLD);
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
