"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "cn";
import { Ban, Lock, Minus, Plus, Search, ShieldCheck, Trash2 } from "lucide-react";
import type { Order } from "@/lib/domain/types";
import type { CartLineView, CartView, RunView } from "@/lib/domain/view";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { money, refusalName, refusalReason } from "./copy";
import { AppButton, EmptyCard, Notice, ProductTile, SectionTitle, useTween } from "./ui";
import { postParent } from "./use-run-view";

type CartReply = { ok: boolean; reason?: string; cart?: CartView };

/** Budget meter: "$26.97 of $35.00", the bar and the number ease to each new total. */
function BudgetMeter({ totalCents, budgetCents }: { totalCents: number; budgetCents: number }) {
  const shown = useTween(totalCents);
  const pct = budgetCents > 0 ? Math.min(100, (totalCents / budgetCents) * 100) : 0;
  const over = totalCents > budgetCents;
  const left = budgetCents - totalCents;
  return (
    <section aria-label="Budget" className="rounded-xl bg-card p-5 shadow-[0_1px_0_var(--border)]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <p className="text-[2rem] font-semibold leading-none tracking-[-0.02em] tabular-nums">
          {money(Math.round(shown))}
          <span className="ml-2 text-base font-normal tracking-normal text-muted-foreground">of {money(budgetCents)}</span>
        </p>
        <p className={cn("text-[0.9375rem] tabular-nums", over ? "font-medium text-refuse" : "text-muted-foreground")}>
          {over ? `${money(-left)} over` : `${money(left)} left`}
        </p>
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={budgetCents}
        aria-valuenow={totalCents}
        aria-valuetext={`${money(totalCents)} of ${money(budgetCents)} weekly budget`}
        className="mt-4 h-2 overflow-hidden rounded-full bg-foreground/10"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-[420ms] ease-[var(--ease-out)] motion-reduce:transition-none",
            over ? "bg-refuse" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </section>
  );
}

function Stepper({ line, packs, disabled, onChange }: { line: CartLineView; packs: number; disabled: boolean; onChange: (n: number) => void }) {
  const btn =
    "inline-flex size-11 items-center justify-center rounded-lg text-foreground transition-colors duration-[var(--dur-fast)] hover:bg-secondary active:bg-muted disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="inline-flex items-center rounded-xl border border-input/30 bg-background" role="group" aria-label={`Quantity of ${line.name}`}>
      <button
        type="button"
        className={btn}
        disabled={disabled}
        onClick={() => onChange(packs - 1)}
        aria-label={packs <= 1 ? `Remove ${line.name}` : `One less ${line.name}`}
      >
        {packs <= 1 ? <Trash2 className="size-[1.125rem]" aria-hidden /> : <Minus className="size-[1.125rem]" aria-hidden />}
      </button>
      <span className="w-7 text-center text-base font-medium tabular-nums" aria-live="polite">
        {packs}
      </span>
      <button type="button" className={btn} disabled={disabled} onClick={() => onChange(packs + 1)} aria-label={`One more ${line.name}`}>
        <Plus className="size-[1.125rem]" aria-hidden />
      </button>
    </div>
  );
}

function AddItemSheet({
  cart,
  open,
  onOpenChange,
  onAdd,
  pending,
  refusals,
}: {
  cart: CartView;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdd: (skuId: string) => void;
  pending: Set<string>;
  refusals: Record<string, string>;
}) {
  const [q, setQ] = useState("");
  const searchId = useId();
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? cart.catalog.filter((c) => `${c.name} ${c.brand}`.toLowerCase().includes(t)) : cart.catalog;
    // Safe items first, then the ones LunchShift rules out, so the reason is still visible.
    return [...list].sort((a, b) => Number(b.safe) - Number(a.safe));
  }, [q, cart.catalog]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="ls-parent mx-auto flex max-h-[88vh] w-full max-w-[440px] flex-col gap-0 rounded-t-2xl bg-card">
        <SheetHeader className="px-5 pt-6 pb-3">
          <SheetTitle className="pr-8 text-xl font-semibold tracking-[-0.01em]">Add an item</SheetTitle>
          <SheetDescription className="text-base">Every product is checked against your child&apos;s allergies first.</SheetDescription>
        </SheetHeader>
        <div className="px-5 pb-3">
          <label htmlFor={searchId} className="sr-only">
            Search the store
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-[1.125rem] -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              id={searchId}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search bread, fruit, snacks…"
              autoComplete="off"
              className="h-12 w-full rounded-xl border border-input/40 bg-background pr-3 pl-10 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
          {results.length ? (
            <ul className="ls-stagger divide-y">
              {results.map((c) => {
                const refused = refusals[c.skuId];
                return (
                  <li key={c.skuId} className="py-3">
                    <div className={cn("flex items-center gap-3", !c.safe && "opacity-80")}>
                      <ProductTile src={c.imageUrl} name={c.name} brand={c.brand} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base font-medium leading-snug">{c.name}</p>
                        <p className="text-[0.9375rem] text-muted-foreground">
                          {c.brand} · <span className="tabular-nums">{money(c.priceCents)}</span>
                        </p>
                      </div>
                      {c.safe ? (
                        <AppButton
                          variant="secondary"
                          className="min-w-[4.5rem]"
                          busy={pending.has(c.skuId)}
                          onClick={() => onAdd(c.skuId)}
                          aria-label={`Add ${c.name}`}
                        >
                          Add
                        </AppButton>
                      ) : (
                        <span
                          className="inline-flex min-h-11 items-center rounded-lg px-3 text-[0.9375rem] text-muted-foreground"
                          aria-label={`${c.name} can't be added`}
                        >
                          Can&apos;t add
                        </span>
                      )}
                    </div>
                    {!c.safe && c.reason ? <p className="mt-2 pl-[3.75rem] text-[0.9375rem] text-refuse">{c.reason}</p> : null}
                    {refused ? (
                      <div className="mt-2 pl-[3.75rem]">
                        <Notice tone="alert">{refused}</Notice>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="py-8 text-center text-base text-muted-foreground">Nothing at the store matches “{q.trim()}”.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

const shopping = (view: RunView) => view.run?.status === "running" || view.run?.status === "scheduled";

/** "Shopping for Maya's week": shown while the agent fills the cart, live. */
function ShoppingNow({ view, count }: { view: RunView; count: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-ok-soft px-5 py-4" role="status" aria-live="polite">
      <span className="relative flex size-3 shrink-0" aria-hidden>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/50 motion-reduce:animate-none" />
        <span className="relative inline-flex size-3 rounded-full bg-primary" />
      </span>
      <p className="min-w-0 flex-1 text-base">
        <span className="font-medium">Shopping for {view.household.childName || "your child"}&apos;s week</span>
      </p>
      <span className="shrink-0 text-[0.9375rem] text-muted-foreground tabular-nums">{count} so far</span>
    </div>
  );
}

/** Review: one next step for this week's cart, depending on what the agent may do on its own. */
function ReviewBar({ view, onRefresh, onOpenOrder }: { view: RunView; onRefresh: () => Promise<void>; onOpenOrder: (o: Order) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const status = view.run?.status;
  const act = async (path: string) => {
    setBusy(true);
    setErr(null);
    const res = await postParent<{ ok: boolean; order?: Order }>(path);
    setBusy(false);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    await onRefresh();
    if (res.data.order) onOpenOrder(res.data.order);
  };

  let body: ReactNode = null;
  if (view.order) {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <ShieldCheck className="size-6 shrink-0 text-primary" aria-hidden />
        <p className="min-w-0 flex-1 leading-snug">
          <span className="block text-base font-medium">Order placed</span>
          <span className="block text-[0.9375rem] text-muted-foreground">Pay at pickup</span>
        </p>
        <AppButton onClick={() => view.order && onOpenOrder(view.order)}>View order</AppButton>
      </div>
    );
  } else if (status === "hold_verified") {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <Lock className="size-5 shrink-0 text-primary" aria-hidden />
        <p className="min-w-0 flex-1 leading-snug">
          <span className="block text-base font-medium">Held automatically</span>
          <span className="block text-[0.9375rem] text-muted-foreground">Nothing paid yet</span>
        </p>
        <AppButton busy={busy} onClick={() => void act("/api/parent/order")}>
          Place order
        </AppButton>
      </div>
    );
  } else if (view.needsApproval && status === "proposed") {
    body = (
      <div className="space-y-3">
        <p className="text-base text-muted-foreground">{view.needsApproval}</p>
        <AppButton className="w-full" busy={busy} onClick={() => void act("/api/parent/approve")}>
          Approve this cart
        </AppButton>
      </div>
    );
  } else if (status === "hold_pending") {
    body = <p className="text-base text-muted-foreground">Holding your pickup with the store…</p>;
  } else {
    return null;
  }
  return (
    <section aria-label="Review" className="ls-enter space-y-3 rounded-xl bg-card p-4 shadow-[0_1px_0_var(--border)]">
      {body}
      {err ? <Notice tone="alert">{err}</Notice> : null}
    </section>
  );
}

export function CartTab({
  view,
  onRefresh,
  onPlan,
  onOpenOrder,
}: {
  view: RunView;
  onRefresh: () => Promise<void>;
  onPlan: () => void;
  onOpenOrder: (o: Order) => void;
}) {
  // Lines already on screen; anything new that arrives with a poll slides in with the "just arrived" wash.
  const seenLines = useRef<Set<string> | null>(null);
  // Optimistic quantities while a change is in flight, and the server's own cart from the last reply.
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [replyCart, setReplyCart] = useState<CartView | null>(null);
  const [lineMsg, setLineMsg] = useState<Record<string, string>>({});
  const [addRefusals, setAddRefusals] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busyCancel, setBusyCancel] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "ok" | "alert";
    text: string;
  } | null>(null);

  // A fresh poll supersedes the last POST reply.
  useEffect(() => setReplyCart(null), [view.generatedAt]);

  const cart = replyCart ?? view.cart;
  const firstPaint = seenLines.current === null;
  const arrived = new Set(firstPaint ? [] : (cart?.lines ?? []).map((l) => l.skuId).filter((id) => !seenLines.current?.has(id)));
  useEffect(() => {
    seenLines.current = new Set((cart?.lines ?? []).map((l) => l.skuId));
  });
  const live = shopping(view);
  const refused = view.refusals.filter((r) => !r.eligible && r.kind === "sku_substitute");
  if (!cart && live) {
    return (
      <div className="space-y-6">
        <ShoppingNow view={view} count={0} />
        <EmptyCard title="Starting at the store" body="Items appear here as LunchShift picks them." />
      </div>
    );
  }
  if (!cart) {
    return (
      <EmptyCard
        title={view.run ? "Your cart is being built" : "No cart yet this week"}
        body={
          view.run
            ? "LunchShift is checking the store. Your groceries appear here in a few seconds."
            : "LunchShift fills the cart from this week's lunches. Plan the week to start."
        }
      >
        {!view.run ? <AppButton onClick={onPlan}>Plan my week</AppButton> : null}
      </EmptyCard>
    );
  }

  const lines = cart.lines
    .map((l) => {
      const packs = overrides[l.skuId] ?? l.packs;
      return { ...l, packs, lineCents: l.unitPriceCents * packs };
    })
    .filter((l) => l.packs > 0);
  const total = Object.keys(overrides).length ? lines.reduce((t, l) => t + l.lineCents, 0) : cart.totalCents;
  const locked = !cart.editable;

  const setPacks = async (skuId: string, packs: number) => {
    setOverrides((o) => ({ ...o, [skuId]: packs }));
    setLineMsg((m) => ({ ...m, [skuId]: "" }));
    const res = await postParent<CartReply>("/api/parent/cart", {
      skuId,
      packs,
    });
    setOverrides((o) => {
      const next = { ...o };
      delete next[skuId];
      return next;
    });
    if (!res.ok) {
      setLineMsg((m) => ({ ...m, [skuId]: res.message }));
      return;
    }
    if (res.data.cart) setReplyCart(res.data.cart);
    await onRefresh();
  };

  const add = async (skuId: string) => {
    setAdding((s) => new Set(s).add(skuId));
    setAddRefusals((r) => ({ ...r, [skuId]: "" }));
    const res = await postParent<CartReply>("/api/parent/cart", {
      skuId,
      packs: 1,
    });
    setAdding((s) => {
      const n = new Set(s);
      n.delete(skuId);
      return n;
    });
    if (!res.ok) {
      setAddRefusals((r) => ({ ...r, [skuId]: res.message }));
      return;
    }
    if (res.data.cart) setReplyCart(res.data.cart);
    setSheetOpen(false);
    const name = cart.catalog.find((c) => c.skuId === skuId)?.name ?? "Item";
    setNotice({
      tone: "ok",
      text: `${name} added. LunchShift checked the label first.`,
    });
    await onRefresh();
  };

  const cancelHold = async () => {
    setBusyCancel(true);
    const res = await postParent("/api/parent/cancel-hold");
    setBusyCancel(false);
    setNotice(
      res.ok
        ? {
            tone: "ok",
            text: "Hold released. You can edit the cart now; nothing was paid.",
          }
        : { tone: "alert", text: res.message },
    );
    if (res.ok) await onRefresh();
  };

  return (
    /* Wide main column (desktop): the list on the left, the budget and review in a sticky summary on the right. */
    <div className="space-y-8 @2xl:grid @2xl:grid-cols-[minmax(0,1fr)_18rem] @2xl:items-start @2xl:gap-x-8 @2xl:space-y-0">
      <div className="space-y-8 @2xl:sticky @2xl:top-[calc(var(--ls-top)+2rem)] @2xl:col-start-2 @2xl:row-start-1">
        {live ? <ShoppingNow view={view} count={lines.length} /> : null}
        <BudgetMeter totalCents={total} budgetCents={cart.budgetCents} />
        {live ? null : <ReviewBar view={view} onRefresh={onRefresh} onOpenOrder={onOpenOrder} />}

        {locked && view.run?.status === "hold_verified" && !view.order ? (
          <p className="-mt-5 px-1 text-[0.9375rem] text-muted-foreground">
            Want to change something?{" "}
            <AppButton variant="quiet" busy={busyCancel} onClick={() => void cancelHold()} className="text-[0.9375rem]">
              Cancel the hold
            </AppButton>{" "}
            to edit.
          </p>
        ) : null}

        {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
      </div>

      <div className="space-y-8 @2xl:col-start-1 @2xl:row-start-1">
        <section aria-labelledby="cart-title" className="space-y-3">
          <SectionTitle aside={`${lines.length} item${lines.length === 1 ? "" : "s"}`}>
            <span id="cart-title">{cart.source === "parent_draft" ? "Your cart" : "Picked by LunchShift"}</span>
          </SectionTitle>
          {lines.length ? (
            <ul className={cn("divide-y overflow-hidden rounded-xl bg-card shadow-[0_1px_0_var(--border)]", firstPaint && "ls-stagger")}>
              {lines.map((l) => (
                <li key={l.skuId} className={cn("px-4 py-4", arrived.has(l.skuId) && "ls-arrive-in")}>
                  <div className="flex gap-3">
                    <ProductTile src={l.imageUrl} name={l.name} brand={l.brand} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="min-w-0 text-base font-medium leading-snug">{l.name}</p>
                        <p className="shrink-0 text-base font-medium tabular-nums">{money(l.lineCents)}</p>
                      </div>
                      <p className="text-[0.9375rem] text-muted-foreground">{l.brand}</p>
                      {l.usedBy.length ? <p className="mt-0.5 text-[0.9375rem] leading-snug text-muted-foreground">For {l.usedBy.join(", ")}</p> : null}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 pl-[4.75rem]">
                    <p className="text-[0.9375rem] text-muted-foreground tabular-nums">{money(l.unitPriceCents)} each</p>
                    {locked ? (
                      l.packs > 1 ? (
                        <span className="shrink-0 text-[0.9375rem] text-muted-foreground tabular-nums">× {l.packs}</span>
                      ) : null
                    ) : (
                      <Stepper line={l} packs={l.packs} disabled={l.skuId in overrides} onChange={(n) => void setPacks(l.skuId, Math.max(0, n))} />
                    )}
                  </div>
                  {lineMsg[l.skuId] ? (
                    <div className="mt-3">
                      <Notice tone="alert">{lineMsg[l.skuId]}</Notice>
                    </div>
                  ) : null}
                </li>
              ))}
              {refused.map((r) => (
                <li key={r.candidateId} className="flex items-center gap-3 bg-refuse-soft/60 px-4 py-3.5">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-card text-refuse" aria-hidden>
                    <Ban className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-medium leading-snug text-foreground/80 line-through decoration-refuse/50">{refusalName(view, r)}</p>
                    <p className="text-[0.9375rem] text-refuse">
                      Refused ·{" "}
                      {cart.catalog
                        .find((c) => c.skuId === r.candidateId)
                        ?.reason?.split(":")[0]
                        .toLowerCase() ?? refusalReason(r)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyCard title="Your cart is empty" body="Add what the week's lunches need. LunchShift checks every label against your child's allergies." />
          )}
        </section>

        {locked ? null : (
          <AppButton variant="secondary" className="w-full" onClick={() => setSheetOpen(true)}>
            <Plus className="size-[1.125rem]" aria-hidden /> Add item
          </AppButton>
        )}
      </div>

      <AddItemSheet cart={cart} open={sheetOpen} onOpenChange={setSheetOpen} onAdd={(id) => void add(id)} pending={adding} refusals={addRefusals} />
    </div>
  );
}
