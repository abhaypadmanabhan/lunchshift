// Deterministic hard rules. The only code allowed to decide eligibility.
import { blockedTags, skuAllergenTags } from "./allergens";
import type {
  Basket,
  BasketLine,
  CandidateDecision,
  Household,
  HouseholdFact,
  Recipe,
  RejectReason,
  Sku,
} from "./types";

export function hardRestrictions(h: Household): HouseholdFact[] {
  return h.facts.filter((f) => f.kind === "hard_restriction" && f.active);
}

/** Tags a fact blocks: from its normalized allergen when present, else its explicit list. */
export function factBlocks(f: HouseholdFact): string[] {
  return f.allergen ? blockedTags(f.allergen) : (f.blocksAllergens ?? []);
}

function blockingFact(h: Household, tags: Iterable<string>): HouseholdFact | undefined {
  const set = new Set(tags);
  return hardRestrictions(h).find((f) => factBlocks(f).some((a) => set.has(a)));
}

/** Custom (free-text) allergens the household declared, for name/label term matching. */
export function customTerms(h: Household): { id: string; terms: string[] }[] {
  return hardRestrictions(h)
    .filter((f) => f.allergen?.id.startsWith("custom:"))
    .map((f) => ({ id: f.allergen!.id, terms: f.allergen!.terms }));
}

/** Every allergen tag on this exact SKU (printed warnings + parsed label + custom-term matches). */
export function tagsFor(h: Household, sku: Sku): Set<string> {
  return skuAllergenTags({ name: sku.name, label: sku.label ?? { sourceText: "" } }, customTerms(h));
}

/** Exact-SKU check: label evidence, allergen warnings, stock. */
export function checkSku(h: Household, sku: Sku, packsNeeded: number): CandidateDecision {
  const reasons: RejectReason[] = [];
  const restricted = hardRestrictions(h).length > 0;
  // Only an explicit "confirmed" counts as evidence. Anything else (missing, empty, unknown) blocks
  // whenever the household has any hard restriction to clear.
  if (restricted && sku.label?.evidence === "conflicting") reasons.push("conflicting_label_evidence");
  else if (restricted && sku.label?.evidence !== "confirmed") reasons.push("missing_label_evidence");
  let fact = blockingFact(h, tagsFor(h, sku));
  if (fact) reasons.push("allergen_warning");
  if (sku.stock < packsNeeded) reasons.push("out_of_stock");
  // Missing evidence is never treated as "safe": cite the hard restriction it could not clear.
  if (!fact && reasons.some((r) => r === "missing_label_evidence" || r === "conflicting_label_evidence")) {
    fact = hardRestrictions(h)[0];
  }
  return {
    candidateId: sku.id,
    kind: "sku_substitute",
    eligible: reasons.length === 0,
    reasons,
    factId: fact?.id,
    factText: fact?.text,
    factRevision: fact?.revision,
    labelVersion: sku.label?.version,
    labelText: sku.label?.sourceText,
    priceCents: sku.priceCents,
  };
}

/** Units needed per role across a set of lunches. */
export function roleNeeds(recipes: Recipe[]): Map<string, { qty: number; recipeIds: string[] }> {
  const needs = new Map<string, { qty: number; recipeIds: string[] }>();
  for (const r of recipes) {
    for (const l of r.lines) {
      const cur = needs.get(l.role) ?? { qty: 0, recipeIds: [] };
      cur.qty += l.qty;
      if (!cur.recipeIds.includes(r.id)) cur.recipeIds.push(r.id);
      needs.set(l.role, cur);
    }
  }
  return needs;
}

/**
 * Build a basket for the week: one SKU per role (the chosen SKU map), packs rounded up.
 * Returns the basket plus any role with no usable SKU.
 */
export function buildBasket(
  recipes: Recipe[],
  skuForRole: Map<string, Sku>,
  version: number,
): { basket: Basket; missingRoles: string[] } {
  const lines: BasketLine[] = [];
  const missingRoles: string[] = [];
  for (const [role, need] of roleNeeds(recipes)) {
    const sku = skuForRole.get(role);
    if (!sku) {
      missingRoles.push(role);
      continue;
    }
    const packs = Math.ceil(need.qty / sku.packQty);
    lines.push({
      skuId: sku.id,
      name: sku.name,
      packs,
      unitPriceCents: sku.priceCents,
      lineCents: packs * sku.priceCents,
      usedBy: need.recipeIds,
    });
  }
  lines.sort((a, b) => a.skuId.localeCompare(b.skuId));
  return { basket: { version, lines, totalCents: lines.reduce((s, l) => s + l.lineCents, 0) }, missingRoles };
}

/** Every applied basket line must carry confirmed label evidence and no blocked allergen. Returns unsafe sku ids. */
export function unsafeLines(h: Household, basket: Basket, catalog: Map<string, Sku>): string[] {
  return basket.lines
    .filter((l) => {
      const sku = catalog.get(l.skuId);
      if (!sku) return true;
      const d = checkSku(h, sku, 0);
      return d.reasons.some((r) => r !== "out_of_stock");
    })
    .map((l) => l.skuId);
}

/** Lunches whose every role is covered by the basket in sufficient quantity. */
export function completeLunches(recipes: Recipe[], basket: Basket, catalog: Map<string, Sku>): number {
  const unitsByRole = new Map<string, number>();
  for (const l of basket.lines) {
    const sku = catalog.get(l.skuId);
    if (!sku) continue;
    unitsByRole.set(sku.role, (unitsByRole.get(sku.role) ?? 0) + l.packs * sku.packQty);
  }
  // allocate in plan order
  let complete = 0;
  const remaining = new Map(unitsByRole);
  for (const r of recipes) {
    const ok = r.lines.every((ln) => (remaining.get(ln.role) ?? 0) >= ln.qty);
    if (ok) {
      complete++;
      for (const ln of r.lines) remaining.set(ln.role, (remaining.get(ln.role) ?? 0) - ln.qty);
    }
  }
  return complete;
}

/** Whole-lunch alternative check: recipe allergens, then every SKU it needs, then budget. */
export function checkRecipe(
  h: Household,
  recipe: Recipe,
  skuForRole: (role: string) => Sku | undefined,
): CandidateDecision {
  const reasons: RejectReason[] = [];
  let fact = blockingFact(h, recipe.containsAllergens);
  if (fact) reasons.push("recipe_allergen");
  let labelVersion: string | undefined;
  let labelText: string | undefined;
  for (const line of recipe.lines) {
    const sku = skuForRole(line.role);
    if (!sku) {
      // No safe in-stock SKU for this role. If the recipe itself is blocked, that is the reason that matters.
      if (!reasons.includes("recipe_allergen") && !reasons.includes("out_of_stock")) reasons.push("out_of_stock");
      continue;
    }
    const d = checkSku(h, sku, 1);
    for (const r of d.reasons) if (!reasons.includes(r)) reasons.push(r);
    if (!d.eligible && !labelVersion) {
      labelVersion = d.labelVersion;
      labelText = d.labelText;
      if (!fact && d.factId) fact = hardRestrictions(h).find((f) => f.id === d.factId);
    }
  }
  return {
    candidateId: recipe.id,
    kind: "lunch_alternative",
    eligible: reasons.length === 0,
    reasons,
    factId: fact?.id,
    factText: fact?.text,
    factRevision: fact?.revision,
    labelVersion,
    labelText,
  };
}

export function diffBaskets(before: Basket, after: Basket) {
  const b = new Map(before.lines.map((l) => [l.skuId, l]));
  const a = new Map(after.lines.map((l) => [l.skuId, l]));
  return {
    removed: [...b.keys()].filter((k) => !a.has(k)),
    added: [...a.keys()].filter((k) => !b.has(k)),
    kept: [...a.keys()].filter((k) => b.has(k)),
  };
}

export function fingerprint(lines: { skuId: string; packs: number; unitPriceCents: number }[], totalCents: number, slot: string): string {
  const norm = [...lines].sort((x, y) => x.skuId.localeCompare(y.skuId)).map((l) => `${l.skuId}:${l.packs}:${l.unitPriceCents}`);
  return `${norm.join("|")}#${totalCents}#${slot}`;
}
