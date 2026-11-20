"use client";

import { useState } from "react";
import { cn } from "cn";
import { Plus } from "lucide-react";
import type { RunView } from "@/lib/domain/view";
import { Notice } from "./ui";
import { postParent } from "./use-run-view";

/** One chip per family at the top of the app, plus "New family". Switching re-plans the week for that child. */
/** `stacked`: one row per family, for the desktop sidebar. */
export function FamilySwitcher({
  view,
  onSwitched,
  onNew,
  stacked = false,
}: {
  view: RunView;
  onSwitched: () => Promise<void>;
  onNew: (householdId: string | null) => void;
  stacked?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!view.families.length) return null;

  const switchTo = async (id: string) => {
    setBusy(id);
    setErr(null);
    const res = await postParent("/api/family/switch", { householdId: id });
    if (!res.ok) setErr(res.message);
    else await onSwitched();
    setBusy(null);
  };
  const create = async () => {
    setBusy("new");
    setErr(null);
    const res = await postParent<{ ok: boolean; householdId: string }>("/api/family/new", {});
    setBusy(null);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    await onSwitched();
    onNew(res.data.householdId);
  };

  return (
    <div className="space-y-2">
      <ul className={cn(stacked ? "flex flex-col gap-1" : "-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]")} aria-label="Families">
        {view.families.map((f) => (
          <li key={f.id} className="shrink-0">
            <button
              type="button"
              aria-pressed={f.active}
              disabled={busy !== null}
              onClick={() => (f.active ? undefined : void switchTo(f.id))}
              className={cn(
                "inline-flex min-h-11 items-center gap-2 border py-1 pr-4 pl-1 text-left transition-colors duration-[var(--dur-fast)] disabled:cursor-wait",
                stacked ? "w-full rounded-lg" : "rounded-full",
                f.active ? "border-primary/50 bg-ok-soft" : stacked ? "border-transparent hover:bg-secondary" : "border-input/25 bg-card hover:bg-secondary",
                busy === f.id && "animate-pulse motion-reduce:animate-none",
              )}
            >
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-full text-base font-semibold",
                  f.active ? "bg-primary text-primary-foreground" : "bg-sunken text-muted-foreground",
                )}
                aria-hidden
              >
                {(f.childName || "?").charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block text-[0.9375rem] font-medium">{f.childName || "New child"}</span>
                <span className={cn("block truncate text-[0.9375rem] text-muted-foreground", !stacked && "max-w-[7.5rem]")}>
                  {f.allergies.length ? f.allergies.join(" · ") : f.onboarded ? "No allergies" : "Not set up"}
                </span>
              </span>
            </button>
          </li>
        ))}
        <li className="shrink-0">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void create()}
            className={cn(
              "inline-flex min-h-11 items-center gap-1.5 border border-dashed border-input/50 px-4 py-2.5 text-[0.9375rem] text-muted-foreground hover:text-foreground disabled:cursor-wait",
              stacked ? "w-full rounded-lg" : "rounded-full",
            )}
          >
            <Plus className="size-4" aria-hidden /> New family
          </button>
        </li>
      </ul>
      {err ? <Notice tone="alert">{err}</Notice> : null}
    </div>
  );
}
