import type { AutonomyMode, RejectReason } from "@/lib/domain/types";

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const TZ = "America/Los_Angeles";

export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour12: false, timeZone: TZ });

export const shortDate = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: TZ,
  });

export const MODE_LABEL: Record<AutonomyMode, string> = {
  suggest_only: "Suggest only",
  auto_swap: "Swap automatically",
  auto_swap_and_hold: "Swap and place hold",
};

export const REASON_LABEL: Record<RejectReason, string> = {
  allergen_warning: "Label warning matches a confirmed allergy",
  recipe_allergen: "Recipe contains a blocked allergen",
  missing_label_evidence: "No allergen statement on file for this exact SKU",
  conflicting_label_evidence: "Label evidence conflicts between sources",
  out_of_stock: "Out of stock",
  classifier_flag: "SIE allergen classifier flagged the label",
  over_budget: "Would exceed the budget",
  mandate_limit: "Outside the parent's standing approval",
};

/** "hold_7f3a9c2e41b8" -> "7f3a9c2e"; "hold:run-2026-11-22" stays readable. */
export const shortRef = (id: string) => {
  const m = id.match(/[0-9a-f]{8,}/i);
  return m ? m[0].slice(0, 8) : id;
};
