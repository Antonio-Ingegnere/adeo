// Board "Move to…" planner. Answers: if a task is moved from one column to another, what
// task attributes change, what cannot be changed, and can the task actually end up in the
// destination column?
//
// Production logic only, imported unmodified:
//   - parseQuery / compilePredicate (query.ts) decide whether a task matches a Smart list
//     column's query -- the same evaluator advanced search uses.
//   - deriveTemplate / unparse (smartListTemplate.ts) invert the query into an assignable
//     attribute set and report every constraint they cannot invert in `skipped`.
//   - resolveDue (activeSmartList.ts) turns today/tomorrow/yesterday into an ISO date.
//
// The planner never writes; it simulates the changes on a cloned Task and re-runs the real
// predicate. Applying the plan is boardApplyMove() below, which uses only the existing
// per-attribute task IPC and rolls back from a client-side snapshot on any failure.
import type { Task } from '../types.js';
import { compilePredicate, parseQuery, type EvalContext } from './query.js';
import { deriveTemplate, unparse } from './smartListTemplate.js';
import { resolveDue } from './activeSmartList.js';
import { state, type BoardMoveSnapshot } from './state.js';
import { t as translate } from './i18n/index.js';

export type BoardColumnRef =
  | { kind: 'list'; listId: number | null; label: string }
  | { kind: 'smart'; smartListId: number; query: string; label: string };

export type BoardMoveVerdict = 'deterministic' | 'best-effort' | 'blocked' | 'noop';

export type BoardAttrChange = {
  /** which per-attribute task write this maps to */
  field: 'list' | 'priority' | 'tags' | 'reminder' | 'repeat' | 'done';
  /** chip text for the preview */
  chip: string;
  /** priority value for the tinted preview chip, when this is a priority change */
  priority?: Task['priority'];
  /** apply this change to a Task clone (simulation) or the live task (apply) */
  apply: (task: Task) => void;
  /** perform the persisted write through the existing per-attribute IPC */
  write: () => Promise<{ error?: string } | unknown>;
};

export type BoardMovePlan = {
  verdict: BoardMoveVerdict;
  changes: BoardAttrChange[];
  skipped: string[];
  note: string;
  /** true when the task still belongs in the source column after the change */
  staysInSource: boolean;
  sourceLabel: string;
  destinationLabel: string;
};

const isoToday = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
};

export const boardEvalContext = (): EvalContext => ({
  listNameById: new Map(state.lists.map((l) => [l.id, l.name.toLowerCase()])),
  tagNameById: new Map(state.tags.map((t) => [t.id, t.name.toLowerCase()])),
  todayISO: isoToday(),
});

const cloneTask = (task: Task): Task => ({ ...task, tagIds: [...(task.tagIds ?? [])] });

/** Does `task` match `ref`? A list column is identity; a smart column runs the real predicate. */
export const taskInColumn = (task: Task, ref: BoardColumnRef): boolean => {
  if (ref.kind === 'list') return (task.listId ?? null) === (ref.listId ?? null);
  const parsed = parseQuery(ref.query);
  if (!parsed.ok) return false;
  return compilePredicate(parsed.ast)(task, boardEvalContext());
};

const RRULE_BY_FREQ: Record<string, string> = {
  daily: 'FREQ=DAILY',
  weekly: 'FREQ=WEEKLY',
  monthly: 'FREQ=MONTHLY',
  yearly: 'FREQ=YEARLY',
};

const titleCase = (value: string): string => value.slice(0, 1).toUpperCase() + value.slice(1);

/** Compute the move plan. Pure: no side effects, no IPC. */
export const planBoardMove = (
  task: Task,
  from: BoardColumnRef,
  to: BoardColumnRef,
): BoardMovePlan => {
  const sourceLabel = from.label;
  const destinationLabel = to.label;

  const sourceNote = (staysInSource: boolean): string => {
    if (from.kind === 'smart') {
      return staysInSource
        ? ` The "${sourceLabel}" filter is unchanged and the task still matches it, so it stays in that column too.`
        : ` The "${sourceLabel}" filter is unchanged.`;
    }
    return ` Moves out of the "${sourceLabel}" list.`;
  };

  // ---- Destination is a plain List ----------------------------------------------------------
  if (to.kind === 'list') {
    if ((task.listId ?? null) === (to.listId ?? null)) {
      return {
        verdict: 'noop',
        changes: [],
        skipped: [],
        note: `Already in "${destinationLabel}".`,
        staysInSource: true,
        sourceLabel,
        destinationLabel,
      };
    }
    const targetListId = to.listId;
    const change: BoardAttrChange = {
      field: 'list',
      chip: targetListId === null ? translate('compose.noList') : (state.lists.find((l) => l.id === targetListId)?.name ?? 'List'),
      apply: (t) => {
        t.listId = targetListId;
      },
      write: () => window.electronAPI.updateTaskList(task.id, targetListId),
    };
    const simulated = cloneTask(task);
    change.apply(simulated);
    const staysInSource = from.kind === 'smart' && taskInColumn(simulated, from);
    return {
      verdict: 'deterministic',
      changes: [change],
      skipped: [],
      note: `The task will appear in "${destinationLabel}".` + sourceNote(staysInSource),
      staysInSource,
      sourceLabel,
      destinationLabel,
    };
  }

  // ---- Destination is a Smart list --------------------------------------------------------
  const parsed = parseQuery(to.query);
  if (!parsed.ok) {
    return {
      verdict: 'blocked',
      changes: [],
      skipped: [to.query],
      note: `"${destinationLabel}" has an invalid query, so nothing can be assigned. Open the task to edit it.`,
      staysInSource: true,
      sourceLabel,
      destinationLabel,
    };
  }

  const template = deriveTemplate(parsed.ast);
  const skipped = [...template.skipped];
  const changes: BoardAttrChange[] = [];

  // list
  if (template.listName === null && (task.listId ?? null) !== null) {
    changes.push({
      field: 'list',
      chip: translate('compose.noList'),
      apply: (t) => {
        t.listId = null;
      },
      write: () => window.electronAPI.updateTaskList(task.id, null),
    });
  } else if (typeof template.listName === 'string') {
    const found = state.lists.find((l) => l.name.toLowerCase() === template.listName!.toLowerCase());
    if (!found) {
      skipped.push(`list:${template.listName} ${translate('smartListTemplate.noSuchList')}`);
    } else if ((task.listId ?? null) !== found.id) {
      changes.push({
        field: 'list',
        chip: found.name,
        apply: (t) => {
          t.listId = found.id;
        },
        write: () => window.electronAPI.updateTaskList(task.id, found.id),
      });
    }
  }

  // tags -- setTaskTags replaces the whole set, so this is one write of the union
  const existingTagIds = new Set(task.tagIds ?? []);
  const addTagIds: number[] = [];
  const addTagNames: string[] = [];
  template.tagNames.forEach((name) => {
    const found = state.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (!found) {
      // the board uses only the existing setTaskTags IPC; it never creates tags
      skipped.push(`#${name} (no such tag)`);
      return;
    }
    if (!existingTagIds.has(found.id)) {
      addTagIds.push(found.id);
      addTagNames.push(name);
    }
  });
  if (addTagIds.length) {
    const nextTagIds = [...(task.tagIds ?? []), ...addTagIds];
    changes.push({
      field: 'tags',
      chip: addTagNames.map((n) => `#${n}`).join(' '),
      apply: (t) => {
        t.tagIds = nextTagIds;
      },
      write: () => window.electronAPI.setTaskTags(task.id, nextTagIds),
    });
  }

  // priority
  if (template.priority && template.priority !== 'none' && task.priority !== template.priority) {
    const nextPriority = template.priority;
    changes.push({
      field: 'priority',
      chip: titleCase(nextPriority),
      priority: nextPriority,
      apply: (t) => {
        t.priority = nextPriority;
      },
      write: () => window.electronAPI.updateTaskPriority(task.id, nextPriority),
    });
  }

  // due -> reminderDate
  if (template.due) {
    const resolved = resolveDue(template.due);
    if ((task.reminderDate ?? null) !== resolved) {
      changes.push({
        field: 'reminder',
        chip: `Due ${resolved}`,
        apply: (t) => {
          t.reminderDate = resolved;
        },
        write: () => window.electronAPI.updateTaskReminder(task.id, resolved, task.reminderTime ?? null),
      });
    }
  }

  // repeat
  if (template.repeat && RRULE_BY_FREQ[template.repeat]) {
    const rule = RRULE_BY_FREQ[template.repeat];
    const currentFreq = /FREQ=([A-Z]+)/i.exec(task.repeatRule ?? '')?.[1]?.toUpperCase();
    if (currentFreq !== template.repeat.toUpperCase()) {
      const start = template.due ? resolveDue(template.due) : (task.reminderDate ?? isoToday());
      changes.push({
        field: 'repeat',
        chip: `Repeats ${template.repeat}`,
        apply: (t) => {
          t.repeatRule = rule;
          t.repeatStart = start;
        },
        write: () => window.electronAPI.updateTaskRepeat(task.id, rule, start),
      });
    }
  }

  // done -- only `true` is ever assignable
  if (template.done && !task.done) {
    changes.push({
      field: 'done',
      chip: 'Done',
      apply: (t) => {
        t.done = true;
      },
      write: () => window.electronAPI.updateTaskDone(task.id, true),
    });
  }

  const matchedBefore = taskInColumn(task, to);
  const simulated = cloneTask(task);
  changes.forEach((c) => c.apply(simulated));
  const matchesAfter = taskInColumn(simulated, to);
  const staysInSource = from.kind === 'smart' ? taskInColumn(simulated, from) : false;

  if (changes.length === 0 && matchedBefore) {
    return {
      verdict: 'noop',
      changes: [],
      skipped,
      note: `Already matches "${destinationLabel}".`,
      staysInSource: from.kind === 'smart' ? staysInSource : true,
      sourceLabel,
      destinationLabel,
    };
  }

  if (changes.length === 0 && !matchedBefore) {
    return {
      verdict: 'blocked',
      changes: [],
      skipped,
      note:
        `"${destinationLabel}" filters on something a move can't set` +
        (skipped.length ? ` (${skipped.join('; ')})` : ` (${unparse(parsed.ast!)})`) +
        `. Open the task to edit it.`,
      staysInSource: true,
      sourceLabel,
      destinationLabel,
    };
  }

  if (skipped.length > 0 && !matchesAfter) {
    return {
      verdict: 'best-effort',
      changes,
      skipped,
      note:
        `These changes don't cover the whole filter, so the task may not stay in ` +
        `"${destinationLabel}".` +
        sourceNote(staysInSource),
      staysInSource,
      sourceLabel,
      destinationLabel,
    };
  }

  return {
    verdict: 'deterministic',
    changes,
    skipped,
    note: `The task will appear in "${destinationLabel}".` + sourceNote(staysInSource),
    staysInSource,
    sourceLabel,
    destinationLabel,
  };
};

export const snapshotTaskForBoard = (task: Task): BoardMoveSnapshot => ({
  taskId: task.id,
  listId: task.listId ?? null,
  priority: task.priority ?? 'none',
  tagIds: [...(task.tagIds ?? [])],
  reminderDate: task.reminderDate ?? null,
  reminderTime: task.reminderTime ?? null,
  repeatRule: task.repeatRule ?? null,
  repeatStart: task.repeatStart ?? null,
  done: task.done,
});

const isErr = (value: unknown): value is { error: string } =>
  Boolean(value) && typeof value === 'object' && 'error' in (value as Record<string, unknown>);

/** Write every snapshot field back through the per-attribute IPC. Used for Undo and rollback. */
export const restoreTaskFromSnapshot = async (snapshot: BoardMoveSnapshot): Promise<void> => {
  const { taskId } = snapshot;
  await window.electronAPI.updateTaskList(taskId, snapshot.listId);
  await window.electronAPI.updateTaskPriority(taskId, snapshot.priority);
  await window.electronAPI.setTaskTags(taskId, snapshot.tagIds);
  await window.electronAPI.updateTaskReminder(taskId, snapshot.reminderDate, snapshot.reminderTime);
  await window.electronAPI.updateTaskRepeat(taskId, snapshot.repeatRule, snapshot.repeatStart);
  await window.electronAPI.updateTaskDone(taskId, snapshot.done);
};

export type BoardApplyResult =
  | { ok: true }
  | { ok: false; rolledBack: boolean; message: string };

/**
 * Apply a plan's changes with sequential per-attribute writes. On any failure, every attribute
 * is rolled back from the pre-move snapshot so a half-changed task is never left.
 */
export const applyBoardMove = async (
  plan: BoardMovePlan,
  snapshot: BoardMoveSnapshot,
): Promise<BoardApplyResult> => {
  for (let i = 0; i < plan.changes.length; i += 1) {
    let result: unknown;
    try {
      result = await plan.changes[i].write();
    } catch (error) {
      result = { error: error instanceof Error ? error.message : String(error) };
    }
    if (isErr(result)) {
      let rolledBack = true;
      try {
        await restoreTaskFromSnapshot(snapshot);
      } catch {
        rolledBack = false;
      }
      return { ok: false, rolledBack, message: result.error };
    }
  }
  return { ok: true };
};
