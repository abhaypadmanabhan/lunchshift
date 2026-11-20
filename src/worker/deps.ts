// Live wiring: every sponsor adapter behind its interface, each with a labelled fallback.
import { HOUSEHOLD, RECIPES } from "../lib/domain/fixture";
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
export const DEMO_RUN_ID = process.env.DEMO_RUN_ID ?? "run-2026-11-22";
export const DEMO_WEEK = "2026-11-22";

export function grocerClient() {
  return new GrocerClient(GROCER_URL, AGENT_TOKEN, 4000);
}
export function grocerOperator() {
  return new GrocerOperator(GROCER_URL, OPERATOR_TOKEN);
}

/** Idempotent: ensures the household record and recipe library exist in the app store. */
export async function ensureSeeded() {
  const store = await getStore();
  await store.init();
  await store.saveHousehold(HOUSEHOLD);
  await store.saveRecipes(RECIPES);
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
