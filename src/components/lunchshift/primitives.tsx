import { cn } from "@/lib/utils";
import { RECIPES } from "@/lib/domain/fixture";
import { allSkus } from "@/lib/domain/catalog";
const CATALOG = allSkus();

/** A literal value (id, SKU, version, key). The only place DM Mono appears outside the audit log. */
export function Code({ children, className }: { children: React.ReactNode; className?: string }) {
  return <code className={cn("font-mono text-[0.9375rem] text-muted-foreground [overflow-wrap:anywhere]", className)}>{children}</code>;
}

export function Panel({
  title,
  aside,
  children,
  className,
  id,
}: {
  title?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("rounded-xl border bg-card p-6", className)}>
      {title ? (
        <header className="mb-5 flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-[-0.01em]">{title}</h2>
          {aside ? <div className="text-sm text-muted-foreground">{aside}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

// Display names for ids the RunView carries without names. Synthetic fixture data, safe client-side.
export const skuName = (id: string) => CATALOG.find((s) => s.id === id)?.name ?? id;
export const skuInfo = (id: string) => CATALOG.find((s) => s.id === id);
export const recipeName = (id: string) =>
  RECIPES.find((r) => r.id === id)?.name ?? CATALOG.find((s) => s.id === id)?.name ?? id;
export const recipeInfo = (id: string) => RECIPES.find((r) => r.id === id);
