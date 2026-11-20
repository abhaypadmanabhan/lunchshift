// npm run smoke:sie-classify - try SIE task models on the fixture's exact-SKU label lines.
import { CATALOG } from "../src/lib/domain/fixture";

const key = process.env.SIE_API_KEY;
const base = (process.env.SIE_BASE_URL || "https://api.superlinked.com").replace(/\/$/, "");
const LABELS = ["contains peanuts", "may contain peanuts or shared equipment with peanuts", "peanut-free", "no allergen information"];

async function call(model: string, params: Record<string, unknown>) {
  const items = CATALOG.filter((s) => ["bread", "seed_butter", "peanut_sauce", "rice"].includes(s.role)).map((s) => ({ id: s.id, text: s.label.sourceText }));
  const t0 = Date.now();
  const r = await fetch(`${base}/v1/extract/${encodeURIComponent(model)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ items, params }),
    signal: AbortSignal.timeout(20000),
  });
  console.log(`\n${model} HTTP ${r.status} ${Date.now() - t0} ms`);
  const b = (await r.json()) as { items?: Array<Record<string, unknown>> };
  if (!b.items) return console.log(JSON.stringify(b).slice(0, 400));
  for (const it of b.items) {
    const cls = (it.classifications as Array<{ label: string; score: number }> | undefined)?.slice(0, 2).map((c) => `${c.label}=${c.score.toFixed(3)}`);
    const ents = (it.entities as Array<{ text: string; label: string; score: number }> | undefined)?.map((e) => `${e.label}:"${e.text}"=${e.score.toFixed(2)}`);
    console.log(" ", String(it.id).padEnd(20), cls?.join(" ") ?? "", ents?.join(" ") ?? "");
  }
}

async function main() {
  await call("MoritzLaurer/deberta-v3-large-zeroshot-v2.0", { labels: LABELS });
  await call("fastino/gliner2-base-v1", { labels: ["peanut allergen", "cross-contact warning"] });
}
main().catch((e) => {
  console.error("FAIL", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
