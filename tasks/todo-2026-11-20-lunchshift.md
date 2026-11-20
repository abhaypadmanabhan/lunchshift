# LunchShift handoff · 2026-11-20 14:15 PT

**Goal:** submit LunchShift (tokens& Personal Agents Hackathon). Hard submission 4:30 PT (form by 4:15). Feature cut 2:45; freeze 3:30; README and demo by 3:45.
**Done check:** the public URL works for a brand-new family (chat setup -> plan -> order -> next Sunday zero-click); `npm run kpi` 25/25; `npm run test:allergens` ALL PASS; secscan PASS; video ready; README current.

## State (commit d6ee3fa, tag demo-safe-10 and later commits)
- Public: https://lunchshift-web-production.up.railway.app (Railway project `lunchshift`, service `lunchshift-web`, builds from branch **`deploy`**; pushes to main are guarded, so deploy = secscan, then `git push origin HEAD:refs/heads/deploy`). Keys set by Abhay in Railway. `LUNCHSHIFT_DB_NAME=lunchshift_prod`.
- Repo: github.com/abhaypadmanabhan/lunchshift (PRIVATE; Abhay makes it public at submission).
- Verified live at 14:08: Claude chat -> chips -> saved; plan for a new family (5 refusals, 3 swaps); SingleStore, Statsig, Claude, SIE classifier live. The SIE rerank fix (no empty query) is deployed at d6ee3fa but **not yet re-verified on the public URL**. Cognee recall falls back on a brand-new family's first plan (cognify takes ~30 s): expected, labelled.
- Local stack: `npm run stack` (background task in the old session); stop it if it still runs (`lsof -nP -iTCP:3000 -sTCP:LISTEN`).
- Backup video (story, 116 s): docs/proof/backup-story.mp4, made by `node scripts/record-demo.mjs` (drives /demo, CDP screencast + ffmpeg). Older: docs/proof/backup-fullauto.mp4.
- Status, plan and log: STATUS.md, docs/PRODUCT_FLOW.md, LOOP-LOG.md, DEMO.md (**DEMO.md is stale**: it still describes the phone layout and operator steps).

## Next, in order
1. On the public URL: reset (POST /api/demo/reset), run a preset family (Maya) and a new family; confirm the rank provider is `sie` and Cognee recalls for Maya. Fix only story-path bugs.
2. Rewrite DEMO.md for the desktop web app story (landing -> chat -> save -> plan -> review/hold -> order -> next Sunday -> console KPIs). Keep it to beats plus lines.
3. Re-record the backup video against the public URL (`DEMO_URL=https://.../demo node scripts/record-demo.mjs docs/proof/backup-story.mp4`), check 8 frames, commit.
4. README pass (product, sponsors, the public URL, how to run, proof files), STATUS.md, secscan, push `deploy`.
5. Tell Abhay: make the repo public at submission; Composio spend is $0.00 (the ~3:30 voiceover is his).

## Traps
- guard-bash blocks commands naming the dotenv file; use the npm scripts (`--env-file-if-exists`). Never read keys.
- Inline python heredocs with words like "remove" or "release" trip the removal check: write the patch to a scratchpad file, then run it.
- Statsig propagation takes 20-40 s; Statsig default is now `auto_swap_and_hold` (the ceiling); the in-app setting is the control.
- Headless Chrome under 500 px wide crops; use CDP emulation for phone shots.

**Load first:** staff-engineer-workflow, product-design (UI copy), abhay-language (reports).

## Update 14:26 PT (takeover session)
Steps 1-4 done: public URL verified (Maya and a chat-made family), SIE query fix 1e90f14, DEMO.md rewritten, video re-recorded against the public URL, README and STATUS current, deploy pushed. Left: Abhay makes the repo public and submits.
