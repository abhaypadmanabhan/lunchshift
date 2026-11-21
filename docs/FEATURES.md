# LunchShift features

| Feature | Entry point | Expected result | Code | Check |
| --- | --- | --- | --- | --- |
| Family setup and changes | `/demo`, `/api/chat`, `/api/chat/confirm`, `/api/parent/household` | Chat proposes facts and confirmation saves them. Invalid input leaves the household unchanged. | `src/app/api`, `src/lib/llm/chat.ts`, `src/worker/parent.ts` | `npm run test:allergens` |
| Plan, edit, hold, order | `/demo`, `/api/parent/plan`, `/api/parent/cart`, `/api/parent/approve`, `/api/parent/order` | Eligible lunches fill the cart within budget. The sandbox merchant verifies the hold and order. | `src/worker/runWeekly.ts`, `src/lib/domain/rules.ts`, `src/app/api/parent` | `npm run kpi` |
| Routines and next week | `/api/routines`, `/api/routines/run`, `/api/demo/next-week` | Settings persist, and next week can swap and hold without clicks when allowed. | `src/worker/routines.ts`, `src/worker/parent.ts`, `src/app/api` | `npm run kpi` |
| Test Checkout | `/api/parent/pay`, `/api/parent/pay/confirm` | The same held order opens one test Checkout Session. Stripe verifies payment on return. | `src/lib/payments/stripe.ts`, `src/worker/parent.ts` | `npm run kpi` |
| Public demo and reset | `/demo`, `/console`, `/api/state`, `/api/demo/reset` | Read the shared demo state and reset it to the presets from the console. | `src/app`, `src/worker/operator.ts`, `src/middleware.ts` | `npm run build` then `npm run stack` |
| Family switcher, Cognee status, payment copy | `/demo` sidebar, `/console` integrations row, order and cart cards | One entry per child name; a new family shows "Building this family's memory" while Cognee builds; a test-card payment reads "Paid by card (test)". | `src/lib/domain/families.ts`, `src/lib/memory/cognee.ts`, `src/lib/view/buildView.ts`, `src/components/parent/copy.ts` | `npm run test:view` |
