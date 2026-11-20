"use client";

import { useState } from "react";
import { ArrowRight, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RunView } from "@/lib/domain/view";
import { money } from "./format";
import { Code, Panel, recipeInfo, recipeName, skuInfo } from "./primitives";

const DAY_NAME: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday" };

const PROVIDER_LABEL = {
  sie: "Superlinked SIE ranking",
  singlestore_vector: "Ranked in SingleStore by vector dot product (SIE key pending)",
  local_vector: "Local vector ranking (fallback)",
} as const;

function SkuList({ ids, sign }: { ids: string[]; sign: "remove" | "add" | "keep" }) {
  return (
    <ul className="space-y-2">
      {ids.map((id) => {
        const s = skuInfo(id);
        return (
          <li key={id} className="flex items-start gap-2">
            {sign === "remove" ? (
              <Minus className="mt-1 size-4 shrink-0 text-refuse" aria-label="Removed" />
            ) : sign === "add" ? (
              <Plus className="mt-1 size-4 shrink-0 text-ok" aria-label="Added" />
            ) : (
              <span className="mt-1 size-4 shrink-0 text-center text-muted-foreground" aria-label="Kept">=</span>
            )}
            <span className="min-w-0">
              <span className={sign === "remove" ? "text-muted-foreground line-through decoration-refuse/50" : ""}>
                {s?.name ?? id}
              </span>
              <span className="block">
                <Code>{id}</Code>
                {s ? <span className="ml-2 text-sm text-muted-foreground">{money(s.priceCents)}</span> : null}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function WeekPlan({ view, onApprove }: { view: RunView; onApprove?: () => Promise<void> }) {
  const { plan, proposal } = view;
  const changed = plan.find((p) => p.status !== "kept");
  const keptCount = plan.filter((p) => p.status === "kept").length;

  if (plan.length === 0) {
    return (
      <Panel title="This week's lunches">
        <p className="text-muted-foreground">No plan loaded yet. Run the Sunday order to build this week&apos;s five lunches.</p>
      </Panel>
    );
  }

  return (
    <Panel
      title="This week's lunches"
      aside={changed ? `${keptCount} kept · 1 ${changed.status === "proposed_swap" ? "proposed swap" : "swapped"}` : "All five kept"}
    >
      <ol className="divide-y border-y">
        {plan.map((p) => {
          const isChanged = p.status !== "kept";
          return (
            <li key={p.day} className="grid grid-cols-[5rem_1fr_auto] md:grid-cols-[7rem_1fr_auto] items-baseline gap-4 py-3">
              <span className="text-[0.9375rem] text-muted-foreground">{DAY_NAME[p.day] ?? p.day}</span>
              <span className="min-w-0">
                {isChanged && p.replacedRecipeName ? (
                  <span className="mr-2 text-muted-foreground line-through decoration-refuse/50">{p.replacedRecipeName}</span>
                ) : null}
                {isChanged ? <ArrowRight className="mr-2 inline size-4 text-muted-foreground" aria-hidden /> : null}
                <span className={isChanged ? "font-semibold" : ""}>{p.recipeName}</span>
              </span>
              <span className={isChanged ? (p.status === "swapped" ? "text-sm font-medium text-ok" : "text-sm font-medium text-wait") : "text-sm text-muted-foreground"}>
                {p.status === "kept" ? "Kept" : p.status === "swapped" ? "Swapped" : "Proposed, waiting for approval"}
              </span>
            </li>
          );
        })}
      </ol>

      {changed?.status === "proposed_swap" && view.run?.status === "proposed" && onApprove ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-lg bg-wait-soft px-4 py-3">
          <p className="text-[0.9375rem]">
            <span className="font-medium">Suggest-only mode.</span>{" "}
            <span className="text-muted-foreground">Nothing changes in the cart or at the store until you approve.</span>
          </p>
          <ApproveButton onApprove={onApprove} />
        </div>
      ) : null}

      {proposal ? (
        <div className="mt-6">
          <h3 className="text-base font-semibold">
            {DAY_NAME[proposal.affectedDay]}: the whole lunch changes, not just the bread
          </h3>
          <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-3">
            <div>
              <p className="mb-2 text-sm text-muted-foreground">Removed</p>
              <SkuList ids={proposal.removedSkuIds} sign="remove" />
            </div>
            <div>
              <p className="mb-2 text-sm text-muted-foreground">Added</p>
              <SkuList ids={proposal.addedSkuIds} sign="add" />
            </div>
            <div>
              <p className="mb-2 text-sm text-muted-foreground">Kept, shared with other lunches</p>
              <SkuList ids={proposal.keptSharedSkuIds} sign="keep" />
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-[1.15fr_1fr] border-t pt-5">
            <div>
              <p className="text-sm text-muted-foreground">{PROVIDER_LABEL[proposal.ranking.provider]}</p>
              {proposal.ranking.provider === "singlestore_vector" ? (
                <Code className="mt-1 block text-[0.8125rem] leading-snug text-muted-foreground">
                  SELECT recipe_id, vec &lt;*&gt; :query AS score FROM ls_rank_vec ORDER BY score DESC
                </Code>
              ) : null}
              <ul className="mt-3 space-y-3">
                {proposal.ranking.ranked.map((r) => {
                  const chosen = r.id === proposal.toRecipeId;
                  const info = recipeInfo(r.id);
                  return (
                    <li key={r.id}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className={chosen ? "truncate font-medium" : "truncate text-muted-foreground"}>{recipeName(r.id)}</span>
                        <span className="shrink-0 whitespace-nowrap">
                          {info ? <span className="mr-3 text-sm text-muted-foreground">{info.prepMinutes} min</span> : null}
                          <span className={chosen ? "font-medium" : "text-muted-foreground"}>{r.score.toFixed(3)}</span>
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken">
                        <div
                          className={chosen ? "h-full bg-primary" : "h-full bg-muted-foreground/35"}
                          style={{ width: `${Math.max(4, Math.min(100, r.score * 100))}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-sm text-muted-foreground">
                Cart {money(proposal.before.totalCents)} <ArrowRight className="inline size-3.5" aria-hidden /> {money(proposal.after.totalCents)}
              </p>
            </div>
            <figure>
              <blockquote className="text-[1.0625rem] leading-relaxed">{proposal.rationale}</blockquote>
              <figcaption className="mt-2 text-sm text-muted-foreground">
                {proposal.rationaleProvider === "anthropic" ? "Explained by Claude, choosing only among eligible lunches" : "Template explanation (model unavailable)"}
              </figcaption>
            </figure>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function ApproveButton({ onApprove }: { onApprove: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onApprove();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Approving…" : "Approve swap and hold"}
    </Button>
  );
}
