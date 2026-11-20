// getRanker(): SIE if keyed, else SingleStore vector when the store is SingleStore, else local.
// Any throw or timeout falls through to the next ranker; fallbackReason says why.
import type { RankQuery, RankResult, Ranker, Recipe } from "../domain/types";
import { getStore, SingleStoreStore } from "../store";
import { defaultPriceBook, type PriceBook } from "./features";
import { LocalVectorRanker } from "./local";
import { SieRanker } from "./sie";
import { SingleStoreVectorRanker } from "./singlestoreVector";

export { buildRankQuery } from "./features";

const RANK_TIMEOUT_MS = 10000;

interface Step { name: string; ranker: Ranker }

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 120);

class ChainRanker implements Ranker {
  constructor(private readonly steps: Step[], private readonly skipped: string[]) {}

  async rank(query: RankQuery, candidates: Recipe[]): Promise<RankResult> {
    const why = [...this.skipped];
    for (const step of this.steps) {
      try {
        const result = await Promise.race([
          step.ranker.rank(query, candidates),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), RANK_TIMEOUT_MS)),
        ]);
        return why.length ? { ...result, fallbackReason: why.join("; ") } : result;
      } catch (e) {
        why.push(`${step.name}: ${msg(e)}`);
      }
    }
    throw new Error(`no ranker available (${why.join("; ")})`); // unreachable: local never throws
  }
}

export async function getRanker(prices: PriceBook = defaultPriceBook()): Promise<Ranker> {
  const steps: Step[] = [];
  const skipped: string[] = [];
  const key = process.env.SIE_API_KEY;
  if (key) steps.push({ name: "sie", ranker: new SieRanker(key, process.env.SIE_BASE_URL || undefined) });
  else skipped.push("sie: SIE_API_KEY not set");

  const store = await getStore();
  if (store instanceof SingleStoreStore) {
    steps.push({ name: "singlestore_vector", ranker: new SingleStoreVectorRanker(() => store.getPool(), prices) });
  } else skipped.push("singlestore_vector: store is sqlite");

  steps.push({ name: "local_vector", ranker: new LocalVectorRanker(prices) });
  return new ChainRanker(steps, skipped);
}
