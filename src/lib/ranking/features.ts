// Auditable feature vectors for the fallback rankers (SingleStore vector, local).
// Recipe vector = how well a recipe fits the CURRENT query context, one labelled dimension each.
// Query vector = fixed weights (0 when the dimension is not asked for). Score = dot product of
// two unit vectors (cosine). Every dimension is kept by name so the audit trail can show why.
import { CATALOG, RECIPES, USUAL_SKU_BY_ROLE } from "../domain/fixture";
import type { Household, PlannedLunch, RankedCandidate, RankQuery, Recipe } from "../domain/types";

export const FEATURE_DIMS = [
  "prep_fit",
  "price_fit",
  "pref_tag_match",
  "kid_favorite",
  "variety",
  "pantry_overlap",
] as const;
export type FeatureDim = (typeof FEATURE_DIMS)[number];
export const DIM_COUNT = FEATURE_DIMS.length;

/** Pack price in cents per ingredient role. */
export type PriceBook = Record<string, number>;

/** preferTags entries with this prefix are bases to avoid (variety), not tags to favour. */
export const AVOID_PREFIX = "avoid:";

/** Tags that name a lunch base; two lunches sharing one repeat the base. */
export const BASE_TAGS = ["sandwich", "tortilla", "pasta", "snack_box", "roll_up", "rice_bowl", "noodles"];

const QUERY_WEIGHTS: Record<FeatureDim, number> = {
  prep_fit: 0.5,
  price_fit: 0.5,
  pref_tag_match: 1,
  kid_favorite: 0.5,
  variety: 1,
  pantry_overlap: 0.5,
};
const PRICE_CAP_CENTS = 600; // marginal basket cost at which price_fit reaches 0
const UNKNOWN_PACK_CENTS = 300;

export function defaultPriceBook(): PriceBook {
  const byId = new Map(CATALOG.map((s) => [s.id, s.priceCents]));
  const book: PriceBook = {};
  for (const [role, skuId] of Object.entries(USUAL_SKU_BY_ROLE)) {
    const cents = byId.get(skuId);
    if (cents !== undefined) book[role] = cents;
  }
  return book;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const f32 = (n: number) => Math.fround(Number(n.toFixed(6)));

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  return v.map((x) => (norm === 0 ? 0 : f32(x / norm)));
}

const avoidTags = (q: RankQuery) =>
  q.preferTags.filter((t) => t.startsWith(AVOID_PREFIX)).map((t) => t.slice(AVOID_PREFIX.length));
const wantTags = (q: RankQuery) => q.preferTags.filter((t) => !t.startsWith(AVOID_PREFIX));

/** Raw (un-normalised) per-dimension fit in [0,1]. */
export function recipeFeatures(recipe: Recipe, query: RankQuery, prices: PriceBook): Record<FeatureDim, number> {
  const want = wantTags(query);
  const avoid = avoidTags(query);
  const roles = recipe.lines.map((l) => l.role);
  const pantry = new Set(query.pantryRoles);
  const marginal = roles.filter((r) => !pantry.has(r)).reduce((a, r) => a + (prices[r] ?? UNKNOWN_PACK_CENTS), 0);
  const bases = recipe.tags.filter((t) => BASE_TAGS.includes(t));
  const repeated = bases.filter((t) => avoid.includes(t)).length;
  return {
    prep_fit: recipe.prepMinutes > query.maxPrepMinutes ? 0 : clamp01(1 - (0.3 * recipe.prepMinutes) / query.maxPrepMinutes),
    price_fit: clamp01(1 - marginal / PRICE_CAP_CENTS),
    pref_tag_match: want.length === 0 ? 0 : want.filter((t) => recipe.tags.includes(t)).length / want.length,
    kid_favorite: recipe.tags.includes("kid_favorite") ? 1 : 0,
    variety: bases.length === 0 ? 1 : 1 - repeated / bases.length,
    pantry_overlap: roles.length === 0 ? 0 : roles.filter((r) => pantry.has(r)).length / roles.length,
  };
}

export function queryVector(query: RankQuery): number[] {
  const active: Record<FeatureDim, boolean> = {
    prep_fit: true,
    price_fit: true,
    pref_tag_match: wantTags(query).length > 0,
    kid_favorite: true,
    variety: avoidTags(query).length > 0,
    pantry_overlap: query.pantryRoles.length > 0,
  };
  return normalize(FEATURE_DIMS.map((d) => (active[d] ? QUERY_WEIGHTS[d] : 0)));
}

export const recipeVector = (recipe: Recipe, query: RankQuery, prices: PriceBook): number[] => {
  const f = recipeFeatures(recipe, query, prices);
  return normalize(FEATURE_DIMS.map((d) => f[d]));
};

export const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

export interface RankInputs {
  dims: readonly string[];
  queryVector: number[];
  vectors: Record<string, number[]>;
  /** Per candidate, per dimension: query weight x recipe value. Sums to the score. */
  contributions: Record<string, Record<string, number>>;
  maxPrepMinutes: number;
  preferTags: string[];
  pantryRoles: string[];
}

export function buildRankInputs(query: RankQuery, candidates: Recipe[], prices: PriceBook = defaultPriceBook()): RankInputs {
  const qv = queryVector(query);
  const vectors: Record<string, number[]> = {};
  const contributions: Record<string, Record<string, number>> = {};
  for (const r of candidates) {
    const v = recipeVector(r, query, prices);
    vectors[r.id] = v;
    contributions[r.id] = Object.fromEntries(FEATURE_DIMS.map((d, i) => [d, Number(((qv[i] ?? 0) * (v[i] ?? 0)).toFixed(4))]));
  }
  return {
    dims: FEATURE_DIMS,
    queryVector: qv,
    vectors,
    contributions,
    maxPrepMinutes: query.maxPrepMinutes,
    preferTags: query.preferTags,
    pantryRoles: query.pantryRoles,
  };
}

export function toRanked(scores: Array<{ id: string; score: number }>): RankedCandidate[] {
  return [...scores]
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .map((s, i) => ({ id: s.id, score: Number(s.score.toFixed(6)), rank: i + 1 }));
}

const KEYWORD_TAGS: Array<[RegExp, string]> = [
  [/rice\s*bowl/i, "rice_bowl"],
  [/noodle/i, "noodles"],
  [/pasta/i, "pasta"],
  [/quesadilla|tortilla/i, "tortilla"],
];

/** Builds the query from preference facts, the lunches that stay in the week, and basket roles.
 *  `plan` is the week's remaining lunches (the broken day removed); recipes resolve their tags. */
export function buildRankQuery(
  household: Household,
  plan: PlannedLunch[],
  basketRoles: string[],
  recipes: Recipe[] = RECIPES,
): RankQuery {
  const prefs = household.facts.filter((f) => f.kind === "preference" && f.active);
  const text = prefs.map((f) => f.text).join(" ");
  const preferTags = new Set<string>();
  for (const [re, tag] of KEYWORD_TAGS) if (re.test(text)) preferTags.add(tag);
  const prep = /under\s+(\d+)\s*min/i.exec(text);
  if (/repeat|same lunch base|variety/i.test(text)) {
    const byId = new Map(recipes.map((r) => [r.id, r]));
    for (const p of plan) for (const t of byId.get(p.recipeId)?.tags ?? []) if (BASE_TAGS.includes(t)) preferTags.add(AVOID_PREFIX + t);
  }
  // A base the parent asked for is never also avoided.
  for (const t of [...preferTags]) if (!t.startsWith(AVOID_PREFIX)) preferTags.delete(AVOID_PREFIX + t);
  return {
    text,
    maxPrepMinutes: prep ? Number(prep[1]) : 20,
    preferTags: [...preferTags],
    pantryRoles: [...new Set(basketRoles)],
  };
}
