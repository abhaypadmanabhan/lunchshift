"use client";

import { useEffect, useId, useState } from "react";
import { cn } from "cn";
import { ChevronRight, X } from "lucide-react";
import type { HouseholdUpdate, HouseholdUpdateResult, RunView } from "@/lib/domain/view";
import { AutonomyControl } from "./autonomy";
import { allergyChips, pickupWindow, type AllergyChip } from "./copy";
import { FamilyEntries } from "./routines-view";
import { AppButton, Notice, SectionTitle } from "./ui";
import { postParent } from "./use-run-view";

const FALLBACK_SUGGESTIONS = ["Dairy", "Egg", "Tree nuts", "Sesame", "Wheat", "Soy", "Fish", "Shellfish"];

type Draft = { childName: string; allergies: AllergyChip[]; budget: string };

const draftFrom = (view: RunView): Draft => ({
  childName: view.household.childName,
  allergies: allergyChips(view.household.facts),
  budget: (view.household.mandate.budgetCents / 100).toFixed(0),
});

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-[var(--dur-base)]",
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

export function FamilyTab({
  view,
  onRefresh,
  onSetup,
  onOpen,
}: {
  view: RunView;
  onRefresh: () => Promise<void>;
  onSetup: () => void;
  onOpen?: (s: "routines" | "memory") => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(view));
  const [dirty, setDirty] = useState(false);
  const [entry, setEntry] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "alert"; text: string } | null>(null);
  const ids = { name: useId(), budget: useId(), allergy: useId() };

  // Follow the server until the parent starts editing; never overwrite their edits mid-poll.
  useEffect(() => {
    if (!dirty) setDraft(draftFrom(view));
  }, [view, dirty]);

  const edit = (next: Partial<Draft>) => {
    setDirty(true);
    setMsg(null);
    setDraft((d) => ({ ...d, ...next }));
  };

  const addAllergy = (text: string) => {
    const t = text.trim();
    if (!t) return;
    if (draft.allergies.some((a) => a.label.toLowerCase() === t.toLowerCase())) {
      setEntry("");
      return;
    }
    edit({ allergies: [...draft.allergies, { key: `new:${t.toLowerCase()}`, label: t, crossContact: true }] });
    setEntry("");
  };

  const budgetCents = Math.round(Number(draft.budget) * 100);
  const budgetValid = Number.isFinite(budgetCents) && budgetCents >= 500 && budgetCents <= 50000;
  const canSave = dirty && draft.childName.trim().length > 0 && budgetValid && !saving;

  const save = async () => {
    setSaving(true);
    setMsg(null);
    const body: HouseholdUpdate = {
      childName: draft.childName.trim(),
      allergies: draft.allergies.map((a) => ({ text: a.label, crossContact: a.crossContact })),
      budgetCents,
    };
    const res = await postParent<HouseholdUpdateResult>("/api/parent/household", body);
    setSaving(false);
    if (!res.ok) {
      setMsg({ tone: "alert", text: `${res.message} Your edits are still here.` });
      return;
    }
    setDirty(false);
    setMsg({ tone: "ok", text: "Saved. Re-planning this week…" });
    await onRefresh();
  };

  const suggestions = (view.allergens.length ? view.allergens.map((a) => a.label) : FALLBACK_SUGGESTIONS)
    .filter((s) => !draft.allergies.some((a) => a.label.toLowerCase() === s.toLowerCase()))
    .slice(0, 6);
  const m = view.household.mandate;

  return (
    <div className="space-y-8 pb-4">
      <section className="space-y-3" aria-labelledby="child-title">
        <SectionTitle>
          <span id="child-title">Your child</span>
        </SectionTitle>
        <div className="rounded-lg bg-card p-5 border">
          <label htmlFor={ids.name} className="text-[0.9375rem] text-muted-foreground">
            Name
          </label>
          <input
            id={ids.name}
            value={draft.childName}
            onChange={(e) => edit({ childName: e.target.value })}
            autoComplete="off"
            className="mt-1 h-11 w-full rounded-lg border border-input/40 bg-background px-3 text-base outline-none focus-visible:border-ring"
          />
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="allergy-title">
        <SectionTitle>
          <span id="allergy-title">Allergies</span>
        </SectionTitle>
        <div className="rounded-lg bg-card border">
          {draft.allergies.length ? (
            <ul className="divide-y">
              {draft.allergies.map((a) => (
                <li key={a.key} className="flex items-center gap-3 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-medium">{a.label}</p>
                    <p className="text-[0.9375rem] text-muted-foreground">Also avoid “may contain” warnings</p>
                  </div>
                  <Toggle
                    checked={a.crossContact}
                    label={`Also avoid may-contain warnings for ${a.label}`}
                    onChange={(v) => edit({ allergies: draft.allergies.map((x) => (x.key === a.key ? { ...x, crossContact: v } : x)) })}
                  />
                  <button
                    type="button"
                    aria-label={`Remove ${a.label}`}
                    onClick={() => edit({ allergies: draft.allergies.filter((x) => x.key !== a.key) })}
                    className="-mr-2 inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    <X className="size-5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-4 text-base text-muted-foreground">No allergies added. LunchShift still checks every label for the ones you add.</p>
          )}
          <form
            className="border-t px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              addAllergy(entry);
            }}
          >
            <label htmlFor={ids.allergy} className="text-[0.9375rem] text-muted-foreground">
              Add an allergy in your own words
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id={ids.allergy}
                value={entry}
                onChange={(e) => setEntry(e.target.value)}
                placeholder="dairy, tree nuts, kiwi…"
                autoComplete="off"
                className="h-11 min-w-0 flex-1 rounded-lg border border-input/40 bg-background px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring"
              />
              <AppButton type="submit" variant="secondary" disabled={!entry.trim()}>
                Add
              </AppButton>
            </div>
            {suggestions.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => addAllergy(s)}
                    className="min-h-9 rounded-full border border-input/30 px-3 text-[0.9375rem] hover:bg-secondary"
                  >
                    + {s}
                  </button>
                ))}
              </div>
            ) : null}
          </form>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="week-title">
        <SectionTitle>
          <span id="week-title">Budget and pickup</span>
        </SectionTitle>
        <div className="divide-y rounded-lg bg-card border">
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <label htmlFor={ids.budget} className="text-base">
              Weekly budget
            </label>
            <div className="flex items-center gap-1">
              <span className="text-base text-muted-foreground">$</span>
              <input
                id={ids.budget}
                inputMode="numeric"
                value={draft.budget}
                onChange={(e) => edit({ budget: e.target.value.replace(/[^0-9.]/g, "") })}
                aria-invalid={!budgetValid || undefined}
                className="h-11 w-20 rounded-lg border border-input/40 bg-background px-3 text-right text-base tabular-nums outline-none focus-visible:border-ring aria-invalid:border-refuse"
              />
            </div>
          </div>
          {!budgetValid ? <p className="px-5 py-3 text-[0.9375rem] text-refuse">Enter a weekly budget between $5 and $500.</p> : null}
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <span className="text-base">Pickup</span>
            <span className="text-base text-muted-foreground">{pickupWindow(m.window)}</span>
          </div>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="approval-title">
        <SectionTitle>
          <span id="approval-title">How much can LunchShift do?</span>
        </SectionTitle>
        <div className="rounded-lg bg-card p-5 border">
          <AutonomyControl view={view} onRefresh={onRefresh} />
          <p className="mt-4 text-base font-medium">LunchShift can hold, never pay.</p>
          <p className="mt-1 text-[0.9375rem] text-muted-foreground">
            Up to {m.maxSwapsPerWeek} swap{m.maxSwapsPerWeek === 1 ? "" : "s"} and {m.maxHoldsPerWeek} hold a week.
          </p>
        </div>
      </section>

      {onOpen ? <FamilyEntries view={view} onOpen={onOpen} /> : null}

      <button
        type="button"
        onClick={onSetup}
        className="flex w-full items-center gap-4 rounded-lg bg-card px-5 py-4 text-left border hover:bg-secondary/60"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-base font-medium">Tell LunchShift something new</span>
          <span className="block text-[0.9375rem] text-muted-foreground">Set up again in a short chat</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      <div className="sticky bottom-[4.75rem] z-10 space-y-3 rounded-lg bg-background py-2 ">
        {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
        <AppButton className="w-full" disabled={!canSave} busy={saving} onClick={() => void save()}>
          {dirty ? "Save and re-plan this week" : "No changes to save"}
        </AppButton>
      </div>
    </div>
  );
}
