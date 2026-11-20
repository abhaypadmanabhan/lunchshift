# LunchShift status

**Updated 12:48 PT. Milestone:** parent product integrated and live: parent app (This week, Cart, Orders, Family, onboarding) on the real engine, `/console` for operators. Fixed live: an approval-gate leak across ticks (red-first scenario) and an SIE classifier false positive. Running: design pass (Opus, until 2:15) and the real Open Food Facts catalog (Codex). Then DEMO.md, 2 rehearsals, backup recording, README, scan (3:00-3:45).

**Latest checks**
- `npm run kpi`: **21/21 scenarios**. Unsafe in cart 0 · meal completeness 100% · clicks per auto order 0 · duplicate holds 0 · budget kept · swaps traced 100%. New: two-allergy child (peanut + sesame); full-auto pay-at-pickup order with a dropped reply (exactly 1 order); payment still 403.
- `npm run test:allergens`: **ALL PASS**: 34 parent inputs, 20 labels vs hand oracle, 32 label edge cases, 5 OFF-vs-text conflict checks, 18 allergy sets end to end.
- Live (12:31): add sesame -> revision 4 -> plan waits for approval -> peanut bread and hummus refused in the cart with reasons -> approve -> hold for the edited cart ($30.67) -> order LS-87CA6A, pay at pickup, idempotent on repeat.

**Sponsors**

| Sponsor | State | Proof |
| --- | --- | --- |
| Cognee | **Live** | Fresh worker session recalls 5 facts. The refusal cites `fact-allergy-peanut r3`. |
| Statsig | **Live** (11:41) | `autonomy_mode` reads `suggest_only` from Statsig (rule `default`). The UI's Autonomy panel shows "Statsig live", source Statsig · rule `default`. Every audit step is logged as `agent_step`, plus `weekly_run_metrics` and the decision events. The log_event API accepted them (the run's audit records "weekly_run_metrics sent"). Arrival in the console is not yet checked: look under Metrics → Events for `weekly_run_metrics`. |
| Superlinked SIE | **Live** (11:41) | Task model as a tool: the DeBERTa-v3 zero-shot allergen classifier flags Value Wheat at 0.97 and the Thai sauce at 0.95 (it can only add refusals). The Qwen3-Reranker-0.6B reranks the safe lunches (rice bowl 0.989 vs 0.001). |
| SingleStore | **Live** (11:58) | Helios, TLS verified by the system trust store, database `lunchshift` created on first connect. System of record for the household, recipes, label snapshots, runs, the append-only audit (gap-free seq under concurrent appends), baskets, receipts and KPIs. Ranking stage 1 is vector SQL (`vec <*> query` over `VECTOR(n,F32)`): rice bowl 0.945, quesadilla 0.499; SIE then reranks. `npm run audit` replays a run from SingleStore. |
| Anthropic | **Live** | Claude explains the swap, choosing among eligible lunches only. |

**Blockers:** none. Demo note: a Statsig console change takes about 20-40 s to reach the API, so flip `auto_swap` -> `auto_swap_and_hold` early in the segment.

**Composio spend (running total, 12:36):** $0.00. Parent-app lane 1: $0 (skipped illustrations). Cart/orders UI lane: $0 (no art). Design-pass lane: allowed up to 8 Higgsfield stills at <=$0.01 each, total under $0.25 (will report exact spend). Catalog lane: Open Food Facts directly, no Composio. Cap: assets at or under $1.00 combined, session total strictly under $2 including the ~3:30 ElevenLabs voiceover; check the price before every call, skip unknown prices. SIE credits: about 25 calls (1 credit each).
