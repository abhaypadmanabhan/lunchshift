// Plain-language copy for the parent app. Everything a parent reads is built here from the RunView.
import type { AuditEvent, AutonomyMode, CandidateDecision, HouseholdFact, RejectReason, RunStatus } from "@/lib/domain/types";
import type { RunView } from "@/lib/domain/view";

const TZ = "America/Los_Angeles";

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const timeOfDay = (iso: string) =>
  new Date(iso)
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ })
    .replace(" AM", " am")
    .replace(" PM", " pm");

export const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: TZ });

export const DAY_NAME: Record<string, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
};

/** "Sun 16:00-18:00" -> "Sun 4-6 pm". Unknown shapes pass through unchanged. */
export function pickupWindow(window: string): string {
  const m = window.match(/^(\w+)\s+(?:\S+\s+)?(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!m) return window;
  const [, day, h1, m1, h2, m2] = m;
  const fmt = (h: number, min: string) => `${h % 12 === 0 ? 12 : h % 12}${min === "00" ? "" : `:${min}`}`;
  const a = Number(h1);
  const b = Number(h2);
  const sameHalf = a >= 12 === b >= 12;
  const suffix = (h: number) => (h >= 12 ? "pm" : "am");
  return sameHalf
    ? `${day} ${fmt(a, m1)}-${fmt(b, m2)} ${suffix(b)}`
    : `${day} ${fmt(a, m1)} ${suffix(a)}-${fmt(b, m2)} ${suffix(b)}`;
}

export const MODE_STEPS: { mode: AutonomyMode; label: string; detail: string }[] = [
  { mode: "suggest_only", label: "Suggest only", detail: "Asks you before changing anything." },
  { mode: "auto_swap", label: "Swap for me", detail: "Fixes the lunches, then waits for you to hold the order." },
  { mode: "auto_swap_and_hold", label: "Swap and hold", detail: "Fixes the lunches and holds your pickup. You still pay at the store." },
];

export const modeLabel = (m: AutonomyMode) => MODE_STEPS.find((s) => s.mode === m)?.label ?? m;

export const REASON_PLAIN: Record<RejectReason, string> = {
  allergen_warning: "its label carries an allergy warning",
  recipe_allergen: "the recipe itself contains the allergen",
  missing_label_evidence: "there's no allergy label on file, so we can't be sure",
  conflicting_label_evidence: "the label sources disagree",
  out_of_stock: "it's sold out",
  classifier_flag: "a second label check flagged it",
  over_budget: "it would go over your budget",
  mandate_limit: "it's outside what you've allowed",
};

const humanizeId = (id: string) =>
  id
    .replace(/^r-/, "")
    .replace(/[-_]/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

/** Name of a refused product or lunch: the audit summary carries it ("Refused Value Wheat Bread: ..."). */
export function refusalName(view: RunView, r: CandidateDecision): string {
  for (const e of view.events) {
    if (e.type !== "candidate_rejected" || e.data.candidateId !== r.candidateId) continue;
    const m = e.summary.match(/^Refused (.+?):/);
    if (m) return m[1];
  }
  const planned = view.plan.find((p) => p.recipeId === r.candidateId);
  return planned?.recipeName ?? humanizeId(r.candidateId);
}

export const refusalReason = (r: CandidateDecision) =>
  r.reasons.length ? REASON_PLAIN[r.reasons[0]] : "it didn't pass the safety check";

export const firstSentence = (s: string) => {
  const m = s.match(/^.+?[.!?](?=\s|$)/);
  return m ? m[0] : s;
};

/** One sentence on what broke this lunch, from the stockout and the refusal facts. */
export function swapCause(view: RunView): string {
  const child = view.household.childName;
  const allergyRefusal = view.refusals.find((r) => r.reasons.includes("allergen_warning") && r.kind === "sku_substitute");
  if (view.stockout) {
    return allergyRefusal
      ? `${view.stockout.name} sold out, and the store's replacement isn't safe for ${child}.`
      : `${view.stockout.name} sold out at the store.`;
  }
  return `This lunch no longer fits ${child}'s allergy rules.`;
}

/** The allergies a parent sees as chips. Older facts carry only `blocksAllergens`. */
export interface AllergyChip {
  key: string;
  label: string;
  crossContact: boolean;
}

const titleCase = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function allergyChips(facts: HouseholdFact[]): AllergyChip[] {
  return facts
    .filter((f) => f.active && f.kind === "hard_restriction")
    .map((f) => {
      if (f.allergen) return { key: f.allergen.id, label: f.allergen.label, crossContact: f.allergen.crossContact };
      const tags = f.blocksAllergens ?? [];
      const base = tags.find((t) => !t.endsWith("_cross_contact")) ?? tags[0] ?? f.id;
      const label = base === "peanut" ? "Peanuts" : titleCase(base);
      return { key: base, label, crossContact: tags.some((t) => t.endsWith("_cross_contact")) };
    });
}

/** Headline for the status card, in plain words. */
export function statusHeadline(view: RunView): { title: string; tone: "ok" | "wait" | "plain" | "alert"; body?: string } {
  const run = view.run;
  const m = view.household.mandate;
  const total = view.receipt?.hold.totalCents ?? view.basket?.totalCents ?? null;
  const spend = total === null ? "" : `${money(total)} of ${money(m.budgetCents)}`;
  if (!run) return { title: "Nothing planned yet this week", tone: "plain", body: "LunchShift plans every Sunday. You can start this week's plan now." };
  const n = Math.max(view.proposals.length, 1);
  const byStatus: Record<RunStatus, { title: string; tone: "ok" | "wait" | "plain" | "alert"; body?: string }> = {
    scheduled: { title: "Planning your week…", tone: "plain", body: "Checking the store for this week's lunches." },
    running: { title: "Planning your week…", tone: "plain", body: "Checking the store for this week's lunches." },
    proposed: {
      title: `Waiting for you: approve ${n} change${n === 1 ? "" : "s"}`,
      tone: "wait",
      body: view.needsApproval ?? "Nothing in your cart changes until you approve.",
    },
    swapped_waiting: {
      title: "Lunches fixed · pickup not held yet",
      tone: "plain",
      body: `Your cart is ready${spend ? ` at ${spend}` : ""}. Your approval lets LunchShift swap lunches, not hold the order.`,
    },
    hold_pending: { title: "Confirming your pickup with the store…", tone: "plain", body: "The store's reply was slow, so LunchShift is checking it directly. It never places two holds." },
    hold_verified: {
      title: "Pickup held",
      tone: "ok",
      body: spend ? `${pickupWindow(m.window)} · ${spend}` : pickupWindow(m.window),
    },
    escalated: { title: "Needs you", tone: "alert", body: "LunchShift couldn't confirm the pickup hold and stopped. Nothing was paid." },
    superseded: { title: "Re-planning with your new rules…", tone: "plain", body: "Your updated rules replaced the earlier plan." },
    failed: { title: "This week's plan didn't go through", tone: "alert", body: "Nothing was held or paid. You can try again." },
  };
  return byStatus[run.status];
}

const ACTOR_PLAIN: Record<AuditEvent["actor"], string> = {
  worker: "LunchShift",
  grocer: "The store",
  parent: "You",
  operator: "Demo operator",
  statsig: "Your settings",
  cognee: "Memory",
  ranker: "LunchShift",
  llm: "LunchShift",
  sie: "Label check",
};

export const actorPlain = (e: AuditEvent) => ACTOR_PLAIN[e.actor] ?? "LunchShift";

const str = (v: unknown) => (typeof v === "string" ? v : null);

/** One friendly sentence per audit event, plus a plain detail line. No ids. */
export function describeEvent(e: AuditEvent, view: RunView): { title: string; detail: string } {
  const child = view.household.childName;
  const d = e.data;
  switch (e.type) {
    case "run_started": {
      const t = str(d.trigger);
      const title =
        t === "manual"
          ? "Started planning because you asked"
          : t === "stockout_event"
            ? "Re-checked the week after a store update"
            : t === "replay"
              ? "Re-checked an earlier store update"
              : "Started planning this week's lunches";
      return { title, detail: "Five school lunches, one store pickup, your budget and rules." };
    }
    case "memory_recalled":
      return { title: `Checked ${child}'s allergies and preferences`, detail: e.summary.replace(/\s*\(r\d+\)/g, "") + "." };
    case "allergen_screened":
      return { title: "Double-checked a product label for allergens", detail: e.summary };
    case "mode_observed": {
      const mode = str(d.mode);
      return {
        title: "Checked how much it may do on its own",
        detail: mode === "suggest_only" || mode === "auto_swap" || mode === "auto_swap_and_hold" ? `Allowed: ${modeLabel(mode)}.` : e.summary,
      };
    }
    case "autonomy_changed": {
      const to = str(d.effective) ?? str(d.to);
      const label = to === "suggest_only" || to === "auto_swap" || to === "auto_swap_and_hold" ? modeLabel(to) : null;
      return { title: label ? `Permission changed to “${label}”` : "Permission changed", detail: "Never more than your standing approval allows." };
    }
    case "stockout_detected": {
      const name = view.stockout && view.stockout.skuId === d.skuId ? view.stockout.name : e.summary.replace(/ out of stock$/, "");
      return { title: `${name} sold out at the store`, detail: "LunchShift looked for a safe replacement instead of guessing." };
    }
    case "candidate_rejected": {
      const m = e.summary.match(/^Refused (.+?):/);
      const reasons = Array.isArray(d.reasons) ? (d.reasons as RejectReason[]) : [];
      const why = reasons.length ? REASON_PLAIN[reasons[0]] ?? "it didn't pass the safety check" : "it didn't pass the safety check";
      const label = str(d.labelText);
      return {
        title: `Turned down ${m ? m[1] : "an option"}`,
        detail: `Because ${why}.${label ? ` Label: “${label}”` : ""}`,
      };
    }
    case "alternatives_ranked":
      return { title: "Compared safe lunches that fit the week", detail: "Ranked by what your child likes, prep time and what's already in the cart." };
    case "swap_proposed": {
      const day = str(d.affectedDay);
      const row = view.plan.find((p) => p.day === day);
      return {
        title: `Picked a new ${day ? DAY_NAME[day] ?? day : ""} lunch${row ? `: ${row.recipeName}` : ""}`,
        detail: view.proposals.find((p) => p.affectedDay === day)?.rationale ?? e.summary,
      };
    }
    case "swap_applied": {
      const total = typeof d.totalCents === "number" ? ` New total ${money(d.totalCents)}.` : "";
      return { title: "Updated your shopping list", detail: `The other lunches stay the same.${total}` };
    }
    case "hold_dispatched": {
      const total = typeof d.totalCents === "number" ? ` (${money(d.totalCents)})` : "";
      return { title: `Asked the store to hold your pickup${total}`, detail: "A hold reserves the groceries. Nothing is paid." };
    }
    case "hold_response_lost":
      return { title: "The store's reply got lost", detail: "LunchShift checked with the store instead of asking twice." };
    case "hold_readback":
      return { title: "Checking the hold with the store", detail: "Looks up the hold it asked for, so there's never a second one." };
    case "hold_verified":
      return { title: "The store confirmed your pickup hold", detail: "One hold, matching every item, the total and your pickup time." };
    case "hold_escalated":
      return { title: "Couldn't confirm the hold, so it stopped", detail: "Nothing was paid. Check the order or try again." };
    case "metrics_computed":
      return {
        title: "Finished the week's safety checks",
        detail: [
          d.unsafeItemsInCart === 0 ? "No unsafe items in the cart" : typeof d.unsafeItemsInCart === "number" ? `${d.unsafeItemsInCart} unsafe item(s) flagged` : null,
          d.mealCompletenessPct === 100 ? "every lunch covered" : null,
          typeof d.totalCents === "number" ? `total ${money(d.totalCents)}` : null,
        ]
          .filter(Boolean)
          .join(", ")
          .replace(/^\w/, (c) => c.toUpperCase()) + ".",
      };
    default:
      return { title: e.actor === "parent" ? "You approved the change" : e.summary, detail: e.summary };
  }
}
