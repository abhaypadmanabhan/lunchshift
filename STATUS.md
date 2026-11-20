# LunchShift status

**Updated 13:41 PT.** **HARD FEATURE CUT: 2:45 PT.** After it: no new slices. Only fixes on the story path (landing -> chat onboarding -> live shopping -> review/order -> next Sunday zero-click), one rehearsal, and a re-recorded backup video. Anything unfinished stays behind its demo-safe tag. Statsig ceiling: waiting on Abhay's one-time console change (default `{"mode":"auto_swap_and_hold"}`); until then the app shows the honest label "Statsig allows up to Swap for me". a real end-to-end product for ANY family. Plan: docs/PRODUCT_FLOW.md. Summary:
- Lifecycle: landing -> chat onboarding (Claude extracts kids, allergies with cross-contact tolerance, dislikes, budget, store, pickup; parent confirms chips; saved per household to the record + Cognee) -> autonomy setting (sent to Statsig as custom.autonomy_pref; Statsig = ceiling) -> plan this week (live shopping over real OFF products, safety gate, SingleStore shortlist, SIE rerank, Claude explains) -> cart -> approve or auto hold -> pay-at-pickup order.
- Day to day: the agent chat is the main interface (allergy diagnosed, no school Friday, sick of sandwiches, add milk and eggs); Settings for direct edits with fact history; Routines (weekly plan time, stock/label watch, school skips, budget alert) run by the worker with next/last run; Inbox of what the agent did and what needs the parent.
- In by 3:30: chat agent with tools, several kids (union safety gate), no seed data needed, simple routines, the autonomy control (done). Partial: inbox. Out: live OFF search at runtime (local OFF snapshot instead), real auth, reorder.

**Progress since the 13:22 direction (slices committed, tags demo-safe-5..9):**
- Chat agent: Claude extracts kids, allergies (with cross-contact), dislikes, budget, pickup, store, skip days, plan changes and extras; code validates; the parent confirms chips; saved per family to the record and Cognee. Several kids per family (shared menu, every product safe for every kid). The in-app autonomy setting is sent to Statsig as custom.autonomy_pref (Statsig = ceiling). Live shopping: compares options per item, skips unsafe ones with reasons, the cart fills step by step. Routines (weekly plan, stock watch, school calendar, budget alert) with last/next run and run-now; inbox; fact history. Allergy-driven swaps are remembered as the family's plan.
- **Live proof (13:35), brand-new family, no seed data:** chat "Noah is 7, tree nuts and eggs, no may-contain; Ivy is 5, sesame; no mushrooms; $50; Sunday" -> 9 chips -> saved (Cognee) -> Plan this week: 5 unsafe products refused, Thursday hummus swapped for veggie pasta, $32.16 of $50 -> approve -> held -> order LS-2D621E (pay at pickup) -> next Sunday: bread stockout detected by the stock-watch routine.
- UI lanes merged: landing, chat onboarding, family switcher, live cart, /demo stepper. Running: Routines / Inbox / fact history screens (due 2:35).

**Latest checks**
- `npm run kpi`: **25/25 scenarios** (new: family built from scratch through chat with 2 kids; mid-week allergy change through chat; routines; two weeks for a chat-built family with zero clicks in week 2). Earlier: Unsafe in cart 0 · meal completeness 100% · clicks per auto order 0 · duplicate holds 0 · budget kept · swaps traced 100%. New: two-allergy child (peanut + sesame); full-auto pay-at-pickup order with a dropped reply (exactly 1 order); payment still 403.
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

**Composio spend (running total, 12:36):** $0.00. Parent-app lane 1: $0 (skipped illustrations). Cart/orders UI lane: $0 (no art). Design-pass lane: $0.00 (the Higgsfield price check was not allowed, so no images were generated, per the rule). Catalog lane: Open Food Facts directly, no Composio. Cap: assets at or under $1.00 combined, session total strictly under $2 including the ~3:30 ElevenLabs voiceover; check the price before every call, skip unknown prices. SIE credits: about 25 calls (1 credit each).
