// Synthetic fixture. Merchant, products and labels are simulated; never real allergy assurance.
import type { Household, Recipe, Sku, SkuLabel } from "./types";

export const HOUSEHOLD_ID = "lunchshift-demo";
export const CATALOG_VERSION = "cat-2026-11-22";
export const PICKUP_SLOT = "Sun 2026-11-22 16:00-18:00";

const ok = (skuId: string, text: string): SkuLabel => ({
  skuId,
  version: `lbl-${skuId}-v1`,
  evidence: "confirmed",
  allergenWarnings: [],
  sourceText: text,
});

type SkuSeed = Omit<Sku, "catalogVersion" | "label"> & { label?: SkuLabel };
const seeds: SkuSeed[] = [
  // bread: the usual SKU sells out; the cheapest substitute carries a peanut cross-contact warning
  { id: "bread-harvest-ww", name: "Harvest Whole Wheat Bread", brand: "Harvest Mill", role: "bread", priceCents: 299, packQty: 20, unit: "slice", stock: 6,
    label: ok("bread-harvest-ww", "Contains: wheat. Made in a peanut-free bakery.") },
  { id: "bread-value-wheat", name: "Value Wheat Bread", brand: "ValuMart", role: "bread", priceCents: 199, packQty: 20, unit: "slice", stock: 14,
    label: { skuId: "bread-value-wheat", version: "lbl-bread-value-wheat-v2", evidence: "confirmed", allergenWarnings: ["peanut_cross_contact"],
      sourceText: "Contains: wheat, soy. May contain peanuts. Made on shared equipment that processes peanuts." } },
  { id: "bread-artisan-sour", name: "Artisan Sourdough Loaf", brand: "Old Town", role: "bread", priceCents: 499, packQty: 16, unit: "slice", stock: 4,
    label: { skuId: "bread-artisan-sour", version: "lbl-bread-artisan-sour-v0", evidence: "missing", allergenWarnings: [],
      sourceText: "No allergen statement on file for this SKU." } },
  { id: "seed-butter-sun", name: "SunButter Sunflower Spread", brand: "SunButter", role: "seed_butter", priceCents: 349, packQty: 16, unit: "tbsp", stock: 8,
    label: ok("seed-butter-sun", "Made in a peanut-free and tree-nut-free facility.") },
  { id: "apple-gala", name: "Gala Apples, 6 ct", brand: "Orchard Co", role: "apple", priceCents: 299, packQty: 6, unit: "each", stock: 20,
    label: ok("apple-gala", "Fresh produce. No allergen statement required.") },
  { id: "tortilla-flour", name: "Flour Tortillas, 10 ct", brand: "La Casa", role: "tortilla", priceCents: 199, packQty: 10, unit: "each", stock: 12,
    label: ok("tortilla-flour", "Contains: wheat.") },
  { id: "cheddar-sticks", name: "Mild Cheddar Sticks, 12 ct", brand: "Valley Dairy", role: "cheddar", priceCents: 299, packQty: 12, unit: "portion", stock: 10,
    label: ok("cheddar-sticks", "Contains: milk.") },
  { id: "grapes-red", name: "Red Seedless Grapes", brand: "Orchard Co", role: "grapes", priceCents: 249, packQty: 4, unit: "portion", stock: 9,
    label: ok("grapes-red", "Fresh produce. No allergen statement required.") },
  { id: "pasta-rotini", name: "Rotini Pasta", brand: "Nonna", role: "pasta", priceCents: 129, packQty: 8, unit: "portion", stock: 15,
    label: ok("pasta-rotini", "Contains: wheat. May contain egg.") },
  { id: "tomato-cherry", name: "Cherry Tomatoes", brand: "Greenhouse", role: "tomato", priceCents: 199, packQty: 4, unit: "portion", stock: 10,
    label: ok("tomato-cherry", "Fresh produce. No allergen statement required.") },
  { id: "pita-mini", name: "Mini Pitas, 8 ct", brand: "Levant", role: "pita", priceCents: 199, packQty: 8, unit: "each", stock: 7,
    label: ok("pita-mini", "Contains: wheat. Peanut-free facility.") },
  { id: "hummus-classic", name: "Classic Hummus", brand: "Levant", role: "hummus", priceCents: 249, packQty: 6, unit: "portion", stock: 8,
    label: ok("hummus-classic", "Contains: sesame.") },
  { id: "carrot-baby", name: "Baby Carrots", brand: "Greenhouse", role: "carrot", priceCents: 129, packQty: 6, unit: "portion", stock: 12,
    label: ok("carrot-baby", "Fresh produce. No allergen statement required.") },
  { id: "turkey-sliced", name: "Sliced Turkey Breast", brand: "Valley Deli", role: "turkey", priceCents: 349, packQty: 6, unit: "portion", stock: 6,
    label: ok("turkey-sliced", "No major allergens.") },
  { id: "rice-jasmine", name: "Jasmine Rice Cups, 10 ct", brand: "Lotus", role: "rice", priceCents: 199, packQty: 10, unit: "portion", stock: 9,
    label: ok("rice-jasmine", "No major allergens. Peanut-free facility.") },
  { id: "beans-black", name: "Black Beans, 15 oz", brand: "Casa Verde", role: "black_beans", priceCents: 99, packQty: 3, unit: "portion", stock: 16,
    label: ok("beans-black", "No major allergens.") },
  { id: "corn-sweet", name: "Sweet Corn, 15 oz", brand: "Casa Verde", role: "corn", priceCents: 99, packQty: 3, unit: "portion", stock: 14,
    label: ok("corn-sweet", "No major allergens.") },
  { id: "bread-gf", name: "Gluten-Free Sandwich Bread", brand: "Simple Oven", role: "gf_bread", priceCents: 449, packQty: 12, unit: "slice", stock: 6,
    label: ok("bread-gf", "Gluten-free. Contains: egg. Made in a peanut-free facility.") },
  { id: "noodles-rice", name: "Rice Noodles", brand: "Lotus", role: "rice_noodles", priceCents: 229, packQty: 6, unit: "portion", stock: 6,
    label: ok("noodles-rice", "No major allergens.") },
  { id: "sauce-thai-peanut", name: "Thai Peanut Sauce", brand: "Lotus", role: "peanut_sauce", priceCents: 349, packQty: 6, unit: "portion", stock: 5,
    label: { skuId: "sauce-thai-peanut", version: "lbl-sauce-thai-peanut-v1", evidence: "confirmed", allergenWarnings: ["peanut"],
      sourceText: "Contains: peanuts, soy." } },
];

export const CATALOG: Sku[] = seeds.map((s) => ({
  ...s,
  catalogVersion: CATALOG_VERSION,
  label: s.label ?? ok(s.id, "No major allergens."),
}));

/** The demo stockout: the usual bread sells out. */
export const DEMO_STOCKOUT_SKU = "bread-harvest-ww";

/** Default SKU per role in the parent's usual basket (preferred brand). */
export const USUAL_SKU_BY_ROLE: Record<string, string> = {
  bread: "bread-harvest-ww",
  seed_butter: "seed-butter-sun",
  apple: "apple-gala",
  tortilla: "tortilla-flour",
  cheddar: "cheddar-sticks",
  grapes: "grapes-red",
  pasta: "pasta-rotini",
  tomato: "tomato-cherry",
  pita: "pita-mini",
  hummus: "hummus-classic",
  carrot: "carrot-baby",
  turkey: "turkey-sliced",
  rice: "rice-jasmine",
  black_beans: "beans-black",
  corn: "corn-sweet",
  rice_noodles: "noodles-rice",
  gf_bread: "bread-gf",
  peanut_sauce: "sauce-thai-peanut",
};

export const RECIPES: Recipe[] = [
  { id: "r-sunbutter-sandwich", name: "SunButter sandwich + apple", prepMinutes: 5, containsAllergens: [], tags: ["sandwich", "kid_favorite"],
    lines: [{ role: "bread", qty: 2 }, { role: "seed_butter", qty: 2 }, { role: "apple", qty: 1 }],
    description: "Sunflower seed butter sandwich on whole wheat with apple slices." },
  { id: "r-quesadilla", name: "Cheese quesadilla + grapes", prepMinutes: 8, containsAllergens: [], tags: ["tortilla", "warm"],
    lines: [{ role: "tortilla", qty: 2 }, { role: "cheddar", qty: 1 }, { role: "grapes", qty: 1 }],
    description: "Cheddar quesadilla with red grapes." },
  { id: "r-pasta-salad", name: "Pasta salad + cherry tomatoes", prepMinutes: 12, containsAllergens: [], tags: ["pasta", "cold"],
    lines: [{ role: "pasta", qty: 1 }, { role: "tomato", qty: 1 }, { role: "cheddar", qty: 1 }],
    description: "Rotini pasta salad with cherry tomatoes and cheddar." },
  { id: "r-hummus-box", name: "Hummus box + carrots", prepMinutes: 5, containsAllergens: [], tags: ["snack_box", "cold"],
    lines: [{ role: "pita", qty: 2 }, { role: "hummus", qty: 1 }, { role: "carrot", qty: 1 }],
    description: "Mini pitas, hummus and baby carrots." },
  { id: "r-turkey-rollups", name: "Turkey roll-ups + apple", prepMinutes: 6, containsAllergens: [], tags: ["roll_up", "cold"],
    lines: [{ role: "turkey", qty: 1 }, { role: "cheddar", qty: 1 }, { role: "apple", qty: 1 }],
    description: "Turkey and cheddar roll-ups with apple slices." },
  // whole-lunch alternatives for a broken lunch
  { id: "r-rice-bean-bowl", name: "Rice-and-bean bowl + apple", prepMinutes: 15, containsAllergens: [], tags: ["rice_bowl", "kid_favorite", "warm"],
    lines: [{ role: "rice", qty: 1 }, { role: "black_beans", qty: 1 }, { role: "corn", qty: 1 }, { role: "apple", qty: 1 }],
    description: "Jasmine rice with black beans and sweet corn, apple on the side." },
  { id: "r-bean-quesadilla", name: "Bean-and-cheese quesadilla + apple", prepMinutes: 8, containsAllergens: [], tags: ["tortilla", "warm"],
    lines: [{ role: "tortilla", qty: 2 }, { role: "black_beans", qty: 1 }, { role: "cheddar", qty: 1 }, { role: "apple", qty: 1 }],
    description: "Black bean and cheddar quesadilla, apple on the side." },
  { id: "r-turkey-rice-box", name: "Turkey and rice box + grapes", prepMinutes: 10, containsAllergens: [], tags: ["rice_box", "cold"],
    lines: [{ role: "turkey", qty: 1 }, { role: "rice", qty: 1 }, { role: "carrot", qty: 1 }, { role: "grapes", qty: 1 }],
    description: "Sliced turkey over jasmine rice with baby carrots, grapes on the side." },
  { id: "r-veggie-pasta", name: "Veggie pasta + corn", prepMinutes: 12, containsAllergens: [], tags: ["pasta", "warm"],
    lines: [{ role: "pasta", qty: 1 }, { role: "tomato", qty: 1 }, { role: "corn", qty: 1 }],
    description: "Rotini with cherry tomatoes and sweet corn, no cheese." },
  { id: "r-gf-sunbutter", name: "Gluten-free SunButter sandwich + apple", prepMinutes: 5, containsAllergens: [], tags: ["sandwich"],
    lines: [{ role: "gf_bread", qty: 2 }, { role: "seed_butter", qty: 2 }, { role: "apple", qty: 1 }],
    description: "Sunflower seed butter on gluten-free bread with apple slices." },
  { id: "r-peanut-noodles", name: "Thai peanut noodles + carrots", prepMinutes: 10, containsAllergens: ["peanut"], tags: ["noodles"],
    lines: [{ role: "rice_noodles", qty: 1 }, { role: "peanut_sauce", qty: 1 }, { role: "carrot", qty: 1 }],
    description: "Rice noodles in Thai peanut sauce with carrots." },
];

/** Recipes that may replace a broken lunch (the planned five are not alternatives). */
export const ALTERNATIVE_RECIPE_IDS = [
  "r-rice-bean-bowl",
  "r-bean-quesadilla",
  "r-turkey-rice-box",
  "r-veggie-pasta",
  "r-gf-sunbutter",
  "r-peanut-noodles",
];

export const HOUSEHOLD: Household = {
  id: HOUSEHOLD_ID,
  childName: "Maya",
  policyRevision: 3,
  plan: [
    { day: "Mon", recipeId: "r-sunbutter-sandwich" },
    { day: "Tue", recipeId: "r-quesadilla" },
    { day: "Wed", recipeId: "r-pasta-salad" },
    { day: "Thu", recipeId: "r-hummus-box" },
    { day: "Fri", recipeId: "r-turkey-rollups" },
  ],
  facts: [
    { id: "fact-member-maya", kind: "member", text: "Maya (8) takes a packed school lunch Monday to Friday.",
      revision: 1, confirmedBy: "parent", confirmedAt: "2026-11-01", active: true },
    { id: "fact-allergy-peanut", kind: "hard_restriction",
      text: "Maya is allergic to peanuts. Refuse any product with a peanut or peanut cross-contact warning.",
      blocksAllergens: ["peanut", "peanut_cross_contact"], revision: 3, confirmedBy: "parent", confirmedAt: "2026-11-08", active: true,
      allergen: { id: "peanut", label: "Peanuts", terms: ["peanut", "peanuts"], crossContact: true } },
    { id: "fact-pref-rice", kind: "preference", text: "Maya has been asking for rice bowls.",
      revision: 1, confirmedBy: "parent", confirmedAt: "2026-11-08", active: true },
    { id: "fact-pref-variety", kind: "preference", text: "Avoid repeating the same lunch base twice in one week.",
      revision: 1, confirmedBy: "parent", confirmedAt: "2026-11-08", active: true },
    { id: "fact-pref-prep", kind: "preference", text: "Weekday lunch prep should stay under 20 minutes.",
      revision: 1, confirmedBy: "parent", confirmedAt: "2026-11-08", active: true },
  ],
  mandate: {
    id: "mandate-weekly-pickup",
    storeId: "sandbox-grocer",
    window: "Sun 16:00-18:00",
    maxSwapsPerWeek: 1,
    maxHoldsPerWeek: 1,
    maxAutonomy: "auto_swap_and_hold",
    budgetCents: 3500,
    expiresAt: "2026-12-31",
    revoked: false,
    approvedAt: "2026-11-08T19:12:00-08:00",
    scopes: ["catalog:read", "quote:create", "hold:create", "hold:read", "hold:cancel"],
    policyRevision: 3,
  },
};
