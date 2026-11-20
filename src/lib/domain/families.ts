// Preset families for the story, the active-family + demo-week pointer, and per-family run ids.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { HOUSEHOLD } from "./fixture";
import { applyHouseholdUpdate } from "./household";
import type { Household } from "./types";

export const WEEKS = ["2026-11-22", "2026-11-29"] as const;

function preset(id: string, childName: string, allergies: string[], prefs: string[]): Household {
  const base: Household = {
    ...HOUSEHOLD,
    id,
    childName,
    facts: HOUSEHOLD.facts
      .filter((f) => f.kind === "member")
      .map((f) => ({ ...f, id: `fact-member-${childName.toLowerCase()}`, text: f.text.replace("Maya (8)", childName) })),
  };
  const { household } = applyHouseholdUpdate(base, {
    childName,
    allergies: allergies.map((text) => ({ text, crossContact: true })),
    approveStanding: { maxAutonomy: "auto_swap_and_hold" },
  });
  const preferenceFacts = prefs.map((text, i) => ({
    id: `fact-pref-${childName.toLowerCase()}-${i + 1}`,
    kind: "preference" as const,
    text,
    revision: 1,
    confirmedBy: "parent",
    confirmedAt: "2026-11-08",
    active: true,
  }));
  return { ...household, facts: [...household.facts, ...preferenceFacts], onboarded: true };
}

export const PRESETS: Household[] = [
  { ...HOUSEHOLD, onboarded: true },
  preset("fam-leo", "Leo", ["sesame", "dairy"], ["Leo loves warm lunches.", "Weekday lunch prep should stay under 20 minutes."]),
  preset("fam-ava", "Ava", ["gluten"], ["Ava has been asking for rice bowls.", "Avoid repeating the same lunch base twice in one week."]),
];

// ---- Active family and demo week (shared by the worker and the web app on this machine) ----
const FILE = ".data/active-family.json";
interface Pointer {
  householdId: string;
  weekIndex: number;
  newFamilies: number;
}
export function readPointer(): Pointer {
  try {
    const p = JSON.parse(readFileSync(FILE, "utf8")) as Partial<Pointer>;
    return { householdId: p.householdId ?? HOUSEHOLD.id, weekIndex: p.weekIndex ?? 0, newFamilies: p.newFamilies ?? 0 };
  } catch {
    return { householdId: HOUSEHOLD.id, weekIndex: 0, newFamilies: 0 };
  }
}
export function writePointer(p: Partial<Pointer>) {
  mkdirSync(".data", { recursive: true });
  writeFileSync(FILE, JSON.stringify({ ...readPointer(), ...p }));
}
export const activeHouseholdId = () => readPointer().householdId;
export const currentWeekOf = () => WEEKS[Math.min(readPointer().weekIndex, WEEKS.length - 1)];

/** A blank family that starts with chat onboarding. */
export function blankFamily(n: number): Household {
  return {
    ...HOUSEHOLD,
    id: `fam-new-${n}`,
    childName: "",
    facts: [],
    policyRevision: 1,
    onboarded: false,
    mandate: { ...HOUSEHOLD.mandate, maxAutonomy: "suggest_only", policyRevision: 1 },
  };
}
