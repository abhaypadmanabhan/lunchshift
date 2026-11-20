"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { CalendarDays, ChevronLeft, Receipt, ShoppingBasket, Users } from "lucide-react";
import type { Order } from "@/lib/domain/types";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityTab } from "./activity-tab";
import { CartTab } from "./cart-tab";
import { timeOfDay } from "./copy";
import { FamilyTab } from "./family-tab";
import { Onboarding, onboardingSeen } from "./onboarding";
import { OrderScreen, OrdersTab } from "./order-view";
import { AppButton } from "./ui";
import { POLL_MS, postParent, useRunView } from "./use-run-view";
import { WeekTab } from "./week-tab";

type Tab = "week" | "cart" | "orders" | "family";
type Screen = { kind: "order"; order: Order; from: Tab } | { kind: "activity" } | { kind: "onboarding" } | null;

const TABS: { id: Tab; label: string; Icon: typeof CalendarDays }[] = [
  { id: "week", label: "This week", Icon: CalendarDays },
  { id: "cart", label: "Cart", Icon: ShoppingBasket },
  { id: "orders", label: "Orders", Icon: Receipt },
  { id: "family", label: "Family", Icon: Users },
];

const TAB_TITLE: Record<Tab, string> = { week: "", cart: "This week's cart", orders: "Orders", family: "Family & rules" };

function Loading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading your week">
      <Skeleton className="h-44 rounded-xl" />
      <div className="space-y-3">
        <Skeleton className="h-6 w-40 rounded-md" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  );
}

function Unreachable({ since, onRetry }: { since: string; onRetry: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-xl bg-card px-6 py-10 text-center shadow-[0_1px_0_var(--border)]">
      <p className="text-xl font-semibold tracking-[-0.01em]">Can&apos;t reach LunchShift</p>
      <p className="mx-auto mt-2 max-w-[20rem] text-base text-muted-foreground">
        Your plan and any store hold are safe. We&apos;ve been retrying every {POLL_MS / 1000} seconds since {timeOfDay(since)}.
      </p>
      <AppButton
        variant="secondary"
        className="mt-6"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          await Promise.resolve(onRetry());
          setTimeout(() => setBusy(false), 600);
        }}
      >
        Try again now
      </AppButton>
    </div>
  );
}

export function ParentApp() {
  const { view, failingSince, refresh } = useRunView();
  const [tab, setTab] = useState<Tab>("week");
  const [screen, setScreen] = useState<Screen>(null);
  const [consoleHref, setConsoleHref] = useState("/console");
  const decided = useRef(false);

  useEffect(() => {
    setConsoleHref(`/console${window.location.search}`);
  }, []);

  // Onboarding opens once per load: on first visit, or when the household has no allergy rules yet.
  // `?onboarding=1` forces it, `?onboarding=0` skips it (demo recording).
  useEffect(() => {
    if (!view || decided.current) return;
    decided.current = true;
    const force = new URLSearchParams(window.location.search).get("onboarding");
    const noRules = !view.household.facts.some((f) => f.active && f.kind === "hard_restriction");
    if (force === "1" || (force !== "0" && (noRules || !onboardingSeen()))) setScreen({ kind: "onboarding" });
  }, [view]);

  const go = (t: Tab) => {
    setTab(t);
    setScreen(null);
    window.scrollTo({ top: 0 });
  };
  const open = (s: Screen) => {
    setScreen(s);
    window.scrollTo({ top: 0 });
  };

  const child = view?.household.childName;
  // Show the freshest copy of an open order (the poll may have moved it on to "ready").
  const openOrder = screen?.kind === "order" ? (view?.orders.find((o) => o.orderId === screen.order.orderId) ?? screen.order) : null;
  const celebrate = !!openOrder && view?.order?.orderId === openOrder.orderId && openOrder.status !== "cancelled";

  const title =
    screen?.kind === "onboarding"
      ? "Welcome"
      : screen?.kind === "activity"
        ? "Activity"
        : screen?.kind === "order"
          ? "Your order"
          : tab === "week"
            ? child
              ? `${child}'s week`
              : "Your week"
            : TAB_TITLE[tab];

  const planNow = () => {
    void postParent("/api/parent/plan").then(() => refresh());
    go("week");
  };

  return (
    <div className="ls-parent min-h-dvh bg-sunken/70 md:py-8">
      <a
        href={consoleHref}
        className="fixed top-5 right-6 z-30 hidden rounded-md px-2 py-1 text-[0.9375rem] text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground lg:block"
      >
        Open console
      </a>

      <div className="relative mx-auto flex min-h-dvh w-full max-w-[440px] flex-col bg-background md:min-h-[calc(100dvh-4rem)] md:rounded-[1.75rem] md:shadow-[0_1px_2px_oklch(0.27_0.015_60/0.06),0_12px_40px_-12px_oklch(0.27_0.015_60/0.18)]">
        <header className="flex items-end justify-between gap-4 px-5 pt-8 pb-5">
          <div>
            <p className="text-[0.9375rem] font-medium text-primary">LunchShift</p>
            <h1 className="mt-0.5 text-[1.875rem] font-semibold leading-tight tracking-[-0.02em]">{title}</h1>
          </div>
          <a href={consoleHref} className="pb-1.5 text-[0.9375rem] text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground lg:hidden">
            Open console
          </a>
        </header>

        {failingSince && view ? (
          <div role="status" className="mx-5 mb-4 rounded-lg bg-wait-soft px-4 py-3 text-[0.9375rem] leading-snug">
            <span className="font-medium">You&apos;re offline.</span> Showing what we last heard at {timeOfDay(view.generatedAt)}. Retrying…
          </div>
        ) : null}

        <main className="flex-1 px-4 pb-10">
          {!view ? (
            failingSince ? <Unreachable since={failingSince} onRetry={() => void refresh()} /> : <Loading />
          ) : screen?.kind === "onboarding" ? (
            <div className="ls-enter px-1">
              <Onboarding view={view} onRefresh={refresh} onDone={() => go("week")} />
            </div>
          ) : openOrder ? (
            <div key={openOrder.orderId} className="ls-enter">
              <OrderScreen view={view} order={openOrder} celebrate={celebrate} onClose={() => go(screen?.kind === "order" ? screen.from : "week")} />
            </div>
          ) : screen?.kind === "activity" ? (
            <div className="ls-enter space-y-4">
              <button
                type="button"
                onClick={() => go("week")}
                className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-md pr-2 text-base font-medium text-primary hover:underline"
              >
                <ChevronLeft className="size-5" aria-hidden /> This week
              </button>
              <ActivityTab view={view} />
            </div>
          ) : (
            <div key={tab} className="ls-enter">
              {tab === "week" ? (
                <WeekTab
                  view={view}
                  onRefresh={refresh}
                  onOpenOrder={(o) => open({ kind: "order", order: o, from: "week" })}
                  onOpenActivity={() => open({ kind: "activity" })}
                />
              ) : null}
              {tab === "cart" ? <CartTab view={view} onRefresh={refresh} onPlan={planNow} /> : null}
              {tab === "orders" ? <OrdersTab view={view} onOpen={(o) => open({ kind: "order", order: o, from: "orders" })} /> : null}
              {tab === "family" ? <FamilyTab view={view} onRefresh={refresh} onSetup={() => open({ kind: "onboarding" })} /> : null}
            </div>
          )}
        </main>

        {screen?.kind === "onboarding" ? null : (
          <nav
            aria-label="Sections"
            className="sticky bottom-0 z-20 w-full border-t bg-background/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:rounded-b-[1.75rem]"
          >
            <ul className="grid grid-cols-4">
              {TABS.map(({ id, label, Icon }) => {
                const active = tab === id && screen?.kind !== "activity";
                const badge = id === "week" && view?.run?.status === "proposed";
                const count = id === "cart" ? (view?.cart?.lines.length ?? 0) : 0;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      aria-current={active ? "page" : undefined}
                      onClick={() => go(id)}
                      className={cn(
                        "flex min-h-16 w-full flex-col items-center justify-center gap-1 text-[0.9375rem] transition-colors duration-[var(--dur-fast)]",
                        active ? "font-medium text-primary" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <span className="relative">
                        <Icon className="size-[1.375rem]" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
                        {badge ? (
                          <span className="absolute -top-1 -right-2.5 rounded-full bg-wait px-1.5 text-[0.75rem] font-semibold leading-[1.1rem] text-primary-foreground">
                            {view?.proposals.length || 1}
                            <span className="sr-only"> waiting for you</span>
                          </span>
                        ) : null}
                        {count ? (
                          <span className="absolute -top-1 -right-3 rounded-full bg-foreground/80 px-1.5 text-[0.75rem] font-semibold leading-[1.1rem] text-background tabular-nums">
                            {count}
                            <span className="sr-only"> items</span>
                          </span>
                        ) : null}
                      </span>
                      {label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
      </div>
    </div>
  );
}
