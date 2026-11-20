# LunchShift demo security review

Reviewed the public demo and its Next.js code on November 20, 2026. Public results describe the deployed build. The fixes below were verified in the review worktree.

## Findings fixed

| Severity | Finding | Fix |
| --- | --- | --- |
| Medium | Checkout success and cancellation used request-supplied forwarded headers. A checkout could send a parent to a different origin. | Use `PUBLIC_URL` or Railway’s configured public domain. Only loopback requests can supply a fallback origin. |
| Medium | Chat, confirmation, household, cart and routine routes accepted unbounded or ill-typed JSON. Invalid settings could break normal reads, and mismatched allergy IDs and text could alter the wrong restriction. | Limit actual request bytes, validate exact fields and values, cap confirmation and household lists, and recover from malformed saved routine settings. |
| Medium | Stripe and household memory writes could bypass the paid request budget. A full visitor counter table also discarded existing limits. | Count payment start and confirmation and household edits toward the paid limits. Expire old counters and retain existing limits when the table fills. |
| Medium | A planner could discard an out-of-list recipe and still show the model’s explanation for it. | Discard that explanation too and use the highest-ranked eligible recipe with the template explanation. |
| Medium | Raw provider error details could reach audit responses or worker logs. | Publish limited status descriptions for provider failures. Stripe confirmation also checks the retrieved session against the order, hold, household, amount and currency. |
| Medium | After a new family’s first allergy edit, the deployed worker superseded its plan and reused that run ID. The replacement could never start. | Reserve a distinct revision for the new plan while preserving existing run IDs. The prior hold is released and the revised plan asks for approval. |
| Low | Browsers received few baseline security headers. | Suppress `X-Powered-By` and add `nosniff`, a referrer policy, framing denial and a production content policy that permits Open Food Facts images. |

## Accepted demo design and remaining lows

- This is a single-tenant public demo with one global active family and week. Household records are grouped for the story. Anyone on the demo can switch families, write facts, start a run, or reset the fixture. Use synthetic family details only. Visitor rate limits and the site-wide paid daily cap are the intended controls.
- Quotas live in process memory and restart with the service. Per-visitor limits depend on Railway's forwarding headers. This review did not verify header sanitization at Railway's edge. Keep the demo to one service instance.
- The content policy permits inline scripts and styles required by the current Next.js build. A nonce-based policy would provide more protection against injected script.
- A local state poll returned one HTTP 500 during the replan. The next read showed the revised proposal and its milk refusals. The transient error's cause was unverified.
- Local process logs and live API responses were checked for credential signatures. Railway's platform logs were unavailable from the review worktree.

## Verification

- `npm run build` and `npx tsc --noEmit -p .` passed. ESLint passed on the changed TypeScript files. `secscan` verdict PASS.
- The client bundles contained vendor display names and no credential signatures or server credential variable names. Local build and runtime logs and the public `/api/state` responses sampled during the walkthrough contained no credential signatures.
- `npm run kpi` passed 27/27. The first-edit scenario went red on the prior code. `npm run test:allergens` returned `ALL PASS`. Removing each of the three specific guards independently caused its label, chat confirmation or explainer test to fail.
- The built app rejected invalid inputs and an oversized streamed body, preserved stored allergies after invalid requests, and accepted a valid chat proposal, confirmation and routine edit. Chrome loaded both the demo's state and a catalog photo with the content policy enabled. The Stripe fixture verified the configured return origin, the same checkout key across retries, the held order amount, and server-side payment confirmation.

## Public walkthrough

- A fresh Noah and Ivy household received seven onboarding facts from Anthropic. Week 1 proposed a swap and recorded five refusals, four allergy warnings and one missing label. The parent added one pack, approved the proposal and verified hold `H-03561911`. Order `LS-8B33EF` totalled $38.32. Two payment calls returned the same test checkout URL. No card was entered.
- The second week swapped Monday to a rice-and-bean bowl and verified a hold with zero parent clicks. The agent placed order `LS-52D342`. SingleStore, Statsig, Superlinked SIE, Anthropic and the sandbox grocer were live throughout. Cognee showed a fallback while the first run started and was live by week 2.
- The mid-week milk allergy was saved, but the deployed app left the run superseded on repeat. The revision fix passed locally and requires deployment. The public reset succeeded and restored the default family, week 0 and an empty active run.
- Firedrill: needs key or CLI (skipped).
