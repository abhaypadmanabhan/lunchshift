"use client";

import { ShieldCheck } from "lucide-react";
import { AppButton } from "./ui";

const WEEK = [
  { day: "Mon", field: "bg-meal-wheat", ink: "text-meal-wheat-ink" },
  { day: "Tue", field: "bg-meal-leaf", ink: "text-meal-leaf-ink" },
  { day: "Wed", field: "bg-meal-tomato", ink: "text-meal-tomato-ink" },
  { day: "Thu", field: "bg-meal-bean", ink: "text-meal-bean-ink" },
  { day: "Fri", field: "bg-meal-leaf", ink: "text-meal-leaf-ink" },
];

/** The first frame: what LunchShift is, in one line, and one way in. */
export function Landing({ onStart }: { onStart: () => void }) {
  return (
    <div className="relative flex min-h-[calc(100dvh-6rem)] flex-col overflow-hidden px-6 pt-10 pb-8 md:min-h-[calc(100dvh-8rem)]">
      <div className="pointer-events-none absolute -top-24 -right-20 size-80 rounded-full bg-bloom blur-3xl" aria-hidden />
      <p className="relative text-[1.0625rem] font-semibold tracking-[-0.01em] text-primary">LunchShift</p>

      <div className="relative mt-auto">
        <ul className="ls-stagger flex gap-2" aria-hidden>
          {WEEK.map((d) => (
            <li key={d.day} className={`flex h-20 flex-1 flex-col justify-between rounded-xl p-2.5 md:h-28 md:p-3.5 ${d.field}`}>
              <span className={`text-[0.9375rem] font-medium ${d.ink}`}>{d.day}</span>
              <ShieldCheck className={`size-5 ${d.ink}`} strokeWidth={1.8} />
            </li>
          ))}
        </ul>
        <h1 className="ls-enter mt-10 text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.03em] text-balance md:text-[3.5rem]">Your kid&apos;s school lunches, planned and safe</h1>
        <p className="ls-enter mt-4 max-w-[30ch] text-lg leading-relaxed md:max-w-[44ch] md:text-[1.375rem] text-muted-foreground [animation-delay:80ms]">
          Tell us about your child once. Every Sunday LunchShift plans five lunches, checks every label and holds the groceries for pickup.
        </p>
      </div>

      <div className="relative mt-10 space-y-3 md:max-w-[22rem]">
        <AppButton className="ls-enter min-h-14 w-full rounded-xl text-[1.0625rem] [animation-delay:160ms]" onClick={onStart}>
          Set up my family
        </AppButton>
        <p className="text-center text-[0.9375rem] text-muted-foreground md:text-left">It holds, never pays. You pay at pickup.</p>
      </div>
    </div>
  );
}
