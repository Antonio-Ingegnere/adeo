# Task Search: Simple + Advanced Query Mode

## Context

Adeo's search today is a single case-insensitive substring test over `text`+`details` (the branch at `src/renderer/tasks.ts:351-357`), with no way to search by list, tag, priority, dates, done state, or combinations. This change keeps that simple mode untouched and adds an **advanced query mode** — a small JQL-inspired language (never called JQL) with `field:value` terms, `~` contains, `!=`, date comparisons, `AND OR NOT`, and parentheses — behind a mode toggle on the existing sidebar search field, with live parse status and context-aware autocomplete. No saved filters in this iteration. All filtering stays client-side; no backend changes.

Confirmed UX decisions: full boolean mini-language · toggle on the search field · full autocomplete · no saved filters.

## Architecture

Two new renderer modules plus surgical edits:

- **`src/renderer/query.ts`** (new) — pure engine: tokenizer → recursive-descent parser → AST → compiled predicate `(task, ctx) => boolean`. MUST NOT import dom/state/browser APIs; lists/tags/today are passed via an `EvalContext { listNameById, tagNameById, todayISO }`. This purity makes it testable from a plain node script.
- **`src/renderer/querySearch.ts`** (new) — mode toggle, status line, help popover, autocomplete.
- Edits: `state.ts`, `tasks.ts` (predicate swap), `index.ts` (`applySearchQuery` rewrite + click-away), `index.html`, `dom.ts`, `styles.css`.

## 1. Query language

Grammar (precedence NOT > AND > OR; parens group; **implicit AND** between adjacent terms so any simple-mode text is a valid query):

```
query   := orExpr EOF
orExpr  := andExpr ( OR andExpr )*
andExpr := notExpr ( AND? notExpr )*
notExpr := NOT notExpr | primary
primary := '(' orExpr ')' | term
term    := FIELD op value | bareWord          # bareWord = ci substring over text+details
op      := ':' | '~' | '!=' | '<' | '<=' | '>' | '>='
```

- Keywords `AND OR NOT` case-insensitive, only unquoted. Double-quoted strings for values with spaces/symbols (no escapes in v1; unclosed quote = error). Values and field names case-insensitive. A word equal to a field name but not followed by an operator is a bareWord. Sugar: bare `#foo` desugars to `tag:foo` (matches the app's tag idiom).
- Tokenizer emits `{kind, text, start, end}` (LPAREN/RPAREN/OP/WORD/QUOTED/EOF); longest-match ops (`!=`, `<=`, `>=` first). Names containing `: < > ( ) "` must be quoted — autocomplete auto-quotes.

**Field catalog** (exported `FIELDS` table, also drives autocomplete; op validity enforced at parse time with targeted messages like `~ is not valid for priority (use : or !=)`):

| Field | Type | Ops | Semantics |
|---|---|---|---|
| `text`, `details` | string | `: ~ !=` | `:` exact (ci), `~` contains, `!=` not-exact |
| `list` | name | `: ~ !=` | name match via listId; `list:none` = no list; quoted = always literal |
| `tag` | name | `: ~ !=` | any-of over tagIds by name; `tag:none` / `tag:any`; multiple `tag:` terms AND naturally |
| `priority` | enum none/low/medium/high | `: !=` | bad value → parse error listing allowed |
| `done` | bool true/false | `: !=` | |
| `due` | date | `: != < <= > >=` | operates on `reminderDate` (ISO strings compare lexically); values: ISO date, `today`/`tomorrow`/`yesterday` (from `ctx.todayISO`), `none`/`any` (only with `:`/`!=`); null reminderDate never matches comparisons |
| `repeat` | enum none/any/daily/weekly/monthly/yearly | `: !=` | FREQ from RRULE — import `splitRrule` from `./repeat.js` (pure) or reimplement the 3-line FREQ extraction |

**Deferred**: `created` field (created_at is in the DB but not exposed through `get_tasks`/`row_to_task`/types — cross-stack change; the catalog is a table, add later), relative date arithmetic (`7d`), quote escapes, saved filters.

**API**: `parseQuery(input): {ok:true, ast} | {ok:false, error:{message, position}}`; `compilePredicate(ast)`. Whitespace-only input → match-all sentinel (treated as "not searching"). **Unknown list/tag names are NOT parse errors** — they compile to match-nothing (values are data-dependent; renames shouldn't break queries). The compiled predicate never throws.

**Self-test**: new `scripts/query-selftest.mjs` (manual node script; imports from `dist/renderer/query.js` after `npm run build`): ~15 fixture tasks, fixed todayISO, table of `[query, expectedIds]` + `[badQuery, errorSubstring]` cases; covers precedence, parens, NOT, implicit AND, quoting, every field/op, date comparisons, none/any, error cases. Exits non-zero on failure.

## 2. State & plumbing — `src/renderer/state.ts`

New `UIState` fields: `searchMode: 'simple'|'advanced'` (init from `localStorage['adeo.searchMode']`, try/catch-wrapped), `queryPredicate: CompiledPredicate | null` (last VALID non-empty query), `queryError: {message, position} | null`.

`applySearchQuery` in `index.ts` (:561-595) becomes mode-aware: in advanced mode it parses **instantly** (status line updates every keystroke), keeps the previous predicate on error (last-good), and **debounces only the re-render ~150 ms**; simple mode stays instant and byte-for-byte unchanged. Escape/clear/mode-toggle flush the pending debounce and render immediately.

## 3. renderTasks integration — `src/renderer/tasks.ts`

- Extract/export `isSearching()`: advanced → `query non-empty && queryPredicate !== null`; simple → `searchQuery non-empty`. Use it in both `renderTasksInner` (:346) and `updateTasksTitle` (:36-50, controls the "Search results" title + tag-chip hiding).
- In the search branch replace the inline filter (:353-357): simple mode keeps the existing substring closure verbatim; advanced mode builds an `EvalContext` once (maps from `state.lists`/`state.tags`, local todayISO) and filters with `state.queryPredicate`. Grouped-by-list rendering below stays shared and untouched; sidebar filters stay ignored during search.
- **Invalid query → keep last-good results** with ⚠ status (live typing passes through invalid states constantly; flashing to empty is unusable). If never-valid this session, render the normal non-search view.
- Empty state: capture `refs.emptyState`'s default text at module scope; show "No tasks match your search" when searching, restore default otherwise.

## 4. UI

**Markup** (`index.html` :15-24, inside `.lists-search`): a `#search-mode-toggle` button (‹/› icon, `aria-pressed`) inside `.lists-search-field` next to the clear ✕; a `#search-status` line under the field (`#search-status-text` + `#search-help-btn` "?"); `#search-help-popover` (static cheat sheet: fields/ops table, keywords, quoting rule, 4 examples); `#query-suggest-menu` inside `.lists-search-field` (it's already `position:relative`, so `positionDropdown` works unmodified). New refs in `dom.ts` for all six.

**`querySearch.ts` — `setupQuerySearch()`** (called from `setupEvents()`):
- Toggle click: flip mode, persist, `applyModeUI()` — `query-mode` class on the input (monospace 12px, subtle `#fbfbf7` tint), placeholder `Search` vs `Query… e.g. list:Home AND due<=today`, status line visibility, re-parse current text, re-render. **Text is kept in both toggle directions** (simple→advanced parses as bare words; advanced→simple becomes a literal substring — visible text explains any no-match).
- `renderSearchStatus()`: empty → dim hint; valid → `✓ Valid query`; invalid → `⚠ message` (ellipsis-truncated, full text + column in `title`).
- Help popover toggle with stopPropagation; closed by the global click-away.

**Autocomplete** (advanced mode only): built inside `querySearch.ts` as a parallel implementation — do NOT extract from `tagInput.ts` (it's coupled to `#`-tokens, tag creation, `state.pendingTagIds`; extraction risks regressing a shipped feature for one reuse). Copy its interaction pattern (mousedown-before-blur, 100 ms blur close, ArrowUp/Down wrap + Enter/Tab select + Escape close, prefix-then-contains ranking) and reuse the `.tag-suggest-menu`/`.tag-suggest-item` CSS + `positionDropdown`. Context detection via the query.ts tokenizer + caret position:
1. **Term start** (input start, after `(`/`AND`/`OR`/`NOT`/completed term) → field names, boolean keywords, `(`.
2. **After a known field** → its valid operators with hint labels (`~ contains`, `: is`, `<= on or before`; `~` listed first for string fields).
3. **After field+op** → values: list names + `none`; tag names (with color dot) + `none`/`any`; priority levels; true/false; repeat kinds; for `due` — `today`/`tomorrow`/`yesterday`/today's ISO (+`none`/`any` for `:`/`!=`). Cap 8. Insertion replaces `[tokenStart, tokenEnd)`, auto-quotes values containing anything outside `[A-Za-z0-9_#-]`, appends a trailing space, restores caret, re-runs `applySearchQuery`.
4. Mid-bareword / inside quotes → menu closed (don't nag plain text).

**Keydown coexistence**: the existing search-input Escape handler (index.ts:575-583) gets an `if (isQuerySuggestOpen()) return;` guard (export the flag from querySearch.ts) — Escape closes the dropdown first, second Escape clears. Add `querySuggestMenu` + `searchHelpPopover` to the global click-away closer (index.ts:1040-1070).

## 5. CSS — `styles.css` (`search-`/`query-` prefixes, existing hex-gray look)

`.lists-search-input` padding-right → 52px (two buttons). `.search-mode-toggle` absolute right:28px, ghost style cloned from `.lists-search-clear` (:71-89), `.active` state (`#444` on `#ececec`). `.lists-search-input.query-mode` monospace. `.search-status` flex 11px line with `.ok #3d8b3d` / `.err #b00020` / neutral `#888`, ellipsis text. `.search-help-btn` 16px circle; `.search-help-popover` styled like `.tag-suggest-menu`. `.query-suggest-menu` = overrides on `.tag-suggest-menu` (min-width 220px, dim `.query-suggest-hint` span). Long queries horizontally scroll in the input — acceptable v1.

## Implementation order

1. `query.ts` engine + `scripts/query-selftest.mjs`; iterate `npm run build && node scripts/query-selftest.mjs` until green.
2. State fields; index.html markup; dom.ts refs; CSS; `querySearch.ts` toggle/status/localStorage (no autocomplete); `applySearchQuery` rewrite + debounce; wire `setupQuerySearch()`.
3. tasks.ts: `isSearching()`, predicate swap, title, empty-state text.
4. Autocomplete + click-away additions.
5. Help popover content + aria polish.

## Verification

`npm run build` (Electron loads from dist). Run isolated (the dev instance may hold the single-instance lock — don't reuse it):

```
ADEO_DB_PATH=<scratch>/verify.db .venv/bin/python server/app.py   # API on :8000
ADEO_API_URL=http://127.0.0.1:8000 npx electron .                 # or drive via playwright-core per project memory
```

Seed via curl: 2 lists (incl. "Foo list 1" with a space), 3 tags, ~10 tasks covering done/priorities/reminderDate yesterday-today-tomorrow/FREQ=WEEKLY repeat/tagged/untagged/unlisted (use PATCH endpoints for priority/reminder/repeat/done).

- **Simple mode regression**: substring over text+details, grouped headers, Escape/✕, title, tag-chip hiding — unchanged.
- **Toggle**: styling/placeholder/status; text preserved both ways; mode survives restart (localStorage).
- **Query matrix**: `milk` · `buy milk` · `list:Home` · `list:"Foo list 1"` · `list:none` · `tag:a tag:b` · `tag:none` · `priority:high OR priority:medium` · `done:false AND due<=today` · `due:none` · `due>2026-08-01` · `repeat:weekly` · `NOT (list:Home OR done:true)` · `text~milk` · `#tagname` · `tag:nosuch` (valid, matches nothing).
- **Errors**: `due:` · `priority~high` · `"unclosed` · `(a OR` · `foo:bar` — right message each, last-good results retained, recovery on fix.
- **Autocomplete**: fields at start; ops after `due`; values per field; auto-quoting "Foo list 1"; arrow-wrap/Enter/Tab/Escape; mouse select; absent in simple mode.
- **Regressions**: add-box `#tag` autocomplete intact; sidebar tag counts still update (`tasks-rendered`, may lag 150 ms in advanced — acceptable); modal Escape handlers unaffected.

## Risks

- Two keydown listeners on the search input — resolved with the explicit `isQuerySuggestOpen()` guard, not listener order.
- `text:milk` (exact) may surprise users expecting contains — decided: keep `:` exact / `~` contains for cross-field consistency; bare words already give contains; autocomplete lists `~` first and the cheat sheet documents it.
- `refs.emptyState` text mutation must restore the default when search clears.
- Debounced render delays `tasks-rendered` listeners by 150 ms in advanced mode — verify no visual oddity in sidebar counts.
