"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { CalendarDays, ChevronLeft, Receipt, ShoppingBasket, Users } from "lucide-react";
import type { Order } from "@/lib/domain/types";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityTab } from "./activity-tab";
import { AgentPanel } from "./agent-panel";
import { CartTab } from "./cart-tab";
import { AskBar, ChatSetup, type ChatCommand } from "./chat";
import { timeOfDay } from "./copy";
import { DemoBar, DEMO_STEPS } from "./demo-bar";
import { FamilySwitcher } from "./family-switcher";
import { FamilyTab } from "./family-tab";
import { Landing } from "./landing";
import { Onboarding } from "./onboarding";
import { OrderScreen, OrdersTab } from "./order-view";
import { AppButton } from "./ui";
import { POLL_MS, postParent, useRunView } from "./use-run-view";
import { WeekTab } from "./week-tab";

type Tab = "week" | "cart" | "orders" | "family";
type Screen =
  | { kind: "order"; order: Order; from: Tab }
  | { kind: "activity" }
  | { kind: "onboarding" } // the form fallback
  | { kind: "chat" } // setup as a conversation with the agent
  | { kind: "landing" }
  | null;

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

/** "Next Sunday": advance the demo clock so the stockout arrives and the agent handles it. */
function NextSunday({ onGo }: { onGo: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-8 flex items-center gap-4 rounded-xl bg-card px-5 py-4 shadow-[0_1px_0_var(--border)]">
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium">Next Sunday</p>
        <p className="text-[0.9375rem] text-muted-foreground">See what LunchShift does when the store runs out.</p>
      </div>
      <AppButton
        variant="secondary"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          await onGo();
          setBusy(false);
        }}
      >
        Go to next Sunday
      </AppButton>
    </div>
  );
}

export function ParentApp({ demo = false }: { demo?: boolean }) {
  const { view, failingSince, refresh, sample, setSample } = useRunView();
  const [tab, setTab] = useState<Tab>("week");
  const [screen, setScreen] = useState<Screen>(null);
  const [consoleHref, setConsoleHref] = useState("/console");
  const [chatCommand, setChatCommand] = useState<ChatCommand | null>(null);
  const [demoStep, setDemoStep] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const decidedFor = useRef<string | null>(null);
  const wantOrder = useRef(false);
  const isSample = sample !== null;

  useEffect(() => {
    setConsoleHref(`/console${window.location.search}`);
  }, []);

  // The story starts on the landing for a family that isn't set up yet (checked once per family).
  // `?onboarding=1` opens the form, `?onboarding=0` skips setup. /demo drives this itself.
  useEffect(() => {
    if (!view || demo || decidedFor.current === view.household.id) return;
    decidedFor.current = view.household.id;
    const force = new URLSearchParams(window.location.search).get("onboarding");
    if (force === "1") setScreen({ kind: "onboarding" });
    else if (force !== "0" && !view.household.onboarded) setScreen({ kind: "landing" });
  }, [view, demo]);

  // /demo opens on step 1 (the landing) so the recording starts at the beginning of the story.
  const demoStarted = useRef(false);
  useEffect(() => {
    if (!demo || demoStarted.current || !view) return;
    demoStarted.current = true;
    setScreen({ kind: "landing" });
  }, [demo, view]);

  const go = (t: Tab) => {
    setTab(t);
    setScreen(null);
    window.scrollTo({ top: 0 });
  };
  const open = (s: Screen) => {
    setScreen(s);
    window.scrollTo({ top: 0 });
  };

  // Open the order confirmation as soon as this week's order shows up (after "Place order" or a demo step).
  useEffect(() => {
    if (wantOrder.current && view?.order) {
      wantOrder.current = false;
      open({ kind: "order", order: view.order, from: "cart" });
    }
  }, [view?.order]);

  const child = view?.household.childName;
  // Show the freshest copy of an open order (the poll may have moved it on to "ready").
  const openOrder = screen?.kind === "order" ? (view?.orders.find((o) => o.orderId === screen.order.orderId) ?? screen.order) : null;
  const celebrate = !!openOrder && view?.order?.orderId === openOrder.orderId && openOrder.status !== "cancelled";

  const title =
    screen?.kind === "onboarding" || screen?.kind === "chat"
      ? "Set up"
      : screen?.kind === "activity"
        ? "Activity"
        : screen?.kind === "order"
          ? "Your order"
          : tab === "week"
            ? child
              ? `${child}'s week`
              : "Your week"
            : TAB_TITLE[tab];

  /** "Plan this week": the agent shops live, so the parent watches the cart fill. */
  const planNow = async () => {
    setNotice(null);
    if (isSample) setSample("g");
    else {
      const res = await postParent("/api/parent/plan");
      if (!res.ok) setNotice(res.message);
      await refresh();
    }
    go("cart");
  };

  const nextSunday = async () => {
    setNotice(null);
    if (isSample) setSample("h");
    else {
      const res = await postParent("/api/demo/next-week");
      if (!res.ok) setNotice(res.message);
      await refresh();
    }
    go("week");
  };

  const placeOrder = async () => {
    wantOrder.current = true;
    if (isSample) {
      setSample("d");
      return;
    }
    if (view?.order) {
      wantOrder.current = false;
      open({ kind: "order", order: view.order, from: "cart" });
      return;
    }
    const res = await postParent<{ ok: boolean; order?: Order }>("/api/parent/order");
    if (!res.ok) setNotice(res.message);
    await refresh();
  };

  // The /demo bar: each step calls what the parent's own button would.
  const runStep = async (n: number) => {
    setDemoStep(n);
    switch (n) {
      case 0:
        if (isSample) setSample("f");
        open({ kind: "landing" });
        break;
      case 1:
        if (isSample) setSample("f");
        // Live: the story starts with a brand-new family (no seed data).
        else if (view?.household.onboarded !== false) {
          await postParent("/api/family/new");
          await refresh();
        }
        open({ kind: "chat" });
        setChatCommand({ n: Date.now(), kind: "send" });
        break;
      case 2:
        if (screen?.kind !== "chat") open({ kind: "chat" });
        setChatCommand({ n: Date.now(), kind: "save" });
        break;
      case 3:
        await planNow();
        break;
      case 4:
        if (isSample) setSample("e");
        else if (view?.run?.status === "proposed") {
          await postParent("/api/parent/approve");
          await refresh();
        }
        go("cart");
        break;
      case 5:
        await placeOrder();
        break;
      case 6:
        // The parent now trusts LunchShift to swap and hold on its own; next Sunday shows it.
        if (!isSample) await postParent("/api/parent/autonomy", { mode: "auto_swap_and_hold" });
        await nextSunday();
        break;
      case 7:
        go("week");
        break;
    }
  };

  const onLanding = screen?.kind === "landing";
  const onSetup = screen?.kind === "chat" || screen?.kind === "onboarding";
  const mainTabs = !screen;

  return (
    <div className={cn("ls-parent min-h-dvh overflow-x-clip bg-sunken/70 md:py-8 stage:flex stage:items-start stage:justify-center stage:gap-14", demo && "pt-16 md:pt-24")}>
      {demo && view ? (
        <DemoBar step={demoStep} total={DEMO_STEPS.length} onStep={(n) => void runStep(n)} consoleHref={consoleHref} view={view} onRefresh={refresh} />
      ) : null}
      <a
        href={consoleHref}
        className={cn(
          "fixed top-5 right-6 z-30 hidden rounded-md px-2 py-1 text-[0.9375rem] text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground lg:block stage:hidden",
          demo && "lg:hidden",
        )}
      >
        Open console
      </a>

      <div className="relative mx-auto flex min-h-dvh w-full max-w-[440px] flex-col stage:mx-0 stage:shrink-0 bg-background md:min-h-[calc(100dvh-4rem)] md:rounded-[1.75rem] md:shadow-[0_1px_2px_oklch(0.27_0.015_60/0.06),0_12px_40px_-12px_oklch(0.27_0.015_60/0.18)]">
        {onLanding ? null : (
          <header className="space-y-4 px-5 pt-8 pb-5">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[0.9375rem] font-medium text-primary">
                  LunchShift{mainTabs && view?.week ? <span className="font-normal text-muted-foreground"> · {view.week.label}</span> : null}
                </p>
                <h1 className="mt-0.5 text-[1.875rem] font-semibold leading-tight tracking-[-0.02em]">{title}</h1>
              </div>
              <a href={consoleHref} className="pb-1.5 text-[0.9375rem] text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground lg:hidden">
                Open console
              </a>
            </div>
            {mainTabs && view ? (
              <FamilySwitcher
                view={view}
                onSwitched={refresh}
                onNew={(id) => {
                  decidedFor.current = id;
                  if (isSample) setSample("f");
                  open({ kind: "chat" });
                }}
              />
            ) : null}
            {notice && mainTabs ? (
              <p role="status" className="rounded-lg bg-wait-soft px-4 py-3 text-[0.9375rem] leading-snug">
                {notice}
              </p>
            ) : null}
          </header>
        )}

        {failingSince && view ? (
          <div role="status" className="mx-5 mb-4 rounded-lg bg-wait-soft px-4 py-3 text-[0.9375rem] leading-snug">
            <span className="font-medium">You&apos;re offline.</span> Showing what we last heard at {timeOfDay(view.generatedAt)}. Retrying…
          </div>
        ) : null}

        <main className={cn("flex-1", onLanding ? "" : "px-4 pb-10", mainTabs && (tab === "week" || tab === "cart") && "pb-2")}>
          {!view ? (
            failingSince ? <Unreachable since={failingSince} onRetry={() => void refresh()} /> : <Loading />
          ) : onLanding ? (
            <Landing onStart={() => open({ kind: "chat" })} />
          ) : screen?.kind === "chat" ? (
            <div className="ls-enter px-1">
              <ChatSetup
                view={view}
                sample={isSample}
                command={chatCommand}
                onRefresh={refresh}
                onUseForm={() => open({ kind: "onboarding" })}
                onPlan={() => void planNow()}
              />
            </div>
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
              {tab === "week" && view.order && view.week.index === 0 ? <NextSunday onGo={nextSunday} /> : null}
              {tab === "cart" ? (
                <CartTab view={view} onRefresh={refresh} onPlan={() => void planNow()} onOpenOrder={(o) => open({ kind: "order", order: o, from: "cart" })} />
              ) : null}
              {tab === "orders" ? <OrdersTab view={view} onOpen={(o) => open({ kind: "order", order: o, from: "orders" })} /> : null}
              {tab === "family" ? <FamilyTab view={view} onRefresh={refresh} onSetup={() => open({ kind: "chat" })} /> : null}
              {tab === "week" || tab === "cart" ? <AskBar sample={isSample} onRefresh={refresh} /> : null}
            </div>
          )}
        </main>

        {onLanding || onSetup ? null : (
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
                          <span className="absolute -top-1 -right-2.5 rounded-full bg-wait px-1.5 text-[0.9375rem] font-semibold leading-[1.25rem] text-primary-foreground">
                            {view?.proposals.length || 1}
                            <span className="sr-only"> waiting for you</span>
                          </span>
                        ) : null}
                        {count ? (
                          <span className="absolute -top-1 -right-3 rounded-full bg-foreground/80 px-1.5 text-[0.9375rem] font-semibold leading-[1.25rem] text-background tabular-nums">
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

      <AgentPanel view={view} offlineSince={failingSince} consoleHref={consoleHref} />
    </div>
  );
}
