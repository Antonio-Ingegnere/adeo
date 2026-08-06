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
  - `index.ts` — wires up all DOM event listeners and app init; also contains the custom recurrence-rule builder UI (RFC5545-style RRULE construction from the "Repeat" modal — daily/weekly/monthly/yearly, by-day/by-set-position, until/count)
- `server/app.py` — single-file FastAPI app. SQLite database (`tasks`, `lists` tables), auto-migrated at startup via `has_column`/`ALTER TABLE` checks (no formal migration framework — new columns are added defensively in `initialize_db`). Recurring tasks: completing a task with a `repeat_rule` inserts the next occurrence using `dateutil.rrulestr`. `GET /reminders/due` returns not-done tasks whose reminder time has passed within a grace window (`reminder_grace_seconds`) — it's stateless on the Python side; dedupe/"already notified" tracking lives in Electron's main process (see above), which is the one polling this endpoint.

### Data flow for a UI action
Renderer calls `window.electronAPI.xyz(...)` → preload's `ipcRenderer.invoke` → `ipcMain.handle` in `main.ts` → `apiRequest()` HTTP call to the local FastAPI server → SQLite. Responses are plain JSON matching the `Task`/`List`/`Settings` shapes in `src/types.ts`, which is the single source of truth for data shapes shared (by hand, not by codegen) between the TS and Python sides — when changing a field, update `src/types.ts`, the Pydantic models in `server/app.py`, and `row_to_task`/equivalent serializers together.

### Ports and environment variables
- `ADEO_API_URL` — if set, Electron skips spawning its own API process and talks to this URL instead (used by `dev-start.sh` to point at the manually-started dev server).
- `ADEO_API_HOST` / `ADEO_API_PORT` — host/port the spawned API process binds to (main process picks a free port automatically when packaged).
- `ADEO_DB_PATH` — SQLite file location; defaults to a platform-specific path under the OS's application-support directory (see `default_db_path()` in `server/app.py`).
- `ADEO_PYTHON_BIN` — override which Python interpreter the Electron main process spawns (bundled Python vs. system `python3`).

### Settings vs. app data
App settings (`showCompleted`, `timeFormat`, `dateFormat`) are stored separately from task/list data — as JSON on disk via Electron's main process (`settingsPath` in `main.ts`), not in the SQLite DB. Task/list data lives entirely in SQLite via the Python API.
