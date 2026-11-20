# LunchShift

**A parent sets the rules once. When a grocery item sells out, LunchShift rebuilds the affected school lunch and confirms one complete pickup hold, with no clicks.**

Built for the tokens& Personal Agents Hackathon (Nov 20, 2026). The merchant, products and labels are simulated. This is a demonstration of evidence handling, never real-world allergy assurance.

## What it does

Maya (8) has a peanut allergy. Her parent packs five school lunches, shops on Sundays and keeps a $35 all-in budget. The parent approves a standing mandate once: one store, Sunday 4-6 p.m., at most one meal swap and one no-fee hold per week, with expiry and revocation.

Every Sunday a background worker (running with the browser closed) builds the week's basket. When the usual bread sells out:

1. **Refusal.** The cheapest substitute bread carries a peanut cross-contact warning on its exact-SKU label. The worker recalls the parent's confirmed allergy fact from **Cognee** and refuses it, citing the fact, its revision and the label version. A bread with no allergen statement is blocked too: missing evidence is never treated as safe.
2. **Whole-lunch swap.** With no safe bread, the sandwich lunch can't be made, so the worker swaps the whole lunch, not just one ingredient. Safe complete alternatives are ranked against the household's preferences (vector ranking), Claude explains the choice, and code rechecks every rule. Monday becomes a rice-and-bean bowl: bread and the sandwich-only spread are removed, the shared apples are kept, and the other four lunches stay intact.
3. **Human sign-off as a live flag.** **Statsig** dynamic config `autonomy_mode` (`suggest_only` / `auto_swap` / `auto_swap_and_hold`) sets how far the agent may go. The effective mode is the lower of Statsig and the parent's approved maximum. Missing, invalid or timed-out config falls back to `suggest_only`.
4. **One hold, verified.** The agent's credential can read the catalog and place or read holds. It has no payment scope (the store returns 403). The hold uses a stable operation key persisted before dispatch. When the store commits but drops its response, the worker reads the hold back by key and confirms lines, total, slot and expiry. Replays, duplicate events and restarts never create a second hold.
5. **Audit and analytics.** Every decision is an append-only audit event (run, sequence, actor, SKU and recipe IDs, fact and label revisions, ranker scores, mode, operation key, merchant read-back), replayable by run ID. KPI events go to Statsig.

## The six KPIs (`npm run kpi`)

| KPI | Target |
| --- | --- |
| Unsafe items reaching the cart | 0 |
| Meal completeness after stockout | 100% |
| Human clicks per weekly order in auto mode | 0 |
| Duplicate holds under a dropped response | 0 |
| Budget kept | 100% |
| Swaps traced to evidence | 100% |

`npm run kpi` runs a fixed scenario suite against the real sandbox store over HTTP and the real worker code: no stockout; stockout full-auto; commit-then-drop with replay and restart; read-back failure with an identical retry; `suggest_only`; parent sign-off; live `auto_swap` to `auto_swap_and_hold` flip; invalid and timed-out config; revoked mandate; late stockout (atomic reject, zero holds); scoped credential and key-reuse refusal. It exits non-zero on any miss. `LOOP-LOG.md` records each improve-and-measure loop.

## Tools and sponsors

| Tool | Role |
| --- | --- |
| **Cognee Cloud** | Household and allergy memory, recalled in each fresh worker session (graph completion + chunk search). Every fact carries a stable marker and revision (`[fact-allergy-peanut r3]`), so a refusal cites the exact fact. Recalled IDs are resolved against the authoritative household record. Hard restrictions always load from that record, even if retrieval misses one. |
| **SingleStore** | System of record: household, recipe vectors, label snapshots, runs, the append-only audit trail, baskets, receipts and KPIs. Ranks alternatives with `VECTOR(n,F32)` dot product (`<*>`) SQL. Falls back to SQLite (labelled) when unreachable. |
| **Statsig** | `autonomy_mode` dynamic config read at run start, on every waiting-run tick and right before the hold. Backend events: `candidate_rejected`, `autonomy_changed`, `meal_swapped`, `hold_verified`, `weekly_run_metrics` (synthetic IDs and numbers only). |
| **Superlinked SIE** | Reranker behind the `Ranker` interface (`Qwen3-Reranker-0.6B`). The key was unavailable during the event, so ranking ran on the labelled vector fallback. |
| **Anthropic Claude** | Explains, and may choose, among the eligible alternatives only (`LLM_PROVIDER`, `LLM_MODEL`). It never sees or decides allergen, budget or stock rules. |

## Run it

```bash
npm install
cp <your env> .env          # COGNEE_*, SINGLESTORE_*, STATSIG_SERVER_SECRET, ANTHROPIC_API_KEY (all optional: each has a labelled fallback)
npm run kpi                 # offline scenario suite + six KPIs
npm run grocer              # sandbox store on :4100 (own SQLite DB)
npm run worker              # background agent; WORKER_SCHEDULE_AT=now makes the Sunday run due at start
npm run dev                 # UI on :3000
npm run demo -- stockout    # operator fixture action: sell out the usual bread (also: reset, drop, run)
npm run audit               # replay the run's full decision from the store
```

## Layout

- `src/lib/domain`: contracts, fixture, deterministic rules (the only code that decides eligibility)
- `src/worker`: the resumable weekly run state machine, background loop, operator actions
- `src/grocer`: sandbox merchant (HTTP + SQLite, fault injection, scoped tokens)
- `src/lib/{memory,autonomy,llm,ranking,store}`: sponsor adapters, each with a fallback
- `src/app`: the one-screen demo UI
