# Adeo content guidelines

## Voice

Adeo is direct, calm, and compact. Prefer a concrete action or state over encouragement,
personality copy, or technical detail. Keep the interface suitable for repeated daily use.

- Use short sentences and familiar verbs.
- Say what changed, what failed, or what the user can do next.
- Avoid blame, jokes in errors, and unnecessary exclamation marks.
- Do not expose implementation terms such as IPC, SQLite, renderer, or AST in UI copy.

## Product vocabulary

| Use | Meaning | Avoid |
|---|---|---|
| Task | A single actionable item | Todo, record, entry when referring to the product object |
| List | Manual task container | Folder, project unless the product model changes |
| Smart list | A saved query | Saved filter in new UI copy |
| Tag | A reusable `#name` label | Label when referring to tags |
| Text search | Simple text-matching mode | Basic mode |
| Query search | Structured search mode | Advanced when the visible control says Query |
| Show completed | Preference/view action | Show done items |
| Reminder | Date/time notification intent | Due date unless the data meaning is actually due |

Use sentence case for headings, buttons, menu items, and field labels. Preserve the exact
case of user-created task, list, smart-list, and tag names.

## Actions

- Prefer verb-first labels: `Add task`, `Save smart list`, `Clear search`, `Show completed`.
- Icon-only actions require an accessible label and tooltip/title where discoverability
  benefits; the label describes the outcome, not the icon.
- Use `Cancel` for abandoning unsaved changes and `Close` for dismissing an informational
  surface.
- Destructive confirmation names the object when safe and states the irreversible outcome.

## States and feedback

### Empty states

Name the empty scope and give the next valid action. Existing examples set the direction:
`No lists yet. Click + to add one.` and `Nothing added yet. Enter a task and hit Add.`
Adapt input-method wording for touch rather than saying `Click` everywhere.

### Search and query errors

- Do not claim there are no results when the query is invalid.
- If the last valid results remain visible, say `Showing last valid results`.
- Identify the invalid token/position where available and provide a correction example.

### Saving and failure

- Keep successful routine actions quiet unless the outcome is not visible.
- A failure names the action: `Couldn’t save the smart list.`
- Add a recovery action or safe next step: retry, correct a field, or retain unsaved input.
- Never report success before the underlying operation has succeeded.

## Dates, time, and shortcuts

- Render application dates with the user's explicit date-format setting.
- Preserve ISO `YYYY-MM-DD` only in technical evidence, not as forced UI display copy.
- Use the user-selected 12/24-hour format where formatting is controlled by Adeo.
- Shortcut hints reflect the live binding and platform (`⌘` on macOS, Ctrl elsewhere).
- Do not promise a shortcut in placeholder/help copy after it has been unbound.

## Concept annotations

Every concept describes:

- The user goal in one sentence.
- What is intentionally unchanged.
- Empty, error, long-content, keyboard, pointer, and touch behavior.
- Desktop/web/mobile implications.
- Benefits, trade-offs, and implementation complexity without claiming approval.
