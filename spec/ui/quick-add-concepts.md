# Quick Add concepts

Last reviewed: 2026-08-29

## Purpose

- [FACT] Collects three related Storybook explorations for capturing a task and
  optionally choosing tags, list, priority, and reminder metadata before adding
  it (`ui-ux/ux/concepts/quick-add-pilot.stories.ts`,
  `quick-task-add-metadata.stories.ts`,
  `quick-add-inline-metadata-layouts.stories.ts`).
- [FACT] The stories describe alternatives for comparison, not one cumulative
  product contract. Quick Add pilot explicitly says only the user can approve a
  direction, Quick task add metadata calls its approaches non-production, and
  inline metadata layouts presents four follow-up alternatives
  (`quick-add-pilot.stories.ts:meta`,
  `quick-task-add-metadata.stories.ts:meta`,
  `quick-add-inline-metadata-layouts.stories.ts`).

## Storybook References

### Quick Add pilot

- [FACT] `Concepts/Quick Add pilot / Compact / current direction`
  (`concepts-quick-add-pilot--compact-current-direction`).
- [FACT] `Concepts/Quick Add pilot / Command style`
  (`concepts-quick-add-pilot--command-style`).
- [FACT] `Concepts/Quick Add pilot / Touch first`
  (`concepts-quick-add-pilot--touch-first`).
- [FACT] All three are in
  `ui-ux/ux/concepts/quick-add-pilot.stories.ts`.

### Quick task add metadata

- [FACT] `Concepts/Quick task add metadata / Inline essentials`
  (`concepts-quick-task-add-metadata--inline-essentials`).
- [FACT] `Concepts/Quick task add metadata / Smart capture`
  (`concepts-quick-task-add-metadata--smart-capture`).
- [FACT] `Concepts/Quick task add metadata / Metadata presets`
  (`concepts-quick-task-add-metadata--metadata-presets`).
- [FACT] All three are in
  `ui-ux/ux/concepts/quick-task-add-metadata.stories.ts`.

### Inline metadata layouts

- [FACT] `Concepts/Quick Add inline metadata layouts / A · Value row`
  (`concepts-quick-add-inline-metadata-layouts--value-row`).
- [FACT] `Concepts/Quick Add inline metadata layouts / B · Meta chips`
  (`concepts-quick-add-inline-metadata-layouts--meta-chips`).
- [FACT] `Concepts/Quick Add inline metadata layouts / C · Same-line cluster`
  (`concepts-quick-add-inline-metadata-layouts--same-line-cluster`).
- [FACT] `Concepts/Quick Add inline metadata layouts / D · Unified context bar`
  (`concepts-quick-add-inline-metadata-layouts--unified-context-bar`).
- [FACT] All four are in
  `ui-ux/ux/concepts/quick-add-inline-metadata-layouts.stories.ts`.

## UI Structure

- [FACT] Every story renders an interactive Quick Add composer inside the
  deterministic app-shell fixture and places Storybook-only fixture controls
  and evaluation notes around it (`createQuickAddPilot`,
  `createQuickTaskConcept`, `createLayoutConcept`).
- [FACT] Every composer includes a task text field and Add action. Additional
  controls depend on the alternative (`quick-add-pilot.stories.ts`,
  `quick-task-add-metadata.stories.ts`,
  `quick-add-inline-metadata-layouts.stories.ts`).
- [FACT] Quick Add pilot structures are: Compact with tag suggestions, selected
  tags, and Options; Command style with one command palette and a metadata
  summary; Touch first with labelled input, persistent Today/Priority/Tags
  controls, tag dialog, metadata summary, and full-width Add action
  (`quick-add-pilot.stories.ts`).
- [FACT] Quick task metadata structures are: Inline essentials with a persistent
  labelled group of list/priority/reminder controls; Smart capture with syntax
  help, live `Will apply` chips, cleaned-title preview, and manual metadata
  panel; Metadata presets with three preset buttons, live summary, and an
  individual customization panel (`quick-task-add-metadata.stories.ts`).
- [FACT] Inline layout structures keep the same three metadata fields visible
  without stacked labels: Value row uses three value controls; Meta chips uses
  interactive chips; Same-line cluster places collapsible-value controls in the
  input row; Unified context bar groups three independent segments
  (`quick-add-inline-metadata-layouts.stories.ts`).
- [FACT] In Value row the three fields sit in one wrapping row below the task
  input, and each is a button showing a leading glyph, the current value, and a
  caret, with no visible field label
  (`quick-add-inline-metadata-layouts.stories.ts:createMenuField`,
  `createComposer`, `ui-ux/ux/concepts/quick-add-inline-layouts.css` `.qaim-row`).
- [FACT] The metadata row is a `role="group"` named `Details for the next task`,
  which replaces the removed visible label. Each trigger carries an
  `aria-label` of `<field>: <value>` plus `aria-haspopup="menu"`,
  `aria-expanded`, and `aria-controls`
  (`quick-add-inline-metadata-layouts.stories.ts:GROUP_LABEL`,
  `createMenuField`).
- [FACT] The right-most field is marked `data-menu-align="end"` so its menu opens
  toward the row's start edge rather than past the column's right edge
  (`quick-add-inline-metadata-layouts.stories.ts:createComposer`,
  `quick-add-inline-layouts.css`).
- [FACT] In Value row the Reminder trigger is restyled to match the list and
  priority pickers instead of the bordered production reminder input; the
  concept CSS calls this its one deliberate visual deviation from production
  (`quick-add-inline-layouts.css`).
- [FACT] Each inline-layout story page also renders Storybook-only scaffolding
  around the preview: a `Storybook fixture controls — not part of Adeo` label,
  the fixture state buttons, an active-theme badge, and a measured compose-block
  height readout. None of it is part of the proposed UI
  (`quick-add-inline-metadata-layouts.stories.ts:createLayoutConcept`,
  `reportHeight`).

## States

- [FACT] Quick Add pilot and Quick task metadata expose Populated, Empty, and
  Save error fixture switches. Switching resets draft, task examples, metadata,
  status, and error to deterministic values and focuses the task input
  (`quick-add-pilot.stories.ts:resetModel`, `renderStateButtons`;
  `quick-task-add-metadata.stories.ts:resetModel`, `renderStateButtons`).
- [FACT] Inline metadata layouts additionally expose Long content, with a long
  task draft, long list name, high priority, and `2026-12-31` reminder
  (`quick-add-inline-metadata-layouts.stories.ts:defaultsForFixture`,
  `stateLabels`).
- [FACT] Each inline-layout field exposes set versus unset as `data-set` on both
  its wrapper and its trigger. Unset reads `Current list` for Task list and
  `None` for Priority, and an empty reminder leaves the production date trigger
  in its own unset state
  (`quick-add-inline-metadata-layouts.stories.ts:createMenuField` `paint`,
  `createReminderField` `paint`).
- [FACT] The Long content state uses the 41-character list name `Quarterly
  planning and stakeholder review`. In Value row that name grows its own control
  up to a fixed cap, ellipsis-truncates past it, and wraps the metadata row at a
  narrow column; the cluster and bar fields instead shrink to fit their line
  (`quick-add-inline-metadata-layouts.stories.ts:listLabels`, `notes.values`,
  `quick-add-inline-layouts.css`).
- [FACT] Metadata fields demonstrate current/no/work/personal destinations,
  none/low/medium/high priority where supported, and empty/today/tomorrow or a
  fixed ISO reminder date (`quick-task-add-metadata.stories.ts`,
  `quick-add-inline-metadata-layouts.stories.ts`).
- [HUMAN DECISION] These deterministic values are comparison examples only. A
  new task defaults to the list currently in view if one is selected and to no
  list otherwise, with empty priority and empty reminder date (OQ-011).

## Interactions

### Common submission behavior

- [FACT] Clicking Add or pressing Enter in the task field attempts submission
  in all demonstrated alternatives (`quick-add-pilot.stories.ts`,
  `quick-task-add-metadata.stories.ts`,
  `quick-add-inline-metadata-layouts.stories.ts`).
- [FACT] A successful concept submission prepends a deterministic task to the
  All lists preview, clears the draft, announces success, and returns focus to
  the task input (`createQuickAddPilot:submit`,
  `createQuickTaskConcept:submit`, `createLayoutConcept:submit`).
- [FACT] A blank submission shows `Enter a task before adding.` and keeps or
  returns focus to the task field. A Save error submission preserves the draft
  and metadata for retry (`submit` functions in all three story files).

### Quick Add pilot alternatives

- [FACT] Compact opens tag suggestions when the final draft token matches `#`;
  Arrow Up/Down changes the active suggestion, Enter selects it, Escape closes
  the menu, and selected pending tags can be removed
  (`quick-add-pilot.stories.ts:createCompactComposer`).
- [FACT] Compact Options toggles Today and High priority. Opening focuses Today;
  Escape closes Options and restores its trigger
  (`quick-add-pilot.stories.ts:createCompactComposer`).
- [FACT] Command style opens a palette for trailing `/` or `#` tokens and
  demonstrates `/today`, `/high`, and `#design`. Arrow keys move, Enter applies
  and removes the token from task text, and Escape closes the palette
  (`quick-add-pilot.stories.ts:createCommandComposer`).
- [FACT] Touch first toggles Today and high priority directly. Tags opens a
  `role="dialog"` surface of toggle buttons; Done or Escape closes it and
  restores focus to Tags (`quick-add-pilot.stories.ts:createTouchComposer`).

### Quick task metadata alternatives

- [FACT] Mod+N reveals a hidden support surface and focuses Task in Inline
  essentials, Smart capture, and Metadata presets
  (`quick-task-add-metadata.stories.ts:attachQuickAddShortcut`).
- [FACT] Inline essentials always begins revealed. Task list and Priority are
  menu buttons; Arrow Up/Down opens at an edge, menu Arrow/Home/End moves, Enter
  selects, and Escape closes the active menu before Escape can hide the strip
  (`quick-task-add-metadata.stories.ts:createInlineComposer`, control factories).
- [FACT] Smart capture recognizes the last `#current|none|work|personal`,
  `!none|low|medium|high`, and `today|tomorrow` token, removes recognized syntax
  from the title preview, and updates a live `Will apply` summary
  (`quick-task-add-metadata.stories.ts:parseMetadataDraft`,
  `createSmartComposer`).
- [FACT] A recognized Smart capture value renders as a removable button. Using
  it keeps that syntax in the task title and restores the manual value for that
  metadata field (`quick-task-add-metadata.stories.ts:createValueChip`).
- [FACT] Smart capture's `Choose metadata…` panel exposes list, priority, and
  reminder in any order. A manual choice removes corresponding recognized
  syntax unless the user chose to keep it as text
  (`quick-task-add-metadata.stories.ts:createSmartComposer`).
- [FACT] Metadata presets demonstrates `Current · Anytime`, `Work · Today ·
  High`, and `Personal · Tomorrow`. Clicking or using Mod+1/2/3 applies a bundle
  and keeps focus in the composer; changing one field can leave no preset
  selected (`quick-task-add-metadata.stories.ts:createPresetComposer`).
- [FACT] In Smart capture and Metadata presets, repeated Escape presses dismiss
  one layer at a time: field menu, then metadata/custom panel, then support
  surface (`quick-task-add-metadata.stories.ts`).

### Inline metadata layout alternatives

- [FACT] Task list and Priority triggers expose menu semantics. Arrow Down/Up
  opens first/last, menu Arrow/Home/End wraps focus, Enter/Space selects, Tab
  closes without restoring focus, and Escape closes and restores the trigger
  (`quick-add-inline-metadata-layouts.stories.ts:createMenuField`).
- [FACT] Reminder uses the production date picker with a fixed clock and
  formatter; selecting or clearing a date updates the concept model
  (`quick-add-inline-metadata-layouts.stories.ts:createReminderField`).
- [FACT] Clicking outside the composer closes open metadata surfaces. Escape
  dismisses at most one open field surface; the persistent metadata row itself
  does not hide (`quick-add-inline-metadata-layouts.stories.ts:createComposer`).
- [FACT] Value row, Meta chips, and Unified context bar place Add before the
  three metadata controls in DOM/tab order. Same-line cluster orders Task, Task
  list, Priority, Reminder, Add
  (`quick-add-inline-metadata-layouts.stories.ts:createComposer`, layout notes).
- [FACT] Selecting a menu value paints the trigger, closes the menu without
  restoring focus through the menu, and moves focus back to the trigger; the
  chosen row is marked `aria-checked="true"`
  (`quick-add-inline-metadata-layouts.stories.ts:createMenuField` `select`,
  `paint`).
- [FACT] Priority is never colour-only in these layouts: the trigger and every
  menu row show the priority word beside the tinted swatch, which is
  `aria-hidden` (`quick-add-inline-metadata-layouts.stories.ts:createMenuField`,
  `src/renderer/theme.ts:setPriorityAttr`).
- [FACT] The concept menus deliberately implement semantics the shipped compose
  menu does not: concept rows are real `<button role="menuitemradio">` with
  `aria-checked` and Arrow/Home/End movement, whereas the shipped
  `#compose-priority-menu` rows are role-less `div`s selected by a click-only
  handler (`quick-add-inline-metadata-layouts.stories.ts:createMenuField` and its
  comment, `index.html` `#compose-priority-menu`,
  `src/renderer/composeOptions.ts`).

## Data displayed/entered

- [FACT] Task draft is free text. Depending on the alternative, users can also
  choose tags, list destination, priority, and reminder/due date
  (`quick-add-pilot.stories.ts:ConceptModel`,
  `quick-task-add-metadata.stories.ts:ConceptModel`,
  `quick-add-inline-metadata-layouts.stories.ts:LayoutModel`).
- [FACT] Quick Add pilot task examples use tags and a simplified None/High
  priority and No date/Today model (`quick-add-pilot.stories.ts`).
- [FACT] Quick task metadata and inline layouts demonstrate Current list, No
  list, Work, and Personal; inline layouts add a long Quarterly example
  (`quick-task-add-metadata.stories.ts:listLabels`,
  `quick-add-inline-metadata-layouts.stories.ts:listLabels`).
- [FACT] Status messages use polite status regions and failures use alert
  regions (`quick-add-pilot.stories.ts:renderFeedback`,
  `quick-task-add-metadata.stories.ts:renderFeedback`,
  `quick-add-inline-metadata-layouts.stories.ts:createComposer`).
- [FACT] Inline layouts render a chosen reminder as day, abbreviated month, and
  year — for example `24 Aug 2026` — using an injected formatter and a fixed
  2026-08-24 clock, so no real clock is read
  (`quick-add-inline-metadata-layouts.stories.ts:formatReminder`, `FIXED_TODAY`,
  `createReminderField`).
- [FACT] A successful inline-layout submission announces `Added “<title>” to
  <list>.` in the polite status region and prepends a task carrying the chosen
  priority and formatted reminder to the preview; the Save error state reports
  `Could not save the task. Keep the draft and try again.` in the alert region
  (`quick-add-inline-metadata-layouts.stories.ts:createLayoutConcept` `submit`,
  `ui-ux/ux/concepts/fixtures.ts:errorConceptFixture`).

## Validation

- [FACT] Whitespace-only drafts are rejected in every alternative. Smart capture
  also rejects drafts that contain only recognized metadata because the cleaned
  title is empty (`quick-task-add-metadata.stories.ts:submit`).
- [FACT] The concept grammar recognizes only the explicitly coded English
  tokens; unrecognized text remains part of the title
  (`quick-task-add-metadata.stories.ts:parseMetadataDraft`).
- [FACT] Story save errors are deterministic fixture outcomes and do not expose
  backend behavior (`quick-add-pilot.stories.ts:submit`,
  `quick-task-add-metadata.stories.ts:submit`,
  `quick-add-inline-metadata-layouts.stories.ts:submit`).

## Relevant assumptions

- [ASSUMPTION] Interaction details shared by all alternatives are credible
  candidate requirements, but they are not approved product behavior until the
  direction itself is selected because each file identifies the UI as concept
  work (`meta` and header copy in all three story files).
- [ASSUMPTION] Story annotations about complexity, platform fit, and measured
  layout are evaluation evidence, not product requirements
  (`notes` objects in all three story files).

## Human decisions

<!-- human-owned:start -->
- [HUMAN DECISION] (2026-08-29) Of the four label-free inline metadata layouts,
  option A, Value row, is selected. Resolves OQ-003. The top-level direction
  (OQ-001) and metadata approach (OQ-002) remain open as recorded.
- [HUMAN DECISION] (2026-08-29) New-task defaults are the list currently in view
  if one is selected, otherwise no list; priority empty; reminder date empty.
  Fixture and shorthand/preset values are comparison examples only. Resolves
  OQ-011.
- [HUMAN DECISION] (2026-08-29) Whether the concepts' menu semantics bind the
  shipped compose menus is not a product question for these specs. The shipped
  menus' gap is the filed accessibility defect F-01/F-02 in
  `ui-ux/handoffs/phase3-handoff.md`. Resolves OQ-012.
<!-- human-owned:end -->

## Open questions

- [OPEN QUESTION: OQ-001] Approve or reject the Compact, Command, and Touch-first
  top-level directions.
- [OPEN QUESTION: OQ-002] Approve or reject Inline essentials, Smart capture,
  and Metadata presets.
- OQ-003 is RESOLVED: Value row is the selected label-free layout. See Human
  decisions and `spec/_open-questions.md`.
- OQ-011 and OQ-012 are RESOLVED; see Human decisions and
  `spec/_open-questions.md`.

