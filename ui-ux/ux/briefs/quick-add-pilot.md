# UX brief: Quick Add concept pilot

**Status:** READY FOR USER REVALIDATION
**Owner:** Product Design Agent
**Created:** 2026-08-24
**Reopened:** 2026-08-25
**Target decision date:** 2026-08-25
**Related request/issue:** `P2.2` in `../../UI_UX_AGENT_INTEGRATION_PLAN.md`

## User goal

Capture a task immediately, with optional organization available without forcing every user
through a full editor.

## Problem and evidence

The production flow is an always-visible combobox plus a compact add button. It supports
inline `#tag` suggestions and shows pending tags below the row, but priority, reminders,
recurrence, and details remain edit-dialog concerns. This is fast for plain capture and
consistent with the approved “capture first” principle. It has not yet been compared with a
command-driven model or a touch-first model for future web/mobile readiness.

Evidence sources:

- `../../../index.html`: `#message-input`, `#add-button`, tag suggestion listbox, and pending
  tag/template containers.
- `../../../src/renderer/tagInput.ts`: inline `#tag` grammar, Arrow/Enter/Escape behavior, and
  focus restoration.
- `../../../src/renderer/actions.ts`: task creation and return to the add field.
- `../principles.md`, `../responsive.md`, `../accessibility.md`, and `../content.md`.

## Scope

### In scope

- Three non-production Quick Add alternatives: compact/current-direction, command-style,
  and touch-first.
- Interactive add, optional metadata, keyboard behavior, empty input, empty list, save
  failure, long context, light/dark, and 1440/1024/768/390 rendering.
- Explicit benefits, trade-offs, complexity, and desktop/web/mobile implications.

### Out of scope

- Production renderer, API, database, dialogs, reminder delivery, and navigation changes.
- Choosing or approving a direction; P2.3 belongs to the user.
- Copying concept controllers or fixture shortcuts into a production plan.

## Current flow

1. Focus the always-visible add field.
2. Type a task; optionally type `#` to select or create tags.
3. Press Enter or activate Add.
4. The task appears and focus returns to the field.
5. Open Edit later for priority, dates, recurrence, or details.

## Required concept flow

1. The current list and task context remain visible.
2. The user enters a task without opening a dialog.
3. Optional organization remains skippable and visibly attached to the draft.
4. Enter and the pointer/touch Add action produce the same result.
5. Success clears the draft and returns focus; failure preserves the draft and names retry.

## States

| State | Trigger/data | Expected UI and behavior |
|---|---|---|
| Default/populated | `concept-populated-v1` | Current context, draft, optional metadata, and existing task preview are visible |
| Empty list | `concept-empty-v1` | Names the empty list and keeps Add immediately available |
| Empty input | Submit a blank draft | Does not add; identifies that a task name is required and keeps input focus |
| Saving success | Add from populated/empty state | Adds a local preview row, clears draft, announces success, and restores input focus |
| Save error | `concept-error-v1` or attempted add in error state | Preserves draft, announces “Could not save,” and offers retry through the same Add action |
| Long content | Long list/context label and task copy | Wraps without horizontal page overflow or type shrinking |

## Accessibility

- Keyboard: Tab/Shift+Tab reach every visible action; Enter submits; each alternative names
  its scoped Arrow/Escape behavior.
- Focus: success/error return to the draft field; Escape closes only the active suggestion,
  command palette, or touch metadata surface and returns to its trigger.
- Semantics: labelled inputs, named groups/surfaces, synchronized expanded state, status and
  alert announcements, and pressed/selected state where applicable.
- Visual: production focus ring/tokens, non-color state text, no horizontal overflow, and
  44px primary touch controls in the touch-first direction.
- Automated axe is required in both themes, followed by manual keyboard verification.

## Platform implications

| Platform | Shared behavior | Platform-specific capability or adaptation |
|---|---|---|
| Electron desktop | Immediate capture, Enter, visible list context, optional metadata | Compact density and shortcut hints can remain prominent |
| Web | Same task semantics and recovery behavior | No Electron/global shortcut assumptions; browser focus and viewport behavior apply |
| Mobile/touch | Same draft and task outcome | Visible 44px controls, no hover requirement, and metadata surface above the keyboard |

## Existing components and tokens to reuse

- Production CSS tokens, focus ring, tag chips, sidebar pill, and shortcut keycaps.
- P2.1 deterministic fixture catalog in `../concepts/fixtures.ts`.
- Existing Add/task/list/tag vocabulary.
- Production task context must use the same structural classes and visual mappings as
  `../../../src/renderer/tasks.ts` and `../../../styles.css`; invented substitutes for existing
  task presentation are not acceptable.

## Alternatives to explore

1. Compact/current-direction: preserve the single-row capture loop and progressively reveal
   optional metadata.
2. Command-style: use an in-field command palette for high keyboard throughput.
3. Touch-first: make metadata and Add actions explicit, large, and operable without hover.

## Acceptance criteria

- [x] Three separate interactive stories exist with stable IDs.
- [x] Every story includes benefits, trade-offs, complexity, keyboard, empty/error, and
  desktop/web/mobile implications.
- [x] Every story renders at 1440, 1024, 768, and 390px in light and dark without horizontal
  page overflow.
- [x] Add success, blank submit, and recoverable failure are deterministic and preserve the
  documented focus behavior.
- [x] Existing task rows use production `.tasks-list`, `.task-row`, circular priority checkbox,
  `.task-main`, reminder, tag-chip, expandable details, and double-chevron presentation with the
  same element order.
- [x] Expanded task details visibly use production Markdown rendering for headings, emphasis,
  inline code, lists, rules, and paragraphs.
- [x] Compact/current-direction reuses the production 34×34 circular Add control and plus SVG.
- [x] Every alternative starts from the production view bar, compose block, input row, suggestion,
  metadata, Add-control, and task styles; only explicitly proposed interaction surfaces diverge.
- [x] New concept CSS uses the P1.2 spacing scale.
- [x] No automation uses the real database or Electron user-data directory.
- [ ] User approval is recorded in a UX decision after corrected evidence and before production
  handoff.

## Revalidation status

The user initially selected Compact/current-direction, then reopened P2.2 on 2026-08-25 after
identifying that the concept task preview did not match production priority and task-element
presentation, subsequently found that Compact substituted an oval Add control for Adeo's circle,
then identified broader concept-only styling around the task view, followed by the omission of
production expandable-task details and visible Markdown treatment. The custom mock application
shell is removed; existing elements use production structure and classes, expanded/collapsed task
details demonstrate production Markdown, and Storybook-only controls are explicitly labelled
outside Adeo. The corrected stories pass the Chrome
revalidation recorded in
[`../reviews/p2-2-quick-add-pilot-review.md`](../reviews/p2-2-quick-add-pilot-review.md).
[`../decisions/0001-quick-add-direction.md`](../decisions/0001-quick-add-direction.md) remains
`PROPOSED` until the user reviews this corrected evidence and explicitly reconfirms, changes, or
rejects the direction.
