// Allergen screen: a small task-specific model used as a tool (Superlinked SIE zero-shot classifier).
// It reads each exact-SKU label line against THIS household's allergens. It can only ADD a refusal on top of the
// structured rules; it never clears one.
import type { HouseholdFact } from "../domain/types";

export interface ScreenResult {
  skuId: string;
  label: string; // top class, e.g. "may contain peanuts"
  score: number;
  risk: boolean; // top class is a contains / may-contain class for one of the household's allergens, above threshold
  allergenId?: string;
  model: string;
}

export interface AllergenScreen {
  readonly provider: "sie" | "none";
  screen(items: { id: string; text: string }[], restrictions: HouseholdFact[]): Promise<Map<string, ScreenResult>>;
}

export const SIE_CLASSIFIER = "MoritzLaurer/deberta-v3-large-zeroshot-v2.0";
// Measured 2026-11-20: with only allergen classes to choose from, "Contains: milk." scored 0.65 "contains peanuts".
// A neutral "other ingredients" class plus a higher bar removes that while true hits stay at 0.95+.
const THRESHOLD = 0.85;
const PHRASE: Record<string, string> = {
  peanut: "peanuts",
  tree_nut: "tree nuts",
  milk: "milk or dairy",
  egg: "eggs",
  wheat: "wheat or gluten",
  soy: "soy",
  sesame: "sesame",
  fish: "fish",
  shellfish: "shellfish",
};

/** Candidate classes for the household's allergens: "contains X" and "may contain X" each, plus two neutral classes. */
export function classesFor(restrictions: HouseholdFact[]): { label: string; allergenId?: string; risk: boolean }[] {
  const out: { label: string; allergenId?: string; risk: boolean }[] = [];
  for (const f of restrictions) {
    const id = f.allergen?.id ?? (f.blocksAllergens ?? [])[0];
    if (!id) continue;
    const phrase = PHRASE[id] ?? f.allergen?.label.toLowerCase() ?? id.replace(/^custom:/, "");
    out.push({ label: `contains ${phrase}`, allergenId: id, risk: true });
    if (f.allergen?.crossContact ?? true) out.push({ label: `may contain ${phrase} or made on shared equipment with ${phrase}`, allergenId: id, risk: true });
  }
  out.push(
    { label: "free of these allergens", risk: false },
    { label: "contains only other ingredients or other allergens", risk: false },
    { label: "no allergen information", risk: false },
  );
  return out;
}

export class SieAllergenScreen implements AllergenScreen {
  readonly provider = "sie" as const;
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.superlinked.com",
  ) {}

  async screen(items: { id: string; text: string }[], restrictions: HouseholdFact[]): Promise<Map<string, ScreenResult>> {
    const classes = classesFor(restrictions);
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/extract/${encodeURIComponent(SIE_CLASSIFIER)}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ items, params: { labels: classes.map((c) => c.label) } }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`SIE extract HTTP ${res.status}`);
    const body = (await res.json()) as { items?: { id?: string; classifications?: { label: string; score: number }[] }[] };
    const out = new Map<string, ScreenResult>();
    for (const it of body.items ?? []) {
      const top = [...(it.classifications ?? [])].sort((a, b) => b.score - a.score)[0];
      if (!it.id || !top) continue;
      const cls = classes.find((c) => c.label === top.label);
      out.set(it.id, {
        skuId: it.id,
        label: top.label,
        score: top.score,
        risk: Boolean(cls?.risk) && top.score >= THRESHOLD,
        allergenId: cls?.allergenId,
        model: SIE_CLASSIFIER,
      });
    }
    return out;
  }
}

export class NoScreen implements AllergenScreen {
  readonly provider = "none" as const;
  async screen() {
    return new Map<string, ScreenResult>();
  }
}

export function getAllergenScreen(): AllergenScreen {
  const key = process.env.SIE_API_KEY;
  return key ? new SieAllergenScreen(key, process.env.SIE_BASE_URL || undefined) : new NoScreen();
}
