// Allergen screen: a small task-specific model used as a tool (Superlinked SIE zero-shot classifier).
// It reads each exact-SKU label line. It can only ADD a refusal on top of the structured rules; it never clears one.
export interface ScreenResult {
  skuId: string;
  label: string; // top class
  score: number;
  risk: boolean; // top class is a peanut-risk class above threshold
  model: string;
}

export interface AllergenScreen {
  readonly provider: "sie" | "none";
  screen(items: { id: string; text: string }[]): Promise<Map<string, ScreenResult>>;
}

export const SIE_CLASSIFIER = "MoritzLaurer/deberta-v3-large-zeroshot-v2.0";
const RISK = "may contain peanuts or shared equipment with peanuts";
const CONTAINS = "contains peanuts";
const LABELS = [CONTAINS, RISK, "peanut-free", "no allergen information"];
const THRESHOLD = 0.6;

export class SieAllergenScreen implements AllergenScreen {
  readonly provider = "sie" as const;
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.superlinked.com",
  ) {}

  async screen(items: { id: string; text: string }[]): Promise<Map<string, ScreenResult>> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/extract/${encodeURIComponent(SIE_CLASSIFIER)}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ items, params: { labels: LABELS } }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`SIE extract HTTP ${res.status}`);
    const body = (await res.json()) as { items?: { id?: string; classifications?: { label: string; score: number }[] }[] };
    const out = new Map<string, ScreenResult>();
    for (const it of body.items ?? []) {
      const top = [...(it.classifications ?? [])].sort((a, b) => b.score - a.score)[0];
      if (!it.id || !top) continue;
      out.set(it.id, {
        skuId: it.id,
        label: top.label,
        score: top.score,
        risk: (top.label === RISK || top.label === CONTAINS) && top.score >= THRESHOLD,
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
