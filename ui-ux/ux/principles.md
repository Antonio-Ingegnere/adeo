# Adeo product-design principles

**Status:** Approved
**Approver:** Antonio
**Approval date:** 21-08-2026

These principles turn Adeo's existing product behavior into decision rules. A concept
that conflicts with one must explain why and obtain explicit user approval.

## 1. Capture first, organize without interruption

Adeo's primary loop is entering a task in the always-visible add field. Creating a basic
task must remain a short keyboard flow; list, tags, priority, reminders, recurrence, and
details are optional refinements.

Verify with: task capture works without opening a dialog and returns focus to the add
field after success.

## 2. Reveal complexity in context

Advanced controls belong where their result is visible: query actions in the view bar,
task metadata in the edit dialog, and application preferences in Settings. Do not expose
every capability in the primary capture path.

Verify with: a first-time user can add and complete a task without understanding smart
lists, repeat rules, or shortcut rebinding.

## 3. Preserve orientation

Search, filtering, smart-list editing, completion, and deletion must leave the user able
to tell which view is active and where keyboard focus moved. Adeo's existing view label,
result count, `edited` state, stale-query note, and task cursor are part of this rule.

Verify with: every transition identifies the active list/filter and has a deterministic
focus destination.

## 4. Keyboard is a complete path; pointer is an equal path

Adeo is a desktop productivity app with a scoped shortcut system and roving task focus.
Every critical action must be reachable without a pointer. Conversely, shortcut-only
behavior needs a discoverable pointer control. Touch layouts must not depend on hover or
drag.

Verify with: add, navigate, edit, complete, delete, search, dismiss, save, and reorder can
be completed with the keyboard; the same outcomes remain available by pointer.

## 5. State must be visible, not inferred from color alone

Selected segments use an outline as well as a surface change; query errors preserve the
last valid result and say so; destructive actions ask for confirmation. Apply the same
standard to new selected, loading, invalid, empty, disabled, and destructive states.

Verify with: state remains understandable in light/dark themes and without relying on
hue alone.

## 6. Reuse Adeo's language before adding variants

Use the existing design tokens, typography scale, radii, focus ring, tag palette, priority
mapping, chips, pills, menus, and action styles. A new variant needs a documented product
need; visual novelty is not sufficient.

Verify with: a concept identifies reused components/tokens and records each exception.

## 7. Local data is private and test data is disposable

Adeo stores task data locally in SQLite and settings under Electron `userData`. Design
review and automation must never modify the user's development or personal data.

Verify with: automation fails before launch unless both database and `userData` paths are
temporary, and a test proves the real files are byte-for-byte unchanged.

## 8. Accessibility is behavior, not a final scan

Semantic names, focus order, escape behavior, keyboard interaction, reduced motion,
contrast, and screen-reader announcements are designed with each state. Axe is a useful
guard, but it does not approve a flow.

Verify with: each brief includes keyboard and assistive-technology expectations, followed
by manual review of the implemented flow.

## 9. Design for platform capability, not platform imitation

Desktop, web, and mobile may use different navigation or system integrations while
preserving task semantics and terminology. Native confirmations, menus, notifications,
and deep links are capabilities behind a platform boundary, not assumptions inside a
visual component.

Verify with: concepts distinguish shared behavior from desktop-only or future-platform
behavior.

## 10. The user owns the product decision

The Product Design Agent may recommend, compare, and reject its own weak explorations, but
it cannot approve a concept, expand scope, or claim acceptance. An approved UX decision
must identify the human approver and date.

Verify with: no production handoff exists without an approved decision record.

## Approval checklist

- [x] These principles reflect the intended Adeo product direction.
- [x] The balance between keyboard efficiency and pointer/touch parity is correct.
- [x] The design agent's write and approval boundaries are correct.
- [x] Any requested revisions have been incorporated.
- [x] The user has explicitly approved this document.
