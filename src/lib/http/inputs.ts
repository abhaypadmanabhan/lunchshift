import { z } from "zod";
import { normalizeAllergy } from "../domain/allergens";
import { RECIPES } from "../domain/fixture";
import { routineConfig } from "../../worker/routines";

const text = (max: number) => z.string().max(max).trim().min(1);
const weekday = z.enum(["Mon", "Tue", "Wed", "Thu", "Fri"]);
const budget = z.number().int().min(500).max(50_000);
const mode = z.enum(["onboarding", "assistant"]).default("assistant");
const autonomy = z.enum(["suggest_only", "auto_swap", "auto_swap_and_hold"]);
const childName = text(40);
const allergenText = text(60).refine((value) => normalizeAllergy(value) !== null);

export const chatInput = z.strictObject({ mode, message: text(1200) });

const factMeta = { id: text(140), label: text(240) };
export const proposedFactInput = z.discriminatedUnion("kind", [
  z.strictObject({ ...factMeta, kind: z.literal("child"), value: z.strictObject({ name: childName, age: z.number().int().min(0).max(120).optional() }) }),
  z.strictObject({ ...factMeta, kind: z.literal("allergy"), value: z.union([
    z.strictObject({ id: text(70), remove: z.literal(true) }),
    z.strictObject({ id: text(70), text: allergenText, crossContact: z.boolean(), child: childName.optional(), remove: z.literal(false).optional() })
      .refine((a) => normalizeAllergy(a.text)?.id === a.id),
  ]) }),
  z.strictObject({ ...factMeta, kind: z.literal("preference"), value: z.strictObject({ text: text(180), child: childName.optional() }) }),
  z.strictObject({ ...factMeta, kind: z.literal("budget"), value: z.strictObject({ cents: budget }) }),
  z.strictObject({ ...factMeta, kind: z.literal("pickup"), value: z.strictObject({
    day: text(12).regex(/^(sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)$/i)
      .transform((name) => name[0].toUpperCase() + name.slice(1, 3).toLowerCase()),
  }) }),
  z.strictObject({ ...factMeta, kind: z.literal("store"), value: z.strictObject({ store: text(60) }) }),
  z.strictObject({ ...factMeta, kind: z.literal("plan_change"), value: z.union([
    z.strictObject({ skip: weekday }),
    z.strictObject({ day: weekday, recipeId: text(60).refine((id) => RECIPES.some((r) => r.id === id && r.containsAllergens.length === 0)) }),
  ]) }),
  z.strictObject({ ...factMeta, kind: z.literal("cart_change"), value: z.strictObject({ text: text(140) }) }),
]);

export const MAX_FACTS = 32;
export const confirmInput = z.strictObject({ mode, facts: z.array(proposedFactInput).min(1).max(MAX_FACTS) });

export const householdInput = z.strictObject({
  childName: z.string().max(40).optional(),
  allergies: z.array(z.strictObject({ text: allergenText, crossContact: z.boolean().default(true) })).max(32),
  budgetCents: budget.optional(),
  approveStanding: z.strictObject({ maxAutonomy: autonomy }).optional(),
});

export const cartInput = z.strictObject({ skuId: text(100), packs: z.number().int().min(0).max(20) });

const enabled = z.boolean().optional();
export const routineInput = z.discriminatedUnion("id", [
  z.strictObject({ id: z.literal("weekly_plan"), enabled, config: routineConfig.weekly_plan.optional() }),
  z.strictObject({ id: z.literal("stock_watch"), enabled, config: routineConfig.stock_watch.optional() }),
  z.strictObject({ id: z.literal("school_skips"), enabled, config: routineConfig.school_skips.optional() }),
  z.strictObject({ id: z.literal("budget_alert"), enabled, config: routineConfig.budget_alert.optional() }),
]);
export const runRoutineInput = z.strictObject({ id: z.enum(["weekly_plan", "stock_watch", "school_skips", "budget_alert"]) });
export const confirmPaymentInput = z.strictObject({ sessionId: z.string().max(160).regex(/^cs_[A-Za-z0-9_]+$/) });
export const autonomyInput = z.strictObject({ mode: autonomy });
export const switchFamilyInput = z.strictObject({ householdId: text(100) });
