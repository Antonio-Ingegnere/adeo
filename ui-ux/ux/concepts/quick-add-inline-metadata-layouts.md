# Quick Add inline metadata — label-free layouts

**Mode:** Explore (concept comparison)
**Status:** NOT APPROVED — this is a recommendation for the user to review.
**Date:** 2026-08-28
**Stories:** `Concepts/Quick Add inline metadata layouts` in
`concepts/quick-add-inline-metadata-layouts.stories.ts`
**Styles:** `concepts/quick-add-inline-layouts.css`
**Evidence:** `../reviews/evidence/quick-add-inline-layouts/`

## What this explores

The approved-direction candidate "Inline essentials"
(`concepts/quick-task-add-metadata.stories.ts` → `InlineEssentials`) keeps the production
Options-panel layout, where each of the three fields stacks an 11px `.compose-option-label`
above its control, under a further "Set before adding" group label.

User feedback, verbatim:

> "I don't like the idea of keeping task list, priority and reminder as label on top of
> elements. Provide some other options, cos these take too much space."

Four layouts drop the visible labels and keep the field name only as the control's
accessible name. Everything else about Inline essentials is deliberately unchanged: the
three production fields stay visible and directly editable, capture stays plain text, Enter
in the task field still submits, and no metadata is typed as command syntax.

These four are about the **always-visible inline row**. They are not a disclosure or an
overlay, so they do not repeat the `ui-ux/labs/quick-add-alternatives/` explorations
(context chips strip, focus shelf, quick card), all of which reveal or expand a surface.

## The four layouts

| Story | Idea |
|---|---|
| A · Value row | Three self-describing pickers on one row: glyph + current value + caret. |
| B · Meta chips | The three fields become the `.template-chip` language Adeo already uses to say what the next task will get. |
| C · Same-line cluster | The controls move onto the Quick Add line itself and collapse to a single glyph until they are set. |
| D · Unified context bar | One sunken bar holds all three values, divided by hairlines rather than split into three pills. |

## Measured space

Height of the compose block (view bar through the end of the metadata row) in the populated
fixture, measured in the browser and printed under each story:

| Layout | 1440 / 1024 / 768 | 390px column | 315px column | 315px + long list name |
|---|---:|---:|---:|---:|
| Baseline (Inline essentials, stacked labels) | 157px | 307px | 307px | not captured |
| A · Value row | 110px | 128px | 128px | 180px |
| B · Meta chips | 112px | 134px | 134px | 184px |
| C · Same-line cluster | **76px** | 128px | 170px | 218px |
| D · Unified context bar | 112px | 128px | **128px** | **128px** |

The narrow figures are large for the baseline because production's own `max-width: 480px`
rule turns `.compose-options-panel` into a column, so the three label/control pairs stack.
Every layout here stays on one to three wrapped lines instead.

The last column is the worst case — a 41-character list name at a 315px column. D is the
only layout that stays on one line there, because the bar truncates the list value with an
ellipsis while priority and the reminder date keep their content width. Save-error states add
about 13px in every layout (the alert line).

## Comparison

### A · Value row

- **Benefits.** Closest to the shipped Options panel, so menus, tokens and behavior are
  unchanged; the value is the largest text in each control, which is what users scan for;
  the glyph distinguishes the field without a word.
- **Trade-offs.** A bare "Medium" or "Personal" is only unambiguous once its glyph is
  learned; three separate pills still read as three objects.
- **Space saved.** 47px at desktop widths (30%), 179px at a 315px column. With a long list
  name at 315px the row wraps to 180px, still 127px under the baseline.
- **Accessibility.** Row is a named `role="group"`; each trigger is `aria-label="<field>:
  <value>"` with `aria-haspopup`/`aria-expanded`/`aria-controls`; menu rows are real buttons
  with `role="menuitemradio"` and `aria-checked`. Priority always keeps its word, so nothing
  is colour-only.
- **Complexity.** Low. Remove the label element, release the width, add a glyph.

### B · Meta chips

- **Benefits.** Reuses the production chip language, so the row reads as a statement about
  the next task rather than as a form; the priority chip carries the production priority
  tint; lightest visual weight.
- **Trade-offs.** Chips are informational in Adeo today, so editability has to be taught by
  the caret and hover/focus styling; chips are smaller pointer/touch targets and need the
  44px floor at narrow widths; the existing `add-task-template` hints row also uses chips,
  so the two rows must not become confusable when a smart list is running.
- **Space saved.** 45px at desktop widths, 173px at a 315px column.
- **Accessibility.** Same trigger and menu semantics as A. The unset chips use
  `--text-hint` on the chip fill, which needs a contrast check in both themes before
  production.
- **Complexity.** Medium. The chip becomes interactive for the first time.

### C · Same-line cluster

- **Benefits.** The only layout that adds no row at all on a desktop-width column: a plain
  capture stays exactly one line tall, which is principle 1 ("capture first") expressed in
  layout. A set value expands in place, so the choice stays visible.
- **Trade-offs.** The cluster competes with the task field for width — the first render of
  this concept collapsed the task field to roughly one character at a 315px column and
  wrapped Add onto its own line, which the concept now prevents with an explicit width floor
  and a wrap rule. It is still the worst layout at narrow widths (170px at 315px, 218px with
  a long list name) because the metadata has to wrap onto its own lines anyway. A collapsed
  glyph shows the field but not its value, and the collapsed priority glyph is the neutral
  `priority-chip` swatch, which does not by itself say "priority". Three icon buttons beside
  the input can read as a toolbar rather than as task metadata.
- **Space saved.** 81px at desktop widths (52%) — the largest — but the saving inverts below
  about 400px, where C becomes the tallest of the four.
- **Accessibility.** A collapsed control keeps the full accessible name, so assistive
  technology is never told less than a sighted user; the open question is the sighted user's,
  since an unset field shows a glyph only. A tooltip/`title` decision is needed before
  production.
- **Complexity.** Medium. Collapsed/expanded rule per field, wrap behavior, and a width
  policy for the task field.

### D · Unified context bar

- **Benefits.** One object rather than three directly answers the "busy" part of the
  feedback; content-sized and left-aligned, so it never stretches; hairlines separate the
  fields without three borders.
- **Trade-offs.** A segmented bar is a new composite in Adeo, and the closest existing
  pattern — the segmented control — means something different (one choice among several).
  Hover and focus must be per-segment or the bar looks like a single button. Long list names
  truncate inside a shared bar instead of growing their own pill.
- **Space saved.** 45px at desktop widths, 179px at a 315px column, and the only layout that
  holds one line at 315px with a long list name (128px, versus 180–218px for the others).
- **Accessibility.** Same semantics as A; the divider is decorative. The global focus ring
  must stay visible against the shared sunken fill (verified visually in both themes).
- **Complexity.** Medium. The controls are production controls, but the bar is a new
  container with its own divider, radius, hover and focus rules to add to the language.

## Shared behavior verified in all four

- Zero visible `.compose-option-label` elements remain; the row carries the accessible name
  "Details for the next task" instead.
- Accessible names: `Task list: Work`, `Priority: Medium`, `Reminder: 24 Aug 2026`.
- Tab order: A/B/D — Task, Add, Task list, Priority, Reminder. C — Task, Task list,
  Priority, Reminder, Add (DOM order matches visual order).
- Arrow Down/Up opens a menu on its first/last row; Arrow/Home/End move; Enter selects,
  closes the menu and returns focus to the trigger with an updated accessible name.
- Escape closes exactly one surface and restores focus to its trigger (menu, then the date
  popover). With nothing open the draft is untouched — these rows are permanent, so there is
  no third layer to dismiss.
- Enter in the task field adds the task and returns focus to the field; a blank submit adds
  nothing and reports `Enter a task before adding.` in a `role="alert"` region.
- No horizontal page overflow and no menu overflow at a 315px column; the right-most field
  opens its menu leftwards.
- Storybook axe (light theme, populated state, scanned over the preview region): **0
  violations** in all four layouts and in the baseline story. Two `incomplete` (inconclusive)
  results appear identically in the baseline: `aria-valid-attr-value` on the pickers'
  `aria-controls` and `color-contrast` on the `aria-hidden` caret plus existing task/tag
  elements. They are inherited, not introduced here, and still need manual confirmation.
- No console errors or page errors in any layout.

## Defects this exploration found by rendering

Both were invisible in the code and only appeared in the browser at a narrow column; both
are fixed in the concept CSS and recorded here because the same traps exist in production
layout work:

1. **C, task field starvation.** `.add-task-input-wrap` is `flex: 1` with no `min-width`, so
   the metadata cluster took the row's width and the task field rendered about one character
   wide with Add wrapped alone below. Fixed with an explicit width floor plus a
   wrap rule at 480px.
2. **C and D, long-name overflow.** With a 41-character list name at a 315px column, the
   reminder control was pushed past the column's right edge. Fixed with an explicit shrink
   policy: the list name is the one value allowed to truncate; priority and the date keep
   their content width. The equal-specificity `flex` declaration later in the file was
   silently overriding that policy, which is why the rule is now commented.

## Known deviations and open questions

1. **Reminder control treatment.** In the shipped Options panel the reminder is a bordered
   `.reminder-date-input` while list and priority are borderless sunken pills — a difference
   the stacked labels hid. On one line it reads as a third kind of control, so A, C and D
   give the reminder the same picker treatment. This is the one visual deviation from
   production in these concepts and needs a decision either way.
2. **Reminder uses the production date picker** (`attachDatePicker`) rather than the native
   date input, because it already renders "value + calendar glyph" and sets its own
   accessible name. Its empty state reads "Select date", which is production copy.
3. **Glyph legibility** for the list field (and, in C, for every collapsed field) is not
   proven by this exploration; it needs a real user check or a tooltip decision.
4. **Chip contrast** for the unset state in B needs a token check in both themes.
5. **The template hints row** (`add-task-template`) still exists in production and also uses
   chips. B in particular has to be reconciled with it.

## Recommendation (recommendation only — the user decides)

**A · Value row** is the recommended direction, with **D · Unified context bar** as a close
second that is worth choosing if narrow-window robustness or the "three separate objects"
reading matters more than pattern conservatism.

A removes exactly what the feedback named — the stacked labels — for a 30% shorter compose
block and a 58% shorter one at phone width, while changing nothing about the controls, menus
or behavior. It is the lowest-risk of the four and the only one that adds no new composite to
the design language, which is what principle 6 asks for.

D matches A at desktop widths and beats every layout in the worst case (one line, 128px, at a
315px column with a long list name, where A needs 180px). Its cost is a genuinely new
container: a segmented-looking bar in an app where the segmented control already means "pick
one of these", plus per-segment hover and focus rules.

C is the most space-efficient at desktop width (52% shorter) and the most faithful to
capture-first, but it inverts below about 400px, where it becomes the tallest option, and its
collapsed state shows a field's glyph without its value. It deserves a second round only if
the user wants to pursue the zero-extra-row idea. B is attractive and the lightest visually,
but it makes chips interactive for the first time and has to be reconciled with the existing
template hints row — a product question rather than a layout one.

**Nothing here is approved.** Only the user can choose a direction and only the user can
record an approved UX decision.
