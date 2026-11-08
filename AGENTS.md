# HKRTTrafficInfo — agent notes

## use impeccable skill for front-end design

## Communication

- Reply to the user in **English**. Code, code comments, commit messages, `README.md` and
  `docs/` are English too; no need to translate API, library or platform names.

## Verified workflow facts

- `npm run verify` = ESLint + `tsc --noEmit` + the deterministic suite
  (`node --test tests/*.test.mts`). Run it before committing; it is what the `Verify` workflow runs.
- Pushing to `main` starts the `Verify` workflow, which also runs `npm run build` and the
  Chromium smoke checks (`npm run verify:browser`). On success the `Vercel deploy`,
  `Cloudflare Worker deploy` and `GitHub Pages deploy` workflows run for that same commit
  (`.github/workflows/`). A failed `Verify` skips all deploys by design, so a red run never
  ships. A manual Pages dispatch remains the rollback route.
- Browser tests (`tests/*.browser.mjs`) run through `npm run verify:browser`, which starts a
  local app and drives a pinned Playwright/Chromium. They are not part of `npm test`;
  `npx playwright install chromium` is needed once on a new machine.
- `npm run build` regenerates `.next/types`, which can make a later `tsc` fail on generated
  `validator.ts` imports. Delete `.next/types` (gitignored build output) if that happens.
- Documentation to keep in step with code changes: `README.md` (layer table, deploy targets),
  `hkrttrafficinfo.md` (handover spec), `docs/` (dated reviews).

