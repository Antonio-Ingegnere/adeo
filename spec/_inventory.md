# Storybook inventory

Last reviewed: 2026-08-29

This inventory follows the story globs in `.storybook/main.ts`. Storybook is
the visual source of truth; linked component code and fixtures supply only
observable behavior and deterministic example data.

## Foundations — Design system smoke

- [FACT] Storybook reference: `Foundations/Design system smoke / Tokens`
  (`foundations-design-system-smoke--tokens`) in
  `ui-ux/ux/stories/design-system-smoke.stories.ts`.
- [FACT] Available states: light or dark global theme and the configured
  desktop/tablet/mobile viewport presets
  (`.storybook/preview.ts`, `design-system-smoke.stories.ts:Tokens`).
- [FACT] Visible content: production surface tokens, type scale, status and
  priority samples, spacing, and radius samples
  (`design-system-smoke.stories.ts:Tokens`).
- [FACT] Major visible interactions: switch the Storybook theme and viewport;
  the story content itself is display-only (`design-system-smoke.stories.ts`).
- [FACT] Dedicated UI spec: none. This is a rendering foundation check rather
  than a user-facing screen or component.

## Components — Combobox suggestion item

- [FACT] Storybook reference: `Components/Combobox suggestion item / States`
  (`components-combobox-suggestion-item--states`) in
  `ui-ux/ux/stories/combobox-suggestion-item.stories.ts`.
- [FACT] Available states: normal tag suggestion, active query suggestion,
  disabled tag suggestion, and long query suggestion with metadata hint
  (`combobox-suggestion-item.stories.ts:States`).
- [FACT] Major visible interactions: selectable items update a status output;
  disabled items cannot activate
  (`combobox-suggestion-item.stories.ts:States`,
  `src/renderer/uiElements.ts:createComboboxSuggestionItem`).
- [FACT] Dedicated UI spec: `spec/ui/combobox-suggestion-item.md`.

## Components — Date picker

- [FACT] Storybook reference: `Components/Date picker / States`
  (`components-date-picker--states`) in
  `ui-ux/ux/stories/date-picker.stories.ts`.
- [FACT] Available states: closed and empty, boundary values `2000-01-01` and
  `2099-12-31`, and open at the 2025/2026 year boundary
  (`date-picker.stories.ts:States`).
- [FACT] Major visible interactions: open/close, previous/next month, select a
  day, choose Today, Clear, dismiss outside or with Escape, and keyboard date
  navigation (`date-picker.stories.ts:States`,
  `src/renderer/datepicker.ts:attachDatePicker`).
- [FACT] Dedicated UI spec: `spec/ui/date-picker.md`.

## Components — Shortcut keycap

- [FACT] Storybook reference: `Components/Shortcut keycap / States`
  (`components-shortcut-keycap--states`) in
  `ui-ux/ux/stories/shortcut-keycap.stories.ts`.
- [FACT] Available states: standard chord, multi-key chord, single key, and
  long key label (`shortcut-keycap.stories.ts:States`).
- [FACT] Major visible interactions: none; the component renders supplied
  display tokens (`src/renderer/uiElements.ts:createShortcutKeycaps`).
- [FACT] Dedicated UI spec: `spec/ui/shortcut-keycap.md`.

## Components — Sidebar pill

- [FACT] Storybook reference: `Components/Sidebar pill / States`
  (`components-sidebar-pill--states`) in
  `ui-ux/ux/stories/sidebar-pill.stories.ts`.
- [FACT] Available states: unselected with count, selected with keyboard focus,
  and truncated long label with full accessible text and count
  (`sidebar-pill.stories.ts:States`,
  `src/renderer/uiElements.ts:createSidebarPill`).
- [FACT] Major visible interactions: pointer activation and Enter/Space
  activation; drag ordering is explicitly outside this component story
  (`sidebar-pill.stories.ts:States`, `uiElements.ts:createSidebarPill`).
- [FACT] Dedicated UI spec: `spec/ui/sidebar-pill.md`.

## Components — Tag chip and dot

- [FACT] Storybook reference: `Components/Tag chip and dot / States`
  (`components-tag-chip-and-dot--states`) in
  `ui-ux/ux/stories/tag-chip-dot.stories.ts`.
- [FACT] Available states: normal interactive chip, colors disabled, disabled
  chip, long text, and four palette-dot samples
  (`tag-chip-dot.stories.ts:States`).
- [FACT] Major visible interactions: an enabled chip may invoke an activation
  callback; disabled chips cannot activate; a dot is omitted when colors are
  disabled (`tag-chip-dot.stories.ts:States`,
  `src/renderer/uiElements.ts:createTagChip`, `createTagDot`).
- [FACT] Dedicated UI spec: `spec/ui/tag-chip-and-dot.md`.

## Concepts — Fixture catalog and app shell

- [FACT] Storybook references: `Concepts/Fixture catalog / Deterministic
  States` (`concepts-fixture-catalog--deterministic-states`) and `App Shell`
  (`concepts-fixture-catalog--app-shell`) in
  `ui-ux/ux/concepts/fixture-catalog.stories.ts`.
- [FACT] `Deterministic States` shows populated, empty, and save-error fixture
  cards with frozen time, active list, draft, tasks, tag samples, and production
  task previews (`fixture-catalog.stories.ts:DeterministicStates`,
  `ui-ux/ux/concepts/fixtures.ts`).
- [FACT] `App Shell` shows Lists, Smart lists, Tags, All lists, recurring and
  reminder task examples, and a default compose row
  (`fixture-catalog.stories.ts:AppShell`,
  `ui-ux/ux/concepts/app-shell-preview.ts`).
- [FACT] Major visible interactions in App Shell: collapse/expand each sidebar
  panel, select a list or smart list from the sidebar or view picker, reorder
  list/smart-list/tag pills within their own groups, and navigate the production
  task preview (`app-shell-preview.ts:createAppShellPreview`,
  `fixture-catalog.stories.ts:AppShell`).
- [FACT] Dedicated UI spec: `spec/ui/app-shell-fixture.md` for the significant
  interactive shell. The flat deterministic fixture catalog is test/design
  infrastructure and has no separate behavioral spec.

## Concepts — Quick Add pilot

- [FACT] Storybook references in
  `ui-ux/ux/concepts/quick-add-pilot.stories.ts`: `Compact / current direction`
  (`concepts-quick-add-pilot--compact-current-direction`), `Command style`
  (`concepts-quick-add-pilot--command-style`), and `Touch first`
  (`concepts-quick-add-pilot--touch-first`).
- [FACT] Every direction exposes Populated, Empty, and Save error fixture states
  and supports task submission with preserved draft/error feedback
  (`quick-add-pilot.stories.ts:createQuickAddPilot`).
- [FACT] Major interactions vary by direction: Compact provides `#` tag
  suggestions and an Options disclosure; Command style provides `/today`,
  `/high`, and `#design` suggestions; Touch first exposes persistent Today,
  Priority, Tags, and Add controls (`quick-add-pilot.stories.ts`).
- [FACT] Dedicated UI spec: `spec/ui/quick-add-concepts.md`. The stories
  explicitly say they are non-production and require user approval.

## Concepts — Quick task add metadata

- [FACT] Storybook references in
  `ui-ux/ux/concepts/quick-task-add-metadata.stories.ts`: `Inline essentials`
  (`concepts-quick-task-add-metadata--inline-essentials`), `Smart capture`
  (`concepts-quick-task-add-metadata--smart-capture`), and `Metadata presets`
  (`concepts-quick-task-add-metadata--metadata-presets`).
- [FACT] Every direction exposes Populated, Empty, and Save error fixture states
  with task list, priority, and reminder values
  (`quick-task-add-metadata.stories.ts:createQuickTaskConcept`).
- [FACT] Major interactions vary by direction: persistent metadata fields;
  shorthand recognition plus manual overrides; or preset bundles plus
  individual customization. Mod+N reveals the support surface, Enter submits,
  and layered Escape behavior is demonstrated
  (`quick-task-add-metadata.stories.ts`).
- [FACT] Dedicated UI spec: `spec/ui/quick-add-concepts.md`. The stories are
  explicitly non-production approaches.

## Concepts — Quick Add inline metadata layouts

- [FACT] Storybook references in
  `ui-ux/ux/concepts/quick-add-inline-metadata-layouts.stories.ts`: `A · Value
  row` (`concepts-quick-add-inline-metadata-layouts--value-row`), `B · Meta
  chips` (`concepts-quick-add-inline-metadata-layouts--meta-chips`), `C ·
  Same-line cluster` (`concepts-quick-add-inline-metadata-layouts--same-line-cluster`),
  and `D · Unified context bar`
  (`concepts-quick-add-inline-metadata-layouts--unified-context-bar`).
- [FACT] Every layout exposes Populated, Empty, Save error, and Long content
  fixture states (`quick-add-inline-metadata-layouts.stories.ts:stateLabels`).
- [FACT] Every layout keeps Task list, Priority, and Reminder visible and
  directly editable; menus support Arrow/Home/End selection, the production
  date picker handles the reminder, Enter submits, and Escape dismisses at most
  one open surface (`quick-add-inline-metadata-layouts.stories.ts`).
- [FACT] `A · Value row` shows the three fields as glyph-plus-value buttons in a
  single wrapping row below the task input, inside a `role="group"` named
  `Details for the next task`, with no visible field labels
  (`quick-add-inline-metadata-layouts.stories.ts:ValueRow`, `createComposer`,
  `GROUP_LABEL`, `ui-ux/ux/concepts/quick-add-inline-layouts.css`).
- [FACT] Each story page surrounds the preview with Storybook-only scaffolding:
  a `Storybook fixture controls — not part of Adeo` label, the fixture state
  buttons, a theme badge, and a measured compose-block height readout
  (`quick-add-inline-metadata-layouts.stories.ts:createLayoutConcept`).
- [FACT] Dedicated UI spec for `A · Value row`:
  `spec/ui/quick-add-inline-metadata-value-row.md`. The umbrella comparison
  remains in `spec/ui/quick-add-concepts.md`; the other three alternatives do
  not yet have exact-story specs.
- [HUMAN DECISION] (2026-08-29) `A · Value row` is the selected layout of the
  four; the other three are not selected (OQ-003). The stories themselves remain
  concept code.

## Concepts — Overdue task treatments

- [FACT] Storybook references in
  `ui-ux/ux/concepts/overdue-task-treatments.stories.ts`: `A — Overdue meta
  emphasis` (`concepts-overdue-task-treatments--a-meta-emphasis`), `B — Overdue
  chip` (`concepts-overdue-task-treatments--b-overdue-chip`), `C — Row rail and
  tint` (`concepts-overdue-task-treatments--c-row-rail-and-tint`), and `Compare
  A / B / C` (`concepts-overdue-task-treatments--compare-alternatives`).
- [FACT] Every treatment shows no overdue tasks, one overdue task, and several
  overdue tasks mixed with normal/completed tasks using a fixed clock
  (`overdue-task-treatments.stories.ts`, `overdue-fixtures.ts:overdueScenarios`).
- [FACT] Major visible interactions: none are added by the treatments; the
  stories compare decorations on the production task-row DOM
  (`overdue-task-treatments.stories.ts:decorateOverdue`).
- [FACT] Dedicated UI spec: `spec/ui/overdue-task-treatments.md`. The stories
  explicitly say no treatment is approved.
