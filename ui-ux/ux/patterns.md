# Adeo interface patterns

This document describes current conventions to preserve during exploration. It is not a
request to freeze known problems or mechanically refactor production CSS.

## Design tokens

The current source is `../../styles.css` under `:root`, with dark values overridden
by `@media (prefers-color-scheme: dark)`.

| Category | Current tokens / behavior |
|---|---|
| Surfaces | `--bg`, `--surface`, sunken, hover, active, selected, query, danger |
| Borders | General/menu/control/chip tokens plus `--border-segmented` for a visible selected state |
| Text | Strong through ghost/disabled roles, chip ink, placeholder, on-accent |
| Status | Accent, focus, drop, danger, success, and priority-specific palettes |
| Typography | System sans and mono; 11, 12, 13, 14, 18, and 28px only |
| Radius | 4, 6, 8, 10, and 12px |
| Elevation | Card, menu, popover, modal, and scrim tokens |
| Tag color | Eight server-validated pastel data colors from `tagColor.ts` and `server/app.py` |

Dark mode is driven by Electron `nativeTheme` and `prefers-color-scheme`; do not add a
renderer theme class. Tag and priority chip ink intentionally stays dark on pastel fills.

### Known token gap

Spacing is hard-coded throughout `styles.css`; no spacing tokens exist. Until Phase P1.2
defines a scale, reuse the spacing of the nearest existing pattern and record exceptions.
Do not perform a wholesale spacing rewrite.

## Layout

- The app fills the Electron viewport and the document itself does not scroll.
- The sidebar and main task column are independent scrollers.
- The desktop grid is `288px minmax(0, 1fr)` with a 24px gap.
- Search and search mode live in the header; view context and actions live immediately
  above Quick Add.
- Settings is intentionally `720×560`; edit uses the established two-column modal.
- Do not change dialog chrome while the approved rollback remains the canonical plan.

## Selection and focus

- Use the single global `:focus-visible` ring (`--accent-focus`).
- Selected neutral controls use `--surface-selected`; accent is reserved for focus,
  confirmation/check marks, and other deliberate emphasis.
- Segmented controls add the `--border-segmented` inset ring because adjacent grey fills
  alone do not reach the required state contrast.
- Task rows and Settings tabs use roving `tabindex`: one tab stop enters the collection,
  arrows move within it.
- An overlay must trap focus, close with Escape, and return focus according to the owning
  flow. Hidden panels must not remain focusable.

## Component behavior

### Buttons and actions

- Icon-only buttons require an accessible name; decorative SVGs are `aria-hidden`.
- Existing compact dialogs use round cancel/check actions. Settings uses text actions.
- Destructive actions use the danger treatment and a native confirmation boundary.
- Hover styling is supplemental; the action must be visible and usable without hover.

### Chips and pills

- Tag chips use `paintTagChip`; never recreate tag colors in a story or component.
- With tag colors disabled, use `tag-plain`; omitting only the background produces bad
  dark-mode text and border colors.
- Sidebar pills expose selection with `aria-pressed` and keyboard activation.
- A reorderable item needs a non-drag alternative before it is considered touch-ready.

### Menus, comboboxes, and popovers

- Inputs that open suggestions maintain `aria-expanded`, `aria-controls`, and
  `aria-activedescendant` together via `syncComboboxAria`.
- Suggestions have a stable active item and support arrows, Enter, and Escape.
- Position floating UI with the shared viewport-aware helper where possible.
- Opening and closing must keep trigger state and visible state synchronized.

### Dialogs

- Use static markup for current production dialogs because `refs` is resolved at module
  import time.
- Every dialog needs `role="dialog"`, `aria-modal="true"`, and an accessible name.
- A dialog state includes closed, open/default, validation failure, saving where relevant,
  success/close, and dismissal.
- Nested repeat editing must close independently of the task editor beneath it.

### Date and recurrence

- Dates are stored as ISO values and displayed through `formatDate` using the user's
  explicit format preference.
- The custom date picker is Monday-first and must distinguish selected date, today, and
  adjacent-month dates.
- Native time/date controls can follow OS formatting; do not promise exact cross-platform
  visual parity for them.

### Motion

- Menus/popovers and overlays currently animate only when
  `prefers-reduced-motion: no-preference`.
- New motion must communicate state, remain brief, and have a reduced-motion outcome.

## Required state matrix

Every new or extracted UI element documents the applicable states:

| State | Evidence expected |
|---|---|
| Default and populated | Story or screenshot with realistic fixture data |
| Empty | Clear next action; no dead-end copy |
| Hover, focus, active, selected | Keyboard and pointer evidence where applicable |
| Disabled or unavailable | Reason is visible or discoverable |
| Invalid/error | Message identifies the problem and recovery action |
| Loading/saving | Prevents duplicate action without trapping focus |
| Long content | No clipped essential name or inaccessible action |
| Light/dark | Tokens preserve hierarchy and state visibility |
| Narrow viewport | No critical action depends on hover, drag, or horizontal page scroll |
