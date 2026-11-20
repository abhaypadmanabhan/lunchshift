# LunchShift demo runbook (3 minutes)

Open http://localhost:3000 at 1440x900 with the Statsig console in a second tab. `npm run build && npm run stack` must already be running.

## Pre-roll (before recording, about 1 minute)

1. Statsig console: `autonomy_mode` = `{"mode":"auto_swap"}`. The Autonomy panel should read "Statsig says auto_swap".
2. Demo operator: **Reset demo**, then **Inject bread stockout**. Wait about 12 s for "Cart repaired, no hold yet".
3. Demo operator: **Drop next store response** (the store will commit the next hold and lose its reply).
4. Scroll to the top. Start recording.

## Script

| Time | Show | Say |
| --- | --- | --- |
| 0:00-0:30 | The refusal card | "Maya has a peanut allergy. On Sunday her usual bread sold out. The cheapest substitute's exact label says *may contain peanuts*. LunchShift refused it, citing the allergy fact her parent confirmed. That fact is recalled from **Cognee** in a fresh session. A small **Superlinked SIE** classifier reads the same label and agrees, 0.97. It can only add refusals, never remove one. The bread never entered the cart. The sourdough was refused too: no allergen statement on file is not safe." |
| 0:30-1:05 | This week's lunches | "With no safe bread, a sandwich lunch can't be made, so it swaps the whole lunch, not one ingredient. Bread and the sandwich-only spread are removed, beans, corn and rice are added, and the shared apples are kept. The other four lunches are untouched. **SingleStore** shortlists the safe alternatives with vector SQL, an SIE reranker orders them, and Claude explains the pick. Code enforces the allergen, budget and stock rules. $26.97 of the $35 budget." |
| 1:05-1:35 | Autonomy panel, then the Statsig console | "How far the agent may go is a live **Statsig** config, capped by what the parent approved once: one store, Sunday 4-6, one swap, one hold. Its credential can hold but never pay; the store returns 403 on payment. Right now it's `auto_swap`: the cart is repaired, nothing is held. I'll raise it to `auto_swap_and_hold`." *(Flip it in the console now. It takes 20-40 s to propagate; keep talking.)* |
| 1:35-2:20 | Store pickup hold panel and the audit trail | "The worker sees the change on its next check, and re-reads the config right before the only write. The store committed the hold, then the reply was lost: *Checking with the store*. The worker reads the hold back by its original key: one active hold, the exact lines, total and pickup slot. Verified." *(Press **Inject bread stockout** again to replay the event.)* "Replaying the event changes nothing: still one hold." |
| 2:20-3:00 | KPI strip and audit trail | "Six measured outcomes: zero unsafe items, every lunch complete, zero shopper clicks, zero duplicate holds, under budget, every swap traced to evidence. `npm run kpi` runs 19 scenarios on each change: dropped replies, restarts, invalid config, revocation, late stockouts. Every decision is in the SingleStore audit and sent to Statsig as a trace. A separate unattended Sunday run, with no human input at all, is in the repo." |

## If something goes wrong

- The flip doesn't show within 45 s: Statsig is still propagating. Keep talking about the standing approval. The audit row "autonomy_changed" lands when it arrives.
- A sponsor chip says "fallback": the run still completes on the labelled stand-in. Say so.
- Start over: Statsig back to `auto_swap`, then repeat the pre-roll.

## Backup proof

- `docs/proof/fullauto-run.txt` and `docs/proof/fullauto-screen.png`: the unattended scheduled run (zero inputs, verified hold in 8 s).
- `npm run kpi`: the six KPIs and all scenarios in about 4 s.
- `npm run audit`: replays the run's full decision from SingleStore.
