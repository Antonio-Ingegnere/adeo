# Implementation Plan

## Goal

Add the Phase P0.4 test-isolation seam required by the UI/UX Agent Integration
Plan. Automated Electron launches must use an explicitly isolated SQLite database
and Electron `userData` directory, must not perform operating-system registration
or background-reminder side effects, and must prove that Adeo's real development
database and settings are byte-for-byte unchanged.

Normal development and packaged launches must retain their current behavior.

## Current Behavior

- `src/main.ts` computes `settingsPath` and `lockFilePath` from
  `app.getPath('userData')` at module load. There is no supported way for a test to
  change that path before settings are read.
- `startApiProcess()` always replaces `ADEO_DB_PATH` with
  `<userData>/tasks.db`. An `ADEO_DB_PATH` passed to the Electron process is
  therefore ignored when Electron starts its own API.
- Setting `ADEO_API_URL` bypasses `startApiProcess()` entirely, so a test could
  accidentally connect to an already-running API backed by development data.
- Every launch calls `app.setAsDefaultProtocolClient('adeo')`, requests the normal
  single-instance lock, starts reminder polling, writes the running lock, and calls
  `ensureBackgroundReminderService()`. The latter writes or updates a macOS
  LaunchAgent, Windows Scheduled Task/registry entry, or Linux systemd user timer.
- `scripts/dev-start.sh` does honor `ADEO_DB_PATH` for its separately launched API,
  but then starts Electron with `ADEO_API_URL`; it is not an isolated automated-test
  harness.
- `playwright-core` 1.62.1 is present locally as an extraneous package and exposes
  `_electron`, but it is not declared in `package.json`/`package-lock.json`, so a
  clean checkout cannot run an Electron test.
- The repository has two Node self-tests for pure renderer modules and no automated
  Electron/data-isolation test.

## Desired Behavior

- A dedicated `ADEO_UI_TEST=1` mode fails synchronously during main-module startup
  unless both `ADEO_USER_DATA_DIR` and `ADEO_DB_PATH` are present, absolute, and
  different from Adeo's normal development paths.
- Test mode rejects `ADEO_API_URL`; the test must launch Adeo's own API process with
  the isolated database.
- `app.setPath('userData', ADEO_USER_DATA_DIR)` runs before `settingsPath`, settings,
  lock-file paths, or any other user-data-derived state is initialized.
- `startApiProcess()` honors `ADEO_DB_PATH`. Outside test mode, absence of that
  variable retains the existing `<userData>/tasks.db` default.
- Test mode does not register the protocol handler, acquire/route through the normal
  single-instance behavior, poll/show reminders, write the running lock, or install
  background reminder services.
- A repeatable self-test launches the actual Electron application, creates a uniquely
  named task through the renderer, writes a setting through the preload bridge, closes
  the app, and verifies:
  - the task exists in the isolated SQLite database;
  - the setting exists under the isolated `userData` directory;
  - the development `tasks.db`, SQLite sidecars, and `settings.json` have exactly the
    same existence and bytes as before the run.
- A negative test proves that test mode exits before opening the application when
  either isolated path is absent.

## Relevant Architecture

- `src/main.ts` owns settings persistence, API-process startup, protocol/deep-link
  registration, the single-instance lock, reminder polling, background-service
  installation, Electron window creation, and application lifecycle.
- `server/reminders.py` reads `ADEO_DB_PATH` at import and creates the database parent
  directory in `get_conn()`. Passing the isolated path into the spawned Python process
  is sufficient; the server needs no change.
- `src/preload.ts` exposes `addTask`, `getTasks`, `getSettings`, and settings-update IPC
  methods. The isolation test can exercise production IPC without adding a test-only
  bridge.
- `src/renderer/actions.ts#addTask` owns the real Quick Add flow. The test should fill
  `#message-input`, press Enter, and observe the rendered task instead of calling the
  API directly.
- The test can use `playwright-core`'s `_electron.launch()` with the Electron package's
  bundled browser; no separate browser download is required.
- Existing scripts are plain ESM `.mjs` self-tests that use explicit checks, print a
  summary, and set a non-zero exit code on failure. The isolation test should follow
  that convention while using `try/finally` for process and temporary-directory cleanup.

## Proposed Solution

Introduce one explicit test-mode boundary near the top of `src/main.ts`, immediately
after imports and constants and before any call that reads or mutates user/OS state.

1. Capture the original/default `userData` path.
2. When `ADEO_UI_TEST === '1'`:
   - require `ADEO_USER_DATA_DIR` and `ADEO_DB_PATH`;
   - require absolute paths;
   - reject the normal user-data directory and its normal `tasks.db` path;
   - reject `ADEO_API_URL` so the database path cannot be bypassed;
   - call `app.setPath('userData', isolatedUserDataDir)`.
3. Compute `settingsPath` and `lockFilePath` only after that configuration.
4. Resolve the API database path in `startApiProcess()` from `ADEO_DB_PATH` when
   provided, otherwise from the configured `userData` directory.
5. Guard all external/background launch behavior with the same `isUiTest` flag:
   protocol registration, the normal single-instance lock/listeners, reminder polling,
   running-lock writes, and background-service installation. Window creation, menu/IPC,
   the local Python API, and normal renderer behavior stay enabled because they are what
   the test must exercise.

Use `ADEO_UI_TEST` as a deliberate fail-closed switch rather than treating the mere
presence of a path override as test mode. Developers may continue to use
`ADEO_DB_PATH` outside tests, while automation gets the stronger all-or-nothing safety
contract.

Add `playwright-core` as an explicit dev dependency for this narrow Electron test. Phase
4 may later replace or build on it with `@playwright/test`; P0.4 must not implement the
full renderer/Electron project matrix early.

## Files to Modify

### `src/main.ts`

- Add the early runtime/test-mode configuration and validation.
- Move user-data-derived path initialization behind `app.setPath()`.
- Make `startApiProcess()` honor the resolved `ADEO_DB_PATH`.
- Suppress protocol, single-instance routing, reminder polling/notifications,
  running-lock writes, and OS background-service installation in test mode.
- Keep non-test startup behavior unchanged.

### `scripts/test-isolation-selftest.mjs`

- Add the Electron/Playwright isolation self-test and its negative fail-closed cases.
- Create paths only under a `mkdtemp` directory inside `os.tmpdir()`.
- Snapshot protected development files without logging their contents.
- Launch the built application directly with the required environment.
- Exercise Quick Add and a settings write, close cleanly, inspect isolated artifacts,
  compare protected snapshots, and clean up in `finally`.

### `package.json`

- Declare `playwright-core` as a dev dependency.
- Add `test:isolation` that builds and runs `scripts/test-isolation-selftest.mjs`.

### `package-lock.json`

- Record the declared `playwright-core` dependency so the test works in a clean checkout.

### `CLAUDE.md`

- Replace the obsolete warning that Electron ignores `ADEO_DB_PATH` with the exact safe
  test-mode contract and command.
- Document that `ADEO_UI_TEST` also suppresses protocol/background OS side effects.

## Implementation Steps

1. In `src/main.ts`, define `isUiTest` and capture the pre-override/default Electron
   `userData` path before the existing `settingsPath` initialization.
2. Add a small path-validation helper that produces a clear startup error naming the
   missing/invalid variable but never prints file contents. In test mode, validate both
   required paths, reject `ADEO_API_URL`, reject the default user-data/database paths,
   and call `app.setPath('userData', ...)`.
3. Leave `settingsPath`, `appSettings`, and `lockFilePath` derived from
   `app.getPath('userData')`; their existing code will then use the isolated directory
   because configuration ran first.
4. Change `startApiProcess()` to select `process.env.ADEO_DB_PATH` when present and
   otherwise keep `path.join(app.getPath('userData'), 'tasks.db')`. Pass the resolved
   absolute path to the Python child exactly as today.
5. Wrap `app.setAsDefaultProtocolClient('adeo')` in a non-test guard. In test mode,
   bypass `requestSingleInstanceLock()` and do not install `second-instance` routing;
   retain normal behavior unchanged outside test mode.
6. In the ready callback, call `startReminderPolling()`, `writeRunningLock()`, and
   `ensureBackgroundReminderService()` only outside test mode. Retain API startup,
   window/menu creation, renderer-ready IPC, and teardown.
7. Add `playwright-core` to `devDependencies` and update the lockfile using the existing
   installed compatible version. Do not add `@playwright/test`, Storybook, axe, or browser
   binaries in this phase.
8. Implement `scripts/test-isolation-selftest.mjs`:
   - resolve the platform's normal Adeo user-data directory and snapshot
     `tasks.db`, `tasks.db-wal`, `tasks.db-shm`, `tasks.db-journal`, and
     `settings.json` as `{ exists, bytes }` values;
   - create isolated user-data and data directories under one unique temp root;
   - launch two negative child processes/test launches, each missing one required path,
     and assert a non-zero failure with the expected variable named;
   - launch `_electron` with `ADEO_UI_TEST=1`, both absolute isolated paths,
     `ADEO_API_URL` removed, and `ADEO_PYTHON_BIN` pointing to `.venv/bin/python` when
     available;
   - wait for Quick Add, enter a task name containing a UUID/random suffix, press Enter,
     and assert a `.task-row` containing that exact text appears;
   - call the production preload settings method from the renderer to change a setting,
     then assert the isolated `settings.json` is created;
   - close Electron in `finally`, verify the isolated SQLite database contains the unique
     task using Python's standard-library `sqlite3`, compare every protected snapshot,
     and remove only the validated temp root.
9. Update `CLAUDE.md` with the new test command and safety contract.
10. Run all verification commands and inspect `git diff` to confirm no unrelated or
    generated files are included.

## Edge Cases

- Either required test path is missing, empty, relative, or resolves to the normal Adeo
  user-data/database path: abort before reading settings, registering the protocol,
  acquiring the normal instance lock, starting the API, or creating a window.
- `ADEO_API_URL` is inherited from a developer shell in test mode: abort rather than risk
  talking to an unknown server.
- The real database/settings or SQLite sidecar does not exist before the test: absence is
  part of the snapshot and it must remain absent afterward.
- A real Adeo instance is already open: test mode does not reuse/focus that instance and
  uses its isolated paths independently.
- The Python API fails to start: Playwright reports startup failure, Electron and any child
  process are closed, protected files are still compared, and the temp directory is cleaned.
- The test fails after Electron starts: cleanup still closes Electron before removing the
  temp directory.
- An isolated parent directory does not yet exist: the test creates it under the validated
  temp root; the production server may create the final database file as it does today.
- Paths contain spaces: pass them through environment objects/argument arrays, never shell
  interpolation.
- A protected file changes concurrently for an unrelated reason: fail loudly rather than
  reporting a false safety guarantee.

## Error Handling

- Invalid test configuration throws a descriptive startup error and exits non-zero before
  application initialization. Do not silently fall back to default paths.
- The self-test catches failures only to print a concise failing check; it retains a non-zero
  exit status.
- Always attempt Electron shutdown and temp cleanup in `finally`. If cleanup also fails,
  report it without hiding the original failure.
- Do not print database/settings bytes or user task content in failure logs; file paths and
  hashes/changed status are sufficient.

## Tests

### Fail-closed configuration

In `scripts/test-isolation-selftest.mjs`, launch with `ADEO_UI_TEST=1` while omitting
`ADEO_DB_PATH`, then while omitting `ADEO_USER_DATA_DIR`. Each launch must exit non-zero,
name the missing variable, and create no window/API/database.

### Isolated successful launch

Launch with both absolute temp paths and no `ADEO_API_URL`. Assert the renderer loads,
Quick Add creates a uniquely named task, and the task renders.

### Isolated persistence

After closing the app, assert the unique task is present in the isolated database and the
settings change is present in `<isolated userData>/settings.json`.

### Protected-file byte proof

Snapshot the development database, SQLite sidecars, and settings before launch and compare
existence plus bytes after shutdown. Any difference fails the test.

### Existing regression checks

Run:

```text
npm run build
node scripts/query-selftest.mjs
node scripts/shortcuts-selftest.mjs
npm run test:isolation
```

Expected results: both existing self-tests retain their current pass counts, the isolation
self-test passes all positive/negative checks, and TypeScript builds without errors.

## Acceptance Criteria

- `ADEO_UI_TEST=1` cannot start without both absolute isolated paths and cannot use
  `ADEO_API_URL`.
- Electron uses `ADEO_USER_DATA_DIR` before reading or deriving settings/lock paths.
- The spawned Python API uses the explicit `ADEO_DB_PATH`.
- Test mode performs no protocol registration, normal single-instance routing, reminder
  polling/notifications, running-lock write, or background-service installation.
- The automated test creates and observes a unique task through the real renderer/preload/
  IPC/API stack and persists a setting only in the isolated locations.
- Development `tasks.db`, its sidecars, and `settings.json` are proven byte-for-byte
  unchanged (including preserved absence).
- `npm run test:isolation` works from a clean dependency install and cleans up its temp
  directory/processes on success or failure.
- `npm run build` and both existing self-tests pass.
- Non-test development and packaged startup behavior is unchanged.

## Non-goals

- Adding the full Phase 4 Playwright project matrix or broad E2E coverage.
- Adding Storybook, axe, visual regression, CI, or screenshot baselines.
- Refactoring renderer calls behind `AppServices`.
- Changing database schemas, API endpoints, settings fields, reminder behavior, or product UI.
- Modifying `scripts/dev-start.sh` or changing normal `ADEO_API_URL` development behavior.
- Cleaning up unrelated agent configuration changes already present in the worktree.

## Open Questions

None.

## Implementation Status

APPROVED
