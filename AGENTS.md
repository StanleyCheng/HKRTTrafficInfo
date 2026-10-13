# HKRTTrafficInfo — agent notes

## Communication

- Reply to the user in **English**. Code, code comments, commit messages, `README.md` and
  `docs/` are English too; no need to translate API, library or platform names.

## Verified workflow facts

- `npm run verify` = ESLint + `tsc --noEmit` + the deterministic suite
  (`node --test tests/*.test.mts`). Run it before committing; it is what the `Verify` workflow runs.
- Pushing to `main` starts the `Verify` workflow; on success the `Vercel deploy` and
  `Cloudflare Worker deploy` workflows run for that same commit (`.github/workflows/`).
  A failed `Verify` skips both deploys by design, so a red run never ships.
- Browser tests (`tests/*.browser.mjs`) need Playwright, which is not a dependency here;
  they are not part of `npm test`.
- `npm run build` regenerates `.next/types`, which can make a later `tsc` fail on generated
  `validator.ts` imports. Delete `.next/types` (gitignored build output) if that happens.
- Documentation to keep in step with code changes: `README.md` (layer table, deploy targets),
  `hkrttrafficinfo.md` (handover spec), `docs/` (dated reviews).
