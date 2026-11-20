# LunchShift status

**Updated 11:43 PT. Milestone:** slice 1 done. The live stack (`npm run stack`: grocer :4100, worker, UI :3000) has been driven end to end with real sponsors. Next: the live Statsig flip rehearsal, SingleStore once its host resolves, then polish and rehearsal.

**Latest KPIs (`npm run kpi`, loop 4, 13/13 scenarios):** unsafe in cart 0 · meal completeness 100% · clicks per auto order 0 · duplicate holds 0 · budget kept ($29.48 max / $35) · swaps traced 100%.

**Sponsors**

| Sponsor | State | Proof |
| --- | --- | --- |
| Cognee | **Live** | Fresh worker session recalls 5 facts. The refusal cites `fact-allergy-peanut r3`. |
| Statsig | **Live** (11:41) | `autonomy_mode` reads `suggest_only` from Statsig (rule `default`). The UI's Autonomy panel shows "Statsig live", source Statsig · rule `default`. Every audit step is logged as `agent_step`, plus `weekly_run_metrics` and the decision events. The log_event API accepted them (the run's audit records "weekly_run_metrics sent"). Arrival in the console is not yet checked: look under Metrics → Events for `weekly_run_metrics`. |
| Superlinked SIE | **Live** (11:41) | Task model as a tool: the DeBERTa-v3 zero-shot allergen classifier flags Value Wheat at 0.97 and the Thai sauce at 0.95 (it can only add refusals). The Qwen3-Reranker-0.6B reranks the safe lunches (rice bowl 0.989 vs 0.001). |
| SingleStore | **Blocked** | Error class: DNS (ENOTFOUND). The host in the env doesn't resolve on public resolvers. The code accepts `singlestore://` or `mysql://`, and creates the `lunchshift` database when the URL has no db name. SQLite stands in, labelled as such. |
| Anthropic | **Live** | Claude explains the swap, choosing among eligible lunches only. |

**Blockers (Abhay):**
1. SingleStore: copy the host from the portal's Connect panel exactly. The current one fails DNS, so the workspace may be deleted or paused.
2. Statsig: for the demo, add a rule for userID `lunchshift-demo` set to `{"mode":"auto_swap"}`. On stage, flip it to `{"mode":"auto_swap_and_hold"}`.

**Composio spend this session:** $0.00. SIE credits used: about 10 calls (1 credit each, from the response usage field).
