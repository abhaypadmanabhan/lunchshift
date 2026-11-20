"use client";

import { ShieldCheck } from "lucide-react";
import { AppButton } from "./ui";

const WEEK = [
  { day: "Mon", meal: "Rice bowl", field: "bg-meal-wheat", ink: "text-meal-wheat-ink" },
  { day: "Tue", meal: "Quesadilla", field: "bg-meal-leaf", ink: "text-meal-leaf-ink" },
  { day: "Wed", meal: "Pasta salad", field: "bg-meal-tomato", ink: "text-meal-tomato-ink" },
  { day: "Thu", meal: "Hummus box", field: "bg-meal-bean", ink: "text-meal-bean-ink" },
  { day: "Fri", meal: "Turkey pita", field: "bg-meal-leaf", ink: "text-meal-leaf-ink" },
];

/** The first frame: what LunchShift is, in one line, and one way in. */
export function Landing({ onStart }: { onStart: () => void }) {
  return (
    <div className="relative flex min-h-[calc(100dvh-6rem)] flex-col overflow-hidden px-6 pt-10 pb-8 md:min-h-[calc(100dvh-8rem)]">
      <p className="relative text-[1.0625rem] font-semibold tracking-[-0.01em] text-primary">LunchShift</p>

      <div className="relative mt-auto">
        <ul className="ls-stagger flex gap-2" aria-hidden>
          {WEEK.map((d) => (
            <li key={d.day} className={`flex h-20 flex-1 flex-col justify-between rounded-lg p-2.5 md:h-28 md:p-3.5 ${d.field}`}>
              <span className={`flex items-center justify-between text-[0.9375rem] font-medium ${d.ink}`}>
                {d.day}
                <ShieldCheck className="size-[1.125rem]" strokeWidth={1.8} />
              </span>
              <span className={`text-[0.9375rem] font-medium leading-tight tracking-[-0.01em] ${d.ink}`}>{d.meal}</span>
            </li>
          ))}
        </ul>
        <h1 className="ls-enter mt-10 text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.03em] text-balance md:text-[3.5rem]">Your kid&apos;s school lunches, planned and safe</h1>
        <p className="ls-enter mt-4 max-w-[30ch] text-lg leading-relaxed md:max-w-[44ch] md:text-[1.375rem] text-muted-foreground [animation-delay:80ms]">
          Tell us about your child once. Every Sunday LunchShift plans five lunches, checks every label and holds the groceries for pickup.
        </p>
      </div>

      <div className="relative mt-10 space-y-3 md:max-w-[22rem]">
        <AppButton className="ls-enter min-h-14 w-full rounded-lg text-[1.0625rem] [animation-delay:160ms]" onClick={onStart}>
          Set up my family
        </AppButton>
        <p className="text-center text-[0.9375rem] text-muted-foreground md:text-left">It holds the groceries. The agent never pays. You approve payment.</p>
      </div>
    </div>
  );
}
