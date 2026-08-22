# P0.4 implementation review: automated UI test isolation

**Status:** PASS
**Reviewer:** Codex implementation verification
**Review date:** 2026-08-22
**Classification:** Maintenance/safety infrastructure; no UX decision required
**Production base:** `99dab6e602edefd3975e1cbe7defb72a24786c64` plus the reviewed worktree diff
**Implementation plan:** `../../../.claude/plans/current.md`

## Outcome

The P0.4 isolation seam meets its acceptance criteria. Automated Electron launches now
fail closed unless both data paths are explicit and isolated, cannot inherit
`ADEO_API_URL`, and do not perform protocol, normal single-instance, reminder polling,
running-lock, or background-service side effects. The successful test exercises the real
Quick Add renderer flow and settings preload bridge against temporary storage.

No visual change is expected or produced by this infrastructure-only change, so screenshots
are not applicable.

## Requirement-to-evidence traceability

| Requirement | Evidence | Result |
|---|---|---|
| Require isolated database and Electron `userData` | `src/main.ts` validates `ADEO_DB_PATH` and `ADEO_USER_DATA_DIR` before settings/app initialization | PASS |
| Reject unsafe fallbacks | `npm run test:isolation` covers missing, relative, normal Adeo paths, and inherited `ADEO_API_URL` | PASS |
| Exercise production data path | Test fills Quick Add, observes the task row, and verifies the unique task in isolated SQLite | PASS |
| Isolate settings | Test writes through `window.electronAPI.updateTimeFormat` and verifies isolated `settings.json` | PASS |
| Protect real data byte-for-byte | Test snapshots the database, WAL/SHM/journal sidecars, and settings before/after | PASS |
| Suppress OS side effects | Test-mode guards exclude protocol registration, normal instance routing, reminder polling, running lock, and background installer | PASS |
| Preserve existing compilation and pure behavior | Build plus 103 query and 132 shortcut cases pass | PASS |

## Verification evidence

Run from `adeo/` on 2026-08-22:

```text
npm run build
  PASS

node scripts/query-selftest.mjs
  All 103 query cases passed

node scripts/shortcuts-selftest.mjs
  All 132 shortcut cases passed

npm run test:isolation
  Isolation self-test passed (34 checks)
```

The two Node self-tests emit their existing module-type performance warning; it does not
represent a test failure and was not changed in P0.4.

## Implementation notes

- Invalid configuration uses an explicit non-zero process exit. Investigation showed that
  a top-level exception could leave Electron's browser process alive without a window.
- The rejection diagnostic is written synchronously before that exit so Electron cannot
  discard the name of the unsafe or missing variable while terminating.
- Test launches also use a temporary Chromium bootstrap directory before the main process
  applies the final isolated `userData` path.
- The negative suite is broader than the minimum two missing-variable cases: it also locks
  in absolute-path, protected-path, and `ADEO_API_URL` rejection.
- `playwright-core` is now a declared, locked dev dependency. The full Playwright project
  matrix remains deferred to Phase 4.

## Remaining gaps

- P0.5 visual baselines remain blocked until the `ui-ux` workspace has an approved version
  control destination.
- Storybook, axe, broad renderer/Electron E2E, screenshot comparison, and CI remain in their
  planned later phases.
