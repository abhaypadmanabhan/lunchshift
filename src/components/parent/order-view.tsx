"use client";

import { useState } from "react";
import { cn } from "cn";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import type { Order } from "@/lib/domain/types";
import type { RunView } from "@/lib/domain/view";
import { ORDER_STATUS, money, shortDate, skuName, slotLabel, timeOfDay } from "./copy";
import { AppButton, Notice } from "./ui";
import { postParent } from "./use-run-view";

/** This week's order on the This week tab: place it after a verified hold, or open the one already placed. */
export function OrderCard({ view, onOpen, onRefresh }: { view: RunView; onOpen: (o: Order, justPlaced: boolean) => void; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const order = view.order;
  const held = view.run?.status === "hold_verified" && view.receipt?.hold.status === "active";

  if (order) {
    const byAgent = order.placedBy === "agent";
    return (
      <section aria-labelledby="order-card-title" className="ls-enter rounded-xl bg-card p-5 shadow-[0_1px_0_var(--border)]">
        <p className="text-[0.9375rem] text-muted-foreground">{byAgent ? "Order placed by LunchShift" : "Order placed"}</p>
        <div className="mt-1 flex items-baseline justify-between gap-4">
          <h2 id="order-card-title" className="font-mono text-[1.375rem] font-medium tracking-[-0.01em]">
            {order.orderId}
          </h2>
          <span className="text-lg font-semibold tabular-nums">{money(order.totalCents)}</span>
        </div>
        <p className="mt-1 text-base text-muted-foreground">
          {slotLabel(order.slot)} · pay at pickup
        </p>
        <AppButton variant="secondary" className="mt-4 w-full" onClick={() => onOpen(order, false)}>
          View order <ChevronRight className="size-4" aria-hidden />
        </AppButton>
      </section>
    );
  }

  if (!held) return null;

  const place = async () => {
    setBusy(true);
    setErr(null);
    const res = await postParent<{ ok: boolean; order?: Order }>("/api/parent/order");
    setBusy(false);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    if (res.data.order) onOpen(res.data.order, true);
    await onRefresh();
  };

  const total = view.receipt?.hold.totalCents ?? view.cart?.totalCents ?? 0;
  return (
    <section
      aria-labelledby="place-title"
      className="ls-enter relative overflow-hidden rounded-2xl bg-[linear-gradient(160deg,var(--ok-soft),var(--card)_70%)] p-6 shadow-[0_1px_0_var(--border),0_10px_30px_-18px_oklch(0.47_0.085_155/0.45)]"
    >
      <p className="text-[0.9375rem] font-medium text-ok">Groceries held at the store</p>
      <h2 id="place-title" className="mt-1 text-[1.5rem] font-semibold leading-tight tracking-[-0.02em]">
        Ready to order
      </h2>
      <p className="mt-1.5 text-base text-muted-foreground">
        <span className="tabular-nums">{money(total)}</span> · {view.receipt ? slotLabel(view.receipt.hold.slot) : "Sunday pickup"}
      </p>
      <AppButton className="mt-5 min-h-12 w-full text-[1.0625rem]" busy={busy} onClick={() => void place()}>
        Place order · pay at pickup
      </AppButton>
      <p className="mt-3 text-center text-[0.9375rem] text-muted-foreground">LunchShift never pays. You pay at the store.</p>
      {err ? (
        <div className="mt-4">
          <Notice tone="alert">{err}</Notice>
        </div>
      ) : null}
    </section>
  );
}

function Timeline({ order }: { order: Order }) {
  return (
    <ol className="ls-stagger" aria-label="Order progress">
      {order.timeline.map((t, i) => {
        const done = t.at !== null;
        const cancelled = t.step === "cancelled";
        const last = i === order.timeline.length - 1;
        return (
          <li key={`${t.step}-${i}`} className="relative flex gap-4 pb-5 last:pb-0">
            {!last ? (
              <span aria-hidden className={cn("absolute top-8 bottom-0 left-[0.9375rem] w-0.5 rounded-full", done ? "bg-primary/35" : "bg-foreground/10")} />
            ) : null}
            <span
              aria-hidden
              className={cn(
                "relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-full",
                cancelled ? "bg-refuse-soft text-refuse" : done ? "bg-primary text-primary-foreground" : "border-2 border-dashed border-foreground/20 bg-card",
              )}
            >
              {cancelled ? <X className="size-4" strokeWidth={2.5} /> : done ? <Check className="size-4" strokeWidth={2.5} /> : null}
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p className={cn("text-base leading-snug", done ? "font-medium" : "text-muted-foreground")}>{t.label}</p>
              <p className="text-[0.9375rem] text-muted-foreground tabular-nums">{t.at ? `${shortDate(t.at)}, ${timeOfDay(t.at)}` : "Not yet"}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The order screen. `celebrate` is the hero moment right after an order is placed (or the first time the
 * parent opens one the agent placed); history opens the same layout without the flourish.
 */
export function OrderScreen({ view, order, celebrate, onClose }: { view: RunView; order: Order; celebrate: boolean; onClose: () => void }) {
  const byAgent = order.placedBy === "agent";
  const cancelled = order.status === "cancelled";
  const title = celebrate ? (byAgent ? "Order placed by LunchShift" : "Order placed") : ORDER_STATUS[order.status];
  const packs = order.lines.reduce((t, l) => t + l.packs, 0);

  return (
    <div className="space-y-8 pb-6">
      <button
        type="button"
        onClick={onClose}
        className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-md pr-2 text-base font-medium text-primary hover:underline"
      >
        <ChevronLeft className="size-5" aria-hidden /> {celebrate ? "This week" : "Orders"}
      </button>

      <section
        aria-labelledby="order-title"
        className={cn(
          "relative overflow-hidden rounded-2xl px-6 pt-8 pb-7 text-center",
          cancelled ? "bg-card shadow-[0_1px_0_var(--border)]" : "bg-[radial-gradient(120%_90%_at_50%_0%,var(--ok-soft),var(--card)_75%)] shadow-[0_1px_0_var(--border),0_14px_40px_-20px_oklch(0.47_0.085_155/0.5)]",
        )}
      >
        {cancelled ? null : (
          <span className={cn("mx-auto flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground", celebrate && "ls-pop")} aria-hidden>
            <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} className={celebrate ? "ls-draw" : undefined} />
            </svg>
          </span>
        )}
        <h2 id="order-title" className="mt-5 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">
          {title}
        </h2>
        <p className="mx-auto mt-2 max-w-[20rem] text-base text-muted-foreground">
          {cancelled ? "The hold was released and nothing was paid." : `${order.status === "picked_up" ? "Picked up" : "Pick up"} ${slotLabel(order.slot)}`}
        </p>
        <p className="mt-5 text-[0.9375rem] text-muted-foreground">Order number</p>
        <p className="font-mono text-[2rem] leading-tight font-medium tracking-[0.02em]">{order.orderId}</p>
        {order.status === "placed" || order.status === "ready" ? <p className="mt-1 text-[0.9375rem] text-muted-foreground">Show this at the pickup desk.</p> : null}
      </section>

      <dl className="divide-y rounded-xl bg-card shadow-[0_1px_0_var(--border)]">
        {[
          ["Pickup", slotLabel(order.slot)],
          ["Total", money(order.totalCents)],
          ["Payment", "Pay at pickup"],
          ["Placed by", byAgent ? "LunchShift, within your rules" : "You"],
        ].map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 px-5 py-3.5">
            <dt className="text-base text-muted-foreground">{k}</dt>
            <dd className={cn("text-right text-base tabular-nums", k === "Total" && "text-lg font-semibold")}>{v}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="timeline-title" className="space-y-3">
        <h3 id="timeline-title" className="px-1 text-lg font-semibold tracking-[-0.01em]">
          Progress
        </h3>
        <div className="rounded-xl bg-card p-5 shadow-[0_1px_0_var(--border)]">
          <Timeline order={order} />
        </div>
      </section>

      <section aria-labelledby="items-title" className="space-y-3">
        <div className="flex items-baseline justify-between gap-4 px-1">
          <h3 id="items-title" className="text-lg font-semibold tracking-[-0.01em]">
            What&apos;s in it
          </h3>
          <span className="text-[0.9375rem] text-muted-foreground tabular-nums">
            {packs} item{packs === 1 ? "" : "s"}
          </span>
        </div>
        <ul className="divide-y rounded-xl bg-card shadow-[0_1px_0_var(--border)]">
          {order.lines.map((l) => (
            <li key={l.skuId} className="flex items-baseline justify-between gap-4 px-5 py-3">
              <span className="flex min-w-0 items-center gap-3 text-base">
                {view.cart?.catalog.find((c) => c.skuId === l.skuId)?.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local Open Food Facts snapshot
                  <img src={view.cart?.catalog.find((c) => c.skuId === l.skuId)?.imageUrl} alt="" className="size-9 shrink-0 rounded-md bg-card object-contain p-0.5 ring-1 ring-border" />
                ) : null}
                {skuName(view, l.skuId)}
                {l.packs > 1 ? <span className="text-muted-foreground tabular-nums"> × {l.packs}</span> : null}
              </span>
              <span className="shrink-0 text-base tabular-nums">{money(l.unitPriceCents * l.packs)}</span>
            </li>
          ))}
          <li className="flex items-baseline justify-between gap-4 px-5 py-3.5">
            <span className="text-base font-medium">Total at pickup</span>
            <span className="text-lg font-semibold tabular-nums">{money(order.totalCents)}</span>
          </li>
        </ul>
      </section>

      <p className="rounded-xl bg-sunken px-5 py-4 text-base">
        <span className="font-medium">LunchShift never pays: you pay at the store.</span>{" "}
        <span className="text-muted-foreground">It can hold and place orders within your rules, and nothing else.</span>
      </p>

      <AppButton variant={celebrate ? "primary" : "secondary"} className="w-full" onClick={onClose}>
        Done
      </AppButton>
    </div>
  );
}

/** Orders tab: every week's order, newest first. */
export function OrdersTab({ view, onOpen }: { view: RunView; onOpen: (o: Order) => void }) {
  if (!view.orders.length) {
    return (
      <div className="rounded-xl bg-card px-6 py-10 text-center shadow-[0_1px_0_var(--border)]">
        <p className="text-lg font-semibold tracking-[-0.01em]">No orders yet</p>
        <p className="mx-auto mt-1.5 max-w-[22rem] text-base text-muted-foreground">
          Once a Sunday pickup is held and the order is placed, it shows up here with its number and receipt.
        </p>
      </div>
    );
  }
  return (
    <section aria-labelledby="orders-title" className="space-y-3">
      <div className="flex items-baseline justify-between gap-4 px-1">
        <h2 id="orders-title" className="text-lg font-semibold tracking-[-0.01em]">
          Past and current
        </h2>
        <span className="text-[0.9375rem] text-muted-foreground tabular-nums">
          {view.orders.length} order{view.orders.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="ls-stagger divide-y overflow-hidden rounded-xl bg-card shadow-[0_1px_0_var(--border)]">
        {view.orders.map((o) => {
          const current = view.order?.orderId === o.orderId;
          return (
            <li key={o.orderId}>
              <button type="button" onClick={() => onOpen(o)} className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-secondary/60">
                <div className="min-w-0 flex-1">
                  <p className="text-base font-medium">{shortDate(o.placedAt)}</p>
                  <p className="text-[0.9375rem] text-muted-foreground">
                    <span className="font-mono">{o.orderId}</span> ·{" "}
                    <span className={cn(o.status === "cancelled" && "text-refuse", current && o.status === "placed" && "font-medium text-ok")}>
                      {current && o.status === "placed" ? "This week" : ORDER_STATUS[o.status]}
                    </span>
                  </p>
                </div>
                <span className={cn("text-base font-medium tabular-nums", o.status === "cancelled" && "text-muted-foreground line-through decoration-foreground/30")}>
                  {money(o.totalCents)}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="px-1 text-[0.9375rem] text-muted-foreground">Every order is pay at pickup.</p>
    </section>
  );
}
