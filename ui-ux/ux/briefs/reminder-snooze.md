# UX brief: Reminder snooze

**Status:** DRAFT — INCOMPLETE REQUIREMENT
**Owner:** Product Design Agent (requirement review); requesting stakeholder unnamed
**Created:** 2026-08-26
**Target decision date:** <not set — needs the requester>
**Related request/issue:** Verbatim stakeholder request: "Users want a way to snooze a
reminder instead of just dismissing it." No ticket, no further detail supplied.

## Purpose of this document

This is a **requirement review**, not a design. It records what the request does and does
not say, grounds the current behavior in production source, and lists what must be decided
before a real brief (and any concept work) can start. Nothing below proposes a solution;
where a design answer would normally sit, this brief names the open question instead.

Notation: **FACT** = verified by reading the cited source in this session. **GAP** = not
supplied by the request and deliberately not invented here.

## User goal

<UNSPECIFIED.> The request states a mechanism ("snooze"), not a goal. The underlying goal is
plausibly one of several different problems with different solutions — see Open questions
Q1. A brief cannot proceed on the mechanism alone.

## Problem and evidence

### What a "reminder" is today (FACT)

- A reminder is two nullable columns on a task, `reminder_date` and `reminder_time`
  (`../../../server/app.py:51-52`, migrated defensively at `:75-78`), exposed as
  `reminderDate` / `reminderTime` on `Task` (`../../../src/types.ts:9-10`).
- The only write path is `PATCH /tasks/{id}/reminder` (`../../../server/app.py:499-508`),
  which **overwrites both columns**. It is reached from the renderer via
  `updateTaskReminder` (`../../../src/types.ts:88-92`,
  `../../../src/renderer/modals.ts:250-256`).
- There is **no snooze, dismissed, notified, or acknowledged state anywhere in the data
  model**. `grep -rn -i "dismiss\|snooze" src/ server/` returns exactly one unrelated
  comment (`../../../src/renderer/index.ts:1453`, about Escape in the repeat modal).

### How a reminder fires (FACT)

Two independent delivery paths, arbitrated by a PID lock file:

1. **App running** — `pollDueReminders` in `../../../src/main.ts:475-504` calls
   `GET /reminders/due` every 30s (`:508-512`), dedupes in an **in-memory** `Map` keyed by
   task id → `"<date>|<time>"` (`:459`, `:488-490`), and raises an Electron `Notification`
   whose only interaction is `notification.on('click', ...)` →
   `focusWindowAndOpenTask` (`:462-473`, `:497`). No buttons, no actions.
2. **App closed** — `../../../server/reminder_notifier.py`, run by launchd / Task Scheduler /
   a systemd timer (`../../../src/main.ts:558-790`). It returns immediately if the app's
   lock file names a live PID (`reminder_notifier.py:55-61`,
   `../../../src/main.ts:521-530`), and otherwise dedupes through **`notified.json`** on
   disk with the same `id → "<date>|<time>"` key (`reminder_notifier.py:64-77`, `:248-264`).

### Due-ness has a 120-second window (FACT)

`get_due_reminders` (`../../../server/reminders.py:41-69`) selects only not-done tasks with
**both** date and time non-null, and drops anything whose fire time is in the future or more
than `reminder_grace_seconds = 120` in the past (`:10`, `:59`). Consequences:

- A reminder that fires while the machine is asleep or the scheduler is late is **never
  re-surfaced**. There is no missed/overdue reminder queue.
- The task row renders the reminder as plain text with **no overdue, fired, or unread
  treatment** (`../../../src/renderer/tasks.ts:300-330`).
- Therefore *"dismissing"* in the stakeholder sentence is not an Adeo action at all — it is
  the OS notification centre discarding a banner. Adeo has never had a dismiss control to
  put a snooze next to. This is the single biggest unstated assumption in the request.

### The notification surface cannot currently carry a button (FACT)

- Electron in-app notification: constructed with `title` and `body` only
  (`../../../src/main.ts:493-496`).
- macOS background: a one-shot LaunchAgent spawns `terminal-notifier` with `-title`,
  `-message`, `-open <adeo://open-task/id>` and nothing else
  (`reminder_notifier.py:124-144`); the surrounding comment records that macOS silently
  drops notifications not spawned directly by launchd, so no long-lived process is waiting
  to receive a button press.
- Windows background: a `ToastGeneric` binding with **no `<actions>` element**
  (`../../../server/reminder_notify_windows.ps1:21-32`; `grep -c actions` = 0).
- Linux background: `notify-send --action=default=Open` only, with an in-file comment that
  many notification daemons ignore actions entirely (`reminder_notifier.py:205-214`).

So "snooze from the notification itself" is a **platform-capability question**, not a visual
choice, and it is not uniformly answerable today.

### Adjacent facts that constrain any snooze (FACT)

- **Repeating tasks compute their next occurrence from the reminder.**
  `update_task_done` bases `compute_next_occurrence` on
  `parse_dtstart(reminder_date or repeat_start, reminder_time)`
  (`../../../server/app.py:395-400`). Mutating the reminder to implement snooze therefore
  moves the base of the whole future series.
- **Smart lists read the same field.** The query grammar's `due` field maps directly to
  `task.reminderDate` (`../../../src/renderer/query.ts:49`, `:346-364`), so a snooze that
  rewrites the date silently changes smart-list membership (a `due:today` list drops the
  task) and changes what a new task seeded from that query inherits
  (`../../../src/renderer/activeSmartList.ts:133-136`).
- **Quick Add can create a date-only reminder that never fires.** `composeSeed` sets
  `seed.reminderDate` and never a time (`../../../src/renderer/composeOptions.ts:79-89`),
  while `get_due_reminders` requires `reminder_time IS NOT NULL`. Such a task shows a
  reminder line but produces no notification, so "snooze" has no defined meaning for it.
- **Reminder editing today** is the edit dialog's `#reminder-picker` → `#reminder-menu`
  popover with a custom date picker plus a native `<input type="time">`
  (`../../../index.html:350-361`, `../../../src/renderer/index.ts:1602`,
  `../../../src/renderer/modals.ts:21-46`).
- **Settings has three tabs** — General, Tasks, Shortcuts (`../../../index.html:470-478`) —
  and no reminder section, so a snooze *preference* has no existing home.

## Scope

### In scope for this document

- Naming the missing requirements, states, edge cases, and platform limits.
- Citing the production behavior a future concept must respect.

### Out of scope for this document

- Proposing snooze durations, controls, copy, placement, or data model.
- Any production code, schema, IPC, or notification change (Architect Agent owns those).
- A UX decision record or any approval.

### Scope of the feature itself — GAP

The request does not say whether snooze covers: the in-app notification only; the background
notifier too; the task row; the edit dialog; a missed-reminder surface; or a Settings
default. Each added surface changes the cost by a large factor. See Q5.

## Current flow (FACT)

1. A task has `reminderDate` + `reminderTime`.
2. Within 120s of that moment, whichever path is active (app / background notifier) posts one
   native notification titled "Adeo Reminder" with the task text as the body.
3. The user clicks it → the window focuses and the task's edit modal opens
   (`open-task-edit`, `../../../src/main.ts:462-473`), or ignores it → the OS discards the
   banner and Adeo never mentions the reminder again.
4. To move the reminder, the user opens the task, opens the reminder popover, and edits the
   date and time by hand.

## Required flow

<CANNOT BE WRITTEN YET.> It depends on Q1–Q8. At minimum the request must specify the
trigger surface, what snooze changes, how the user learns it happened, and where focus lands.

## States

The template's state matrix cannot be filled from the request. Each row below records the
question that must be answered before it can be.

| State | Trigger/data | Required decision (not yet answered) |
|---|---|---|
| Default | Task with a future reminder | Does a snooze-capable task look any different before firing? |
| Fired, not acted on | Reminder within the 120s window | Is there any in-app indication at all today's UI does not have? |
| Snoozed | User snoozed | Is snoozed a visible task state, or just a changed reminder time? What does the task row show? |
| Empty | No reminders, or none snoozed | Only relevant if a missed/snoozed list surface is introduced — see Q5. |
| Populated | Several reminders fired at once | Snooze each individually, or a batch action? Adeo has no notification centre of its own. |
| Loading/saving | `PATCH` in flight | Snooze must not be reported before it persists (`content.md`, "Never report success before the underlying operation has succeeded"). Where does that state show if it is triggered from an OS notification with no window open? |
| Invalid/error | API down, task deleted meanwhile | The user may have no Adeo window in view. What is the failure path and recovery copy? |
| Long content | Long task text in the notification body | Native truncation is OS-owned; any in-app snooze control must survive long task text in the row. |
| Disabled/unavailable | Date-only reminder; completed task; repeating task | Is snooze offered, disabled with a reason, or hidden? `patterns.md` requires a discoverable reason when disabled. |
| Success/dismissed | Snooze applied | What is announced, to whom, and does anything remain undoable? |
| Light/dark, 1440/1024/768/390 | All of the above | Required by `patterns.md`; blocked until a surface exists to render. |

## Edge cases the request does not address

1. **Repeating task** — snoozing shifts the series base (`app.py:395-400`). Snooze this
   occurrence only, or the series?
2. **Snooze past the next occurrence** of a repeating task — two live reminders for the same
   series, or a clamp?
3. **Task completed while snoozed** — `get_due_reminders` filters `done = 0`, so it silently
   stops; is that acceptable, or must snooze be cleared?
4. **Task deleted while snoozed**, or its reminder cleared in the edit dialog.
5. **Machine asleep / app closed through the snooze expiry** — the 120s grace window means
   the re-fire can be missed entirely, exactly like the original. Snooze that silently
   evaporates is worse than no snooze.
6. **Snooze while the background notifier owns delivery** — it has no API client at all; it
   reads SQLite directly (`reminders.py:26-32`) and writes only `notified.json`.
7. **Dedupe interaction** — both stores key on `id → "date|time"`. A snooze that changes the
   time re-arms the key by accident; a snooze that does *not* change it must introduce its
   own dedupe state. Neither is specified.
8. **The two dedupe stores disagree** — the in-app map is in memory and lost on restart
   (`main.ts:459`); `notified.json` is persistent. A snooze surviving app restart lands
   squarely in that seam.
9. **Date-only reminder** (Quick Add) — never fires, so cannot be snoozed; unclear whether
   the control should appear at all.
10. **Snooze then manual edit** in the reminder popover — which wins, and is the original
    time recoverable?
11. **Smart list / `due:` membership churn** — a snooze can make a task vanish from the view
    the user is looking at (`principles.md` §3, preserve orientation).
12. **Multiple snoozes** — is there a cap, escalation, or infinite repeat?
13. **Undo** — no undo exists anywhere in Adeo today; a mis-snooze may be unrecoverable
    unless the original time is stored.

## Accessibility — required, entirely unspecified

- **Keyboard path and shortcuts:** GAP. Native OS notifications are outside Adeo's keyboard
  model entirely; if snooze lives only there, it has no keyboard path inside the app, which
  conflicts with `principles.md` §4 ("keyboard is a complete path"). If it lives in the task
  row or edit dialog, it must fit the existing roving task cursor
  (`state.focusedTaskId`) and the scoped shortcut registry rather than adding a global key.
- **Focus:** GAP. Today clicking a notification opens the edit modal. If snooze replaces or
  supplements that, initial/return focus must be defined — including the case where the app
  was **closed** when the notification was raised.
- **Names, roles, states, announcements:** GAP. A snooze result is not otherwise visible, so
  it likely needs a live-region announcement in the pattern of `#compose-status`
  (`role="status"`) / `#compose-error` (`role="alert"`); which one, and its exact copy, is
  undecided.
- **Contrast, zoom, reduced motion, non-color cues:** GAP. If "snoozed" becomes a task-row
  state it must not be conveyed by hue alone (`principles.md` §5).
- **Manual AT checks:** cannot be planned before a surface exists. Note that native
  notifications cannot be exercised in Storybook, so evidence for that half of the feature
  cannot come from this agent's toolchain at all.

## Platform implications

| Platform | Shared behavior | Platform-specific capability or limit |
|---|---|---|
| Electron desktop (app open) | The only path Adeo fully controls | Electron notification `actions` are macOS-only and require an installed, signed app — **assumed, not verified in this session**; current code passes only `title`/`body` (`main.ts:493-496`). |
| Electron desktop (app closed) | The background notifier is a separate Python process with no API and no UI | macOS: one-shot LaunchAgent + `terminal-notifier -open` only. Windows: `ToastGeneric` with no `<actions>`. Linux: `notify-send` single action, often ignored by the daemon. Snooze buttons here need production work in three OS-specific code paths. |
| Web | No equivalent of the background notifier | Out of scope of current product, but `principles.md` §9 asks concepts to separate shared from desktop-only behavior; a notification-button-only design does not port. |
| Mobile/touch | None today | Any in-app snooze control must meet the 44×44 target in `../accessibility.md` and must not be hover-revealed, unlike the current task drag handle. |

## Existing components and tokens to reuse (if an in-app surface is chosen)

- Date picker controller — `component-inventory.md` "Date picker" (Reusable,
  `../../../src/renderer/datepicker.ts`), for any "snooze until…" custom time.
- Menus/popovers pattern and `syncComboboxAria` (`../../../src/renderer/helpers.ts`) for a
  duration menu.
- Task row is **Production-only** in the inventory; adding a control there needs an adapter
  or extracted presentation before it can be storied.
- Live regions modeled on `#compose-status` / `#compose-error`.
- Content rules: "Reminder" is the approved term; sentence case; verb-first action labels
  (`../content.md`).

## Alternatives worth exploring (once the goal is settled — none recommended here)

1. **Snooze from the notification** — closest to the literal request; blocked or partly
   blocked on all three background paths above. Hypothesis: highest perceived value, highest
   platform risk.
2. **Snooze from the task row / edit dialog after the fact** — needs a way to *find* the
   fired reminder, which today does not exist (120s window, no overdue surface).
3. **A missed/overdue reminders surface** (e.g. a built-in smart list over past reminders)
   with snooze as one action on it — larger, but addresses the un-asked question of what
   happens to reminders nobody saw.
4. **Re-fire policy instead of snooze** — widen or repeat notification until acknowledged;
   introduces an acknowledged state, which snooze arguably needs anyway.
5. **Do nothing in the notification; make rescheduling cheaper** — e.g. quick relative times
   in the existing reminder popover. Lowest risk, may or may not serve the real goal.

Each is listed to show the decision space, not as a recommendation. Choosing among them is
the user's call, and requires answers to Q1–Q8 first.

## Acceptance criteria

Cannot be written yet — acceptance criteria for an unspecified goal would be invented. The
two standing ones still apply to whatever is eventually written:

- [ ] No automation uses the real database or Electron user-data directory.
- [ ] User approval is recorded in a UX decision before production handoff.

## Open questions

Every item below is a blocker for writing the real brief. None is answered here.

- **Q1 — What is the actual user problem?** "I saw it at a bad moment and want it again in
  10 minutes" and "I keep missing reminders entirely" and "I want to reschedule a task
  quickly" are three different problems; snooze only solves the first. Owner: requester.
- **Q2 — What does snooze change in the data?** Overwrite `reminder_date`/`reminder_time`
  (visible in the row, changes `due:` smart lists, moves a repeating series' base), or add
  new state the schema does not have? This is a production data-model decision. Owner:
  requester + Architect Agent.
- **Q3 — Which surface triggers it?** OS notification, task row, edit dialog, or more than
  one. Determines whether a keyboard path is even possible. Owner: requester.
- **Q4 — What durations?** Fixed set, relative offsets, "until a time", or all three;
  what happens if the snooze target is in the past. Owner: requester.
- **Q5 — Does this include a missed-reminder surface?** Without one, a snooze that expires
  while the app is closed disappears just like the original reminder. Owner: requester.
- **Q6 — Repeating tasks: this occurrence or the series?** Owner: requester.
- **Q7 — Is snooze visible on the task afterwards, and for how long?** Owner: requester.
- **Q8 — Is a snooze button technically available on each platform's notification?**
  Needs a production/technical spike across Electron, `terminal-notifier`, Windows
  `ToastGeneric` and `notify-send`. **Owner: Architect Agent — outside this agent's
  boundary.**
- **Q9 — Who is the requester, and what is the target decision date?** Both are blank on
  this request.

## Status of this brief

**Not approved. Not a design. Not a decision.** It is a list of what is missing plus the
production facts a future brief must respect. The next step belongs to the user: answer
Q1–Q7, route Q8 to the Architect Agent, and then a real brief (and only then concepts) can
be written.
