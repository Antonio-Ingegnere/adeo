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

There is no configured test suite or linter in this repo — do not assume `npm test`/`npm run lint` exist. What does exist are two self-test scripts over the pure, dom-free modules, both run with plain `node` after `npm run build`:
```
node scripts/query-selftest.mjs      # query parsing/compilation, smart-list templates
node scripts/shortcuts-selftest.mjs  # shortcut key grammar, default keymap integrity
```

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

### The view
A list, a smart list and a bare search are three answers to one question, so there is one control for them: the **view bar** above the add-task input (`.view-bar`, `src/renderer/viewBar.ts`). Its picker is the only menu where lists and smart lists appear together — `All lists`, then the lists, then the smart lists under their group labels. **A task still belongs to a list or to nothing**: the edit modal's picker (`renderListOptions` in `lists.ts`) offers "No list" + lists and never a smart list.

`currentView()` (`src/renderer/currentView.ts`) derives which of the three is up: `smart` when a search is running and `associatedSmartList()` matches, `search` when one is running and nothing matches, otherwise `list` with `state.selectedListId`. Every highlight reads it — the sidebar's list pills (`isListInView`) and smart-list pills (`isSmartListInView`) — which is what makes exclusivity structural rather than something each path has to remember. Nothing new is stored: `selectedListId` survives *underneath* a running search, so clearing the search drops you back into the list you were in.

Selecting a list clears whatever search is running (`selectList` in `index.ts`) — one view at a time, or the picker would name something the rows below are not. `state.selectedListId` is still doing two jobs: filtering the rows (`getVisibleTasks`) and receiving new tasks (`addTask`). A running smart list's own `list:` term overrides it for *new* tasks only (`resolveTemplateNames`), being the more specific statement of intent. Because the picker names the search rather than a list while one is up, `renderTemplateHints` always leads with the destination in that state — that row is then the only thing that can say where the next task will land, and it always does.

The bar's own repaint is `renderViewBar()`, called from `renderSearchStatus()` (advanced) and from `applySearchQuery`'s simple branch, deliberately unmemoized: its actions key off `state.queryStatus`, which is only settled by then. `syncSmartListUI`'s memo guards the *sidebar* repaint only; `querySearch.ts` repaints the list pills just on the search-on/search-off transition (`syncListPills`).

### Keyboard shortcuts
Four renderer modules, in a strict DAG: `shortcutKeys.ts` (the key grammar) ← `shortcutRegistry.ts` (the definitions) ← `shortcuts.ts` (the dispatcher) ← `shortcutsHelp.ts` / `shortcutsSettings.ts`. **The registry holds no handler functions** — only ids; `index.ts` owns the id→function table (`shortcutHandlers`), the same trick `viewBar.ts` uses, and it is what lets `tasks.ts`, the help overlay and the settings UI all import the registry without a cycle. The first two modules are pure and dom-free so `scripts/shortcuts-selftest.mjs` can drive them from Node.

**Nothing shared may live at `src/`.** `tsconfig.json` includes `"src"` and excludes `src/renderer/**`; `tsconfig.renderer.json` clears that exclude and pulls in imported files transitively. A runtime module at `src/foo.ts` is therefore emitted by *both* passes to the same `dist/foo.js` — main's as CommonJS, the renderer's as ESNext — and `npm run build` runs main first, so the ESM output wins and `require()` from `dist/main.js` breaks at runtime. `src/types.ts` is only safe because it emits no runtime code. Consequently **main holds no shortcut logic**: the renderer computes Electron accelerators (`toElectronAccelerator`) and hands them over.

A binding is a canonical string (`"Mod+Shift+F"`, `"ArrowDown"`, `"?"`) so dispatch is a `Map` lookup with no normalization at keypress time. `Mod` is ⌘ on macOS and Ctrl elsewhere, and the *other* one is emitted literally, so `Mod` never collides with a real Ctrl. The one subtle rule is Shift: a printable non-letter uses `event.key` as typed with Shift dropped (`Shift+/` → `"?"`), while ASCII letters uppercase and keep it — for a letter, case is the only signal.

`scope` is what makes bare keys bindable. `list` fires only when the task list has focus, `modal` only under an overlay, and `global` everywhere — **except that an unmodified `global` binding is suppressed while typing**. That single rule lets `Mod+F` work from inside the search field while `?` stays inert in a query containing one, with no per-shortcut special-casing. Context comes from `activeOverlay()` (exported from `focusTrap.ts` — the app's one answer to "is a modal open") plus `document.activeElement`.

`menuItem: true` means *a native menu accelerator carries this key*, so the dispatcher must not also claim it — Electron consumes the accelerator before the page sees it. A menu item with no accelerator (Help) claims no key and is not marked. `fixed: true` (Escape, Tab) means documented in help, never dispatched, never rebindable: Escape already has four correct owners layered by `stopPropagation` across `querySearch.ts`, `viewBar.ts`, `tagInput.ts` and `datepicker.ts`, and making it rebindable would let someone unbind their way out of every modal. `installShortcuts()` runs *before* `installModalFocusTrap()` — both are capture listeners on `document`, so registration order decides, and the rebinding UI's capture mode has to beat the trap's `Tab`.

The task cursor is `state.focusedTaskId` — an **id**, because `row.dataset.index` is the drag-and-drop coordinate and every reorder or refetch invalidates it, and because `renderTasksInner` wipes the list with `innerHTML = ''`. `renderTasks()` brackets the rebuild: it records whether focus was in the list and the focused row's *ordinal* beforehand, then re-seats afterwards, falling back to the ordinal when the task itself is gone (completed with Show completed off, filtered out, deleted) so the cursor holds its place. The `hadFocus` gate is not optional — `renderTasks()` has ~15 callers, several with focus legitimately elsewhere, and without it adding a task yanks the caret out of the input. Traversal is always over `querySelectorAll('.task-row')`, never `getVisibleTasks()`, so search-mode grouping needs no special handling.

The two always-visible text inputs name their own shortcut in their placeholder — "Search (⌘F)", "Add a new task (⌘N)" — because nothing else on screen says those keys exist. `shortcutHints.ts` reads the **live keymap**, so a rebind moves the hint and an unbind removes it rather than leaving the placeholder promising a dead key; `renderShortcutHints()` runs at init and after every keymap change. It sits above both `querySearch.ts` and `shortcuts.ts` on purpose: `shortcuts.ts` already imports `querySearch.ts`, so the search placeholder is *pushed in* via `setSearchShortcutHint` rather than pulled, which is what keeps that from being a cycle. Query mode keeps its own placeholder and takes no hint.

`Settings.shortcuts` stores **overrides only, never a keymap snapshot**: an absent id keeps its platform default, so an improved default still reaches anyone who never rebound that one; `[]` is an explicit unbind and so must stay distinct from absent. `Settings.menuAccelerators` is a derived cache, needed because `setupMenu` runs inside `createWindow()` long before the renderer has loaded settings — main re-validates it against a narrow pattern on both read and menu build, because `Menu.buildFromTemplate` *throws* on a malformed accelerator and would leave the app with no menu at all. `update-shortcuts` persists both and re-calls `setupMenu`.

### Tag colour
Every tag swatch, dot and chip in the app goes through `tagColor.ts` — `paintTagChip` and `makeTagDot`. The colour is an **inline style, not a class**: it is data rather than a variant, which is what makes "turn tag colours off" simply *not setting it*, since the chip classes carry a border and no background of their own.

`TAG_PALETTE` is hand-mirrored between `tagColor.ts` and `server/app.py`, the way `src/types.ts` mirrors the Pydantic models. The server assigns from it at creation and **validates against it** in `PATCH /tags/{id}/color`, so the two must be edited together — a colour the picker offers and the server doesn't know is rejected with a 400 rather than silently stored. Only palette colours are accepted because chip text is a single fixed ink chosen to sit on these pastels.

`settings.tagColors` (default on) drops the fill everywhere and adds `tag-plain`; sidebar dots are not rendered at all, since a grey dot beside every tag carries no information. `tag-plain` is not just "no background": `--text-chip` is dark ink meant for a pastel fill and **stays dark in dark mode**, and `--border-chip` is black at low alpha, so an unfilled chip must switch to `--text-body` and `--border` or it goes invisible on a dark surface. `styles.css:2471` already documents that distinction for `.template-chip`. The rule must also sit *after* `.task-tag-chip` and `.tag-filter-chip` in the file — equal specificity means source order decides, and placing it earlier loses.

### Sidebar order
All three sidebar panels — lists, smart lists and tags — are **drag-ordered by `position`, never by name**. The gesture lives once in `pillDnD.ts`; each panel calls `attachPillDnD` with a `kind`, and a `dragover` whose kind doesn't match the pill under the pointer never calls `preventDefault`, so the browser refuses the drop and the panels can't be dragged into each other. The in-flight drag is module-local — it's interaction state, only one exists at a time, and it deliberately does not live in `UIState`.

Tags were alphabetical until they became draggable, and the two cannot coexist: a drop would snap back on the next render. So `sortTags()` sorts by `position`, `GET /tags` orders by it, and `add_tag` appends with `MAX(position)+1` (it used `COUNT(*)`, which repeats a number as soon as a tag is deleted — harmless while nothing read the column, not any more). Renaming a tag no longer moves it.

`initialize_db` carries a one-time renumber for tags whose positions aren't a distinct `0..n-1` run, assigning them by name so an existing database opens looking exactly as it did before. It is self-guarding rather than flag-driven: reordering always writes a distinct run, so it can never fire twice and can never undo someone's arrangement.

Anything that reorders a panel has to repaint whatever else lists it in array order — for lists that's `renderViewBar()`, since the view picker names them in order. Tags appear in no picker, only in the edit modal's tag menu, which is rebuilt on open.

### Settings vs. app data
App settings (`showCompleted`, `timeFormat`, `dateFormat`, `theme`) are stored separately from task/list data — as JSON on disk via Electron's main process (`settingsPath` in `main.ts`), not in the SQLite DB. Task/list data lives entirely in SQLite via the Python API. All app-rendered dates go through the single shared `formatDate` helper (`src/renderer/helpers.ts`), which maps `state.dateFormat` to one of a fixed set of patterns — deliberately explicit/user-chosen rather than auto-detected from the OS locale, since JS's `Intl`/`toLocaleDateString` locale resolution doesn't reliably reflect OS regional-format overrides (verified: it ignores macOS's `-u-rg-` regional override entirely). Native `<input type="date">`/`<input type="time">` elements (the reminder popover, repeat start/end dates) still render in the OS's own format regardless of this setting — that's a normal, unavoidable native-control limitation, not a bug.

`theme` (`'system' | 'light' | 'dark'`, chosen in the Settings modal) is applied entirely in the main process by assigning `nativeTheme.themeSource`. That drives the `prefers-color-scheme` media query in the renderer, so the dark token set at the bottom of `styles.css` needs no switch of its own and there is no renderer-side theme class or attribute — do not add one. It is set in `app.whenReady()` *before* `createWindow()`, because the window's `backgroundColor` is derived from `nativeTheme.shouldUseDarkColors` and applying the theme later would flash the wrong scheme at launch.

Testing note: under `playwright-core`, `nativeTheme.themeSource` appears to do nothing, because Playwright emulates `prefers-color-scheme: light` by default and that overrides what Electron reports. Call `page.emulateMedia({ colorScheme: null })` first to hand control back to the app.

### Smart lists
A smart list (`smart_lists` table, `/smart-lists` endpoints) is **only a named query string** — the server never parses it. Running one (from the sidebar or the view picker) loads its text into the search field and switches to Query mode, so there is no separate filtering path: `parseQuery`/`compilePredicate`/`getSearchMatches` do all the work.

Two different questions, and they have different answers (`src/renderer/activeSmartList.ts`):
- **Which one is *running*** is *derived*, never stored — `activeSmartList()`: a smart list is running iff the search bar holds exactly its query.
- **Which one the bar is *working on*** is `associatedSmartList()`, and it is the one the UI actually uses. Refining a saved query is how you edit a smart list, and the refined text matches nothing, so the association is carried in `state.smartListOrigin` and reported with an `edited` flag. An exact match always wins and re-adopts the origin, so a query typed by hand that happens to equal a saved one is still recognised. Origin is dropped by `clearSearch`, by leaving Query mode, by emptying the query, and by deleting the smart list it points at.

Everything a query needs beyond its own text lives in the view bar, never inside the search input, which holds the query and nothing else. Beside the name it shows exactly one set of actions: `Save as smart list` (a bare search), `Edit` (running unchanged), `Update` + `Save as new` (edited), or a name input (naming). `Update` is a bare `updateSmartListQuery` with no modal and no name to retype; the modal (`#smart-list-overlay`) is the *full* editor, reached from `Edit` and the sidebar menu. `viewBar.ts` renders and dispatches CustomEvents (`select-list`, `run-smart-list`, `smart-list-create`, `smart-list-update`) that `index.ts` executes — that is what keeps it a leaf `lists.ts`, `smartLists.ts`, `tasks.ts` and `querySearch.ts` can all call without a cycle. The search selectors it needs live in `searchMatches.ts` for the same reason.

"Saved filter" was the original name. `initialize_db` carries a guarded `ALTER TABLE saved_filters RENAME TO smart_lists` that must stay *before* the `CREATE TABLE IF NOT EXISTS`, or the create wins and the old rows are stranded.

Adding a task while a query is in the bar seeds the new task from **the query on screen**, saved or not (`activeTemplate()` parses `state.searchQuery`, so an edited query seeds from the edit rather than from the version it was saved as). `deriveTemplate` (`src/renderer/smartListTemplate.ts`, kept pure and dom-free like `query.ts` so `scripts/query-selftest.mjs` can exercise it) inverts the AST: a `term` using `:` under only `and` nodes is a straight assignment; `OR`, `NOT`, ranges (`~ != < <= > >=`), `text`/`details`, and fields constrained twice with different values are collected into `skipped` and surfaced in the add-task row rather than guessed at. `none` values (`list:none`, `due:none`, `repeat:none`, `done:false`) are assignable because they equal a new task's defaults, so they need no assignment at all; `done:true` is the one value that assigns a *non*-default, creating an already-completed task (`TaskSeed.done` → `POST /tasks`), which is why the hints row carries a `Done` chip — such a task disappears on creation while Show completed is off. This is why Adeo's smart lists accept new tasks where macOS Reminders' only do for a single list.

Where the task lands when the query does not name exactly one list: `state.selectedListId`, i.e. the list the view was in underneath the smart list (All lists ⇒ unfiled). A list named in the query that no longer exists is never recreated — it is reported and the fallback applies. A *tag* named in the query that does not exist yet **is** created, the same way typing `#todo` in the add-task input would, so a smart list written before its tag exists still produces a task that lands in it.

`POST /tasks` accepts optional `priority`/`reminderDate`/`reminderTime`/`repeatRule`/`repeatStart` for this; they were previously hardcoded to defaults.
