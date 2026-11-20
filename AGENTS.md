# LunchShift agent rules

- Contracts live in `src/lib/domain/types.ts` and `src/lib/domain/view.ts`. Change them only via the orchestrator.
- Never read, print or log the dotenv file or any secret value. Adapters read `process.env` server-side only.
  Scripts load it with `node --env-file=.env` (tsx supports the same flag).
- Deterministic code enforces allergen, budget, stock and mandate rules. The LLM only explains/chooses among eligible options.
- Every vendor adapter has a labelled fallback and never throws into the worker: it returns a typed result with `error`.
- Fonts: Switzer (body/UI), DM Mono (audit trail, IDs, logs). Follow the vault UI-UX notes.
- Lane ownership: core worker/grocer/kpi `src/lib/domain`, `src/grocer`, `src/worker`, `scripts/kpi.ts` (orchestrator);
  store + ranking `src/lib/store`, `src/lib/ranking`; vendors `src/lib/memory`, `src/lib/autonomy`, `src/lib/llm`;
  UI `src/app`, `src/components`.
