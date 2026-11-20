// Ranks with SingleStore: recipe vectors go into a VECTOR(n, F32) column, scores come from SQL dot product (<*>).
import { createHash } from "node:crypto";
import type { Pool } from "mysql2/promise";
import type { RankQuery, RankResult, Ranker, Recipe } from "../domain/types";
import { buildRankInputs, defaultPriceBook, DIM_COUNT, toRanked, type PriceBook } from "./features";

const TABLE = "ls_rank_vec";
const asVec = (v: number[]) => `[${v.join(",")}]`;

export class SingleStoreVectorRanker implements Ranker {
  private ready = false;
  constructor(
    private readonly getPool: () => Promise<Pool>,
    private readonly prices: PriceBook = defaultPriceBook(),
  ) {}

  private async ensureTable(pool: Pool) {
    if (this.ready) return;
    // Vectors are contextual (they depend on the query), so rows are keyed by a hash of the query.
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${TABLE} (qkey VARCHAR(32) NOT NULL, recipe_id VARCHAR(64) NOT NULL,
         vec VECTOR(${DIM_COUNT}, F32) NOT NULL, PRIMARY KEY (qkey, recipe_id), SHARD KEY (qkey))`,
    );
    this.ready = true;
  }

  async rank(query: RankQuery, candidates: Recipe[]): Promise<RankResult> {
    if (candidates.length === 0) throw new Error("no candidates to rank");
    const inputs = buildRankInputs(query, candidates, this.prices);
    const pool = await this.getPool();
    await this.ensureTable(pool);
    const qkey = createHash("sha256").update(JSON.stringify(query)).digest("hex").slice(0, 32);
    for (const r of candidates) {
      await pool.query(
        `INSERT INTO ${TABLE} (qkey, recipe_id, vec) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE vec = VALUES(vec)`,
        [qkey, r.id, asVec(inputs.vectors[r.id] ?? [])],
      );
    }
    const ids = candidates.map((r) => r.id);
    const [rows] = await pool.query(
      `SELECT recipe_id, vec <*> (? :> VECTOR(${DIM_COUNT}, F32)) AS score
         FROM ${TABLE} WHERE qkey = ? AND recipe_id IN (?) ORDER BY score DESC`,
      [asVec(inputs.queryVector), qkey, ids],
    );
    const scored = (rows as Array<{ recipe_id: string; score: number | string }>).map((r) => ({
      id: r.recipe_id,
      score: Number(r.score),
    }));
    if (scored.length !== ids.length || scored.some((s) => Number.isNaN(s.score))) {
      throw new Error(`singlestore returned ${scored.length}/${ids.length} usable scores`);
    }
    return {
      provider: "singlestore_vector",
      model: `VECTOR(${DIM_COUNT}, F32) dot product (<*>)`,
      query: query.text,
      ranked: toRanked(scored),
      inputs: { ...inputs, qkey },
    };
  }
}
