// Superlinked SIE reranker. Used only when SIE_API_KEY is set; any failure throws so the chain falls back.
// Verified live 2026-11-20: POST /v1/score/{model} -> {model, scores:[{item_id, score, rank}], usage}.
import type { RankQuery, RankResult, Ranker, Recipe } from "../domain/types";
import { toRanked } from "./features";

const MODEL = "Qwen/Qwen3-Reranker-0.6B";
const TIMEOUT_MS = 8000;

const itemText = (r: Recipe) => `${r.name}. ${r.description} Tags: ${r.tags.join(", ")}.`;

/** Accepts {items|results|scores: [{id, score}]} and rejects anything else. */
function parseScores(body: unknown, ids: string[]): Array<{ id: string; score: number }> {
  const b = body as Record<string, unknown> | null;
  const list = b && [b.items, b.results, b.scores, b.data].find(Array.isArray);
  if (!Array.isArray(list)) throw new Error("SIE response has no scores array");
  const out = list.map((x: unknown, i) => {
    // Live SIE returns {item_id, score, rank} sorted by rank; never map by position when an id is present.
    const o = x as { id?: unknown; item_id?: unknown; score?: unknown };
    const id = typeof o.item_id === "string" ? o.item_id : typeof o.id === "string" ? o.id : (ids[i] ?? "");
    return { id, score: Number(o.score) };
  });
  if (out.length !== ids.length || out.some((s) => !ids.includes(s.id) || Number.isNaN(s.score))) {
    throw new Error("SIE response does not match the candidates");
  }
  return out;
}

/** The reranker scores "is this item relevant to the query". A chat-built family often has only dislikes and recipe ids,
 * which scores every lunch near 0 (and an empty query is HTTP 400), so the query always states what a good item is. */
export function sieQueryText(familyText: string): string {
  const family = familyText.replace(/Week already has:[^.]*\./, "").trim();
  return `A complete, kid-friendly school lunch that is quick to pack. ${family}`.trim();
}

export class SieRanker implements Ranker {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.superlinked.com",
  ) {}

  async rank(query: RankQuery, candidates: Recipe[]): Promise<RankResult> {
    const items = candidates.map((r) => ({ id: r.id, text: itemText(r) }));
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/score/${encodeURIComponent(MODEL)}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ query: { text: sieQueryText(query.text) }, items }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`SIE HTTP ${res.status}`);
    const scores = parseScores(await res.json(), candidates.map((c) => c.id));
    return {
      provider: "sie",
      model: MODEL,
      query: query.text,
      ranked: toRanked(scores),
      inputs: { queryText: query.text, items },
    };
  }
}
