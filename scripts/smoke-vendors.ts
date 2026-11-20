// Vendor smoke checks. Prints results only, never headers or key values.
// Usage: npx tsx --env-file=<path to dotenv> scripts/smoke-vendors.ts seed|recall|statsig|llm
// Run without --env-file to see each adapter's labelled fallback.
import { HOUSEHOLD, RECIPES } from "@/lib/domain/fixture";
import type { RankResult } from "@/lib/domain/types";
import { getAnalytics, getAutonomy, StatsigAnalytics } from "@/lib/autonomy";
import { AnthropicExplainer, getExplainer } from "@/lib/llm";
import { CogneeMemory, extractFactMarkers, getMemory } from "@/lib/memory";

const RECALL_QUERY = "Who eats these lunches and which products must the household refuse?";

async function seed() {
  const mem = getMemory();
  const t0 = Date.now();
  const res = await mem.seed(HOUSEHOLD);
  console.log(`provider=${mem instanceof CogneeMemory ? "cognee" : "fallback"} ok=${res.ok} datasetId=${res.datasetId ?? "-"} ms=${Date.now() - t0}`);
  if (res.error) console.log(`error=${res.error}`);
}

async function recall() {
  const mem = getMemory();
  const t0 = Date.now();
  const r = await mem.recall(HOUSEHOLD.id, RECALL_QUERY);
  console.log(`provider=${r.provider} datasetId=${r.datasetId ?? "-"} totalMs=${Date.now() - t0}`);
  if (mem instanceof CogneeMemory) for (const t of mem.lastTimings) console.log(`search ${t.searchType} ok=${t.ok} ms=${t.ms}`);
  console.log(`factIds=${r.factIds.join(",") || "-"}`);
  console.log(`markers=${extractFactMarkers(r.snippets).map((m) => `${m.id} r${m.revision}`).join(", ") || "-"}`);
  const withPeanut = r.snippets.find((s) => s.includes("[fact-allergy-peanut")) ?? r.snippets[0];
  console.log(`snippets=${r.snippets.length} sample=${JSON.stringify(withPeanut?.slice(0, 300) ?? "")}`);
  if (r.error) console.log(`error=${r.error}`);
}

async function statsig() {
  const reading = await getAutonomy().read(HOUSEHOLD.id);
  console.log(`mode=${reading.mode} source=${reading.source} ruleId=${reading.ruleId ?? "-"} fetchedAt=${reading.fetchedAt}`);
  if (reading.error) console.log(`error=${reading.error}`);
  const analytics = getAnalytics();
  const ev = { eventName: "lunchshift_smoke", value: 1, metadata: { runId: "smoke", observedMode: reading.mode } };
  const res = analytics instanceof StatsigAnalytics ? await analytics.logRaw(HOUSEHOLD.id, [ev]) : await analytics.log(HOUSEHOLD.id, []);
  console.log(`event=lunchshift_smoke ok=${res.ok}${res.error ? ` error=${res.error}` : ""}`);
}

async function llm() {
  const byId = new Map(RECIPES.map((r) => [r.id, r]));
  const eligible = ["r-rice-bean-bowl", "r-bean-quesadilla"].map((id) => byId.get(id)!);
  const ranking: RankResult = {
    provider: "local_vector",
    query: "rice bowl, under 20 minutes, reuse pantry",
    ranked: [
      { id: "r-rice-bean-bowl", score: 0.82, rank: 1 },
      { id: "r-bean-quesadilla", score: 0.71, rank: 2 },
    ],
    inputs: {},
  };
  const explainer = getExplainer();
  const t0 = Date.now();
  const out = await explainer.explain({
    affectedDay: "Mon",
    fromRecipe: byId.get("r-sunbutter-sandwich")!,
    eligible,
    ranking,
    refusals: [],
    preferenceFacts: HOUSEHOLD.facts.filter((f) => f.kind === "preference"),
  });
  console.log(`provider=${out.provider} choiceId=${out.choiceId} ms=${Date.now() - t0}`);
  console.log(`rationale=${out.rationale}`);
  if (explainer instanceof AnthropicExplainer && explainer.lastError) console.log(`fallbackReason=${explainer.lastError}`);
}

const cmds: Record<string, () => Promise<void>> = { seed, recall, statsig, llm };
const cmd = process.argv[2] ?? "";
if (!cmds[cmd]) {
  console.log(`usage: smoke-vendors.ts ${Object.keys(cmds).join("|")}`);
  process.exit(1);
}
cmds[cmd]().catch((e: unknown) => {
  console.log(`unexpected throw: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
