// npm run smoke:sie [models|score|rank] - live Superlinked SIE check. Prints model ids, shapes and scores; never the key.
import { HOUSEHOLD, RECIPES } from "../src/lib/domain/fixture";
import { buildRankQuery } from "../src/lib/ranking/features";
import { SieRanker } from "../src/lib/ranking/sie";

const key = process.env.SIE_API_KEY;
const base = (process.env.SIE_BASE_URL || "https://api.superlinked.com").replace(/\/$/, "");
const auth = { authorization: `Bearer ${key}` };

async function main() {
  if (!key) throw new Error("SIE_API_KEY not set");
  const cmd = process.argv[2] ?? "models";
  if (cmd === "models") {
    const r = await fetch(`${base}/v1/models`, { headers: auth, signal: AbortSignal.timeout(10000) });
    console.log("models HTTP", r.status);
    const b = (await r.json()) as unknown;
    const list = (Array.isArray(b) ? b : ((b as Record<string, unknown>).data ?? (b as Record<string, unknown>).models ?? [])) as Array<Record<string, unknown>>;
    console.log("count", list.length, "keys", Object.keys(list[0] ?? {}).join(","));
    for (const m of list) {
      const id = String(m.id ?? m.name ?? "");
      const task = JSON.stringify(m.tasks ?? m.task ?? m.type ?? "");
      if (/rerank|classif|nli|zero|gliner|extract|score/i.test(id + task)) console.log(" ", id, task);
    }
    return;
  }
  const plan = HOUSEHOLD.plan.filter((p) => p.day !== "Mon");
  const q = buildRankQuery(HOUSEHOLD, plan, ["apple", "tortilla", "cheddar"], RECIPES);
  const cands = RECIPES.filter((r) => r.id === "r-rice-bean-bowl" || r.id === "r-bean-quesadilla");
  if (cmd === "score") {
    const t0 = Date.now();
    const r = await fetch(`${base}/v1/score/${encodeURIComponent("Qwen/Qwen3-Reranker-0.6B")}`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ query: { text: q.text }, items: cands.map((c) => ({ id: c.id, text: `${c.name}. ${c.description}` })) }),
      signal: AbortSignal.timeout(15000),
    });
    console.log("score HTTP", r.status, `${Date.now() - t0} ms`);
    console.log(JSON.stringify(await r.json()).slice(0, 600));
    return;
  }
  if (cmd === "newfamily") {
    // A chat-built family: only dislikes, no positive preference. Its scores must still separate the lunches.
    const pool = RECIPES.filter((r) => ["r-veggie-pasta", "r-rice-bean-bowl", "r-turkey-rice-box", "r-bean-quesadilla"].includes(r.id));
    const text = "Whole school lunch for Noah and Ivy. Noah dislikes mushrooms. Ivy dislikes mushrooms. Week already has: r-turkey-pita, r-pasta-salad.";
    const res = await new SieRanker(key, base).rank({ text, maxPrepMinutes: 20, preferTags: [], pantryRoles: [] }, pool);
    console.log("newfamily via SieRanker", res.ranked.map((x) => `${x.id}=${x.score.toFixed(4)}`).join(" "));
    return;
  }
  const t0 = Date.now();
  const res = await new SieRanker(key, base).rank(q, cands);
  console.log("rank via SieRanker", `${Date.now() - t0} ms`, res.model, res.ranked.map((x) => `${x.id}=${x.score.toFixed(4)}`).join(" "));
}

main().catch((e) => {
  console.error("FAIL", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
