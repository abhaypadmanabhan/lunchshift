"use client";

import { Fragment, type ReactNode } from "react";
import { ChevronRight, ShieldCheck } from "lucide-react";
import type { CandidateDecision } from "@/lib/domain/types";
import type { RunView } from "@/lib/domain/view";
import { allergyChips, money, refusalName } from "./copy";
import { labelExcerpt } from "./copy";
import { ProductTile } from "./ui";

/** The refusal worth showing: a store product refused for an allergy, else any refusal tied to an allergy rule. */
export function heroRefusal(view: RunView): CandidateDecision | null {
  const r = view.refusals;
  return (
    r.find((x) => x.kind === "sku_substitute" && (x.reasons.includes("allergen_warning") || x.reasons.includes("classifier_flag"))) ??
    r.find((x) => x.kind === "sku_substitute" && !!x.factId) ??
    r.find((x) => !!x.factId) ??
    null
  );
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Wraps the allergen words (and "may contain" style warnings) in a highlight. */
function highlight(text: string, terms: string[]): ReactNode {
  const words = [...new Set([...terms, "may contain", "traces of"])].filter((t) => t.length > 2).sort((a, b) => b.length - a.length);
  if (!words.length) return text;
  const re = new RegExp(`(${words.map(escape).join("|")})`, "gi");
  return text.split(re).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded-[0.25rem] bg-refuse/12 px-0.5 font-medium text-refuse">
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

const confirmedDay = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00-08:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });

export function SafetyHero({ view, onWhy }: { view: RunView; onWhy: () => void }) {
  const r = heroRefusal(view);
  if (!r) return null;
  const child = view.household.childName || "your child";
  const name = refusalName(view, r);
  const product = view.cart?.catalog.find((c) => c.skuId === r.candidateId);
  const price = r.priceCents ?? product?.priceCents;
  const fact = view.household.facts.find((f) => f.id === r.factId) ?? view.household.facts.find((f) => f.active && f.kind === "hard_restriction");
  const chip = fact ? allergyChips([fact])[0] : undefined;
  const terms = [
    ...(fact?.allergen?.terms ?? []),
    ...(fact?.blocksAllergens ?? []).map((t) => t.replace(/_cross_contact$/, "")),
    ...(fact?.allergen?.label ? [fact.allergen.label.toLowerCase()] : []),
  ];
  const others = view.refusals.length - 1;
  const allergyLabel = chip ? `${chip.label.replace(/s$/, "")} allergy` : "Allergy rule";

  return (
    <section aria-labelledby="safe-title" className="ls-enter overflow-hidden rounded-xl bg-card shadow-[0_1px_0_var(--border)]">
      <div className="flex items-center gap-2.5 px-5 pt-5">
        <ShieldCheck className="size-6 shrink-0 text-ok" strokeWidth={2} aria-hidden />
        <h2 id="safe-title" className="text-[1.375rem] font-semibold leading-tight tracking-[-0.015em]">
          Kept {child} safe
        </h2>
      </div>

      <div className="mx-3 mt-4 rounded-lg bg-refuse-soft p-4">
        <div className="flex items-center gap-3.5">
          <ProductTile src={product?.imageUrl} name={name} brand={product?.brand ?? name} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-[1.0625rem] font-medium leading-snug">{name}</p>
            <p className="text-[0.9375rem] tabular-nums">
              <span className="font-medium text-refuse">Refused</span>
              <span className="text-muted-foreground">{price !== undefined ? ` · ${money(price)}` : ""} · store&apos;s swap</span>
            </p>
          </div>
        </div>
        {r.labelText ? (
          <p className="mt-3 text-[1rem] leading-relaxed text-foreground/90">“{highlight(labelExcerpt(r.labelText), terms)}”</p>
        ) : null}
        {r.screen?.risk ? (
          <p className="mt-1 text-[0.9375rem] text-muted-foreground tabular-nums">
            Label check agreed · <span className="font-mono text-foreground/80">{r.screen.score.toFixed(2)}</span>
          </p>
        ) : null}
      </div>

      <div className="px-5 pt-3.5 pb-4">
        <p className="text-[1.0625rem] font-medium text-ok">Never added to your cart</p>
        {fact ? (
          <p className="mt-2">
            <span className="inline-block rounded-lg bg-sunken px-3 py-1.5 text-[0.9375rem] leading-snug text-muted-foreground">
              <span className="font-medium text-foreground">{allergyLabel}</span> · confirmed by you {confirmedDay(fact.confirmedAt)}
              {view.memory?.provider === "cognee" ? " · recalled from memory" : ""}
            </span>
          </p>
        ) : null}
        <button
          type="button"
          onClick={onWhy}
          className="mt-1 -mb-1 inline-flex min-h-11 items-center gap-1 rounded-md text-base font-medium text-primary underline-offset-4 hover:underline"
        >
          {others > 0 ? `Why? · ${others} more refused` : "Why?"} <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
    </section>
  );
}
