// The agent's side of the product: each audit event as one short line, credited to the service that did it.
import type { AuditEvent } from "@/lib/domain/types";
import type { RunView } from "@/lib/domain/view";
import { DAY_NAME, money } from "./copy";

export type Sponsor = "Cognee" | "Superlinked SIE" | "SingleStore" | "Claude" | "Statsig" | "Store" | "LunchShift" | "You";

export interface FeedLine {
  key: string;
  at: string;
  sponsor: Sponsor;
  text: string;
  /** "refuse" marks a safety refusal, "done" a confirmed outcome. */
  tone?: "refuse" | "done";
  /** Literal values (a flag value, a score, a short reference) shown in mono. */
  mono?: string;
}

const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" ? v : null);

function productName(view: RunView, skuId: string): string {
  const c = view.cart;
  return (
    c?.lines.find((l) => l.skuId === skuId)?.name ??
    c?.catalog.find((x) => x.skuId === skuId)?.name ??
    skuId.replace(/-/g, " ").replace(/^\w/, (x) => x.toUpperCase())
  );
}

const shortRef = (id: string | null) => id?.match(/[0-9a-f]{8,}/i)?.[0].slice(0, 8).toUpperCase() ?? null;

function line(e: AuditEvent, view: RunView): Omit<FeedLine, "key" | "at"> | null {
  const d = e.data;
  const child = view.household.childName || "your child";
  switch (e.type) {
    case "run_started": {
      const t = str(d.trigger);
      return {
        sponsor: "LunchShift",
        text: t === "manual" ? "Started planning, as you asked" : t === "stockout_event" || t === "replay" ? "Re-checked the week after a store update" : "Started Sunday's lunch plan",
      };
    }
    case "mode_observed":
      return { sponsor: "Statsig", text: "Autonomy rule says", mono: str(d.mode) ?? undefined };
    case "autonomy_changed":
      return { sponsor: "Statsig", text: "Autonomy changed to", mono: str(d.effective) ?? str(d.to) ?? undefined };
    case "memory_recalled": {
      const m = e.summary.match(/^Recalled (.+)$/);
      return { sponsor: "Cognee", text: m ? `Recalled ${child}'s ${m[1].replace(/\s*\(r\d+\)/g, "")}` : `Recalled ${child}'s allergy rules` };
    }
    case "allergen_screened": {
      if (d.error) return { sponsor: "Superlinked SIE", text: "Label check offline · rules decide alone" };
      const results = (d.results ?? {}) as Record<string, { score?: number; risk?: boolean }>;
      const flagged = Object.entries(results)
        .filter(([, r]) => r.risk)
        .sort((a, b) => (b[1].score ?? 0) - (a[1].score ?? 0));
      if (!flagged.length) return { sponsor: "Superlinked SIE", text: `Screened ${Object.keys(results).length} labels · none flagged` };
      const [skuId, r] = flagged[0];
      return { sponsor: "Superlinked SIE", text: `Flagged the ${productName(view, skuId)} label`, mono: r.score?.toFixed(2), tone: "refuse" };
    }
    case "stockout_detected": {
      const name = view.stockout && view.stockout.skuId === d.skuId ? view.stockout.name : e.summary.replace(/ out of stock$/, "");
      return { sponsor: "Store", text: `${name} sold out` };
    }
    case "candidate_rejected": {
      if (e.actor === "parent") {
        const p = e.summary.match(/^Parent tried to add (.+?): refused/);
        return { sponsor: "LunchShift", text: `Kept ${p?.[1] ?? "an unsafe item"} out of your cart`, tone: "refuse" };
      }
      const m = e.summary.match(/^Refused (.+?): (.+)$/);
      return { sponsor: "LunchShift", text: m ? `Refused ${m[1]} · ${m[2]}` : "Refused an unsafe option", tone: "refuse" };
    }
    case "alternatives_ranked": {
      const provider = str(d.provider);
      const n = Array.isArray(d.ranked) ? d.ranked.length : null;
      return {
        sponsor: provider === "sie" ? "Superlinked SIE" : provider === "local_vector" ? "LunchShift" : "SingleStore",
        text: `Ranked ${n ?? "the"} safe lunch${n === 1 ? "" : "es"} for ${child}`,
      };
    }
    case "swap_proposed": {
      const day = str(d.affectedDay);
      const row = view.plan.find((p) => p.day === day);
      const who: Sponsor = str(d.rationaleProvider) === "anthropic" ? "Claude" : "LunchShift";
      return { sponsor: who, text: `Explained ${day ? (DAY_NAME[day] ?? day) : "the"} swap${row ? `: ${row.recipeName.replace(/ \+ .*$/, "").toLowerCase()}` : ""}` };
    }
    case "swap_applied": {
      const t = num(d.totalCents);
      return { sponsor: "LunchShift", text: "Swapped the lunch, kept the other four", mono: t === null ? undefined : money(t) };
    }
    case "hold_dispatched":
      return { sponsor: "Store", text: "Asked the store to hold the pickup", mono: num(d.totalCents) === null ? undefined : money(num(d.totalCents)!) };
    case "hold_response_lost":
      return { sponsor: "Store", text: "Store reply dropped · reading back, not retrying" };
    case "hold_readback":
      return { sponsor: "Store", text: "Read the hold back by key" };
    case "hold_verified":
      return { sponsor: "Store", text: "Held the pickup · one hold, verified", mono: shortRef(str(d.holdId)) ?? undefined, tone: "done" };
    case "hold_escalated":
      return { sponsor: "LunchShift", text: "Stopped and asked you · nothing paid", tone: "refuse" };
    case "order_placed":
      return { sponsor: "Store", text: "Order placed · pay at pickup", tone: "done" };
    case "order_response_lost":
      return { sponsor: "Store", text: "Order reply dropped · reading back by key" };
    case "cart_edited":
      return { sponsor: "You", text: "You edited the cart" };
    case "metrics_computed": {
      const unsafe = num(d.unsafeItemsInCart);
      return { sponsor: "Statsig", text: unsafe === 0 ? "Logged the week · 0 unsafe items" : "Logged the week's safety checks" };
    }
    case "note": {
      if (e.actor === "operator") return null;
      if (/^Needs parent approval/.test(e.summary)) return { sponsor: "LunchShift", text: "Waiting for your approval" };
      if (/waiting for hold authority/.test(e.summary)) return { sponsor: "LunchShift", text: "Cart ready · not allowed to hold yet" };
      if (/^Hold skipped/.test(e.summary)) return { sponsor: "LunchShift", text: "Skipped the hold · not allowed yet" };
      return null;
    }
    default:
      return e.actor === "parent" ? { sponsor: "You", text: "You approved the change" } : null;
  }
}

/** Oldest first, so the newest step lands at the bottom of the panel. */
export function feedLines(view: RunView): FeedLine[] {
  return [...view.events]
    .sort((a, b) => (a.at === b.at ? a.seq - b.seq : a.at.localeCompare(b.at)))
    .flatMap((e) => {
      const l = line(e, view);
      return l ? [{ key: `${e.runId}:${e.seq}`, at: e.at, ...l }] : [];
    });
}
