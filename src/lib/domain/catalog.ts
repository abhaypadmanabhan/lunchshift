// The store's catalog source. `LUNCHSHIFT_CATALOG=off` serves the real Open Food Facts snapshot (demo prices);
// anything else serves the hand-written fixture that the test suites and the hand oracle are built on.
import { CATALOG, CATALOG_VERSION, DEMO_STOCKOUT_SKU, USUAL_SKU_BY_ROLE } from "./fixture";
import type { Sku } from "./types";

export interface ActiveCatalog {
  source: "fixture" | "off";
  version: string;
  skus: Sku[];
  usualByRole: Record<string, string>;
  stockoutSku: string;
}

const FIXTURE: ActiveCatalog = {
  source: "fixture",
  version: CATALOG_VERSION,
  skus: CATALOG,
  usualByRole: USUAL_SKU_BY_ROLE,
  stockoutSku: DEMO_STOCKOUT_SKU,
};

const sources: Record<string, ActiveCatalog> = { fixture: FIXTURE };

/** Register another catalog (the OFF snapshot registers itself as "off"). */
export function registerCatalog(name: string, c: ActiveCatalog) {
  sources[name] = c;
}

export function activeCatalog(): ActiveCatalog {
  const want = typeof process !== "undefined" ? process.env.LUNCHSHIFT_CATALOG : undefined;
  return (want && sources[want]) || FIXTURE;
}

/** Every product any catalog knows, for display-name lookups in the UI. */
export function allSkus(): Sku[] {
  return Object.values(sources).flatMap((c) => c.skus);
}
