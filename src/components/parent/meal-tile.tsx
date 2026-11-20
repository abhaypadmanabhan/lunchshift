import { cn } from "cn";

type Field = "wheat" | "leaf" | "tomato" | "bean";

/** Each recipe gets a food-coloured field and a two-letter monogram. Unknown recipes fall back to their initials. */
const ART: Record<string, { field: Field; mark: string }> = {
  "r-sunbutter-sandwich": { field: "wheat", mark: "Sb" },
  "r-gf-sunbutter": { field: "wheat", mark: "Gf" },
  "r-quesadilla": { field: "tomato", mark: "Qu" },
  "r-bean-quesadilla": { field: "bean", mark: "Bq" },
  "r-pasta-salad": { field: "tomato", mark: "Ps" },
  "r-veggie-pasta": { field: "leaf", mark: "Vp" },
  "r-hummus-box": { field: "bean", mark: "Hu" },
  "r-turkey-rollups": { field: "wheat", mark: "Tr" },
  "r-turkey-rice-box": { field: "leaf", mark: "Tb" },
  "r-rice-bean-bowl": { field: "leaf", mark: "Rb" },
  "r-peanut-noodles": { field: "tomato", mark: "Pn" },
};

const FIELD: Record<Field, string> = {
  wheat: "bg-meal-wheat text-meal-wheat-ink",
  leaf: "bg-meal-leaf text-meal-leaf-ink",
  tomato: "bg-meal-tomato text-meal-tomato-ink",
  bean: "bg-meal-bean text-meal-bean-ink",
};

function fallback(name: string): { field: Field; mark: string } {
  const words = name.replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter(Boolean);
  const mark = ((words[0]?.[0] ?? "L").toUpperCase() + (words[1]?.[0] ?? "").toLowerCase()).slice(0, 2);
  const fields: Field[] = ["wheat", "leaf", "tomato", "bean"];
  return { field: fields[name.length % fields.length], mark };
}

export function MealTile({ recipeId, name, imageUrl, className }: { recipeId: string; name: string; imageUrl?: string; className?: string }) {
  const art = ART[recipeId] ?? fallback(name);
  if (imageUrl) {
    return (
      <span aria-hidden className={cn("relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-card ring-1 ring-border", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- local Open Food Facts snapshot, already small */}
        <img src={imageUrl} alt="" className="size-full object-contain p-1" loading="lazy" />
      </span>
    );
  }
  return (
    <span aria-hidden className={cn("relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl", FIELD[art.field], className)}>
      {/* a plate seen from above: one soft ring, then the monogram */}
      <span className="absolute inset-[0.4rem] rounded-full bg-card/45 ring-1 ring-current/10" />
      <span className="relative text-[1.25rem] font-semibold tracking-[-0.03em]">{art.mark}</span>
    </span>
  );
}
