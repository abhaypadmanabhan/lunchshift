"use client";

import { cn } from "cn";
import type { FactHistoryItem, RunView } from "@/lib/domain/view";
import { EmptyCard, SectionTitle } from "./ui";

const TZ = "America/Los_Angeles";

const GROUPS: { kind: string; title: string }[] = [
  { kind: "hard_restriction", title: "Allergies" },
  { kind: "preference", title: "Preferences" },
  { kind: "member", title: "Kids" },
];

const titleFor = (kind: string) =>
  GROUPS.find((g) => g.kind === kind)?.title ?? kind.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** "Nov 14". A bare ISO date stays on its own calendar day. */
function dateLabel(iso: string): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: dateOnly ? "UTC" : TZ });
}

function FactRow({ f }: { f: FactHistoryItem }) {
  return (
    <li className={cn("px-5 py-4", !f.active && "opacity-55")}>
      <p className={cn("text-base leading-snug", !f.active && "line-through decoration-foreground/30")}>{f.text}</p>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[0.9375rem] text-muted-foreground">
        {f.child ? <span>{f.child}</span> : <span>Whole family</span>}
        <span aria-hidden>·</span>
        <span className="font-mono text-[0.9375rem]">rev {f.revision}</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">{dateLabel(f.confirmedAt)}</span>
        {!f.active ? (
          <>
            <span aria-hidden>·</span>
            <span>Replaced</span>
          </>
        ) : null}
      </p>
    </li>
  );
}

/** Read-only: every fact the parent confirmed, newest revision first, older or inactive ones dimmed. */
export function FactHistory({ view }: { view: RunView }) {
  const facts = view.factHistory ?? [];
  if (!facts.length) {
    return <EmptyCard title="Nothing remembered yet" body="Tell LunchShift about your family and confirm what it heard. Each fact shows up here." />;
  }

  const kinds = [...GROUPS.map((g) => g.kind), ...new Set(facts.map((f) => f.kind).filter((k) => !GROUPS.some((g) => g.kind === k)))];
  const sorted = (list: FactHistoryItem[]) =>
    [...list].sort((a, b) => Number(b.active) - Number(a.active) || b.revision - a.revision || b.confirmedAt.localeCompare(a.confirmedAt));

  return (
    <div className="space-y-8 pb-4">
      <div className="px-1">
        <p className="text-lg font-semibold tracking-[-0.01em]">What LunchShift remembers</p>
        <p className="mt-1 text-base text-muted-foreground">Only what you confirmed. Older versions stay, dimmed, so you can see what changed.</p>
      </div>
      {kinds.map((kind) => {
        const list = sorted(facts.filter((f) => f.kind === kind));
        if (!list.length) return null;
        const active = list.filter((f) => f.active).length;
        return (
          <section key={kind} className="space-y-3" aria-labelledby={`facts-${kind}`}>
            <SectionTitle aside={<span className="tabular-nums">{active} active</span>}>
              <span id={`facts-${kind}`}>{titleFor(kind)}</span>
            </SectionTitle>
            <ul className="ls-stagger divide-y overflow-hidden rounded-lg bg-card border">
              {list.map((f) => (
                <FactRow key={`${f.id}:${f.revision}`} f={f} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
