// Any-allergy support. Canonical ids for the nine major US allergens plus free-text custom allergens.
// Deterministic: normalization and label parsing never call a model. "x_cross_contact" marks a may-contain warning.

export interface AllergenDef {
  id: string;
  label: string;
  /** Words that mean this allergen in a parent's input or on a label ("dairy", "whey", "almond"). */
  terms: string[];
}

export const MAJOR_ALLERGENS: AllergenDef[] = [
  { id: "peanut", label: "Peanuts", terms: ["peanut", "peanuts", "groundnut", "groundnuts", "arachis"] },
  {
    id: "tree_nut",
    label: "Tree nuts",
    terms: ["tree nut", "tree nuts", "tree-nut", "tree-nuts", "nuts", "almond", "almonds", "cashew", "cashews", "walnut", "walnuts", "pecan", "pecans", "hazelnut", "hazelnuts", "pistachio", "pistachios", "macadamia", "brazil nut", "pine nut", "pine nuts"],
  },
  {
    id: "milk",
    label: "Milk / dairy",
    terms: ["milk", "dairy", "lactose", "cheese", "whey", "casein", "caseinate", "cream", "butter", "buttermilk", "ghee", "lactalbumin", "yogurt", "yoghurt", "milk solids"],
  },
  { id: "egg", label: "Eggs", terms: ["egg", "eggs", "egg white", "egg yolk", "albumin", "albumen", "ovalbumin", "meringue", "mayonnaise"] },
  { id: "wheat", label: "Wheat / gluten", terms: ["wheat", "gluten", "flour", "spelt", "semolina", "durum", "farina", "bulgur", "couscous", "seitan"] },
  { id: "soy", label: "Soy", terms: ["soy", "soya", "soybean", "soybeans", "tofu", "edamame", "soy lecithin"] },
  { id: "sesame", label: "Sesame", terms: ["sesame", "tahini"] },
  { id: "fish", label: "Fish", terms: ["fish", "salmon", "tuna", "cod", "anchovy", "anchovies", "tilapia"] },
  { id: "shellfish", label: "Shellfish", terms: ["shellfish", "shrimp", "prawn", "prawns", "crab", "lobster", "crustacean", "crustaceans"] },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (term: string) => new RegExp(`(^|[^a-z])${escapeRe(term)}([^a-z]|$)`);

export interface NormalizedAllergy {
  input: string;
  id: string; // canonical id or "custom:<slug>"
  label: string;
  terms: string[];
  custom: boolean;
}

/** "Dairy" -> milk; "tree nuts" -> tree_nut; "kiwi" -> custom:kiwi. "nuts" alone means tree nuts (peanut is separate). */
export function normalizeAllergy(input: string): NormalizedAllergy | null {
  const t = norm(input).replace(/\b(allergy|allergic|to|intolerance|intolerant|free|no|avoid)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  // Longest matching term wins ("peanut butter" is peanut, not milk).
  let best: { def: AllergenDef; len: number } | null = null;
  for (const def of MAJOR_ALLERGENS) {
    for (const term of def.terms) {
      if (wordRe(term).test(t) && (!best || term.length > best.len)) best = { def, len: term.length };
    }
  }
  if (best) return { input, id: best.def.id, label: best.def.label, terms: best.def.terms, custom: false };
  const singular = t.endsWith("ies") ? `${t.slice(0, -3)}y` : t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t;
  const esForm = /(ches|shes|xes|oes)$/.test(t) ? t.slice(0, -2) : singular;
  const plural = singular.endsWith("y") ? `${singular.slice(0, -1)}ies` : `${singular}s`;
  const terms = [...new Set([t, singular, esForm, plural])].filter((x) => x.length >= 3);
  if (!terms.length) return null;
  const slug = singular.replace(/\s+/g, "-");
  return { input, id: `custom:${slug}`, label: t.replace(/\b\w/g, (c) => c.toUpperCase()), terms, custom: true };
}

const NOT_WHAT_IT_SEEMS: [RegExp, string][] = [
  [/sunflower(?: seed)? butter/g, "sunflower spread"],
  [/sun ?butter/g, "sunflower spread"],
  [/cocoa butter/g, "cocoa fat"],
  [/shea butter/g, "shea fat"],
  [/apple butter/g, "apple spread"],
  [/peanut butter/g, "peanuts"],
  [/(almond|cashew|pecan|walnut|hazelnut|pistachio) butter/g, "$1"],
  [/coconut (milk|cream)/g, "coconut"],
  [/(rice|oat|almond|cashew|hemp) milk/g, "$1 drink"],
  [/soy ?milk/g, "soy drink"],
  [/cream of tartar/g, "tartaric salt"],
  [/(rice|corn|potato|tapioca|chickpea|coconut|sorghum|cassava|millet|quinoa|teff|banana|arrowroot) flour/g, "$1 starch"],
  [/cornflour/g, "corn starch"],
  [/buckwheat/g, "buck grain"],
  [/peanut[- ]free and tree[- ]nut[- ]free/g, "peanut-free, tree-nut-free"],
];

function demask(text: string): string {
  let t = ` ${text.toLowerCase()} `;
  for (const [re, to] of NOT_WHAT_IT_SEEMS) t = t.replace(re, to);
  return t;
}

/** Open Food Facts tags -> app ids. Allergens are "contains"; traces are "may contain". */
const OFF_TAG: Record<string, string> = {
  "en:peanuts": "peanut",
  "en:nuts": "tree_nut",
  "en:milk": "milk",
  "en:eggs": "egg",
  "en:gluten": "wheat",
  "en:soybeans": "soy",
  "en:sesame-seeds": "sesame",
  "en:fish": "fish",
  "en:crustaceans": "shellfish",
  "en:molluscs": "shellfish",
};
export function offTagsToIds(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((t) => OFF_TAG[t]).filter((x): x is string => Boolean(x)))];
}

export interface ParsedLabel {
  contains: Set<string>;
  mayContain: Set<string>;
  freeOf: Set<string>;
}

/**
 * Parse an exact-SKU label line for the nine major allergens.
 *   "Contains: wheat, soy. May contain peanuts. Made on shared equipment that processes peanuts."
 *   "Made in a peanut-free and tree-nut-free facility." -> freeOf
 */
export function parseLabel(text: string): ParsedLabel {
  const out: ParsedLabel = { contains: new Set(), mayContain: new Set(), freeOf: new Set() };
  const lower = demask(text);
  // "X-free" / "free of X" first, and blank them out so they don't count as mentions.
  let rest = lower;
  for (const def of MAJOR_ALLERGENS) {
    for (const term of def.terms) {
      const freeRe = new RegExp(`${escapeRe(term)}[- ]free|free (?:of|from) ${escapeRe(term)}`, "g");
      if (freeRe.test(rest)) {
        out.freeOf.add(def.id);
        rest = rest.replace(freeRe, " ");
      }
    }
  }
  const sentences = rest.split(/[.;]/);
  for (const s of sentences) {
    const cross = /(may contain|traces? of|shared (?:equipment|facility|line)|processes|processed (?:in|on)|manufactured (?:in|on)|made in a facility|made on|also handles|handles|same facility|produced in a facility|packed in a facility)/.test(s);
    const containsClause = /\bcontains?\b/.test(s) && !/may contain/.test(s);
    for (const def of MAJOR_ALLERGENS) {
      if (!def.terms.some((term) => wordRe(term).test(s))) continue;
      if (cross) out.mayContain.add(def.id);
      // An explicit "Contains:" clause always counts. A bare mention counts unless the label says "X-free".
      else if (containsClause || !out.freeOf.has(def.id)) out.contains.add(def.id);
    }
  }
  for (const id of out.contains) out.mayContain.delete(id);
  return out;
}

/** Every allergen tag a SKU carries: printed warnings, parsed label, and custom-term matches on label or product name. */
export function skuAllergenTags(
  sku: { name: string; label: { sourceText: string; allergenWarnings?: string[] }; allergenTags?: string[]; traceTags?: string[] },
  customTerms: { id: string; terms: string[] }[] = [],
): Set<string> {
  const tags = new Set<string>(Array.isArray(sku.label.allergenWarnings) ? sku.label.allergenWarnings : []);
  for (const id of offTagsToIds(sku.allergenTags)) tags.add(id);
  for (const id of offTagsToIds(sku.traceTags)) tags.add(`${id}_cross_contact`);
  const parsed = parseLabel(sku.label.sourceText ?? "");
  for (const id of parsed.contains) tags.add(id);
  for (const id of parsed.mayContain) tags.add(`${id}_cross_contact`);
  const hay = ` ${norm(demask(`${sku.name} ${sku.label.sourceText ?? ""}`))} `;
  for (const c of customTerms) {
    const hit = c.terms.some((t) => wordRe(norm(t)).test(hay) && !new RegExp(`${escapeRe(norm(t))}[- ]free`).test(hay));
    if (hit) tags.add(c.id);
  }
  return tags;
}

/** The tags a hard restriction blocks: the allergen itself, plus its may-contain warning when cross-contact is on. */
export function blockedTags(a: { id: string; crossContact: boolean }): string[] {
  return a.crossContact ? [a.id, `${a.id}_cross_contact`] : [a.id];
}

/**
 * Two independent readings of one product disagree about an allergen this household cares about: the OFF tags
 * say one thing and the ingredient text another. Returns the allergen ids in dispute (the item is then blocked).
 */
export function evidenceConflicts(
  sku: { label: { sourceText: string }; allergenTags?: string[]; traceTags?: string[] },
  householdAllergens: string[],
): string[] {
  if (!sku.allergenTags && !sku.traceTags) return [];
  const parsed = parseLabel(sku.label.sourceText ?? "");
  const off = new Set([...offTagsToIds(sku.allergenTags), ...offTagsToIds(sku.traceTags)]);
  const text = new Set([...parsed.contains, ...parsed.mayContain]);
  // Disputed: exactly one source mentions the allergen (a "free of X" statement counts as the text saying no).
  return householdAllergens.filter((a) => !a.startsWith("custom:") && off.has(a) !== text.has(a));
}
