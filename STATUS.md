# LunchShift status

**Updated 11:20 PT. Milestone:** thin end-to-end slice works headless: sandbox grocer + background worker + audit trail + KPI harness. UI lane is building the screen (merge next).

**Latest KPIs (`npm run kpi`, loop 2, 10/10 scenarios):** unsafe in cart 0 · meal completeness 100% · clicks per auto order 0 · duplicate holds 0 · budget kept ($29.48 max / $35) · swaps traced 100%.

**Live sponsors:** Cognee recall live (cites fact-allergy-peanut r3). Anthropic explainer live. Statsig reads live but return the default (config missing). SingleStore down (see blockers); SQLite fallback in use. SIE key missing; local vector ranking fallback.

**Blockers (Abhay):**
1. SingleStore: the host in the env does not resolve on public DNS, and `SINGLESTORE_DATABASE` holds a full URL, not a database name. Fix both in the portal's Connect panel.
2. Statsig: create Dynamic Config `autonomy_mode` (default `{"mode":"suggest_only"}`, rule userID `lunchshift-demo` -> `{"mode":"auto_swap"}`).

**Composio spend this session:** $0.00.
