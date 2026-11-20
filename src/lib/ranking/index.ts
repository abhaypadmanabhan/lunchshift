// getRanker(): SIE if keyed, else SingleStore vector when the store is SingleStore, else local.
// Any throw or timeout falls through to the next ranker; fallbackReason says why.
import type { RankQuery, RankResult, Ranker, Recipe } from "../domain/types";
import { errorClass, getStore, SingleStoreStore } from "../store";
import { defaultPriceBook, type PriceBook } from "./features";
import { LocalVectorRanker } from "./local";
import { SieRanker } from "./sie";
import { SingleStoreVectorRanker } from "./singlestoreVector";

export { buildRankQuery } from "./features";

const RANK_TIMEOUT_MS = 10000;

/**
 * Two stages, per the design: SingleStore (or local) vector SQL builds the auditable shortlist from structured
 * features; SIE's small reranker model reorders that shortlist. If SIE fails, the vector shortlist stands.
 */
class TwoStageRanker implements Ranker {
  constructor(
    private readonly shortlist: Ranker,
    private readonly shortlistName: string,
    private readonly rerank: Ranker | null,
    private readonly skipped: string[],
  ) {}

  async rank(query: RankQuery, candidates: Recipe[]): Promise<RankResult> {
    const why = [...this.skipped];
    let stage1: RankResult;
    try {
      stage1 = await withTimeoutR(this.shortlist.rank(query, candidates));
    } catch (e) {
      why.push(`${this.shortlistName}: ${errorClass(e)}`);
      stage1 = await new LocalVectorRanker().rank(query, candidates);
    }
    const shortlist = { provider: stage1.provider, model: stage1.model, ranked: stage1.ranked };
    if (!this.rerank) return { ...stage1, inputs: { ...stage1.inputs, shortlist }, ...(why.length ? { fallbackReason: why.join("; ") } : {}) };
    const ids = new Set(stage1.ranked.slice(0, SHORTLIST_K).map((r) => r.id));
    try {
      const stage2 = await withTimeoutR(this.rerank.rank(query, candidates.filter((c) => ids.has(c.id))));
      return {
        ...stage2,
        inputs: { ...stage1.inputs, shortlist, rerank: stage2.inputs },
        ...(why.length ? { fallbackReason: why.join("; ") } : {}),
      };
    } catch (e) {
      why.push(`sie: ${errorClass(e)}`);
      return { ...stage1, inputs: { ...stage1.inputs, shortlist }, fallbackReason: why.join("; ") };
    }
  }
}

const SHORTLIST_K = 5;
const withTimeoutR = <T>(p: Promise<T>) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), RANK_TIMEOUT_MS))]);

export async function getRanker(prices: PriceBook = defaultPriceBook()): Promise<Ranker> {
  const skipped: string[] = [];
  const key = process.env.SIE_API_KEY;
  const rerank = key ? new SieRanker(key, process.env.SIE_BASE_URL || undefined) : null;
  if (!key) skipped.push("sie: SIE_API_KEY not set");
  const store = await getStore();
  if (store instanceof SingleStoreStore) {
    return new TwoStageRanker(new SingleStoreVectorRanker(() => store.getPool(), prices), "singlestore_vector", rerank, skipped);
  }
  skipped.push("singlestore_vector: store is sqlite");
  return new TwoStageRanker(new LocalVectorRanker(prices), "local_vector", rerank, skipped);
}
