# Quick Add alternatives

Three isolated, static prototypes for what Adeo could reveal when the existing **Add a new task**
shortcut (`Cmd+N` on macOS, `Ctrl+N` elsewhere) focuses Quick Add. They deliberately keep task
entry as plain text: metadata is chosen through visible controls, never typed as command syntax.
No production source is imported or changed.

## How to view

Open any HTML file directly in a browser. Each prototype starts with Quick Add open so the proposed
surface is immediately visible. Press `Cmd+N` / `Ctrl+N` to replay the entry state, click the
metadata controls, and press Enter in the task field (or click the round Add button) to add the
draft to the local mock task list. Escape dismisses the most local open surface first.

## 1. Context chips

**Interaction model.** Cmd+N focuses the production-shaped task field and reveals a one-line
context strip directly underneath it. The strip exposes the effective List, Priority, Reminder,
and Tags as compact quick-pick chips; clicking a chip opens its small menu in place, while the
selections remain visible on the chip. Enter from the task field confirms the task with the chosen
context. Escape closes an open menu first, then collapses the strip without discarding the draft;
the trailing Done control does the same explicitly.

[Open `context-chips.html`](./context-chips.html)

Tradeoffs versus the current Options disclosure:

- **Pros:** fastest scanning and one-click access; chosen values stay visible; adds tags to the
  same contextual layer without requiring `#` discovery.
- **Cons:** consumes a permanent extra line while active; four peer controls can feel busy on
  narrow windows; menus still require individual keyboard interaction rules.
- **Relationship to Options:** replaces the current disclosure for List, Priority, Reminder, and
  Tags. A small overflow control could retain future low-frequency fields without reopening the
  full current panel.

## 2. Focus shelf

**Interaction model.** Cmd+N focuses the task field and auto-expands a shallow shelf beneath it.
The shelf begins with a compact summary row for List, Priority, Reminder, and Tags; activating one
field expands only that field's choices in a second row, so the user works on one decision at a
time. The shelf collapses to a quiet summary after Add, on outside click, or with Escape; a draft
and any explicit choices are preserved, and clicking the summary reopens it.

[Open `focus-shelf.html`](./focus-shelf.html)

Tradeoffs versus the current Options disclosure:

- **Pros:** Cmd+N makes important context discoverable without another click; only one editor is
  expanded at a time; the collapsed summary still makes overrides legible.
- **Cons:** common choices take two clicks (field, then value); the changing second row introduces
  more vertical motion; automatic expansion needs careful blur and Escape behavior.
- **Relationship to Options:** evolves the current disclosure rather than removing it: the
  existing fields become the shelf's summary/editor, while an Options/More affordance could remain
  for future advanced metadata.

## 3. Quick card

**Interaction model.** Cmd+N focuses the task field and opens a lightweight, anchored palette
directly below it. The left column lists the four context fields and their current values; the
right column shows choices for the active field. Arrow keys move through fields, Enter opens the
active field's choices, and pointer users can click either side. Enter in the task field or the
palette's Add task action confirms; Escape closes the active choices first and then the card,
returning focus to the task field without clearing the draft.

[Open `quick-card.html`](./quick-card.html)

Tradeoffs versus the current Options disclosure:

- **Pros:** strongest keyboard overview; all effective values are visible together; the overlay
  avoids permanently moving the task list and scales to more contextual fields.
- **Cons:** temporarily covers the first tasks; visually heavier than an inline row; needs robust
  focus management and viewport-aware placement.
- **Relationship to Options:** replaces the disclosure while Cmd+N capture is active. The existing
  Options button could remain as a pointer entry point that opens the same card, avoiding two
  separate metadata UIs.

