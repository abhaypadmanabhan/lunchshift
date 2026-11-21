import { ShieldX } from "lucide-react";
import type { AuditEvent } from "@/lib/domain/types";
import type { RunView } from "@/lib/domain/view";
import { Button } from "@/components/ui/button";
import { REASON_LABEL, clock, money, shortDate } from "./format";
import { Code, recipeName, skuInfo } from "./primitives";

/** Label text with the sentences that matched the blocked allergen set in the refusal colour. */
import { labelExcerpt } from "@/components/parent/copy";
import { isMemoryBuilding } from "@/lib/memory/status";

function LabelQuote({ text }: { text: string }) {
  // Consecutive matching sentences merge into one highlight so it reads as one warning.
  const groups: { hit: boolean; text: string }[] = [];
  for (const sentence of text.split(/(?<=\.)\s+/)) {
    const hit = /peanut/i.test(sentence);
    const last = groups[groups.length - 1];
    if (last && last.hit === hit) last.text += ` ${sentence}`;
    else groups.push({ hit, text: sentence });
  }
  return (
    <p className="text-[1.0625rem] leading-relaxed">
      {groups.map((g, i) => (
        <span key={i}>
          {i > 0 ? " " : ""}
          {g.hit ? (
            <mark className="rounded-[3px] bg-refuse-soft px-0.5 text-refuse [box-decoration-break:clone]">{g.text}</mark>
          ) : (
            g.text
          )}
        </span>
      ))}
    </p>
  );
}

export function RefusalHero({ view, onOpenEvent }: { view: RunView; onOpenEvent: (e: AuditEvent) => void }) {
  const hero = view.refusals[0];
  const others = view.refusals.slice(1);
  const findEvent = (candidateId: string) =>
    view.events.find((e) => e.type === "candidate_rejected" && e.data.candidateId === candidateId);

  if (!hero) {
    return (
      <section className="rounded-xl border bg-card p-8">
        <p className="text-sm text-muted-foreground">No stockout this week</p>
        <h1 className="mt-2 text-[2.25rem] leading-[1.1] font-semibold tracking-[-0.025em]">
          Every usual item is in stock.
        </h1>
        <p className="mt-3 max-w-[60ch] text-muted-foreground">
          If something sells out before Sunday, the refused substitute and the evidence behind it appear here.
        </p>
      </section>
    );
  }

  const sku = skuInfo(hero.candidateId);
  const fact = view.household.facts.find((f) => f.id === hero.factId);
  const memory = view.memory;
  const recalled = memory && hero.factId ? memory.factIds.includes(hero.factId) : false;
  const providerLabel = !memory
    ? "Not recalled yet"
    : memory.provider === "cognee"
      ? "Recalled from Cognee"
      : isMemoryBuilding(memory.error)
        ? "Cognee still building · household record"
        : "Fallback memory · household record";
  const heroEvent = findEvent(hero.candidateId);
  const stockoutAt = view.events.find((e) => e.type === "stockout_detected")?.at;

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="px-8 pt-7 pb-6">
        <p className="text-sm text-muted-foreground">
          {view.stockout ? `${view.stockout.name} is out of stock` : "Stockout"}
          {stockoutAt ? ` · detected ${clock(stockoutAt)} Sunday` : ""}
        </p>
        <h1 className="mt-2 text-[2.25rem] leading-[1.08] font-semibold tracking-[-0.025em] text-balance">
          Usual bread sold out. Cheapest substitute <span className="text-refuse">refused.</span>
        </h1>
      </div>

      <div className="grid grid-cols-1 border-t md:grid-cols-2">
        <div className="px-8 py-6 md:border-r">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-base font-semibold">{sku?.name ?? hero.candidateId}</h3>
            <span className="text-sm font-medium text-refuse">Refused</span>
          </div>
          <p className="mt-1 mb-3 text-sm text-muted-foreground">
            Exact-SKU label
            {sku?.brand ? ` · ${sku.brand}` : ""}
            {hero.priceCents != null ? ` · ${money(hero.priceCents)}, cheapest in stock` : ""}
          </p>
          {hero.labelText ? (
            <>
              <LabelQuote text={labelExcerpt(hero.labelText)} />
              {labelExcerpt(hero.labelText) !== hero.labelText ? (
                <details className="mt-2 text-[0.9375rem] text-muted-foreground">
                  <summary className="cursor-pointer select-none underline decoration-dotted underline-offset-4">Show full label</summary>
                  <p className="mt-2 leading-relaxed">{hero.labelText}</p>
                </details>
              ) : null}
            </>
          ) : (
            <p className="text-muted-foreground">No label text recorded.</p>
          )}
          {hero.screen ? (
            <p className="mt-3 text-[0.9375rem]">
              <span className="text-muted-foreground">Superlinked SIE classifier agrees: </span>
              <span className="font-medium">{hero.screen.label}</span>{" "}
              <span className="font-mono text-sm text-muted-foreground">{hero.screen.score.toFixed(2)}</span>
            </p>
          ) : null}
          <p className="mt-4 flex flex-wrap gap-x-3 gap-y-1">
            <Code>{hero.candidateId}</Code>
            {hero.labelVersion ? <Code>{hero.labelVersion}</Code> : null}
          </p>
        </div>

        <div className="bg-sunken/60 px-8 py-6">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-base font-semibold">Parent-confirmed allergy</h3>
            <span className={memory?.provider === "fallback" || !memory ? "text-sm text-wait" : "text-sm text-ok"}>
              {providerLabel}
            </span>
          </div>
          <p className="mt-1 mb-3 text-sm text-muted-foreground">
            {fact
              ? `Revision ${fact.revision} · confirmed by ${fact.confirmedBy} on ${shortDate(fact.confirmedAt)}`
              : hero.factRevision != null
                ? `Revision ${hero.factRevision}`
                : "Household record"}
          </p>
          <p className="text-[1.0625rem] leading-relaxed">{fact?.text ?? hero.factText}</p>
          <p className="mt-4 flex flex-wrap gap-x-3 gap-y-1">
            {hero.factId ? <Code>{hero.factId}</Code> : null}
            {memory?.datasetId && recalled ? <Code>{memory.datasetId}</Code> : null}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t bg-refuse-soft/60 px-8 py-4">
        <p className="flex min-w-0 flex-1 items-center gap-2.5 text-[0.9375rem]">
          <ShieldX className="size-5 shrink-0 text-refuse" aria-hidden />
          <span>
            <span className="font-medium">Never entered the cart.</span>{" "}
            <span className="text-muted-foreground">Blocked by code, not the model: {REASON_LABEL[hero.reasons[0] ?? "allergen_warning"].toLowerCase()}.</span>
          </span>
        </p>
        {heroEvent ? (
          <Button variant="outline" size="lg" className="h-9 px-3.5 text-sm" onClick={() => onOpenEvent(heroEvent)}>
            Open evidence
          </Button>
        ) : null}
      </div>

      {others.length > 0 ? (
        <div className="border-t px-8 py-4">
          <p className="mb-2 text-sm text-muted-foreground">Also refused</p>
          <ul className="space-y-1.5">
            {others.map((r) => {
              const ev = findEvent(r.candidateId);
              return (
                <li key={r.candidateId} className="flex items-baseline gap-x-3 text-[0.9375rem]">
                  <span className="font-medium">{recipeName(r.candidateId)}</span>
                  <span className="text-muted-foreground">{r.reasons.map((x) => REASON_LABEL[x]).join("; ")}</span>
                  {ev ? (
                    <button
                      type="button"
                      onClick={() => onOpenEvent(ev)}
                      className="ml-auto shrink-0 rounded-sm text-sm text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground"
                    >
                      Evidence
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
