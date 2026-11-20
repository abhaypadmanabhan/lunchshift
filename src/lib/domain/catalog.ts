// The store's catalog source. `LUNCHSHIFT_CATALOG=off` serves the real Open Food Facts snapshot (demo prices);
// anything else serves the hand-written fixture that the test suites and the hand oracle are built on.
import { CATALOG, CATALOG_VERSION, DEMO_STOCKOUT_SKU, USUAL_SKU_BY_ROLE } from "./fixture";
import type { Sku } from "./types";
import { OFF_CATALOG, OFF_DEMO_STOCKOUT_SKU, OFF_USUAL_SKU_BY_ROLE } from "./catalog.off";

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

const OFF: ActiveCatalog = {
  source: "off",
  version: "off-2026-11-20",
  skus: OFF_CATALOG,
  usualByRole: OFF_USUAL_SKU_BY_ROLE,
  stockoutSku: OFF_DEMO_STOCKOUT_SKU,
};

const sources: Record<string, ActiveCatalog> = { fixture: FIXTURE, off: OFF };

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
