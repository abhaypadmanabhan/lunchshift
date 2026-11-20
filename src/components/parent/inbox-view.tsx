"use client";

import { useState } from "react";
import { Check, CircleAlert } from "lucide-react";
import type { InboxItem, RunView } from "@/lib/domain/view";
import { timeOfDay } from "./copy";
import { AppButton, Notice, SectionTitle } from "./ui";
import { postParent } from "./use-run-view";

const TZ = "America/Los_Angeles";
const needsYou = (i: InboxItem) => i.kind === "needs_you" || i.kind === "alert";
const newestFirst = (a: InboxItem, b: InboxItem) => b.at.localeCompare(a.at);

/** The count on the inbox's entry point: items that wait for the parent. */
export const inboxCount = (view: RunView | null) => (view?.inbox ?? []).filter(needsYou).length;

/** "4:00 pm" today, otherwise "Sun 4:00 pm". */
function when(iso: string): string {
  const d = new Date(iso);
  const day = (x: Date) => x.toLocaleDateString("en-US", { year: "numeric", month: "numeric", day: "numeric", timeZone: TZ });
  if (day(d) === day(new Date())) return timeOfDay(iso);
  return `${d.toLocaleDateString("en-US", { weekday: "short", timeZone: TZ })} ${timeOfDay(iso)}`;
}

function NeedsYouRow({ item, onRefresh }: { item: InboxItem; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "wait"; text: string } | null>(null);
  const alert = item.kind === "alert";
  const act = async () => {
    if (!item.action) return;
    setBusy(true);
    setMsg(null);
    const res = await postParent(item.action.endpoint, item.action.body);
    setBusy(false);
    if (!res.ok) {
      setMsg({ tone: "wait", text: "That didn't go through, so nothing changed. Try again in a moment." });
      return;
    }
    setMsg({ tone: "ok", text: "Done. LunchShift is on it." });
    await onRefresh();
  };
  return (
    <li className="px-5 py-4">
      <div className="flex items-start gap-3">
        {alert ? <CircleAlert className="mt-0.5 size-5 shrink-0 text-refuse" aria-label="Alert" /> : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-base font-medium leading-snug">{item.title}</p>
            <span className="shrink-0 whitespace-nowrap text-[0.9375rem] text-muted-foreground tabular-nums">{when(item.at)}</span>
          </div>
          <p className="mt-0.5 text-[0.9375rem] leading-snug text-muted-foreground">{item.body}</p>
          {item.action && msg?.tone !== "ok" ? (
            <AppButton className="mt-3 min-h-10 px-4 text-[0.9375rem]" busy={busy} onClick={() => void act()}>
              {item.action.label}
            </AppButton>
          ) : null}
        </div>
      </div>
      {msg ? (
        <div className="mt-3">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      ) : null}
    </li>
  );
}

export function InboxView({ view, onRefresh }: { view: RunView; onRefresh: () => Promise<void> }) {
  const items = [...(view.inbox ?? [])].sort(newestFirst);
  const open = items.filter(needsYou);
  const done = items.filter((i) => !needsYou(i));

  return (
    <div className="space-y-8 pb-4">
      <p className="px-1 text-base text-muted-foreground">While you were away</p>

      <section className="space-y-3" aria-labelledby="needs-title">
        <SectionTitle aside={open.length ? <span className="tabular-nums">{open.length}</span> : undefined}>
          <span id="needs-title">Needs you</span>
        </SectionTitle>
        {open.length ? (
          <ul className="ls-stagger divide-y overflow-hidden rounded-xl bg-card shadow-[0_1px_0_var(--border)]">
            {open.map((i) => (
              <NeedsYouRow key={i.id} item={i} onRefresh={onRefresh} />
            ))}
          </ul>
        ) : (
          <div className="ls-enter flex items-center gap-4 rounded-xl bg-card px-5 py-5 shadow-[0_1px_0_var(--border)]">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok" aria-hidden>
              <Check className="size-5" strokeWidth={2.2} />
            </span>
            <span className="min-w-0">
              <span className="block text-base font-medium">Nothing needs you</span>
              <span className="block text-[0.9375rem] text-muted-foreground">LunchShift asks here before anything new.</span>
            </span>
          </div>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="done-title">
        <SectionTitle>
          <span id="done-title">Done</span>
        </SectionTitle>
        {done.length ? (
          <ul className="ls-stagger divide-y overflow-hidden rounded-xl bg-card shadow-[0_1px_0_var(--border)]">
            {done.map((i) => (
              <li key={i.id} className="px-5 py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-base leading-snug">{i.title}</p>
                  <span className="shrink-0 whitespace-nowrap text-[0.9375rem] text-muted-foreground tabular-nums">{when(i.at)}</span>
                </div>
                <p className="mt-0.5 text-[0.9375rem] leading-snug text-muted-foreground">{i.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-1 text-[0.9375rem] text-muted-foreground">What LunchShift does for you will show up here.</p>
        )}
      </section>
    </div>
  );
}
