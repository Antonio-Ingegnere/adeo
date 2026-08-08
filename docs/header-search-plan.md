# Move Search into a Full-Width App Header

## Context

The search field lives in the 288px sidebar rail — far too narrow for advanced boolean queries (`list:"Foo list 1" AND due<=today AND NOT done:true` scrolls out of view immediately). Per user decision, search moves into a **new slim app header spanning the window above the sidebar+content grid** (macOS Reminders style), used by **both** simple and advanced modes; the sidebar loses its search box entirely. Everything shipped in commit 8247abe must keep working: ⟨/⟩ mode toggle, ✕ clear, live status line, help popover, autocomplete, Escape flows, localStorage mode persistence.

Key insight from design: all search elements are referenced only via `refs.*` (`byId`) in `dom.ts`/`querySearch.ts` — **moving the markup verbatim with IDs unchanged requires zero renderer TS changes**. The only TS change is a new Cmd/Ctrl+F "Find" accelerator.

## Design decisions

- **Uniform white bar** (48px, `border-bottom: 1px solid #e0e0e0`), first child of `.card` before `.content-grid`; not split at the 288px rail boundary (no column mirroring to keep in sync). `flex-shrink: 0` so `.content-grid`'s `flex: 1` fills the rest.
- **Full-bleed gotcha**: `.card` has 32px right padding only (left/top/bottom zeroed) — the header needs `margin-right: -32px` plus its own `padding: 0 16px` to reach the window edge.
- **Field left-aligned** (`flex: 0 1 560px; min-width: 180px`): the advanced-only status line sits to its right, so the field never shifts on mode toggle (no layout jump; centering would look lopsided).
- **Status line inline, right of the field** — header height constant in both modes. `.search-status-text` already has `flex:1` + ellipsis + title tooltip; the `?` button ends up pinned at the header's far right. `applyModeUI` already sets `display:flex` — no TS change.
- **Popovers**: `#query-suggest-menu` stays inside `.lists-search-field` (`position:relative`) — `positionDropdown` unchanged, opens downward near the window top. `#search-help-popover` gets a real anchor: make `.lists-search` `position:relative`, override the popover to `left:0; top:calc(100% + 6px); width:520px; max-width:calc(100vw - 48px)` (previously it accidentally anchored full-width to `.card`).
- **Keep `.lists-search*` class names** — renaming to `.header-search` is diff churn for zero benefit.
- **Cmd/Ctrl+F included** (~15 lines): compensates for search leaving the sidebar's prime position.

## Edits

**`index.html`**
1. Insert between `.card`'s opening and `.content-grid`:
   ```html
   <header class="app-header">
     <div class="lists-search"> …existing block moved verbatim… </div>
   </header>
   ```
   The moved block is the current `.lists-search` (~lines 15-55): field wrapper (`#lists-search-input`, `#search-mode-toggle`, `#lists-search-clear`, `#query-suggest-menu`), `#search-status`, `#search-help-popover` — all IDs byte-identical.
2. Delete the block from `.lists-rail` (the "Lists" panel simply moves to the top of the rail; its `padding: 16px 12px` already gives correct spacing).

**`styles.css`** (existing conventions: hardcoded hex, kebab-case)
1. New end section: `.app-header { display:flex; align-items:center; height:48px; padding:0 16px; margin-right:-32px; background:#fff; border-bottom:1px solid #e0e0e0; box-sizing:border-box; flex-shrink:0; min-width:0; }`
2. Edit in place:
   - `.lists-search` (≈47-50) → `position:relative; display:flex; align-items:center; gap:10px; flex:1; min-width:0;`
   - `.lists-search-field` (≈52-54) → add `flex: 0 1 560px; min-width: 180px;`
   - `.search-status` (appended section) → `margin-top:0; padding:0; flex:1; min-width:0;` (keep the rest)
   - `.search-help-popover` → `left:0; right:auto; top:calc(100% + 6px); margin-top:0; width:520px; max-width:calc(100vw - 48px); box-sizing:border-box;`
3. Untouched: input/toggle/clear internals, `.query-suggest-menu`, `.query-mode`, `.tag-suggest-menu` base.

**Cmd/Ctrl+F (only TS changes)**
- `src/main.ts` View submenu (near the Show-Completed item, pattern of `open-settings` at ~:727): `{ label: 'Find', accelerator: 'CmdOrCtrl+F', click: () => window.webContents.send('focus-search') }`.
- `src/preload.ts`: `onFocusSearch` cloned from `onOpenSettings`; `src/types.ts`: add to `ElectronAPI`.
- `src/renderer/querySearch.ts` end of `setupQuerySearch()`: `window.electronAPI.onFocusSearch?.(() => { input?.focus(); input?.select(); });`

Sequence: HTML move + CSS (self-contained, testable) → Cmd+F wiring → build + verify.

## Risks

- `margin-right:-32px` must not create a horizontal scrollbar (`.card` is `width:100vw`; header should land exactly at 100vw — verify visually).
- Help popover at fixed 520px: check the syntax table doesn't wrap awkwardly; bump to 560px if cramped.
- Re-verify help-popover click-away (screen position changed; event paths didn't).
- Cmd+F focuses the field even under an open modal — acceptable v1.

## Verification

1. `npm run build`.
2. Check the single-instance lock first (`pgrep -fl "Electron.*adeo"`) — the user's dev instance may hold it.
3. Isolated backend per project memory: manual `server/app.py` with scratch `ADEO_DB_PATH`, seed via curl, launch Electron via playwright-core (`npm i --no-save playwright-core`) with `ADEO_API_URL`.
4. Assert: simple search filters; toggle switches placeholder/monospace/status inline right of field; advanced query filters with ✓/⚠ status; autocomplete opens below the field inside the header (bounding-box check vs `#lists-search-input`); `?` popover opens at 520px under the field and closes on click-away; Escape closes suggest then clears; ✕ clears; mode persists across relaunch; **Cmd+F focuses the field**; sidebar starts with the "Lists" header, no leftover gap; no horizontal scrollbar.
5. Screenshots: header in simple mode, advanced with status, and a narrow (~700px) window.
