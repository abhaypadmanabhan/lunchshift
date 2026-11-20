"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { BookOpen, CalendarDays, ChevronLeft, Inbox, Receipt, Repeat, ShoppingBasket, Users } from "lucide-react";
import type { Order } from "@/lib/domain/types";
import type { RunView } from "@/lib/domain/view";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityTab } from "./activity-tab";
import { AgentPanel } from "./agent-panel";
import { CartTab } from "./cart-tab";
import { AskBar, ChatSetup, type ChatCommand } from "./chat";
import { modeLabel, timeOfDay } from "./copy";
import { DemoBar, DEMO_STEPS } from "./demo-bar";
import { FamilySwitcher } from "./family-switcher";
import { FamilyTab } from "./family-tab";
import { Landing } from "./landing";
import { Onboarding } from "./onboarding";
import { FactHistory } from "./fact-history";
import { InboxView, inboxCount } from "./inbox-view";
import { OrderScreen, OrdersTab } from "./order-view";
import { RoutinesView } from "./routines-view";
import { AppButton } from "./ui";
import { POLL_MS, postParent, useRunView } from "./use-run-view";
import { WeekTab } from "./week-tab";

const MODE_ORDER = { suggest_only: 0, auto_swap: 1, auto_swap_and_hold: 2 } as const;

type Tab = "week" | "cart" | "orders" | "family";
type Sub = "activity" | "routines" | "memory" | "inbox";
type Screen =
  | { kind: "order"; order: Order; from: Tab }
  | { kind: Sub; from?: Tab }
  | { kind: "onboarding" } // the form fallback
  | { kind: "chat" } // setup as a conversation with the agent
  | { kind: "landing" }
  | null;
const SUB_TITLE: Record<Sub, string> = {
  activity: "Activity",
  routines: "Routines",
  memory: "Memory",
  inbox: "Inbox",
};

const TABS: { id: Tab; label: string; Icon: typeof CalendarDays }[] = [
  { id: "week", label: "This week", Icon: CalendarDays },
  { id: "cart", label: "Cart", Icon: ShoppingBasket },
  { id: "orders", label: "Orders", Icon: Receipt },
  { id: "family", label: "Family", Icon: Users },
];

const TAB_TITLE: Record<Tab, string> = {
  week: "",
  cart: "This week's cart",
  orders: "Orders",
  family: "Family & rules",
};

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

type NavId = Tab | "routines" | "inbox" | "memory";
const SIDE_NAV: { id: NavId; label: string; Icon: typeof CalendarDays }[] = [
  ...TABS,
  { id: "routines", label: "Routines", Icon: Repeat },
  { id: "inbox", label: "Inbox", Icon: Inbox },
  { id: "memory", label: "Memory", Icon: BookOpen },
];

/** Desktop sidebar (1024 px and wider): wordmark, families, sections, what LunchShift may do, the console. */
function Sidebar({
  view,
  active,
  onNav,
  consoleHref,
  switcher,
}: {
  view: RunView | null;
  active: NavId | null;
  onNav: (id: NavId) => void;
  consoleHref: string;
  switcher: React.ReactNode;
}) {
  const count = (id: NavId) => {
    if (!view) return 0;
    if (id === "week") return view.run?.status === "proposed" ? view.proposals.length || 1 : 0;
    if (id === "cart") return view.cart?.lines.length ?? 0;
    if (id === "inbox") return inboxCount(view);
    return 0;
  };
  const needsYou = (id: NavId) => id === "inbox" || id === "week";
  return (
    <aside
      aria-label="LunchShift"
      className="sticky top-[var(--ls-top)] hidden h-[calc(100dvh-var(--ls-top))] flex-col border-r border-border/70 bg-sidebar/70 lg:flex"
    >
      <div className="px-5 pt-7 pb-5">
        <p className="text-[1.25rem] font-semibold tracking-[-0.02em] text-primary">LunchShift</p>
        {view?.week ? <p className="text-[0.9375rem] text-muted-foreground">{view.week.label}</p> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 [scrollbar-width:thin]">
        {switcher}
        <nav aria-label="Sections" className="mt-6">
          <ul className="space-y-0.5">
            {SIDE_NAV.map(({ id, label, Icon }) => {
              const on = active === id;
              const n = count(id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    aria-current={on ? "page" : undefined}
                    onClick={() => onNav(id)}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-base transition-colors duration-[var(--dur-fast)]",
                      on ? "bg-card font-medium text-foreground shadow-[0_1px_0_var(--border)]" : "text-foreground/75 hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    <Icon className={cn("size-[1.125rem] shrink-0", on ? "text-primary" : "text-muted-foreground")} strokeWidth={on ? 2.1 : 1.8} aria-hidden />
                    <span className="flex-1">{label}</span>
                    {n ? (
                      <span
                        className={cn(
                          "min-w-6 rounded-full px-1.5 text-center text-[0.875rem] leading-6 font-medium tabular-nums",
                          needsYou(id) ? "bg-wait-soft text-wait" : "text-muted-foreground",
                        )}
                      >
                        {n}
                        <span className="sr-only">{needsYou(id) ? " need you" : " items"}</span>
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
      {view ? (
        <button
          type="button"
          onClick={() => onNav("family")}
          className="mx-3 mt-3 rounded-xl bg-card px-4 py-3 text-left shadow-[0_1px_0_var(--border)] transition-colors duration-[var(--dur-fast)] hover:bg-secondary/60"
        >
          <span className="block text-[0.9375rem] text-muted-foreground">LunchShift may</span>
          <span className="block text-base font-medium">{modeLabel(view.mode.effective)}</span>
          {view.mode.effective !== view.mode.parentMax ? (
            <span className="block text-[0.9375rem] leading-snug text-wait">
              {MODE_ORDER[view.mode.effective] > MODE_ORDER[view.mode.parentMax]
                ? "You approved this week's order"
                : `You chose ${modeLabel(view.mode.parentMax)}; Statsig allows up to ${modeLabel(view.mode.observed)}`}
            </span>
          ) : null}
        </button>
      ) : null}
      <a
        href={consoleHref}
        className="mx-3 mt-2 mb-4 flex min-h-11 items-center rounded-lg px-3 text-[0.9375rem] text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        Open console
      </a>
    </aside>
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

  const sub = screen && (screen.kind === "activity" || screen.kind === "routines" || screen.kind === "memory" || screen.kind === "inbox") ? screen : null;
  const title =
    screen?.kind === "onboarding" || screen?.kind === "chat"
      ? "Set up"
      : screen && screen.kind !== "order" && screen.kind !== "landing"
        ? SUB_TITLE[screen.kind]
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
        if (!isSample)
          await postParent("/api/parent/autonomy", {
            mode: "auto_swap_and_hold",
          });
        await nextSunday();
        break;
      case 7:
        go("week");
        break;
    }
  };

  const onLanding = screen?.kind === "landing";
  const onSetup = screen?.kind === "chat" || screen?.kind === "onboarding";
  const fullBleed = onLanding || onSetup;
  const mainTabs = !screen;
  const navActive: NavId | null = sub ? (sub.kind === "activity" ? "week" : sub.kind) : screen?.kind === "order" ? screen.from : screen ? null : tab;
  const onNav = (id: NavId) => {
    if (id === "routines" || id === "inbox" || id === "memory") open({ kind: id, from: tab });
    else go(id);
  };
  const switcher = (stacked: boolean) =>
    view ? (
      <FamilySwitcher
        view={view}
        stacked={stacked}
        onSwitched={refresh}
        onNew={(id) => {
          decidedFor.current = id;
          if (isSample) setSample("f");
          open({ kind: "chat" });
        }}
      />
    ) : null;

  const content = !view ? (
    failingSince ? (
      <Unreachable since={failingSince} onRetry={() => void refresh()} />
    ) : (
      <Loading />
    )
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
  ) : sub ? (
    <div key={sub.kind} className="ls-enter space-y-4">
      <button
        type="button"
        onClick={() => go(sub.from ?? "week")}
        className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-md pr-2 text-base font-medium text-primary hover:underline lg:hidden"
      >
        <ChevronLeft className="size-5" aria-hidden /> {TABS.find((t) => t.id === (sub.from ?? "week"))?.label}
      </button>
      {sub.kind === "activity" ? <ActivityTab view={view} /> : null}
      {sub.kind === "routines" ? <RoutinesView view={view} onRefresh={refresh} /> : null}
      {sub.kind === "memory" ? <FactHistory view={view} /> : null}
      {sub.kind === "inbox" ? <InboxView view={view} onRefresh={refresh} /> : null}
    </div>
  ) : (
    <div key={tab} className="ls-enter">
      {tab === "week" ? (
        <WeekTab
          view={view}
          onRefresh={refresh}
          onOpenOrder={(o) => open({ kind: "order", order: o, from: "week" })}
          onOpenActivity={() => open({ kind: "activity", from: "week" })}
        />
      ) : null}
      {tab === "week" && view.order && view.week.index === 0 ? <NextSunday onGo={nextSunday} /> : null}
      {tab === "cart" ? (
        <CartTab view={view} onRefresh={refresh} onPlan={() => void planNow()} onOpenOrder={(o) => open({ kind: "order", order: o, from: "cart" })} />
      ) : null}
      {tab === "orders" ? <OrdersTab view={view} onOpen={(o) => open({ kind: "order", order: o, from: "orders" })} /> : null}
      {tab === "family" ? (
        <FamilyTab view={view} onRefresh={refresh} onSetup={() => open({ kind: "chat" })} onOpen={(kind) => open({ kind, from: "family" })} />
      ) : null}
      {/* Below 1280 px the chat floats above the tabs; wider, it lives in the right rail. */}
      {tab === "week" || tab === "cart" ? <AskBar sample={isSample} onRefresh={refresh} className="lg:bottom-0 xl:hidden" /> : null}
    </div>
  );

  const offline =
    failingSince && view ? (
      <div role="status" className="mb-4 rounded-lg bg-wait-soft px-4 py-3 text-[0.9375rem] leading-snug">
        <span className="font-medium">You&apos;re offline.</span> Showing what we last heard at {timeOfDay(view.generatedAt)}. Retrying…
      </div>
    ) : null;

  return (
    <div className={cn("ls-parent min-h-dvh overflow-x-clip", demo && "pt-16")} style={{ "--ls-top": demo ? "4rem" : "0px" } as React.CSSProperties}>
      {demo && view ? (
        <DemoBar step={demoStep} total={DEMO_STEPS.length} onStep={(n) => void runStep(n)} consoleHref={consoleHref} view={view} onRefresh={refresh} />
      ) : null}

      {fullBleed ? (
        /* Landing and setup: full width and centred, no sidebar or rail. */
        <div className="mx-auto flex min-h-[calc(100dvh-var(--ls-top))] w-full max-w-[46rem] flex-col px-4 md:px-8">
          {onSetup ? (
            <header className="px-1 pt-8 pb-5 md:pt-14">
              <p className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-primary">LunchShift</p>
              <h1 className="mt-0.5 text-[1.875rem] font-semibold leading-tight tracking-[-0.02em] md:text-[2.25rem]">Set up</h1>
            </header>
          ) : null}
          {offline}
          <main className={cn("flex-1", onSetup && "pb-10")}>{content}</main>
        </div>
      ) : (
        <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_22.5rem]">
          <Sidebar view={view} active={navActive} onNav={onNav} consoleHref={consoleHref} switcher={switcher(true)} />

          <div className="mx-auto flex min-h-[calc(100dvh-var(--ls-top))] w-full max-w-[640px] min-w-0 flex-col bg-background lg:max-w-[52rem] lg:bg-transparent lg:px-8">
            <header className="space-y-4 px-5 pt-8 pb-5 lg:px-0 lg:pt-10 lg:pb-6">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-[0.9375rem] font-medium text-primary lg:hidden">
                    LunchShift
                    {mainTabs && view?.week ? <span className="font-normal text-muted-foreground"> · {view.week.label}</span> : null}
                  </p>
                  <h1 className="mt-0.5 text-[1.875rem] font-semibold leading-tight tracking-[-0.02em] lg:mt-0 lg:text-[2rem]">{title}</h1>
                </div>
                <div className="flex items-center gap-3 pb-0.5 lg:hidden">
                  <a href={consoleHref} className="text-[0.9375rem] text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground">
                    Open console
                  </a>
                  {view ? (
                    <button
                      type="button"
                      aria-label={`Inbox${inboxCount(view) ? `, ${inboxCount(view)} need you` : ""}`}
                      aria-current={screen?.kind === "inbox" ? "page" : undefined}
                      onClick={() =>
                        open({
                          kind: "inbox",
                          from: screen?.kind === "inbox" ? screen.from : tab,
                        })
                      }
                      className={cn(
                        "relative -mr-2 inline-flex size-11 items-center justify-center rounded-lg hover:bg-secondary",
                        screen?.kind === "inbox" ? "text-primary" : "text-foreground/80",
                      )}
                    >
                      <Inbox className="size-[1.375rem]" strokeWidth={1.8} aria-hidden />
                      {inboxCount(view) ? (
                        <span className="absolute top-0.5 right-0 min-w-5 rounded-full bg-wait px-1.5 text-center text-[0.8125rem] font-semibold leading-5 text-primary-foreground tabular-nums">
                          {inboxCount(view)}
                        </span>
                      ) : null}
                    </button>
                  ) : null}
                </div>
              </div>
              {mainTabs ? <div className="lg:hidden">{switcher(false)}</div> : null}
              {notice && mainTabs ? (
                <p role="status" className="rounded-lg bg-wait-soft px-4 py-3 text-[0.9375rem] leading-snug">
                  {notice}
                </p>
              ) : null}
            </header>

            <div className="px-4 lg:px-0">{offline}</div>

            <main className={cn("@container flex-1 px-4 pb-10 lg:px-0 lg:pb-16", mainTabs && (tab === "week" || tab === "cart") && "pb-2 lg:pb-8")}>
              {content}
            </main>

            <nav
              aria-label="Sections"
              className="sticky bottom-0 z-20 w-full border-t bg-background/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
            >
              <ul className="grid grid-cols-4">
                {TABS.map(({ id, label, Icon }) => {
                  const active = tab === id;
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
          </div>

          {/* Right rail (1280 px and wider): the agent's own feed on top, the conversation with it below. */}
          <div className="sticky top-[var(--ls-top)] hidden h-[calc(100dvh-var(--ls-top))] min-h-0 flex-col border-l border-border/70 bg-card/60 backdrop-blur-sm xl:flex">
            <AgentPanel view={view} offlineSince={failingSince} className="flex-1" />
            {view ? (
              <section aria-label="Ask LunchShift" className="flex max-h-[62%] min-h-0 shrink-0 flex-col border-t border-border/70 bg-background/70 p-4">
                <AskBar sample={isSample} onRefresh={refresh} docked className="min-h-0" />
              </section>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
