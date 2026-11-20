# LunchShift product flow

A grocery agent for families with food-allergic kids. The parent talks to it; it plans school lunches, shops real products, refuses anything unsafe, and holds a pay-at-pickup order. It never pays.

## What we learned (research, 2026-11-20)

- **Labels are the safety boundary.** FARE asks families to read every label three times, to avoid foods with no label, and recommends avoiding precautionary labels ("may contain", "made on shared equipment") for the child's allergens. Those statements are voluntary and unregulated, and their wording doesn't track real risk. Sources: [FARE label guide](https://www.foodallergy.org/sites/default/files/2024-05/FARE%20Understanding%20Food%20Labels.pdf), [FARE field guide](https://www.foodallergy.org/sites/default/files/2023-09/FARE_FieldGuide-2023-021323.pdf), [FARE on precautionary labeling](https://www.foodallergy.org/fare-blog/blog-post-may-contain-food-thought-about-precautionary-allergen-labeling).
  -> Product rule: an unlabeled product is never safe. "May contain" counts by default; the parent can turn it off per allergy with an explicit toggle. A label that changes (a recall, or a new warning) is re-checked every week. Sources that disagree block the product.
- **The nine US major allergens** (milk, egg, peanut, tree nuts, wheat, soy, fish, crustacean shellfish, sesame) must be labeled; others (mustard, kiwi) may hide behind "natural flavors". -> The canonical nine plus free-text custom allergens, matched on label and name, and shown as "lower confidence".
- **Meal planners** (Mealime, BitePal, Blue Apron, via Mobbin) organize around a week of meals that becomes one grocery list, with a per-day plan, prep time and swap options; ordering apps (Instacart, DoorDash) end in a cart, a review, an order and a status timeline. -> LunchShift = week plan -> cart -> hold/order -> timeline, with an agent doing the work in between.

## Lifecycle

### 1. First run
1. **Landing**: one line, "Your kid's school lunches, planned and safe", and "Set up my family".
2. **Account**: local email only (no real auth in the hackathon build).
3. **Chat onboarding**: the parent writes naturally ("Maya is 8, peanut allergy, avoid may-contain; Leo is 6, sesame and milk; both hate mushrooms; $45 a week; pickup Sunday at Hannaford"). Claude extracts structured facts: kids, each allergy with severity and cross-contact tolerance, dislikes, diet, budget, store, pickup day. They appear as chips to confirm or remove. Confirmed facts are saved to the household record (the authority) and to **Cognee** memory, per household and per child, with a visible "Saved to memory" step. A form is the fallback.
4. **How much can LunchShift do?**: Ask me / Swap for me / Swap and hold. Saved per family and sent to **Statsig** as `custom.autonomy_pref`. Statsig's `autonomy_mode` is the operator ceiling; the effective mode is the lower of the two.
5. **Plan this week**: the agent shops live (below), the cart fills, the parent reviews and approves (or auto mode holds it), and gets an order confirmation.

### 2. Day to day: the agent chat is the main interface
- "Leo got diagnosed with a sesame allergy" -> a new hard restriction for Leo (confirm chip) -> the policy revision bumps -> the week re-plans -> autonomy pauses until the parent approves the new plan.
- "No school Friday" -> that day is skipped this week -> the cart shrinks.
- "She's sick of sandwiches" -> a preference fact -> the ranking avoids that base.
- "Swap Wednesday to pasta" -> a plan change -> the safety gate -> the cart updates.
- "Add milk and eggs for us too" -> household extras -> checked against every kid's allergies (shared pantry).
- Every action shows in the **LunchShift at work** feed. Family / Settings allows direct edits, and every change is a dated, revisioned fact (history).

### 3. Routines (run by the worker; shown on a Routines screen with on/off, next run, last run, result)
- **Weekly plan**: day and time (default Sunday 16:00).
- **Stock and label watch**: a stockout or a label change on anything in the cart -> re-check -> swap the whole lunch.
- **School calendar skips**: listed no-school days are dropped from the plan.
- **Budget alert**: the repaired cart is within $X of the budget, or over it -> notify, never overspend.

### 4. Shopping
Week plan (lunches per kid) -> product search per meal need over the Open Food Facts catalog (real products, labels, photos) -> the **safety gate** (deterministic: label + OFF tags + parser, disagreement blocks, unlabeled blocks, the SIE classifier can only add refusals) -> **SingleStore** vector shortlist -> **SIE** rerank -> **Claude** explains -> cart (editable; unsafe adds refused with the reason; live budget meter) -> approval or autonomy -> hold (idempotent key, read-back) -> pay-at-pickup order -> confirmation and timeline -> order history and reorder.

### 5. Inbox
"While you were away": what the agent did (held, swapped, refused) and what needs the parent (approve a re-plan, a budget alert), newest first, each with a one-tap action.

## Build plan for today (freeze 3:30 PT), in order

| Slice | In by 3:30 | Notes |
| --- | --- | --- |
| A. Chat agent with tools (Claude): onboarding and day to day; facts -> confirm -> household + Cognee | Yes | Multi-kid extraction; allergy, preference, skip-day, plan-change and extras tools |
| B. Several kids per household: union safety gate (every product safe for every kid), lunches per kid | Yes | A shared pantry is the conservative MVP; per-kid basket splitting comes later |
| C. No seed data needed: new families work end to end; Maya, Leo and Ava stay only as optional sample families | Yes | Fixtures remain for tests |
| D. Routines: weekly plan time, stock watch, school skips, budget alert; worker-run, with next/last run | Yes (simple) | Recall/label-change watch = re-check on each run |
| E. In-app autonomy control via Statsig custom field | Yes (done) | |
| F. Inbox | Partial | The activity feed plus a "needs you" list |
| G. Live Open Food Facts search at runtime | No | Search runs over the local OFF snapshot (45 real products); live search later, rate-limited |
| H. Real accounts/auth, reorder, recall feeds | No | Local email only; reorder = re-plan from the last order (later) |

New scenarios: a family created from scratch through chat (2 kids, different allergies), a mid-week allergy change through chat, and routine runs.
