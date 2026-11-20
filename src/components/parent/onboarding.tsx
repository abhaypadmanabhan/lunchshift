"use client";

import { useId, useState } from "react";
import { cn } from "cn";
import { Check, ChevronLeft } from "lucide-react";
import type { HouseholdUpdate, HouseholdUpdateResult, RunView } from "@/lib/domain/view";
import { allergyChips, pickupWindow } from "./copy";
import { AppButton, Notice } from "./ui";
import { postParent } from "./use-run-view";

const SEEN_KEY = "lunchshift.onboarded.v1";

/** First-visit flag. Storage can be blocked (private window, previews): treat that as "seen" so the app never nags. */
export function onboardingSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}
export function markOnboardingSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // storage blocked: the flow simply shows again next visit
  }
}

const FALLBACK = ["Peanuts", "Tree nuts", "Milk / dairy", "Eggs", "Wheat / gluten", "Soy", "Sesame", "Fish", "Shellfish"];

type Picked = { label: string; crossContact: boolean };

const STEP_TITLES = ["Who's the lunch for?", "What must LunchShift avoid?", "Budget and pickup"] as const;

export function Onboarding({ view, onDone, onRefresh }: { view: RunView; onDone: () => void; onRefresh: () => Promise<void> }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(view.household.childName);
  const [picked, setPicked] = useState<Picked[]>(() => allergyChips(view.household.facts).map((a) => ({ label: a.label, crossContact: a.crossContact })));
  const [entry, setEntry] = useState("");
  const [budget, setBudget] = useState(((view.household.mandate.budgetCents || 3500) / 100).toFixed(0));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ids = { name: useId(), other: useId(), budget: useId() };

  const chips = view.allergens.length ? view.allergens.map((a) => a.label) : FALLBACK;
  const has = (label: string) => picked.some((p) => p.label.toLowerCase() === label.toLowerCase());
  const toggle = (label: string) => setPicked((p) => (has(label) ? p.filter((x) => x.label.toLowerCase() !== label.toLowerCase()) : [...p, { label, crossContact: true }]));
  const addOther = () => {
    const t = entry.trim();
    if (t && !has(t)) setPicked((p) => [...p, { label: t, crossContact: true }]);
    setEntry("");
  };
  const custom = picked.filter((p) => !chips.some((c) => c.toLowerCase() === p.label.toLowerCase()));

  const budgetCents = Math.round(Number(budget) * 100);
  const budgetValid = Number.isFinite(budgetCents) && budgetCents >= 500 && budgetCents <= 50000;
  const child = name.trim() || "your child";

  const skip = () => {
    markOnboardingSeen();
    onDone();
  };

  const finish = async () => {
    setSaving(true);
    setErr(null);
    const body: HouseholdUpdate = {
      childName: name.trim(),
      allergies: picked.map((p) => ({ text: p.label, crossContact: p.crossContact })),
      budgetCents,
      // "Let LunchShift place my Sunday hold" is the parent's one-time standing approval for these rules.
      approveStanding: { maxAutonomy: "auto_swap_and_hold" },
    };
    const res = await postParent<HouseholdUpdateResult>("/api/parent/household", body);
    setSaving(false);
    if (!res.ok) {
      setErr(`${res.message} Your answers are still here.`);
      return;
    }
    markOnboardingSeen();
    await onRefresh();
    onDone();
  };

  const canNext = step === 0 ? name.trim().length > 0 : step === 1 ? true : budgetValid;

  return (
    <div className="flex min-h-[calc(100dvh-12rem)] flex-col" aria-labelledby="ob-title">
      <div className="flex items-center justify-between gap-4">
        {step > 0 ? (
          <button type="button" onClick={() => setStep(step - 1)} className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-md pr-2 text-base font-medium text-primary hover:underline">
            <ChevronLeft className="size-5" aria-hidden /> Back
          </button>
        ) : (
          <span className="text-[0.9375rem] text-muted-foreground">Takes about 30 seconds</span>
        )}
        <button type="button" onClick={skip} className="inline-flex min-h-11 items-center rounded-md px-1 text-base text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground">
          Skip for now
        </button>
      </div>

      <ol className="mt-4 grid grid-cols-3 gap-2" aria-label={`Step ${step + 1} of 3`}>
        {STEP_TITLES.map((t, i) => (
          <li key={t} aria-current={i === step ? "step" : undefined}>
            <span className={cn("block h-1 rounded-full transition-colors duration-[var(--dur-slow)]", i <= step ? "bg-primary" : "bg-foreground/10")} />
          </li>
        ))}
      </ol>

      <div key={step} className="ls-enter mt-8 flex-1">
        <p className="text-[0.9375rem] text-muted-foreground tabular-nums">Step {step + 1} of 3</p>
        <h2 id="ob-title" className="mt-1 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">
          {step === 1 ? `What must ${child} avoid?` : STEP_TITLES[step]}
        </h2>

        {step === 0 ? (
          <div className="mt-6">
            <p className="text-base text-muted-foreground">LunchShift plans five school lunches a week and holds the groceries for a Sunday pickup.</p>
            <label htmlFor={ids.name} className="mt-6 block text-[0.9375rem] text-muted-foreground">
              Child&apos;s first name
            </label>
            <input
              id={ids.name}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) setStep(1);
              }}
              placeholder="Maya"
              autoComplete="off"
              autoFocus
              className="mt-1 h-12 w-full rounded-lg border border-input/40 bg-card px-4 text-lg outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring"
            />
          </div>
        ) : null}

        {step === 1 ? (
          <div className="mt-6">
            <p className="text-base text-muted-foreground">
              Every product label is checked against these, including “may contain” warnings. Pick any that apply.
            </p>
            <div className="ls-stagger mt-5 flex flex-wrap gap-2" role="group" aria-label="Allergies">
              {chips.map((c) => {
                const on = has(c);
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(c)}
                    className={cn(
                      "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-base transition-colors duration-[var(--dur-fast)]",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-input/30 bg-card hover:bg-secondary",
                    )}
                  >
                    {on ? <Check className="size-4" strokeWidth={2.5} aria-hidden /> : null}
                    {c}
                  </button>
                );
              })}
              {custom.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  aria-pressed
                  onClick={() => toggle(c.label)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-primary bg-primary px-4 text-base text-primary-foreground"
                >
                  <Check className="size-4" strokeWidth={2.5} aria-hidden />
                  {c.label}
                </button>
              ))}
            </div>
            <form
              className="mt-6"
              onSubmit={(e) => {
                e.preventDefault();
                addOther();
              }}
            >
              <label htmlFor={ids.other} className="text-[0.9375rem] text-muted-foreground">
                Something else? Type it in your own words
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id={ids.other}
                  value={entry}
                  onChange={(e) => setEntry(e.target.value)}
                  placeholder="kiwi, mustard, coconut…"
                  autoComplete="off"
                  className="h-12 min-w-0 flex-1 rounded-lg border border-input/40 bg-card px-4 text-base outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring"
                />
                <AppButton type="submit" variant="secondary" className="min-h-12" disabled={!entry.trim()}>
                  Add
                </AppButton>
              </div>
            </form>
            {!picked.length ? <p className="mt-4 text-[0.9375rem] text-muted-foreground">No allergies? You can continue and add them later in Family.</p> : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="mt-6 space-y-5">
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
                    value={budget}
                    onChange={(e) => setBudget(e.target.value.replace(/[^0-9.]/g, ""))}
                    aria-invalid={!budgetValid || undefined}
                    className="h-11 w-20 rounded-lg border border-input/40 bg-background px-3 text-right text-base tabular-nums outline-none focus-visible:border-ring aria-invalid:border-refuse"
                  />
                </div>
              </div>
              {!budgetValid ? <p className="px-5 py-3 text-[0.9375rem] text-refuse">Enter a weekly budget between $5 and $500.</p> : null}
              <div className="flex items-center justify-between gap-4 px-5 py-4">
                <span className="text-base">Pickup</span>
                <span className="text-base text-muted-foreground">{pickupWindow(view.household.mandate.window)}, every week</span>
              </div>
            </div>
            <div className="rounded-lg bg-sunken px-5 py-4">
              <p className="text-base font-medium">What happens next</p>
              <p className="mt-1 text-base text-muted-foreground">
                Every Sunday LunchShift plans {child === "your child" ? "the" : `${child}'s`} lunches, refuses anything unsafe and holds the groceries for pickup. The agent never pays. You approve payment.
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="sticky bottom-0 mt-8 pb-4 space-y-3 bg-background py-2 ">
        {err ? <Notice tone="alert">{err}</Notice> : null}
        {step < 2 ? (
          <AppButton className="min-h-12 w-full text-[1.0625rem]" disabled={!canNext} onClick={() => setStep(step + 1)}>
            {step === 1 && !picked.length ? "Continue without allergies" : "Continue"}
          </AppButton>
        ) : (
          <AppButton className="min-h-12 w-full text-[1.0625rem]" disabled={!canNext} busy={saving} onClick={() => void finish()}>
            Let LunchShift place my Sunday hold
          </AppButton>
        )}
      </div>
    </div>
  );
}
