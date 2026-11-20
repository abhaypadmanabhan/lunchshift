# LunchShift status

**Updated 12:01 PT. Milestone:** all sponsors live (SingleStore since 11:58). Proven: the live Statsig flip, the unattended full-auto run, a dropped reply recovered with no duplicate. Next: polish and rehearsal (demo milestone 3:30).

**Latest KPIs (`npm run kpi`, loop 6, 19/19 scenarios; cross-model review findings fixed):** unsafe in cart 0 · meal completeness 100% · clicks per auto order 0 · duplicate holds 0 · budget kept ($29.48 max / $35) · swaps traced 100%.

**Sponsors**

| Sponsor | State | Proof |
| --- | --- | --- |
| Cognee | **Live** | Fresh worker session recalls 5 facts. The refusal cites `fact-allergy-peanut r3`. |
| Statsig | **Live** (11:41) | `autonomy_mode` reads `suggest_only` from Statsig (rule `default`). The UI's Autonomy panel shows "Statsig live", source Statsig · rule `default`. Every audit step is logged as `agent_step`, plus `weekly_run_metrics` and the decision events. The log_event API accepted them (the run's audit records "weekly_run_metrics sent"). Arrival in the console is not yet checked: look under Metrics → Events for `weekly_run_metrics`. |
| Superlinked SIE | **Live** (11:41) | Task model as a tool: the DeBERTa-v3 zero-shot allergen classifier flags Value Wheat at 0.97 and the Thai sauce at 0.95 (it can only add refusals). The Qwen3-Reranker-0.6B reranks the safe lunches (rice bowl 0.989 vs 0.001). |
| SingleStore | **Live** (11:58) | Helios, TLS verified by the system trust store, database `lunchshift` created on first connect. System of record for the household, recipes, label snapshots, runs, the append-only audit (gap-free seq under concurrent appends), baskets, receipts and KPIs. Ranking stage 1 is vector SQL (`vec <*> query` over `VECTOR(n,F32)`): rice bowl 0.945, quesadilla 0.499; SIE then reranks. `npm run audit` replays a run from SingleStore. |
| Anthropic | **Live** | Claude explains the swap, choosing among eligible lunches only. |

**Blockers:** none. Demo note: a Statsig console change takes about 20-40 s to reach the API, so flip `auto_swap` -> `auto_swap_and_hold` early in the segment.

**Composio spend this session:** $0.00. SIE credits used: about 10 calls (1 credit each, from the response usage field).
