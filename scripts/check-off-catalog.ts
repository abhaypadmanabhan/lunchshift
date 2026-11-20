import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OFF_CATALOG, OFF_DEMO_STOCKOUT_SKU, OFF_USUAL_SKU_BY_ROLE } from "../src/lib/domain/catalog.off";
import { HOUSEHOLD, RECIPES } from "../src/lib/domain/fixture";
import { buildBasket, checkSku } from "../src/lib/domain/rules";
import type { Sku } from "../src/lib/domain/types";

const roleUnits = {
  bread: "slice",
  seed_butter: "tbsp",
  apple: "each",
  tortilla: "each",
  cheddar: "portion",
  grapes: "portion",
  pasta: "portion",
  tomato: "portion",
  pita: "each",
  hummus: "portion",
  carrot: "portion",
  turkey: "portion",
  rice: "portion",
  black_beans: "portion",
  corn: "portion",
  gf_bread: "slice",
  rice_noodles: "portion",
  peanut_sauce: "portion",
} as const;

const byId = new Map(OFF_CATALOG.map((sku) => [sku.id, sku]));
const tags = (sku: Sku) => [...(sku.allergenTags ?? []), ...(sku.traceTags ?? [])];

console.log("role | name | brand | allergens | traces | demo price | image");
for (const sku of OFF_CATALOG) {
  console.log([
    sku.role,
    sku.name,
    sku.brand,
    sku.allergenTags?.join(", ") || "—",
    sku.traceTags?.join(", ") || "—",
    `$${(sku.priceCents / 100).toFixed(2)}`,
    sku.imageUrl ? "yes" : "no",
  ].join(" | "));
}

assert(OFF_CATALOG.length >= 40 && OFF_CATALOG.length <= 60, "Expected 40–60 products");
assert.equal(byId.size, OFF_CATALOG.length, "Duplicate barcode");
const usualByRole = new Map<string, Sku>();
for (const role of Object.keys(roleUnits)) {
  const usual = byId.get(OFF_USUAL_SKU_BY_ROLE[role]);
  assert(usual?.role === role, `Missing usual product for ${role}`);
  usualByRole.set(role, usual);
}

for (const sku of OFF_CATALOG) {
  assert.equal(sku.unit, roleUnits[sku.role as keyof typeof roleUnits], `${sku.id} has the wrong role unit`);
  assert(Number.isInteger(sku.packQty) && sku.packQty > 0, `${sku.id} has an invalid pack size`);
  assert(sku.stock >= 6 && sku.stock <= 15, `${sku.id} has invalid stock`);
  if (sku.imageUrl) {
    assert.equal(sku.imageUrl, `/products/${sku.barcode}.jpg`);
    const jpeg = readFileSync(resolve(import.meta.dirname, "../public", `.${sku.imageUrl}`));
    assert(jpeg[0] === 0xff && jpeg[1] === 0xd8 && jpeg[2] === 0xff, `${sku.imageUrl} is not a JPEG`);
  }
}

const usualBread = usualByRole.get("bread")!;
assert.equal(OFF_DEMO_STOCKOUT_SKU, usualBread.id);
assert(/whole[ -]wheat/i.test(usualBread.name), "Usual bread must be whole wheat");
assert(!tags(usualBread).includes("en:peanuts"), "Usual bread has a peanut tag");
assert(checkSku(HOUSEHOLD, usualBread, 1).eligible, "Usual bread must pass the demo household's rules");

const cheaperBread = OFF_CATALOG.find((sku) =>
  sku.role === "bread" &&
  sku.priceCents < usualBread.priceCents &&
  sku.traceTags?.includes("en:peanuts")
);
assert(cheaperBread, "Expected a cheaper bread with an OFF peanut trace");
assert(cheaperBread.label.allergenWarnings.includes("peanut_cross_contact"), "Peanut trace did not map to the app warning");
assert(checkSku(HOUSEHOLD, cheaperBread, 1).reasons.includes("allergen_warning"), "App did not refuse the cheaper bread");
for (const bread of OFF_CATALOG.filter((sku) => sku.role === "bread" && sku.label.evidence === "missing")) {
  assert(checkSku(HOUSEHOLD, bread, 1).reasons.includes("missing_label_evidence"), "App accepted a bread with missing evidence");
}

const sunflowerButter = usualByRole.get("seed_butter")!;
assert(/sunbutter|sunflower/i.test(sunflowerButter.name), "Expected sunflower seed butter");
assert(!tags(sunflowerButter).some((tag) => tag === "en:peanuts" || tag === "en:nuts"), "Sunflower butter has a peanut or tree-nut tag");
assert(checkSku(HOUSEHOLD, sunflowerButter, 1).eligible, "Sunflower butter must pass the demo household's rules");

const planned = HOUSEHOLD.plan.map(({ recipeId }) => RECIPES.find((recipe) => recipe.id === recipeId)!);
const { basket, missingRoles } = buildBasket(planned, usualByRole, 1);
assert.deepEqual(missingRoles, []);
assert(basket.totalCents <= HOUSEHOLD.mandate.budgetCents, "Usual basket is over the demo household budget");
for (const line of basket.lines) {
  assert(checkSku(HOUSEHOLD, byId.get(line.skuId)!, line.packs).eligible, `${line.skuId} cannot fill the usual basket`);
}

console.log(`PASS. ${OFF_CATALOG.length} products across ${usualByRole.size} roles, ${OFF_CATALOG.filter((sku) => sku.imageUrl).length} JPEGs. The usual basket costs $${(basket.totalCents / 100).toFixed(2)}. The rules refuse the cheaper bread.`);
