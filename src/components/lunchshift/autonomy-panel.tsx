import { MODE_RANK, type AutonomyMode } from "@/lib/domain/types";
import type { RunView } from "@/lib/domain/view";
import { MODE_LABEL, clock, money, shortDate } from "./format";
import { Code, Panel } from "./primitives";

const LADDER: AutonomyMode[] = ["suggest_only", "auto_swap", "auto_swap_and_hold"];
const SHORT: Record<AutonomyMode, string> = { suggest_only: "Suggest", auto_swap: "Swap", auto_swap_and_hold: "Swap + hold" };

/** Filled segment: what the agent may do now. Outlined segment: what Statsig says, shown only when the two differ. */
function ModeLadder({ observed, effective, parentMax }: { observed: AutonomyMode; effective: AutonomyMode; parentMax: AutonomyMode }) {
  return (
    <ol className="grid grid-cols-3 gap-1 rounded-lg bg-sunken p-1" aria-label="Autonomy levels">
      {LADDER.map((m) => {
        const active = m === effective;
        const statsigOnly = m === observed && !active;
        const allowed = MODE_RANK[m] <= MODE_RANK[parentMax];
        return (
          <li
            key={m}
            aria-current={active ? "step" : undefined}
            className={
              active
                ? "rounded-md bg-primary px-2 py-2 text-center text-sm font-medium text-primary-foreground transition-colors duration-300"
                : statsigOnly
                  ? "rounded-md px-2 py-2 text-center text-sm text-foreground shadow-[inset_0_0_0_1.5px_var(--primary)] transition-colors duration-300"
                  : allowed
                    ? "rounded-md px-2 py-2 text-center text-sm text-muted-foreground transition-colors duration-300"
                    : "rounded-md px-2 py-2 text-center text-sm text-muted-foreground/60 line-through"
            }
          >
            {SHORT[m]}
            {statsigOnly ? <span className="sr-only"> (Statsig says)</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** One short line on why the effective mode is not what Statsig says, or null when they agree. */
function whyDifferent(view: RunView): string | null {
  const { observed, effective, parentMax } = view.mode;
  const m = view.household.mandate;
  if (observed === effective) return null;
  if (MODE_RANK[effective] > MODE_RANK[observed]) {
    const approved = view.events.some((e) => e.actor === "parent" && e.data.approved === true);
    return approved ? "Parent approved this order" : "Raised for this run";
  }
  if (m.revoked) return "Capped: standing approval revoked";
  if (Date.parse(m.expiresAt) <= Date.parse(view.mode.fetchedAt)) return "Capped: standing approval expired";
  if (MODE_RANK[observed] > MODE_RANK[parentMax]) return "Capped by parent";
  return "Capped for this run";
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3 py-1.5">
      <dt className="text-sm text-muted-foreground">{k}</dt>
      <dd className="text-[0.9375rem]">{children}</dd>
    </div>
  );
}

export function AutonomyPanel({ view }: { view: RunView }) {
  const { mode } = view;
  const m = view.household.mandate;
  const why = whyDifferent(view);

  return (
    <Panel title="Autonomy" aside={mode.source === "statsig" ? "Statsig live" : "Default (config unavailable)"}>
      <div key={`${mode.observed}-${mode.effective}`} className="ls-enter">
        <ModeLadder observed={mode.observed} effective={mode.effective} parentMax={mode.parentMax} />
        <p className="mt-2 text-sm text-muted-foreground">
          {why ? "Filled: what the agent may do. Outlined: what Statsig says now." : "Statsig and the agent agree."}
        </p>
      </div>
      <dl className="mt-3">
        <Row k="Statsig says now">
          <span className="font-medium">{MODE_LABEL[mode.observed]}</span>{" "}
          <Code>{mode.observed}</Code>
        </Row>
        <Row k="Effective">
          <span className="font-medium">{MODE_LABEL[mode.effective]}</span>
          {why ? <span className="block text-sm text-muted-foreground">{why}</span> : null}
        </Row>
        <Row k="Parent allows up to">
          <Code className="text-foreground">{mode.parentMax}</Code>
        </Row>
        <Row k="Source">
          {mode.source === "statsig" ? "Statsig" : "Safe default"}
          <span className="text-muted-foreground">, read {clock(mode.fetchedAt)}</span>
          {mode.ruleId ? <Code className="block">{mode.ruleId}</Code> : null}
        </Row>
      </dl>

      <div className="mt-5 border-t pt-4">
        <h3 className="mb-1 text-base font-semibold">
          Standing approval
          {m.revoked ? <span className="ml-2 text-sm font-medium text-refuse">Revoked</span> : null}
        </h3>
        <p className="mb-2 text-sm text-muted-foreground">Approved once by the parent on {shortDate(m.approvedAt)}</p>
        <dl>
          <Row k="Store">
            <Code className="text-foreground">{m.storeId}</Code>
          </Row>
          <Row k="Window">{m.window.replace(/^Sun/, "Sundays,")}</Row>
          <Row k="Limits">
            {m.maxSwapsPerWeek} swap, {m.maxHoldsPerWeek} hold per week
          </Row>
          <Row k="Budget">{money(m.budgetCents)} all-in</Row>
          <Row k="Expires">{shortDate(m.expiresAt)}</Row>
          <Row k="Agent can">
            <span className="flex flex-wrap gap-x-2.5 gap-y-1">
              {m.scopes.map((s) => (
                <Code key={s} className="text-foreground">
                  {s}
                </Code>
              ))}
            </span>
            <span className="mt-1 block text-sm font-medium">No payment scope</span>
          </Row>
        </dl>
      </div>
    </Panel>
  );
}
