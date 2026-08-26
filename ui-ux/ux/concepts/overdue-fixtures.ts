import { formatDate } from '../../../src/renderer/helpers';
import { populatedConceptFixture, type ConceptTaskFixture } from './fixtures';

/**
 * Deterministic fixture set for the "how do we show a task is overdue" exploration.
 *
 * Everything here is frozen and clock-free: `OVERDUE_NOW_ISO` is the only "now" in the file and
 * `isOverdue` compares against it explicitly, so no story path can reach `Date.now()`. Due labels
 * are produced by production `formatDate` with an explicit format argument rather than
 * `state.dateFormat`, which keeps the rendered strings identical between runs and machines.
 */
export const OVERDUE_NOW_ISO = '2026-08-26T09:30:00+02:00';

/** The date format the concept renders with; production reads this from settings instead. */
const CONCEPT_DATE_FORMAT = 'YYYY-MM-DD';

/** Fixed offset for every fixture timestamp, so parsing never depends on the host time zone. */
const FIXTURE_UTC_OFFSET = '+02:00';

export type OverdueTaskFixture = ConceptTaskFixture &
  Readonly<{
    /** `YYYY-MM-DD` due date, or null for a task with no date. */
    dueDate: string | null;
    /** `HH:MM` due time, or null when the task is date-only. */
    dueTime: string | null;
  }>;

const OVERDUE_NOW_MS = Date.parse(OVERDUE_NOW_ISO);

/**
 * A task counts as overdue when it has a due date, that moment is strictly in the past relative to
 * the fixed clock, and it is not completed. Completion wins deliberately: a finished task with an
 * old date is not a problem the list needs to shout about.
 */
export const isOverdue = (task: OverdueTaskFixture, nowIso: string = OVERDUE_NOW_ISO): boolean => {
  if (task.completed || !task.dueDate) return false;
  const due = Date.parse(`${task.dueDate}T${task.dueTime ?? '23:59'}:00${FIXTURE_UTC_OFFSET}`);
  const now = nowIso === OVERDUE_NOW_ISO ? OVERDUE_NOW_MS : Date.parse(nowIso);
  return due < now;
};

type OverdueTaskSeed = Omit<ConceptTaskFixture, 'dueLabel'> &
  Readonly<{ dueDate: string | null; dueTime: string | null }>;

/** Mirrors production's `task-reminder-text` composition in `src/renderer/tasks.ts`. */
const makeTask = (seed: OverdueTaskSeed): OverdueTaskFixture => {
  const parts: string[] = [];
  if (seed.dueDate) parts.push(formatDate(seed.dueDate, CONCEPT_DATE_FORMAT));
  if (seed.dueTime) parts.push(seed.dueTime);
  return Object.freeze({
    ...seed,
    tags: Object.freeze([...seed.tags]),
    dueLabel: parts.join(' '),
  });
};

export const overdueAvailableTags = populatedConceptFixture.availableTags;

const taskBrief = makeTask({
  id: 'overdue-fixture-brief',
  title: 'Review the Quick Add brief',
  dueDate: '2026-08-27',
  dueTime: '10:00',
  priority: 'high',
  completed: false,
  tags: ['Design'],
});

const taskNotes = makeTask({
  id: 'overdue-fixture-notes',
  title: 'Consolidate research notes',
  dueDate: '2026-08-26',
  dueTime: '14:30',
  priority: 'medium',
  completed: false,
  tags: ['Planning'],
});

const taskGroceries = makeTask({
  id: 'overdue-fixture-groceries',
  title: 'Pick up groceries',
  dueDate: null,
  dueTime: null,
  priority: 'low',
  completed: false,
  tags: ['Personal'],
});

const taskInvoices = makeTask({
  id: 'overdue-fixture-invoices',
  title: 'Send the August invoices',
  dueDate: '2026-08-24',
  dueTime: '17:00',
  priority: 'high',
  completed: false,
  tags: ['Planning'],
});

/** Long-content case: the title must wrap without pushing the overdue signal out of the row. */
const taskPassport = makeTask({
  id: 'overdue-fixture-passport',
  title:
    'Renew the passport application before the consulate appointment window closes at the end of the month',
  dueDate: '2026-08-19',
  dueTime: '09:00',
  priority: 'medium',
  completed: false,
  tags: ['Personal'],
});

/** Overdue plus a repeat summary, so the meta line already carries two facts before any marker. */
const taskStandup = makeTask({
  id: 'overdue-fixture-standup',
  title: 'Daily design standup',
  dueDate: '2026-08-25',
  dueTime: '09:00',
  priority: 'medium',
  completed: false,
  tags: ['Design'],
  repeatRule: 'FREQ=DAILY',
});

/** Edge case: a past due date on a completed task must stay untreated in every alternative. */
const taskArchive = makeTask({
  id: 'overdue-fixture-archive',
  title: 'Archive the Q2 retro board',
  dueDate: '2026-08-20',
  dueTime: '12:00',
  priority: 'low',
  completed: true,
  tags: ['Planning'],
});

export type OverdueScenario = Readonly<{
  id: string;
  label: string;
  description: string;
  tasks: readonly OverdueTaskFixture[];
}>;

export const overdueScenarios: readonly OverdueScenario[] = Object.freeze([
  Object.freeze({
    id: 'overdue-scenario-none',
    label: 'No overdue tasks',
    description:
      'Baseline. Nothing here is past its due date, so the list must look exactly like production does today.',
    tasks: Object.freeze([taskBrief, taskNotes, taskGroceries]),
  }),
  Object.freeze({
    id: 'overdue-scenario-one',
    label: 'One overdue task',
    description:
      'A single past-due task among current ones. This is the case the treatment has to win at: one row must separate from three.',
    tasks: Object.freeze([taskBrief, taskInvoices, taskNotes, taskGroceries]),
  }),
  Object.freeze({
    id: 'overdue-scenario-many',
    label: 'Several overdue tasks, mixed with normal ones',
    description:
      'Three overdue rows (one with a long wrapping title, one recurring) plus a completed past-due task that must stay untreated, and two current tasks.',
    tasks: Object.freeze([
      taskInvoices,
      taskPassport,
      taskBrief,
      taskStandup,
      taskNotes,
      taskArchive,
      taskGroceries,
    ]),
  }),
]);

export const overdueCount = (tasks: readonly OverdueTaskFixture[]): number =>
  tasks.filter((task) => isOverdue(task)).length;
