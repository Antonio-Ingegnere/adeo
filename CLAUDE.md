# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Adeo is a lightweight, cross-platform (mac/Windows/Linux) Electron todo app. The UI runs in Electron's main/renderer processes (TypeScript); persistence and business logic (tasks, lists, recurring-task expansion, due-reminder lookup) live in a local FastAPI + SQLite backend (Python) that the Electron main process spawns as a child process. Reminder notifications are delivered natively via Electron's own `Notification` API in the main process, which also handles notification clicks.

## Commands

Setup (one time):
```
npm install
python3 -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt
```

Run the app in development:
```
npm run start
```
This runs `scripts/dev-start.sh`, which starts the FastAPI server on `127.0.0.1:8000` (using `.venv/bin/python` if present, else `python3`), then launches Electron with `ADEO_API_URL` pointing at the running API. There is no separate "run just the frontend" mode — the API must be up first.

Build (compiles TS for both main and renderer, copies static assets into `dist/`):
```
npm run build
```

Run only the Python API standalone (e.g. for API debugging):
```
npm run api
```

Package for distribution:
```
npm run package:mac
npm run package:win
npm run package:linux
```
`package:win` expects a bundled Windows embeddable Python under `python/python-3.12.10-embed-amd64/` with site-packages populated; `package:mac` expects standalone Python runtimes under `python/mac-arm64/` and `python/mac-x64/` (from [python-build-standalone](https://github.com/astral-sh/python-build-standalone)) with site-packages populated — see README.md for the full steps. Without these, the packaged app falls back to the system `python3`, which typically lacks `fastapi` and fails to start (now surfaced via an error dialog instead of a silent windowless hang, see `src/main.ts`'s `app.whenReady()` handler).

There is no configured test suite or linter in this repo — do not assume `npm test`/`npm run lint` exist.

## Architecture

### Process split
- `src/main.ts` — Electron main process. Owns the app lifecycle, native menu, settings persistence (`settings.json` in Electron's userData dir), and spawning/health-checking the Python API child process. All data operations are exposed to the renderer via `ipcMain.handle(...)` and simply proxy to HTTP calls against the local FastAPI server (`apiRequest` helper). If the API process dies, the next request restarts it once and retries. It also polls `GET /reminders/due` every 30s, dedupes via an in-memory `Map`, and raises native `Notification`s for due reminders; clicking one focuses the window and sends `open-task-edit` over IPC to the renderer.
- `src/preload.ts` — the only bridge between main and renderer; uses `contextBridge` to expose a single `window.electronAPI` object (typed by `ElectronAPI` in `src/types.ts`) with one method per IPC channel. Context isolation is on; the renderer has no direct Node/Electron access.
- `src/renderer/*.ts` — plain TypeScript modules (no framework) that manipulate the DOM directly, compiled with a separate tsconfig (`tsconfig.renderer.json`, ESNext modules) targeting the browser context. Split by concern:
  - `state.ts` — single mutable `UIState` object shared across modules (current tasks/lists, modal state, drag state, etc.)
  - `dom.ts` — one `refs` object caching all `getElementById` lookups used across the app
  - `actions.ts` — API calls (add/load tasks, lists, settings) that mutate `state` and trigger re-renders
  - `tasks.ts` / `lists.ts` / `modals.ts` — rendering + drag-and-drop + modal logic for tasks, lists, and the edit/settings modals respectively
  - `repeat.ts` — recurrence-rule helpers shared by the UI
  - `smartLists.ts` / `activeSmartList.ts` / `smartListTemplate.ts` — smart lists (see below)
  - `index.ts` — wires up all DOM event listeners and app init; also contains the custom recurrence-rule builder UI (RFC5545-style RRULE construction from the "Repeat" modal — daily/weekly/monthly/yearly, by-day/by-set-position, until/count)
- `server/app.py` — single-file FastAPI app. SQLite database (`tasks`, `lists`, `tags`, `task_tags`, `smart_lists` tables), auto-migrated at startup via `has_column`/`ALTER TABLE` checks (no formal migration framework — new columns are added defensively in `initialize_db`). Recurring tasks: completing a task with a `repeat_rule` inserts the next occurrence using `dateutil.rrulestr`. `GET /reminders/due` returns not-done tasks whose reminder time has passed within a grace window (`reminder_grace_seconds`) — it's stateless on the Python side; dedupe/"already notified" tracking lives in Electron's main process (see above), which is the one polling this endpoint.

### Data flow for a UI action
Renderer calls `window.electronAPI.xyz(...)` → preload's `ipcRenderer.invoke` → `ipcMain.handle` in `main.ts` → `apiRequest()` HTTP call to the local FastAPI server → SQLite. Responses are plain JSON matching the `Task`/`List`/`Settings` shapes in `src/types.ts`, which is the single source of truth for data shapes shared (by hand, not by codegen) between the TS and Python sides — when changing a field, update `src/types.ts`, the Pydantic models in `server/app.py`, and `row_to_task`/equivalent serializers together.

### Ports and environment variables
- `ADEO_API_URL` — if set, Electron skips spawning its own API process and talks to this URL instead (used by `dev-start.sh` to point at the manually-started dev server).
- `ADEO_API_HOST` / `ADEO_API_PORT` — host/port the spawned API process binds to (main process picks a free port automatically when packaged).
- `ADEO_DB_PATH` — SQLite file location; defaults to a platform-specific path under the OS's application-support directory (see `default_db_path()` in `server/app.py`).
- `ADEO_PYTHON_BIN` — override which Python interpreter the Electron main process spawns (bundled Python vs. system `python3`).

### List selection
`state.selectedListId` is a single value doing two jobs: it filters the rows (`getVisibleTasks`) *and* it is where a new task goes (`addTask`). There is no separate add-target — the title picker above the add-task input (`#list-picker`, rendered by `syncListPicker`) and the sidebar pills are two views of that one value, and both write it through `selectList()` in `src/renderer/lists.ts`, which owns the four repaints that follow. `null` is "All lists" as a view and "no list" as a destination; `renderListOptions`'s `emptyLabel` parameter is what lets the same menu builder say either.

A running smart list still overrides the picker for *new* tasks only (`resolveTemplateNames` in `addTask`) — `list:Home` in the query is the more specific statement of where the task belongs. Searching does not touch the selection at all: `.tasks-title` becomes a muted `Search results · N` beside the picker rather than replacing it, so the picker keeps saying where a new task lands while the annotation says why the rows below are something else.

### Settings vs. app data
App settings (`showCompleted`, `timeFormat`, `dateFormat`, `theme`) are stored separately from task/list data — as JSON on disk via Electron's main process (`settingsPath` in `main.ts`), not in the SQLite DB. Task/list data lives entirely in SQLite via the Python API. All app-rendered dates go through the single shared `formatDate` helper (`src/renderer/helpers.ts`), which maps `state.dateFormat` to one of a fixed set of patterns — deliberately explicit/user-chosen rather than auto-detected from the OS locale, since JS's `Intl`/`toLocaleDateString` locale resolution doesn't reliably reflect OS regional-format overrides (verified: it ignores macOS's `-u-rg-` regional override entirely). Native `<input type="date">`/`<input type="time">` elements (the reminder popover, repeat start/end dates) still render in the OS's own format regardless of this setting — that's a normal, unavoidable native-control limitation, not a bug.

`theme` (`'system' | 'light' | 'dark'`, chosen in the Settings modal) is applied entirely in the main process by assigning `nativeTheme.themeSource`. That drives the `prefers-color-scheme` media query in the renderer, so the dark token set at the bottom of `styles.css` needs no switch of its own and there is no renderer-side theme class or attribute — do not add one. It is set in `app.whenReady()` *before* `createWindow()`, because the window's `backgroundColor` is derived from `nativeTheme.shouldUseDarkColors` and applying the theme later would flash the wrong scheme at launch.

Testing note: under `playwright-core`, `nativeTheme.themeSource` appears to do nothing, because Playwright emulates `prefers-color-scheme: light` by default and that overrides what Electron reports. Call `page.emulateMedia({ colorScheme: null })` first to hand control back to the app.

### Smart lists
A smart list (`smart_lists` table, `/smart-lists` endpoints) is **only a named query string** — the server never parses it. Clicking one in the sidebar loads its text into the search field and switches to Query mode, so there is no separate filtering path: `parseQuery`/`compilePredicate`/`getSearchMatches` do all the work.

Two different questions, and they have different answers (`src/renderer/activeSmartList.ts`):
- **Which one is *running*** is *derived*, never stored — `activeSmartList()`: a smart list is running iff the search bar holds exactly its query.
- **Which one the bar is *working on*** is `associatedSmartList()`, and it is the one the UI actually uses. Refining a saved query is how you edit a smart list, and the refined text matches nothing, so the association is carried in `state.smartListOrigin` and reported with an `edited` flag. An exact match always wins and re-adopts the origin, so a query typed by hand that happens to equal a saved one is still recognised. Origin is dropped by `clearSearch`, by leaving Query mode, by emptying the query, and by deleting the smart list it points at.

Everything a query needs beyond its own text lives in the **query bar** (`#query-bar`, `src/renderer/queryBar.ts`) — the strip under the field in Query mode — never inside the input, which holds the query and nothing else. It shows the association on the left and, on the right, exactly one set of actions: `Save as smart list` (unassociated), `Edit` (unchanged), `Update` + `Save as new` (edited), or a name input (naming). `Update` is a bare `updateSmartListQuery` with no modal and no name to retype; the modal (`#smart-list-overlay`) is the *full* editor, reached from `Edit` and the sidebar menu. `queryBar.ts` renders and dispatches CustomEvents (`smart-list-create`, `smart-list-update`) that `index.ts` executes — that is what keeps it out of the `smartLists.ts` ⇄ `activeSmartList.ts` import graph.

The bar is `position: absolute` inside `.lists-search-field`, so the header row (and with it the 181px trailing group, see the comment above `.search-mode-switch`) is untouched; its height is reserved by `.app-header.query-mode`'s `min-height: 86px`, which keeps the search row centred in exactly the 55px it has in Text mode. The suggest menu and `.search-status-line` both open 34px below the field so they clear the bar — `positionDropdown`'s `belowGap` argument exists for this.

`renderQueryBar()` runs from `renderSearchStatus()` on every keystroke, deliberately unmemoized: its actions key off `state.queryStatus`, which is only settled by the time that runs. `syncSmartListUI`'s memo guards the *sidebar* repaint only, and its key includes the `edited` flag.

"Saved filter" was the original name. `initialize_db` carries a guarded `ALTER TABLE saved_filters RENAME TO smart_lists` that must stay *before* the `CREATE TABLE IF NOT EXISTS`, or the create wins and the old rows are stranded.

Adding a task while a query is in the bar seeds the new task from **the query on screen**, saved or not (`activeTemplate()` parses `state.searchQuery`, so an edited query seeds from the edit rather than from the version it was saved as). `deriveTemplate` (`src/renderer/smartListTemplate.ts`, kept pure and dom-free like `query.ts` so `scripts/query-selftest.mjs` can exercise it) inverts the AST: a `term` using `:` under only `and` nodes is a straight assignment; `OR`, `NOT`, ranges (`~ != < <= > >=`), `text`/`details`, and fields constrained twice with different values are collected into `skipped` and surfaced in the add-task row rather than guessed at. `none` values (`list:none`, `due:none`, `done:false`) are assignable because they equal a new task's defaults. This is why Adeo's smart lists accept new tasks where macOS Reminders' only do for a single list.

`POST /tasks` accepts optional `priority`/`reminderDate`/`reminderTime`/`repeatRule`/`repeatStart` for this; they were previously hardcoded to defaults.
