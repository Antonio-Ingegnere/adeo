# Add Tags to Adeo

## Context

Adeo currently organizes tasks only by Lists (one list per task). Tags add a second, orthogonal, many-to-many dimension (`#errands` on tasks across lists). Agreed UX (confirmed with user):

1. **Input**: tags picker in the edit-task modal **plus** inline `#tag` typing in the quick-add input with an autocomplete dropdown (select/Enter attaches the tag and strips the token from the text; unknown names create the tag).
2. **Filtering**: a "Tags" section in the sidebar below Lists — click to filter (click again / ✕ to clear), AND-combined with the current list selection; tag chips on task rows are clickable shortcuts to the same filter; sidebar shows per-tag counts of open tasks.
3. **Colors**: auto-assigned round-robin from a fixed 8-hue pastel palette at tag creation, stored on the tag.
4. **Management**: rename/delete via kebab menu on sidebar tag rows (like lists). Deleting a tag detaches it from tasks; tasks survive.

## Design decisions

- **Normalized data model**: new `tags` table + `task_tags` join. `Task` carries `tagIds: number[]`; renderer keeps `state.tags: Tag[]` as the single source for name/color (mirrors the existing `task.listId` + `state.lists` pattern). Rename = one row update + rerender.
- **`POST /tags` is get-or-create** (case-insensitive via `UNIQUE COLLATE NOCASE`) — both input flows need "name → id" and this removes duplicate races from the renderer.
- **Color assigned server-side**: `TAG_PALETTE[COUNT(*) % 8]` at insert.
- **Sidebar order**: alphabetical, no DnD (keep a `position` column for future parity).
- **Search mode**: the grouped search view (`renderTasks` tasks.ts:300-353) already ignores list filter/showCompleted; the tag filter stays inert during search too, and the filter chip hides.
- **No import cycles**: task-row chips dispatch a `filter-by-tag` CustomEvent handled in `index.ts` (same pattern as `open-edit-modal`); `renderTasks` dispatches `tasks-rendered` so `index.ts` can refresh sidebar counts.

## 1. Backend — `server/app.py`

- **Schema** in `initialize_db` (after the `lists` CREATE at :54-63) — `CREATE TABLE IF NOT EXISTS` is the existing migration idiom, existing DBs pick these up on next startup:
  ```sql
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS task_tags (
    task_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (task_id, tag_id)
  );
  ```
- **Palette constant** `TAG_PALETTE` (8 pastels, all readable with `#3a3a3a` text): `#F6C6C6 #F9D9B8 #F5EBAE #C9E8C1 #BEE3E8 #C5D4F5 #DCCDF0 #F3CFE3`.
- **Models** (near `ListName` :150): `TagCreate{name}`, `TagName{name}`, `TaskTags{tagIds: List[int]}`; extend `TaskCreate` (:103) with `tagIds: Optional[List[int]] = None`. Helper `normalize_tag_name`: strip, drop one leading `#`, strip; 400 if empty.
- **Endpoints** (model on the `/lists` block :375-424):
  - `POST /tags` — get-or-create by name (NOCASE); on create, color/position from tag count.
  - `GET /tags` — `ORDER BY name COLLATE NOCASE ASC, id ASC`.
  - `PATCH /tags/{id}/name` — catch `sqlite3.IntegrityError` → 400 "Tag name already exists".
  - `DELETE /tags/{id}` — delete `task_tags` rows then the tag (detach semantics).
  - `PUT /tasks/{id}/tags` — full replace: delete join rows, `INSERT OR IGNORE` new ones (validate ids exist in `tags`).
- **Task read/write paths**:
  - `row_to_task` (:154-168): new param `tag_ids=None`, emit `"tagIds": tag_ids or []`.
  - `GET /tasks` (:210-223): one extra query over `task_tags` → build `task_id → [tag_id]` map, pass into `row_to_task`. No N+1.
  - `POST /tasks` (:176-207): insert join rows for `payload.tagIds` (existence-checked); add `tagIds` to the **manually built** response dict (easy to miss — it doesn't use `row_to_task`).
- **Recurrence carry-forward** in `PATCH /tasks/{id}/done` (:226-281): after the next-occurrence INSERT (:255-275), copy tags:
  `INSERT INTO task_tags (task_id, tag_id) SELECT ?, tag_id FROM task_tags WHERE task_id = ?` with `(cursor.lastrowid, row["id"])`.
- **Orphan cleanup** in `DELETE /lists/{id}` (:415-424): before deleting tasks, `DELETE FROM task_tags WHERE task_id IN (SELECT id FROM tasks WHERE list_id = ?)`.

## 2. IPC plumbing

- **`src/types.ts`**: add `export type Tag = { id: number; name: string; color: string; position: number }`; add `tagIds?: number[]` to `Task` (:1-14); in `ElectronAPI` extend `addTask(text, listId?, tagIds?)` and add `addTag`, `getTags`, `updateTagName`, `deleteTag`, `setTaskTags`, `confirmDeleteTag`.
- **`src/preload.ts`**: one-liner bridges next to the list ones (:38-45) — channels `add-tag`, `get-tags`, `update-tag-name`, `delete-tag`, `set-task-tags`, `confirm-delete-tag`; forward `tagIds` in `addTask`. `satisfies ElectronAPI` enforces completeness.
- **`src/main.ts`**: five `apiRequest` proxies next to the list handlers (:830-865); extend `add-task` (:761-770) body with `tagIds`. Add `ipcMain.handle('confirm-delete-tag')` using `dialog.showMessageBox` (Cancel/Delete).
- **Bug fix (verified real)**: `confirm-delete-list` is invoked by preload.ts:45 but has **no handler in main.ts** — list deletion dies on an unhandled invoke today. Register it with the same dialog code while adding `confirm-delete-tag`.

## 3. Renderer state & loading

- **`src/renderer/state.ts`** — new `UIState` fields: `tags: Tag[]`, `selectedTagId: number | null`, `modalTagIds: number[]`, `openTagMenuId: number | null`, `editingTagId: number | null`, `pendingTagIds: number[]` (quick-add tags awaiting submit). Autocomplete transients stay module-local in `tagInput.ts`.
- **Normalization back-fill in BOTH duplicated spots** — `refreshTasksFromApi` (tasks.ts:71-103) and `loadTasks` (actions.ts:28-56): `if (!Array.isArray(t.tagIds)) t.tagIds = []` (missing one → `undefined.includes` crash in the filter). Optionally extract a shared `normalizeTask` into helpers.ts to end the duplication.
- **`loadTags()`** in actions.ts (mirror `loadLists` :70-84); call it in `init()` (index.ts ~:1021) **before** `loadTasks` so first-paint chips can resolve names.

## 4. Filtering

- `getVisibleTasks` (tasks.ts:13-19): add `if (state.selectedTagId !== null) base = base.filter(t => (t.tagIds ?? []).includes(state.selectedTagId))`.
- **Filter indicator**: wrap the tasks title (index.html:71) in `.tasks-title-row` with a hidden `#tag-filter-chip` button; `updateTasksTitle` (tasks.ts:21-33) shows it (`#name ✕`, tag color background) when a tag filter is active and not searching. Click clears `selectedTagId` → `updateTasksTitle(); renderTags(); renderTasks();`.
- **On tag delete**: clear `selectedTagId` if it matches; strip the id from every `task.tagIds`, `modalTagIds`, `pendingTagIds`; rerender all.

## 5. Sidebar Tags section

- **index.html**: `.tags-panel` after `.lists-panel` (closes ~line 51) inside `.lists-rail`, reusing `.lists-header`/`.lists-title`/`.lists-list` classes; `#tags-list` container. No + button (tags are born from the pickers).
- **New file `src/renderer/tags.ts`** exporting `renderTags()` (mirror `renderLists` lists.ts:96-324, minus DnD and "All" pill). Per tag row (`.list-pill.tag-pill`): color `.tag-dot`, name, `.tag-count` (open tasks only), kebab reusing `.list-menu-btn`/`.list-menu` classes driven by `state.openTagMenuId`.
  - Row click toggles `selectedTagId` → `updateTasksTitle(); renderTags(); renderTasks();`. Selected style comes free from `.list-pill.selected`.
  - **Rename**: kebab dispatches `open-edit-tag-modal`; small `#tag-overlay` modal cloned from `#list-overlay` markup (index.html:178-192), wired in index.ts; on save mutate `state.tags`, re-sort, rerender (chips update automatically since they render from `state.tags`).
  - **Delete**: `confirmDeleteTag(name)` → `deleteTag(id)` → §4 cleanup.
- **Counts stay fresh**: `renderTasks` dispatches `tasks-rendered`; index.ts listens and calls `renderTags()`. Extend the global click-away handler (index.ts:981-1001) to close the tag kebab.

## 6. Task-row chips — `buildTaskRow` (tasks.ts)

Insert after the reminder/repeat block (after :245): if `task.tagIds?.length`, append a `.task-tags` flex-wrap row of `.task-tag-chip` buttons (`#name`, background = tag color, skip unknown ids). Chip click: `preventDefault` + `stopPropagation` (must NOT open the edit modal) + dispatch `filter-by-tag {tagId}`. index.ts handler (next to `open-edit-modal` :957) sets `selectedTagId` and rerenders. Overflow: wrap, no `+N` cap initially.

## 7. Edit-modal picker

- **index.html**: "Tags" section in `.modal-right-content` after the Repeat block (~:162) — `#tags-picker` trigger button + `#tags-menu` popover containing `#tags-menu-list` (checklist) and `#tags-menu-new` inline "New tag…" input. Refs added to dom.ts next to the priority cluster (:30-33).
- **modals.ts**: `renderTagsMenu()` — checklist of `state.tags` with ✓ for members of `state.modalTagIds`; clicking toggles membership, **menu stays open** (multi-select, unlike the single-select list menu). `updateTagsUI()` label: "None" | one name | `"first +N"`. `openEditModal` (:102-145) copies `task.tagIds` → `modalTagIds`; `closeEditModal` resets; `saveEdit` (:186-237) adds `setTaskTags(...)` to the `Promise.all` (:200-208), checks its `{error}`, and sets `state.tasks[idx].tagIds` in the in-place mutation block.
- **index.ts**: popover wiring mirrors priority (:450-465) with `positionDropdown`; Enter in the new-tag input → `addTag` (get-or-create) → merge into `state.tags`, add to `modalTagIds`, rerender menu/label/sidebar. Add menu to the global click-away closer.

## 8. Quick-add inline `#tag` — new file `src/renderer/tagInput.ts`

- **index.html**: wrap `#message-input` (:56) in `.add-task-input-wrap { position:relative }` with a `#tag-suggest-menu` dropdown; add `#add-task-tags` pending-chips strip under `.input-row`. Move `positionDropdown` (index.ts:330-361) to helpers.ts and export (update the repeat-menu call site :551).
- **Tokenizer**: `/(^|\s)#([A-Za-z0-9_-]*)$/` against `value.slice(0, selectionStart)` — caret-inside-token detection; punctuation ends a token.
- **Dropdown**: on input/keyup/click, show prefix-then-contains matches from `state.tags` (max ~6) plus a `Create "#query"` row when no exact match; `#` alone lists all tags with no create row. Keyboard: ArrowUp/Down, Enter/Tab selects (`preventDefault` on **keydown** so the keypress `addTask` listener at index.ts:367-371 never fires; also export `isTagSuggestOpen()` and early-return in that keypress handler as a guard), Escape closes dropdown only (`stopPropagation` vs. the global Escape handler :971-979).
- **On select**: create if needed (`addTag`), push id into `state.pendingTagIds`, splice the `#token` out of the input (restore caret), render pending chip (`#name`, color, ✕ to remove), close dropdown.
- **Submit** (`addTask` in actions.ts:7-26, rewritten): global pass `/(^|\s)#([A-Za-z0-9_-]+)/g` resolves tokens typed without the dropdown (get-or-create makes this safe), strips them, collapses whitespace; `tagIds = dedupe(pending + resolved)`; if the remaining text is empty, abort; single `addTask(text, listId, tagIds)` call (no second round-trip/flicker); on success clear input + pending chips, rerender tasks/tags. Bare `#` stays in the text untouched.

## 9. CSS — `styles.css`

Chip text `#3a3a3a` on pastel backgrounds; borders/hovers reuse existing greys (`#d6d6d6`, `#f0f0f0`). New classes: `.tags-panel`, `.tag-pill`/`.tag-dot`/`.tag-count` (count hides on hover so the kebab can swap in, like list rows), `.task-tags`/`.task-tag-chip` (10px text, radius 9, brightness hover), `.tasks-title-row`/`.tag-filter-chip`, `.tag-suggest-menu`/`.tag-suggest-item(.active)` (clone the `.add-task-list-menu` popover recipe :1015-1032), `.add-task-tags`/`.add-task-tag-chip`, `.tags-menu`/`.tags-menu-item`/`.tags-menu-check`/`.tags-menu-new-input`.

## Implementation order

1. Backend (testable standalone: `npm run api` + curl)
2. types.ts → preload.ts → main.ts (incl. `confirm-delete-tag` + missing `confirm-delete-list` fix)
3. State fields, normalization back-fills (both spots), `loadTags`, init ordering
4. Filtering + title chip + task-row chips + `filter-by-tag`/`tasks-rendered` events
5. Sidebar panel + tags.ts + rename/delete flows
6. Edit-modal picker
7. Quick-add tokenizer/autocomplete + `addTask` rewrite
8. CSS alongside each UI step; `npm run build` to typecheck

## Verification

`npm run start` (note: **no uvicorn hot reload** — restart after every app.py change). Test migration against a copy of a real DB via `ADEO_DB_PATH`.

1. **Migration**: existing DB starts clean; `.tables` shows `tags`, `task_tags`; existing tasks render unchanged.
2. **Quick-add**: `Buy milk #err` → dropdown → create → pending chip, token stripped; submit → row chip + sidebar `err (1)`. Also: token submitted without touching the dropdown; `#` alone; `#ERR` reuses `err` case-insensitively; task that is only a tag is refused.
3. **Modal**: toggle tags, create inline, Save → chips/counts update; reopen to confirm persistence.
4. **Filtering**: sidebar click filters + title chip shows; AND with list selection; row-chip click filters without opening the modal; ✕ / re-click clears; search mode ignores tag filter and hides the chip.
5. **Rename/delete**: rename propagates everywhere; duplicate name rejected; delete detaches (tasks survive) and clears an active filter. Regression-check list deletion (the fixed handler).
6. **Recurrence**: complete a repeating tagged task → next occurrence carries the tag.
7. **Restart**: tags/assignments/colors persist; palette round-robin continues.

## Risks

- The duplicated task normalization (actions.ts vs tasks.ts) must gain the back-fill in **both** places or filtering crashes.
- Enter-key collision between suggest dropdown (keydown) and addTask (keypress) — handled by preventDefault + explicit guard.
- `apiRequest` returns `{error}` objects rather than throwing — all new renderer calls must check like existing code does.
- Inline token charset is `[A-Za-z0-9_-]`; the modal's new-tag input accepts any non-empty name (spaces allowed) — such tags just can't be typed inline. Acceptable.
