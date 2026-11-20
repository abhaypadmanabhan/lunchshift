// Parent edits to the household record. Deterministic: allergies are normalized in code, every change bumps the
// policy revision, and a newer revision than the standing approval covers means the next plan needs a parent's yes.
import { normalizeAllergy, blockedTags, type NormalizedAllergy } from "./allergens";
import type { Household, HouseholdFact } from "./types";
import type { HouseholdUpdate } from "./view";

export const WEEK_OF = "2026-11-22";

/** One run per family per week per policy revision: rules changed mid-week means a fresh plan (the old run is superseded). */
export function currentRunId(h: Pick<Household, "id" | "policyRevision" | "mandate">, weekOf: string = WEEK_OF): string {
  const base = h.id === "lunchshift-demo" || !h.id ? `run-${weekOf}` : `run-${h.id}-${weekOf}`;
  const approved = h.mandate.policyRevision ?? h.policyRevision;
  return h.policyRevision <= 3 && approved <= 3 ? base : `${base}-r${h.policyRevision}`;
}

const today = () => new Date().toISOString().slice(0, 10);

export function allergyFact(n: NormalizedAllergy, crossContact: boolean, childName: string, revision: number): HouseholdFact {
  const id = `fact-allergy-${n.id.replace(/^custom:/, "custom-").replace(/_/g, "-")}`;
  const what = n.custom ? n.label.toLowerCase() : n.label.toLowerCase().replace(" / ", " or ");
  return {
    id,
    kind: "hard_restriction",
    text: `${childName} is allergic to ${what}. Refuse any product that contains ${what}${crossContact ? ` or carries a ${what} cross-contact warning` : ""}.`,
    blocksAllergens: blockedTags({ id: n.id, crossContact }),
    revision,
    confirmedBy: "parent",
    confirmedAt: today(),
    active: true,
    allergen: { id: n.id, label: n.label, terms: n.terms, crossContact },
  };
}

export function applyHouseholdUpdate(
  h: Household,
  u: HouseholdUpdate,
): { household: Household; normalized: { input: string; id: string; label: string; custom: boolean }[] } {
  const childName = (u.childName ?? h.childName).trim() || h.childName;
  const revision = h.policyRevision + 1;
  const seen = new Set<string>();
  const normalized: NormalizedAllergy[] = [];
  const allergyFacts: HouseholdFact[] = [];
  const previous = new Map(h.facts.filter((f) => f.kind === "hard_restriction").map((f) => [f.allergen?.id ?? f.id, f]));
  for (const a of u.allergies) {
    const n = normalizeAllergy(a.text);
    if (!n || seen.has(n.id)) continue;
    seen.add(n.id);
    normalized.push(n);
    const prev = previous.get(n.id);
    // An unchanged allergy keeps its confirmed fact and revision; a new or edited one gets this revision.
    if (prev && prev.allergen?.crossContact === a.crossContact && prev.text.startsWith(`${childName} `)) allergyFacts.push(prev);
    else allergyFacts.push(allergyFact(n, a.crossContact, childName, revision));
  }
  const others = h.facts
    .filter((f) => f.kind !== "hard_restriction")
    .map((f) => (f.kind === "member" ? { ...f, text: f.text.replace(h.childName, childName) } : f));
  const budget = u.budgetCents && u.budgetCents > 0 ? Math.round(u.budgetCents) : h.mandate.budgetCents;
  return {
    household: {
      ...h,
      childName,
      policyRevision: revision,
      facts: [...others.filter((f) => f.kind === "member"), ...allergyFacts, ...others.filter((f) => f.kind !== "member")],
      mandate: u.approveStanding
        ? { ...h.mandate, budgetCents: budget, maxAutonomy: u.approveStanding.maxAutonomy, policyRevision: revision, approvedAt: new Date().toISOString(), revoked: false }
        : { ...h.mandate, budgetCents: budget },
    },
    normalized: normalized.map((n) => ({ input: n.input, id: n.id, label: n.label, custom: n.custom })),
  };
}
