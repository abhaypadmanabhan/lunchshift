"use client";

import { useState } from "react";
import { cn } from "cn";
import { ChevronRight, Minus, Plus } from "lucide-react";
import type { RoutineView, RunView } from "@/lib/domain/view";
import { money, timeOfDay } from "./copy";
import { AppButton, EmptyCard, Notice } from "./ui";
import { postParent } from "./use-run-view";

const TZ = "America/Los_Angeles";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
const PLAN_DAYS = ["Sat", "Sun", "Mon"] as const;
const PLAN_TIMES = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00"] as const;

type Patch = { enabled?: boolean; config?: Record<string, unknown> };
type Msg = { tone: "ok" | "wait"; text: string };

/** "16:00" -> "4:00 pm". */
const clock = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

/** "Sun Nov 29, 4:00 pm". */
const nextRunLabel = (iso: string) => {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ }).replace(",", "");
  return `${date}, ${timeOfDay(iso)}`;
};

const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const days = (v: unknown): string[] => (Array.isArray(v) ? v.filter((d): d is string => typeof d === "string") : []);

export const routinesOn = (view: RunView) => (view.routines ?? []).filter((r) => r.enabled).length;

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-[var(--dur-base)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        checked ? "bg-primary" : "bg-foreground/20",
      )}
    >
      <span
        className={cn(
          "inline-block size-5 rounded-full bg-card shadow-sm transition-transform duration-[var(--dur-base)] ease-[var(--ease-out)]",
          checked ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}

const selectCls =
  "h-11 rounded-lg border border-input/40 bg-background px-3 text-base tabular-nums outline-none focus-visible:border-ring disabled:opacity-60";

function Setting({ r, onConfig }: { r: RoutineView; onConfig: (config: Record<string, unknown>) => void }) {
  const off = !r.enabled;
  if (r.id === "weekly_plan") {
    const day = str(r.config.day, "Sun");
    const time = str(r.config.time, "16:00");
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[0.9375rem] text-muted-foreground">Every</span>
        <select aria-label="Plan day" disabled={off} value={day} onChange={(e) => onConfig({ ...r.config, day: e.target.value })} className={selectCls}>
          {(PLAN_DAYS as readonly string[]).includes(day) ? null : <option value={day}>{day}</option>}
          {PLAN_DAYS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <span className="text-[0.9375rem] text-muted-foreground">at</span>
        <select aria-label="Plan time" disabled={off} value={time} onChange={(e) => onConfig({ ...r.config, time: e.target.value })} className={selectCls}>
          {(PLAN_TIMES as readonly string[]).includes(time) ? null : <option value={time}>{clock(time)}</option>}
          {PLAN_TIMES.map((t) => (
            <option key={t} value={t}>
              {clock(t)}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (r.id === "school_skips") {
    const skip = days(r.config.days);
    return (
      <div>
        <p className="text-[0.9375rem] text-muted-foreground">No school on</p>
        <div className="mt-2 flex gap-1.5" role="group" aria-label="School-free days">
          {WEEKDAYS.map((d) => {
            const on = skip.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                disabled={off}
                onClick={() => onConfig({ ...r.config, days: on ? skip.filter((x) => x !== d) : WEEKDAYS.filter((x) => x === d || skip.includes(x)) })}
                className={cn(
                  "min-h-11 flex-1 rounded-lg text-[0.9375rem] transition-colors duration-[var(--dur-fast)] disabled:opacity-60",
                  on ? "bg-foreground font-medium text-background" : "border border-input/30 text-foreground hover:bg-secondary",
                )}
              >
                {d}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  if (r.id === "budget_alert") {
    const within = num(r.config.withinCents, 300);
    const step = (delta: number) => onConfig({ ...r.config, withinCents: Math.min(2000, Math.max(100, within + delta)) });
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.9375rem] text-muted-foreground">Alert me within</span>
        <div className="flex items-center gap-1 rounded-lg bg-sunken p-1">
          <button
            type="button"
            aria-label="Less"
            disabled={off || within <= 100}
            onClick={() => step(-100)}
            className="inline-flex size-9 items-center justify-center rounded-md hover:bg-card disabled:opacity-40"
          >
            <Minus className="size-4" aria-hidden />
          </button>
          <span className="w-14 text-center text-base font-medium tabular-nums" aria-live="polite">
            {money(within).replace(".00", "")}
          </span>
          <button
            type="button"
            aria-label="More"
            disabled={off || within >= 2000}
            onClick={() => step(100)}
            className="inline-flex size-9 items-center justify-center rounded-md hover:bg-card disabled:opacity-40"
          >
            <Plus className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    );
  }
  return null;
}

function RoutineRow({ r, onPatch }: { r: RoutineView; onPatch: (p: Patch) => Promise<Msg | null> }) {
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  const patch = async (p: Patch) => {
    setMsg(null);
    const res = await onPatch(p);
    if (res) setMsg(res);
  };

  const runNow = async () => {
    setRunning(true);
    setMsg(null);
    const res = await postParent<{ ok: boolean; result?: string }>("/api/routines/run", { id: r.id });
    setRunning(false);
    setMsg(res.ok ? { tone: "ok", text: res.data.result ? `Done · ${res.data.result}` : "Done." } : { tone: "wait", text: res.message });
  };

  return (
    <li className="px-5 py-5">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-base font-medium">{r.title}</p>
          <p className="mt-0.5 text-[0.9375rem] leading-snug text-muted-foreground">{r.description}</p>
        </div>
        <Switch checked={r.enabled} label={`${r.title} ${r.enabled ? "on" : "off"}`} onChange={(v) => void patch({ enabled: v })} />
      </div>

      <div className={cn("mt-4 space-y-4 transition-opacity duration-[var(--dur-base)]", !r.enabled && "opacity-55")}>
        <Setting r={r} onConfig={(config) => void patch({ config })} />

        <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1 text-[0.9375rem] leading-snug tabular-nums">
          <dt className="whitespace-nowrap text-muted-foreground">Last run</dt>
          <dd className="min-w-0">{r.lastRun ? `${timeOfDay(r.lastRun.at)} · ${r.lastRun.result}` : "Not yet"}</dd>
          <dt className="whitespace-nowrap text-muted-foreground">Next run</dt>
          <dd className="min-w-0">{!r.enabled ? "Off" : r.nextRun ? nextRunLabel(r.nextRun) : "When something changes"}</dd>
        </dl>

        <div className="flex items-center gap-3">
          <AppButton variant="secondary" className="min-h-10 px-3.5 text-[0.9375rem]" busy={running} disabled={!r.enabled} onClick={() => void runNow()}>
            Run now
          </AppButton>
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

export function RoutinesView({ view, onRefresh }: { view: RunView; onRefresh: () => Promise<void> }) {
  // Local edits show at once; they are dropped when the save fails or the server catches up.
  const [local, setLocal] = useState<Record<string, Patch>>({});
  const routines = (view.routines ?? []).map((r) => {
    const p = local[r.id];
    return p ? { ...r, enabled: p.enabled ?? r.enabled, config: p.config ?? r.config } : r;
  });

  const patchRoutine = (id: RoutineView["id"]) => async (p: Patch): Promise<Msg | null> => {
    setLocal((l) => ({ ...l, [id]: { ...l[id], ...p } }));
    const res = await postParent("/api/routines", { id, ...p });
    if (res.ok) await onRefresh();
    setLocal((l) => {
      const next = { ...l };
      delete next[id];
      return next;
    });
    return res.ok ? null : { tone: "wait", text: res.message };
  };

  if (!routines.length) {
    return <EmptyCard title="No routines yet" body="Once your family is set up, LunchShift plans, watches and alerts on its own here." />;
  }

  return (
    <div className="space-y-4 pb-4">
      <p className="px-1 text-base text-muted-foreground">LunchShift runs these on its own. Turn off any you&apos;d rather do yourself.</p>
      <ul className="ls-stagger divide-y overflow-hidden rounded-lg bg-card border">
        {routines.map((r) => (
          <RoutineRow key={r.id} r={r} onPatch={patchRoutine(r.id)} />
        ))}
      </ul>
    </div>
  );
}

/** Family's way in to routines and memory: two rows in one card. */
export function FamilyEntries({ view, onOpen }: { view: RunView; onOpen: (s: "routines" | "memory") => void }) {
  const on = routinesOn(view);
  const total = (view.routines ?? []).length;
  const facts = (view.factHistory ?? []).filter((f) => f.active).length;
  const rows = [
    { id: "routines" as const, title: "Routines", detail: total ? `${on} of ${total} on` : "Plan, watch and alert on their own" },
    { id: "memory" as const, title: "What LunchShift remembers", detail: facts ? `${facts} confirmed fact${facts === 1 ? "" : "s"}` : "Nothing yet" },
  ];
  return (
    <div className="divide-y overflow-hidden rounded-lg bg-card border">
      {rows.map((row) => (
        <button key={row.id} type="button" onClick={() => onOpen(row.id)} className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-secondary/60">
          <span className="min-w-0 flex-1">
            <span className="block text-base font-medium">{row.title}</span>
            <span className="block text-[0.9375rem] text-muted-foreground tabular-nums">{row.detail}</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      ))}
    </div>
  );
}
