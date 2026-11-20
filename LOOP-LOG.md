# Loop log

Each `npm run kpi` loop: time, the six KPI values, the worst miss, the change made.

## Loop 1 · 11:14 PT
- Unsafe 0 · completeness **80%** (miss) · clicks 0 · duplicate holds 0 · budget kept ($29.48/$35) · traced 100%. 10/10 scenarios.
- Worst miss: completeness measured on the unrepaired basket in `suggest_only`. Change: measure the repaired basket the parent is asked to approve.

## Loop 2 · 11:18 PT
- All six green: unsafe 0 · completeness 100% · clicks 0 · duplicate holds 0 · budget kept · traced 100%. 10/10 scenarios.
- Change: harness now uses the merged vector ranker and preference query (rice bowl 0.945 vs quesadilla 0.499).
- Live run (real Cognee, Anthropic, Statsig default): stockout event -> refusal cites fact-allergy-peanut r3 -> proposal -> KPIs. Peanut-noodle refusal reason cleaned up (recipe allergen only).
