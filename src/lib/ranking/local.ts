import type { RankQuery, RankResult, Ranker, Recipe } from "../domain/types";
import { buildRankInputs, defaultPriceBook, dot, toRanked, type PriceBook } from "./features";

/** In-process dot-product ranker; same math as the SingleStore ranker. */
export class LocalVectorRanker implements Ranker {
  constructor(private readonly prices: PriceBook = defaultPriceBook()) {}

  async rank(query: RankQuery, candidates: Recipe[]): Promise<RankResult> {
    const inputs = buildRankInputs(query, candidates, this.prices);
    const scores = candidates.map((r) => ({ id: r.id, score: dot(inputs.queryVector, inputs.vectors[r.id] ?? []) }));
    return { provider: "local_vector", query: query.text, ranked: toRanked(scores), inputs: { ...inputs } };
  }
}
