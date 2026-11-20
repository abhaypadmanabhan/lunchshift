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

## Loop 7 · unattended full-auto proof · 11:52 PT
- `npm run demo:fullauto`: clean state, the store boots with the usual bread sold out, and the Sunday schedule is due 20 s after launch. No inputs after launch.
- 11:52:04 schedule fired -> Cognee recall -> Statsig `auto_swap_and_hold` -> SIE classifier -> refusals -> SIE rerank -> Claude -> swap -> pre-hold re-read -> hold -> read-back -> verified at 11:52:12. Audit actors: worker, cognee, statsig, sie, grocer, ranker, llm. Zero parent or operator events. KPIs: unsafe 0, complete 100%, clicks 0, duplicate holds 0, $26.97/$35, traced 100%.
- Saved: docs/proof/fullauto-run.txt, docs/proof/fullauto-screen.png.

## Loop 8 · SingleStore live · 11:58 PT
- Diagnosis (`npm run diag:singlestore`): DNS ok, TCP 3306 ok, SQL `SELECT 1` 184 ms. The earlier "timeout" was the 5 s probe covering the first `CREATE DATABASE`; raised to 15 s.
- `npm run smoke:store` on SingleStore: TLS verified (system), household/run/events/receipt/KPIs read back, 7 concurrent appends gap-free.
- Ranking made two-stage, per the PRD: SingleStore vector SQL shortlist (0.945 / 0.499) -> SIE Qwen3 rerank (0.989 / 0.001). Previously SIE replaced the SingleStore stage outright.
- Live run on the SingleStore-backed stack in `auto_swap`: refusal, swap, waiting for hold authority. All six integration chips show live. Suite 19/19, KPIs green.

## Loop 9 · product expansion · 12:15-12:31 PT
- Any allergy: canonical 9 + synonyms + custom free text; label parser; multi-lunch repair; a rules change caps autonomy until the parent re-approves. `npm run test:allergens` caught that bug first: a rules change with no affected lunch placed a hold without approval.
- Allergen v2 (captain steer): fixed the false positives; OFF tags as primary evidence, and OFF-vs-text disagreement blocks the item; 32 edge-case labels.
- Cart and orders: draft cart with deterministic checks; pay-at-pickup orders keyed by `order:<runId>`; the agent auto-orders in full auto. KPI scenario: a dropped order reply still gives exactly 1 order.
- Suite 21/21, allergen matrix all pass, live API path proven.

## Loop 10 · integration · 12:45 PT
- Live integration found two misses that the suites didn't:
  1. **Approval gate leak (critical).** A run that needed approval for more swaps than the mandate allows was applied and held on the next tick, because the mode re-read forgot the pending approval. The two-allergy scenario now ticks twice before approving; it failed on the old code (hold placed), and the fix (the run remembers it is awaiting approval and caps autonomy) passes.
  2. **SIE classifier false positive.** "Contains: milk." scored 0.65 "contains peanuts" because the model had no neutral class to choose. Added an "only other ingredients" class and raised the threshold to 0.85. Live check: peanut flags exactly 2 products, peanut+sesame exactly 3, dairy exactly 1.
- Suite 21/21; allergen matrix all pass.

## Loop 11 · real catalog + design · 13:06 PT
- Real Open Food Facts snapshot (45 products, 42 photos, demo prices) behind `LUNCHSHIFT_CATALOG=off`, the demo default. The story holds on real labels: the usual When Pigs Fly whole wheat sells out; the cheaper Country Hearth Dakota 12-Grain is refused (OFF traces: peanuts; SIE 0.95); the Hannaford bread with no ingredient text is blocked; Monday becomes the rice-and-bean bowl ($30.36/$35).
- Design pass merged (desktop stage with the "LunchShift at work" panel, the "Kept Maya safe" hero, short status lines). Live fixes: feed copy from real event data (sponsor credits: Cognee, SIE, SingleStore, Claude, Statsig, Store); the hero shows the allergen sentence of a real label, not the full ingredient list.
- Suites unchanged and green (fixture): kpi 21/21, allergen matrix all pass. Secret scan PASS; history grep shows no keys.

## Loop 12 · live rehearsal + backup video · 13:16 PT
- Rehearsal on real products with Abhay's live Statsig flip: the parent-edited cart ($31.55) was held; the store reply was dropped; read-back verified H-AFFE14B2 (1 active); the agent placed order LS-5425D4 (pay at pickup). During propagation the pre-hold re-read saw `auto_swap` twice and correctly waited; the hold was placed once both reads agreed.
- Fixes: the clicks KPI counts only clicks the order needed (approvals), not voluntary cart edits; the feed collapses flapping mode reads; the status total follows the parent's cart.
- Backup video: `docs/proof/backup-fullauto.mp4`, 50 s, recorded by `scripts/record.mjs` (CDP screencast + ffmpeg) of the unattended run. Audit actors: worker, cognee, statsig, sie, ranker, llm, grocer; zero parent or operator events.
