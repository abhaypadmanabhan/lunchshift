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
  { id: "milk", label: "Milk / dairy", terms: ["milk", "dairy", "lactose", "cheese", "whey", "casein", "cream", "butter", "yogurt", "yoghurt"] },
  { id: "egg", label: "Eggs", terms: ["egg", "eggs", "albumin", "mayonnaise"] },
  { id: "wheat", label: "Wheat / gluten", terms: ["wheat", "gluten", "flour", "spelt", "semolina", "durum"] },
  { id: "soy", label: "Soy", terms: ["soy", "soya", "soybean", "soybeans", "tofu", "edamame"] },
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
  const lower = ` ${text.toLowerCase()} `;
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
    const cross = /(may contain|traces? of|shared (?:equipment|facility|line)|processes|processed in|manufactured in|made in a facility|made on)/.test(s);
    const containsClause = /\bcontains?\b/.test(s) && !/may contain/.test(s);
    for (const def of MAJOR_ALLERGENS) {
      if (!def.terms.some((term) => wordRe(term).test(s))) continue;
      if (cross) out.mayContain.add(def.id);
      else out.contains.add(def.id); // a "Contains:" clause or a bare mention both count as contains
      void containsClause;
    }
  }
  for (const id of out.contains) out.mayContain.delete(id);
  return out;
}

/** Every allergen tag a SKU carries: printed warnings, parsed label, and custom-term matches on label or product name. */
export function skuAllergenTags(
  sku: { name: string; label: { sourceText: string; allergenWarnings?: string[] } },
  customTerms: { id: string; terms: string[] }[] = [],
): Set<string> {
  const tags = new Set<string>(Array.isArray(sku.label.allergenWarnings) ? sku.label.allergenWarnings : []);
  const parsed = parseLabel(sku.label.sourceText ?? "");
  for (const id of parsed.contains) tags.add(id);
  for (const id of parsed.mayContain) tags.add(`${id}_cross_contact`);
  const hay = ` ${norm(`${sku.name} ${sku.label.sourceText ?? ""}`)} `;
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
