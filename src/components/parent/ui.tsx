"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "cn";
import { LoaderCircle } from "lucide-react";

type Variant = "primary" | "secondary" | "quiet";

const VARIANT: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/85",
  secondary: "border border-input/40 bg-card text-foreground hover:bg-secondary active:bg-muted",
  quiet: "text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground px-0 min-h-0",
};

export function AppButton({
  variant = "primary",
  busy = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-base font-medium transition-colors duration-[var(--dur-fast)] disabled:cursor-not-allowed disabled:opacity-60",
        VARIANT[variant],
        className,
      )}
    >
      {busy ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
      {children}
    </button>
  );
}

/** A calm inline message under an action: what happened and what to do. */
export function Notice({ tone, children }: { tone: "ok" | "wait" | "alert"; children: ReactNode }) {
  const cls = {
    ok: "bg-ok-soft text-foreground",
    wait: "bg-wait-soft text-foreground",
    alert: "bg-refuse-soft text-foreground",
  }[tone];
  return (
    <p role="status" className={cn("ls-enter rounded-lg px-4 py-3 text-[0.9375rem] leading-snug", cls)}>
      {children}
    </p>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-1">
      <h2 className="text-lg font-semibold tracking-[-0.01em]">{children}</h2>
      {aside ? <span className="text-[0.9375rem] text-muted-foreground">{aside}</span> : null}
    </div>
  );
}
