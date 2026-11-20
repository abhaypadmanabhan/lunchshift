// Product records and front photos by Open Food Facts contributors, linked via each sourceUrl.
// Database: https://opendatacommons.org/licenses/odbl/1.0/
// Photos: https://creativecommons.org/licenses/by-sa/3.0/
import snapshot from "./catalog.off.json";
import type { Sku } from "./types";

export interface OffCatalogProduct {
  barcode: string;
  name: string;
  brand: string;
  role: string;
  ingredientsText: string;
  allergenTags: string[];
  traceTags: string[];
  imageFile: string | null;
  sourceUrl: string;
  quantity: string;
  demoPriceCents: number;
  packQty: number;
  unit: string;
  comment: string;
}

const allergens: Readonly<Record<string, { id: string; label: string }>> = {
  "en:peanuts": { id: "peanut", label: "peanuts" },
  "en:nuts": { id: "tree_nut", label: "tree nuts" },
  "en:milk": { id: "milk", label: "milk" },
  "en:eggs": { id: "egg", label: "eggs" },
  "en:gluten": { id: "wheat", label: "gluten" },
  "en:soybeans": { id: "soy", label: "soybeans" },
  "en:sesame-seeds": { id: "sesame", label: "sesame seeds" },
  "en:fish": { id: "fish", label: "fish" },
  "en:crustaceans": { id: "shellfish", label: "crustaceans" },
  "en:molluscs": { id: "shellfish", label: "molluscs" },
  "en:shellfish": { id: "shellfish", label: "shellfish" },
};

function tagWords(tags: string[]): string {
  return tags.map((tag) => allergens[tag]?.label ?? tag.replace(/^[a-z]{2}:/, "").replaceAll("-", " ")).join(", ");
}

const products: OffCatalogProduct[] = snapshot;

export const OFF_CATALOG: Sku[] = products.map((product, index) => {
  const { barcode, name, brand, role, packQty, unit, ingredientsText, allergenTags, traceTags } = product;
  const id = `off-${barcode}`;
  return {
    id,
    barcode,
    name,
    brand,
    role,
    priceCents: product.demoPriceCents,
    packQty,
    unit,
    stock: 6 + (index % 10),
    catalogVersion: "off-2026-11-20",
    sourceUrl: product.sourceUrl,
    ...(product.imageFile ? { imageUrl: `/products/${product.imageFile}` } : {}),
    allergenTags,
    traceTags,
    label: {
      skuId: id,
      version: id,
      evidence: ingredientsText.trim() ? "confirmed" : "missing",
      sourceText: [
        ingredientsText,
        allergenTags.length ? `Contains: ${tagWords(allergenTags)}.` : "",
        traceTags.length ? `May contain: ${tagWords(traceTags)}.` : "",
      ].filter(Boolean).join("\n"),
      allergenWarnings: [...new Set([
        ...allergenTags.flatMap((tag) => allergens[tag] ? [allergens[tag].id] : []),
        ...traceTags.flatMap((tag) => allergens[tag] ? [`${allergens[tag].id}_cross_contact`] : []),
      ])],
    },
  };
});

// The capture lists each role's usual product first.
export const OFF_USUAL_SKU_BY_ROLE: Record<string, string> = {};
for (const sku of OFF_CATALOG) {
  OFF_USUAL_SKU_BY_ROLE[sku.role] ??= sku.id;
}
export const OFF_DEMO_STOCKOUT_SKU = OFF_USUAL_SKU_BY_ROLE.bread;
