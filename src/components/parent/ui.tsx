"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
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

/** Product photo on a neutral tile. A missing or broken image keeps the tile with the brand's initial. */
export function ProductTile({ src, name, brand, size = "md" }: { src?: string; name: string; brand: string; size?: "sm" | "md" }) {
  const [broken, setBroken] = useState(false);
  const box = size === "sm" ? "size-12" : "size-16";
  return (
    <span className={cn("relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sunken", box)} aria-hidden>
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- local /public product shots, sizes vary
        <img src={src} alt="" className="size-full object-contain p-1.5 mix-blend-multiply" onError={() => setBroken(true)} loading="lazy" />
      ) : (
        <span className="text-lg font-semibold text-muted-foreground/70" title={name}>
          {(brand || name).trim().charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

/** Eases a number toward its new value (420 ms). Reduced motion jumps straight there. */
export function useTween(value: number, ms = 420): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      from.current = value;
      setShown(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = start + (value - start) * eased;
      from.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

/** A plain empty or error state inside a card: what this is, and the next step. */
export function EmptyCard({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl bg-card px-6 py-10 text-center shadow-[0_1px_0_var(--border)]">
      <p className="text-lg font-semibold tracking-[-0.01em]">{title}</p>
      <p className="mx-auto mt-1.5 max-w-[22rem] text-base text-muted-foreground">{body}</p>
      {children ? <div className="mt-6 flex justify-center gap-3">{children}</div> : null}
    </div>
  );
}
