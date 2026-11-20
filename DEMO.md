# LunchShift demo runbook (3 minutes)

Screen: http://localhost:3000/?onboarding=0 at 1440x900 (parent app on the left, "LunchShift at work" on the right). Second tab: the Statsig console. Third tab: http://localhost:3000/console. `npm run build && npm run stack` must be running.

## Pre-roll (about 1 minute, before recording)

1. Statsig: `autonomy_mode` = `{"mode":"auto_swap"}`.
2. Console tab, Demo operator: **Reset demo**, then **Inject bread stockout**. Wait about 12 s for "Lunches fixed · waiting to hold pickup".
3. Demo operator: **Drop next store response** (the store will commit the hold, then lose its reply).
4. Back to the app tab, scroll to the top, start recording.

## Script

| Time | Screen | Say |
| --- | --- | --- |
| 0:00-0:30 | This week: **Kept Maya safe** | "Maya is 8 and allergic to peanuts. On Sunday her usual bread sold out, and the cheapest replacement's exact label says *may contain peanuts*. LunchShift refused it. It never reached the cart. The allergy is the one her parent confirmed, recalled from **Cognee** memory, and a small **Superlinked SIE** classifier read the same label and agreed, 0.96. On the right, the agent is working on its own." |
| 0:30-1:05 | Lunch list, then **Why?**, then the **Cart** tab | "It didn't just swap bread. With no safe bread there's no sandwich, so it replaced the whole Monday lunch and kept the other four. **SingleStore** shortlisted safe lunches with vector search, SIE reranked them, and **Claude** explains the pick. Code enforces every rule. In the cart, $26.97 of a $35 budget. If I try to add that bread myself..." *(Add item: Value Wheat is greyed out)* "...it's blocked, with the reason." *(Add a second pack of apples.)* |
| 1:05-1:35 | Statsig console, then **Family** | "How far it may act on its own is a live **Statsig** setting, capped by what the parent approved once. Right now it fixes lunches but may not hold. I'll allow holds." *(Flip to `auto_swap_and_hold`; it takes 20-40 s, so keep talking.)* "Family is where the parent sets the rules: any allergy in plain words, the budget, and one line that matters: LunchShift can hold, never pay." |
| 1:35-2:15 | The right panel, then **This week** and **Orders** | "There it is: Statsig changed the mode, the agent rechecked it right before the only write, and asked the store to hold the cart, including my extra apples. The store's reply was lost, so it read the hold back by key instead of retrying blindly: one hold, verified. Then it placed the order, pay at pickup." *(Open the order: number, Sunday 4-6, timeline.)* |
| 2:15-2:40 | Family: add **sesame** *(optional if time)* | "Rules change? Add sesame. LunchShift re-plans the week, refuses the hummus, and waits for my approval, because the rules changed since I last said yes." |
| 2:40-3:00 | `/console` | "Under the hood: every decision is in an append-only audit in SingleStore. Six outcomes are measured on every run: zero unsafe items, every lunch complete, zero clicks in auto mode, zero duplicate holds, on budget, every swap traced. `npm run kpi` runs 21 scenarios, and the allergy suite covers all nine major allergens plus anything typed in." |

## If something goes wrong

- The flip hasn't shown after 45 s: Statsig is still propagating. Keep talking over the Family tab; the panel line "Autonomy changed to auto_swap_and_hold" lands when it arrives.
- A sponsor shows "fallback" on the console: the run still completes on the labelled stand-in. Say so.
- Start over: Statsig back to `auto_swap`, then repeat the pre-roll.

## Backup proof

- `docs/proof/fullauto-run.txt` and `docs/proof/fullauto-screen.png`: the unattended Sunday run (zero inputs, verified hold in 8 s).
- `npm run kpi` (21 scenarios, about 4 s) and `npm run test:allergens` (all nine allergens, custom ones, 32 label edge cases).
- `npm run audit`: replays the run's full decision from SingleStore.
