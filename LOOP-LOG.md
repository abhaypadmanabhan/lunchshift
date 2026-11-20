# Loop log

Each `npm run kpi` loop: time, the six KPI values, the worst miss, the change made.

## Loop 1 · 11:14 PT
- Unsafe 0 · completeness **80%** (miss) · clicks 0 · duplicate holds 0 · budget kept ($29.48/$35) · traced 100%. 10/10 scenarios.
- Worst miss: completeness measured on the unrepaired basket in `suggest_only`. Change: measure the repaired basket the parent is asked to approve.

## Loop 2 · 11:18 PT
- All six green: unsafe 0 · completeness 100% · clicks 0 · duplicate holds 0 · budget kept · traced 100%. 10/10 scenarios.
- Change: harness now uses the merged vector ranker and preference query (rice bowl 0.945 vs quesadilla 0.499).
- Live run (real Cognee, Anthropic, Statsig default): stockout event -> refusal cites fact-allergy-peanut r3 -> proposal -> KPIs. Peanut-noodle refusal reason cleaned up (recipe allergen only).

## Loop 3 · 11:30 PT
- Suite: 11/11 (added parent sign-off scenario). All six green: unsafe 0 · completeness 100% · auto clicks 0 · duplicate holds 0 · budget kept · traced 100%.
- Live run through the built UI stack (grocer :4100, worker, Next :3000): stockout event -> refusal citing Cognee fact r3 -> Claude-explained proposal -> parent approval -> store commits and drops the response -> read-back by key -> 1 verified hold, $26.97/$35.
- Worst miss found live (not in the KPI suite): suggest_only showed the repaired cart as "unchanged". Change: suggest_only saves cart v1; repaired basket lives only in the proposal. Also labelled the parent sign-off click (expected in suggest_only) instead of "Missed".

## Loop 4 · 11:42 PT
- Suite: 13/13 (added: suggest_only with no stockout waits for approval; allergen classifier can only add refusals). All six KPIs green.
- Worst miss found live: suggest_only with no stockout set the run to `swapped_waiting`. The new scenario was red on the old code; fixed.
- Sponsors: SIE live as a task-model tool (zero-shot allergen classifier + reranker; fixed a latent position-based score mapping). Statsig config now readable live. SingleStore still fails DNS; URL parsing and no-db bootstrap are ready.

## Loop 5 · cross-model review (Grok 4.7) · 11:44 PT
- Review verdict CHANGES, with 7 findings. Each finding was reproduced as a scenario first; all five new scenarios were red on the old code.
- Fixed: only `evidence: "confirmed"` counts (an unlabelled SKU was held); a parent click is capped by the parent's max, and a failed config read never authorizes; the household is re-read before each mode check, so a mid-run revocation is seen; `maxHoldsPerWeek` is enforced across the week's runs; read-back requires an exact line match, the stored fingerprint and exactly one active hold; the unsafe KPI is measured from the merchant's held lines against a fresh catalog.
- Suite now 18/18; all six KPIs green. Not done: the cross-run `maxSwapsPerWeek` count (one run per week in the demo), and KPIs on escalated runs (shown as pending).

## Loop 6 · live Statsig flip · 11:50 PT
- Live flip proven: the run waited in `auto_swap` (cart repaired, no hold). Abhay set `auto_swap_and_hold` in the Statsig console. Over 3 consecutive worker ticks (6 s) the reads went suggest_only -> auto_swap -> auto_swap_and_hold (Statsig propagation is eventually consistent). The pre-hold re-read agreed, so one hold was placed; the store dropped the reply; read-back by key verified H-F86DD81A, $26.97, 1 active hold. About 15 s from Abhay's message to a verified hold.
- Miss found on screen: the hold expired 48 h after creation (Nov 22 11:49), before the 4-6 pm pickup. Change: the store sets expiry to the end of the pickup slot, and read-back now requires the expiry to cover pickup.
- Suite 18/18, all six KPIs green.
