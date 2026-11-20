// The parent talks to LunchShift in plain words. Claude turns a message into structured, typed facts; code then
// validates every fact (allergies through the deterministic normalizer, recipes against the library) before the
// parent sees them as chips. Nothing is saved until the parent confirms.
import Anthropic from "@anthropic-ai/sdk";
import { normalizeAllergy } from "../domain/allergens";
import { RECIPES } from "../domain/fixture";
import type { Household } from "../domain/types";
import type { ProposedFact } from "../domain/view";
import { DEFAULT_MODEL } from "./anthropic";

export interface Interpretation {
  reply: string;
  facts: ProposedFact[];
  provider: "anthropic" | "rules";
}

interface Parsed {
  reply?: string;
  kids?: { name: string; age?: number }[];
  allergies?: { child?: string; allergen: string; avoidMayContain?: boolean }[];
  removeAllergies?: { child?: string; allergen: string }[];
  dislikes?: { child?: string; text: string }[];
  budgetDollars?: number;
  pickupDay?: string;
  store?: string;
  skipDays?: string[];
  planChanges?: { day: string; want: string }[];
  extras?: { text: string }[];
}

const DAYS: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri" };
const DAY_NAME: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday" };
const toDay = (d: string) => DAYS[d.trim().toLowerCase().slice(0, 3)];

function familySummary(h: Household): string {
  const kids = h.children?.length ? h.children.map((k) => `${k.name}${k.age ? ` (${k.age})` : ""}`).join(", ") : h.childName || "none yet";
  const allergies = h.facts.filter((f) => f.kind === "hard_restriction" && f.allergen).map((f) => `${f.allergen!.label}${f.child ? ` (${f.child})` : ""}`);
  const lunches = h.plan.map((p) => `${p.day}: ${RECIPES.find((r) => r.id === p.recipeId)?.name ?? p.recipeId}`).join("; ");
  return `Kids: ${kids}. Allergies: ${allergies.join(", ") || "none"}. Budget: $${(h.mandate.budgetCents / 100).toFixed(0)}/week. This week's lunches: ${lunches}.`;
}

const SYSTEM = `You are LunchShift, a calm grocery assistant for parents of kids with food allergies.
Read the parent's message and return ONLY a JSON object (no prose, no code fences) with these optional fields:
{"reply": string, "kids": [{"name": string, "age": number}], "allergies": [{"child": string, "allergen": string, "avoidMayContain": boolean}],
 "removeAllergies": [{"child": string, "allergen": string}], "dislikes": [{"child": string, "text": string}], "budgetDollars": number,
 "pickupDay": string, "store": string, "skipDays": ["Mon"|"Tue"|"Wed"|"Thu"|"Fri"], "planChanges": [{"day": "Mon"|"Tue"|"Wed"|"Thu"|"Fri", "want": string}],
 "extras": [{"text": string}]}
Rules: only include what the parent actually said; never invent an allergy or a kid. "avoidMayContain" defaults to true unless the parent says traces or "may contain" are fine.
"reply" is one or two short, warm sentences that say what you understood and that they can confirm it below. Never promise that food is safe.`;

async function parseWithClaude(message: string, mode: string, h: Household): Promise<Parsed> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("no ANTHROPIC_API_KEY");
  const client = new Anthropic({ apiKey: key });
  const res = await client.messages.create(
    {
      model: process.env.LLM_MODEL || DEFAULT_MODEL,
      max_tokens: 700,
      system: SYSTEM,
      messages: [{ role: "user", content: `Mode: ${mode}. Current family: ${familySummary(h)}\n\nParent: ${message}` }],
    },
    { timeout: 15000 },
  );
  const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(json) as Parsed;
}

/** Deterministic fallback when the model is unavailable: kids, allergies, budget, skip days. */
function parseWithRules(message: string): Parsed {
  const m = message;
  const kids = [...m.matchAll(/\b([A-Z][a-z]+) is (\d{1,2})\b/g)].map((x) => ({ name: x[1], age: Number(x[2]) }));
  const allergies: Parsed["allergies"] = [];
  for (const part of m.split(/[,.;]| and /)) {
    const a = part.match(/(?:allergic to|allergy to|allergies? (?:to )?)\s*([a-z -]+)|([a-z -]+?)\s+allerg/i);
    const raw = (a?.[1] ?? a?.[2])?.trim();
    if (raw && normalizeAllergy(raw)) allergies.push({ allergen: raw, avoidMayContain: !/traces? (?:are )?(?:ok|fine)/i.test(m) });
  }
  const budget = m.match(/\$\s?(\d{2,3})/);
  const skip = [...m.matchAll(/no school (?:on )?(\w+)/gi)].map((x) => x[1]);
  return {
    reply: "Here's what I understood. Confirm the chips below and I'll save them.",
    kids,
    allergies,
    budgetDollars: budget ? Number(budget[1]) : undefined,
    skipDays: skip,
  };
}

function findRecipe(want: string): string | undefined {
  const w = want.toLowerCase();
  const hit = RECIPES.filter((r) => !r.containsAllergens.length).find(
    (r) => r.name.toLowerCase().includes(w) || r.tags.some((t) => w.includes(t.replace("_", " ")) || t.includes(w.split(" ")[0])),
  );
  return hit?.id;
}

/** Validate the model's output into chips. Anything that doesn't validate is dropped, not guessed. */
export function toFacts(p: Parsed): ProposedFact[] {
  const out: ProposedFact[] = [];
  for (const k of p.kids ?? []) {
    if (!k?.name || !/^[\p{L}][\p{L} '-]{0,30}$/u.test(k.name)) continue;
    out.push({ id: `child:${k.name.toLowerCase()}`, kind: "child", label: `${k.name}${k.age ? `, ${k.age}` : ""}`, value: { name: k.name, age: k.age } });
  }
  for (const a of p.allergies ?? []) {
    const n = a?.allergen ? normalizeAllergy(a.allergen) : null;
    if (!n) continue;
    const cc = a.avoidMayContain !== false;
    out.push({
      id: `allergy:${(a.child ?? "family").toLowerCase()}:${n.id}`,
      kind: "allergy",
      label: `${a.child ? `${a.child}: ` : ""}${n.label} allergy${cc ? " · avoid may-contain" : " · traces OK"}${n.custom ? " · custom" : ""}`,
      value: { text: a.allergen, id: n.id, crossContact: cc, child: a.child },
    });
  }
  for (const a of p.removeAllergies ?? []) {
    const n = a?.allergen ? normalizeAllergy(a.allergen) : null;
    if (!n) continue;
    out.push({ id: `remove:${n.id}`, kind: "allergy", label: `Remove ${n.label} allergy${a.child ? ` (${a.child})` : ""}`, value: { id: n.id, remove: true } });
  }
  for (const d of p.dislikes ?? []) {
    if (!d?.text) continue;
    out.push({ id: `pref:${d.text.toLowerCase().slice(0, 20)}`, kind: "preference", label: `${d.child ?? "Family"} dislikes ${d.text}`, value: { text: `${d.child ?? "The family"} dislikes ${d.text}.`, child: d.child } });
  }
  if (typeof p.budgetDollars === "number" && p.budgetDollars >= 5 && p.budgetDollars <= 500) {
    out.push({ id: "budget", kind: "budget", label: `$${p.budgetDollars} a week`, value: { cents: Math.round(p.budgetDollars * 100) } });
  }
  if (p.pickupDay) out.push({ id: "pickup", kind: "pickup", label: `Pickup ${p.pickupDay}`, value: { day: p.pickupDay } });
  if (p.store) out.push({ id: "store", kind: "store", label: `Store: ${p.store}`, value: { store: p.store } });
  for (const d of p.skipDays ?? []) {
    const day = toDay(String(d));
    if (day) out.push({ id: `skip:${day}`, kind: "plan_change", label: `No school ${DAY_NAME[day]}`, value: { skip: day } });
  }
  for (const c of p.planChanges ?? []) {
    const day = toDay(String(c?.day ?? ""));
    const recipeId = c?.want ? findRecipe(c.want) : undefined;
    if (day && recipeId) {
      out.push({ id: `plan:${day}`, kind: "plan_change", label: `${DAY_NAME[day]} → ${RECIPES.find((r) => r.id === recipeId)!.name}`, value: { day, recipeId } });
    }
  }
  for (const e of p.extras ?? []) if (e?.text) out.push({ id: `extra:${e.text.toLowerCase()}`, kind: "cart_change", label: `Add ${e.text}`, value: { text: e.text } });
  return out;
}

export async function interpret(message: string, mode: string, h: Household): Promise<Interpretation> {
  try {
    const parsed = await parseWithClaude(message, mode, h);
    const reply = typeof parsed.reply === "string" && parsed.reply.trim() ? parsed.reply.slice(0, 600) : "Here's what I understood.";
    return { reply, facts: toFacts(parsed), provider: "anthropic" };
  } catch {
    const parsed = parseWithRules(message);
    return { reply: parsed.reply!, facts: toFacts(parsed), provider: "rules" };
  }
}
