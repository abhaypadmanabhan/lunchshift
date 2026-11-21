# LunchShift demo runbook (3 minutes)

Screen: https://lunchshift-web-production.up.railway.app/demo in a desktop browser at 1440x900. The web app has a sidebar (This week, Cart, Orders, Routines, Inbox, Memory, Family), the main view, and the "LunchShift at work" rail on the right. The bar at the top is the demo stepper: **Next step** (or the right arrow key) runs what the parent's own button would. Second tab: `/console`.

Backup if anything breaks live: `docs/proof/backup-story.mp4` (the same eight steps, recorded against the public URL, no audio).

## Pre-roll (30 seconds, before recording)

1. `/console`, Demo operator: **Reset demo**. This clears the store and hides families made in earlier runs.
2. Open `/demo`. It starts on the landing page. Start recording.

## Script

| Step | Screen | Say |
| --- | --- | --- |
| 1 Landing | "Your kid's school lunches, planned and safe" | "Packing lunch for a kid with a food allergy means reading every label, every week. LunchShift is an agent that does the shopping and never lets an unsafe product into the cart." |
| 2 Chat setup | The chat; the message types itself | "A parent describes their family in plain words. **Claude** picks out the facts: Maya is 8, peanut allergy, avoid may-contain, hates mushrooms, $35 a week, Sunday pickup. They come back as chips for the parent to confirm. Nothing is saved yet." |
| 3 Save to memory | Chips turn to "Saved to memory" | "Confirmed facts go to the household record, which is the authority, and to **Cognee** memory, so the agent recalls them in every later session." |
| 4 Plan this week | Cart fills item by item; the rail streams steps | "Now it shops real Open Food Facts products. For each item it compares options and refuses unsafe ones with the reason: this bread says *may contain peanuts*, so it never reaches the cart. A **Superlinked SIE** classifier reads the same labels and can only add refusals. Code enforces every rule; the model never decides what is safe." |
| 5 Review and hold | Cart, budget meter | "Under budget. The parent approves once, and LunchShift asks the store to hold the cart for Sunday pickup. One hold, read back by key so a lost reply never makes two. It can hold. It can never pay." |
| 6 Order placed | Order with number, pickup window and timeline | "The order is placed. The parent pays, never the agent." |
| 7 Next Sunday | Autonomy set to Swap and hold; the clock jumps a week | "The parent now trusts it to act alone. How far it may go is capped live by **Statsig**. A week later, Maya's usual bread is sold out." |
| 8 Payoff | This week: Monday swapped, pickup held, zero clicks | "No safe bread means no sandwich, so it swapped the whole Monday lunch. **SingleStore** shortlisted safe lunches with vector search, SIE reranked them, Claude explained the pick, and it held the pickup on its own. Zero clicks." |
| Close | `/console` (Open console) | "Every decision is in an append-only audit in SingleStore. Six outcomes are measured on every run: zero unsafe items, every lunch complete, zero clicks in auto mode, zero duplicate holds, on budget, every swap traced. `npm run kpi` runs 25 scenarios; the allergy suite covers all nine major allergens plus anything a parent types." |

## If something goes wrong

- A step is slow: the rail shows the agent working; keep talking. Live shopping takes about 20 seconds.
- A sponsor shows "fallback" on `/console`: the run still completes on a labelled stand-in. Say so. Cognee shows fallback on a brand-new family's first plan while it builds the memory graph (about 30 seconds).
- Start over: **Reset demo** on `/console`, reload `/demo`.
- The site is down: play `docs/proof/backup-story.mp4`.

## Proof to point at

- `npm run kpi`: 25 scenarios, about 4 seconds. `npm run test:allergens`: all nine allergens, custom ones, 32 label edge cases.
- `npm run audit`: replays a run's full decision from SingleStore.
- `docs/proof/backup-story.mp4`: the eight steps above, unattended.
