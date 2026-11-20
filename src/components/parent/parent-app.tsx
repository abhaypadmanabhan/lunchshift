"use client";

import { useEffect, useState } from "react";
import { cn } from "cn";
import { CalendarDays, History, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityTab } from "./activity-tab";
import { timeOfDay } from "./copy";
import { FamilyTab } from "./family-tab";
import { AppButton } from "./ui";
import { POLL_MS, useRunView } from "./use-run-view";
import { WeekTab } from "./week-tab";

type Tab = "week" | "family" | "activity";

const TABS: { id: Tab; label: string; Icon: typeof CalendarDays }[] = [
  { id: "week", label: "This week", Icon: CalendarDays },
  { id: "family", label: "Family & rules", Icon: Users },
  { id: "activity", label: "Activity", Icon: History },
];

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
  const [consoleHref, setConsoleHref] = useState("/console");

  useEffect(() => {
    setConsoleHref(`/console${window.location.search}`);
  }, []);

  const child = view?.household.childName;

  return (
    <div className="min-h-dvh bg-sunken/70 md:py-8">
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
            <h1 className="mt-0.5 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">
              {tab === "week" ? (child ? `${child}'s week` : "Your week") : tab === "family" ? "Family & rules" : "Activity"}
            </h1>
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
          ) : (
            <div key={tab} className="ls-enter">
              {tab === "week" ? <WeekTab view={view} onRefresh={refresh} /> : null}
              {tab === "family" ? <FamilyTab view={view} onRefresh={refresh} /> : null}
              {tab === "activity" ? <ActivityTab view={view} /> : null}
            </div>
          )}
        </main>

        <nav
          aria-label="Sections"
          className="sticky bottom-0 z-20 w-full border-t bg-background/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:rounded-b-[1.75rem]"
        >
          <ul className="grid grid-cols-3">
            {TABS.map(({ id, label, Icon }) => {
              const active = tab === id;
              const badge = id === "week" && view?.run?.status === "proposed";
              return (
                <li key={id}>
                  <button
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => {
                      setTab(id);
                      window.scrollTo({ top: 0 });
                    }}
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
                    </span>
                    {label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
