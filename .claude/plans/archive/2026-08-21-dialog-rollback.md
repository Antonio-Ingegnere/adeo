# Revert the dialog rework

## Context

An uncommitted change in the working tree — "Step 1 — The dialog foundation", from the
plan this file previously held — rewrote the chrome of every `.overlay` dialog. The user
rejects the result outright: the round ✕ / ✓ icon buttons were replaced with text
`Cancel` / `Save`, the dialogs were re-sized, and the edit modal's two-tone highlight
was deleted.

None of it is committed, so the rollback is a clean discard back to `HEAD` (`99dab6e`).
Decision, confirmed with the user: **full revert to HEAD**, with the icon buttons
called out explicitly as the thing that must come back.

This plan replaces the dialog-foundation plan that used to live here. That plan is
withdrawn: its Step 1 is what is being reverted, and Steps 2–7 are not to be started.

## What the change did (all of it goes)

| Area | Files | What is being undone |
|---|---|---|
| Action rows | `index.html` | Text `Cancel`/`Save` buttons → back to `.btn.icon-btn` (✕ and the check `<svg class="icon-check">`) in the edit, add-list, smart-list, tag, repeat and shortcuts dialogs. Settings keeps its text buttons — it already had them at `HEAD` and was not changed. |
| Geometry | `styles.css` | `.dialog-sm` / `.dialog-md` / `.dialog-lg` → back to `.modal` (`80vw × 80vh`, max `860×900`), `.modal-small` (380px), `.modal-settings` (720×560), `.modal-shortcuts` (520px). |
| Highlighting | `styles.css:2151`, `:3352` | Restores `.modal-content .modal-actions`'s `linear-gradient(… calc(100% - 224px) …)` in both light and dark — the right rail's sunken column carried down through the button row. |
| Labels | `styles.css`, `index.html` | Restores `.modal-label { … width: 11% }` and every `settings-field-label` back to `modal-label` outside Settings, which is what kept the repeat dialog's inline rows aligned. |
| Structure | `index.html`, `styles.css` | Removes `.dialog-header` / `.dialog-body` / `.dialog-actions`; restores `.modal h2`, `.modal-actions`, `.modal-details { margin-bottom: -63px }` and the `<hr class="modal-list-divider">`. |
| Plumbing | `src/renderer/dialog.ts` (new, untracked) | Deleted. Its `openDialog`/`closeDialog`, the open-order stack and the shared backdrop handler all go with it. |

The plumbing is worth one note for the record, since it is the only part that was
not purely cosmetic: it added focus-restore-on-close and backdrop-click-to-close.
It also introduced a regression — the shared backdrop handler called `closeDialog()`
alone, bypassing `closeEditModal` / `closeSmartListModal` / `closeTagModal`, so a
backdrop click left `state.editingSmartListId` / `editingTagId` and the modal inputs
uncleared. Reverting removes both the feature and the regression together. Nothing
here needs to be preserved.

## Steps

1. **Discard the tracked edits** — restore from `HEAD`:
   - `index.html`
   - `styles.css`
   - `src/renderer/index.ts`
   - `src/renderer/modals.ts`
   - `src/renderer/focusTrap.ts`
   - `src/renderer/shortcutsHelp.ts`

   Scope the checkout to exactly these six paths. **Do not touch
   `.claude/agents/git.md`**, which is also modified in the tree but is unrelated
   tooling work.

2. **Delete the new module and its build output**: `src/renderer/dialog.ts` and the
   stale `dist/renderer/dialog.js` (+ `.js.map` if present). The revert removes every
   import of it, so leaving the compiled file behind would be dead weight, not a break.

3. **Rebuild** so `dist/` matches the reverted sources: `npm run build`.

## Verification

```
npm run build
node scripts/query-selftest.mjs      # expect 103/103
node scripts/shortcuts-selftest.mjs  # expect 132/132
git status --short                   # expect only .claude/agents/git.md and .claude/plans/ left
git diff --stat                      # expect .claude/agents/git.md alone
```

Neither selftest touches the DOM or CSS, so they only prove the revert left the pure
modules compiling. The visual check is by eye, in the running app (`npm run start`):

1. Open the edit modal from a task — 80vw × 80vh again, round ✕ and ✓ buttons,
   the sunken right-rail colour continuing through the button row.
2. Open Add list, Edit tag, Save smart list, Custom repeat, Keyboard shortcuts —
   icon buttons in every action row; the repeat dialog's `Start` / `Repeat` / `Every` /
   `End` labels aligned in their column again.
3. Open Settings — unchanged in every respect, including its text `Cancel` / `Save`.
4. Escape still closes the topmost dialog, and the repeat modal opened on top of the
   edit modal still closes alone.

⚠️ Per `CLAUDE.md` and prior experience: if the app is driven with `playwright-core`,
`ADEO_DB_PATH` is ignored by the spawned API and writes hit the real development
database. Back it up first, or check by hand.

## Open Questions

None.

## Implementation Status

APPROVED
