export type ConceptPriority = 'none' | 'low' | 'medium' | 'high';

export type ConceptTaskFixture = Readonly<{
  id: string;
  title: string;
  dueLabel: string;
  priority: ConceptPriority;
  completed: boolean;
  tags: readonly string[];
  details?: string;
  detailsExpanded?: boolean;
  /** RFC5545-style RRULE, rendered through the production `repeatSummaryFromRule` helper. */
  repeatRule?: string;
}>;

export type ConceptUiFixture = Readonly<{
  id: string;
  label: string;
  nowIso: string;
  activeList: string;
  draft: string;
  availableTags: readonly Readonly<{ label: string; color: string }>[];
  tasks: readonly ConceptTaskFixture[];
  errorMessage?: string;
}>;

const freezeFixture = (fixture: ConceptUiFixture): ConceptUiFixture =>
  Object.freeze({
    ...fixture,
    availableTags: Object.freeze(
      fixture.availableTags.map((tag) => Object.freeze({ ...tag })),
    ),
    tasks: Object.freeze(
      fixture.tasks.map((task) =>
        Object.freeze({ ...task, tags: Object.freeze([...task.tags]) }),
      ),
    ),
  });

const sharedTags = Object.freeze([
  Object.freeze({ label: 'Design', color: '#b8d8ff' }),
  Object.freeze({ label: 'Planning', color: '#ffd6a5' }),
  Object.freeze({ label: 'Personal', color: '#caffbf' }),
]);

export const populatedConceptFixture = freezeFixture({
  id: 'concept-populated-v1',
  label: 'Populated planning day',
  nowIso: '2026-08-24T09:30:00+02:00',
  activeList: 'Today',
  draft: 'Prepare design review',
  availableTags: sharedTags,
  tasks: [
    {
      id: 'task-review',
      title: 'Review Quick Add brief',
      dueLabel: 'Today, 10:00',
      priority: 'high',
      completed: false,
      tags: ['Design'],
      details:
        '## Review scope\nCompare **three Quick Add directions** using `production styles`.\n- Confirm desktop and mobile behavior\n- Record open questions\n---\nKeep the evidence deterministic.',
      detailsExpanded: true,
    },
    {
      id: 'task-notes',
      title: 'Consolidate research notes',
      dueLabel: 'Today, 14:30',
      priority: 'medium',
      completed: false,
      tags: ['Planning'],
      details: '**Source notes** use the `fixed research fixture`.',
      detailsExpanded: false,
    },
    {
      id: 'task-groceries',
      title: 'Pick up groceries',
      dueLabel: 'Today, 18:00',
      priority: 'low',
      completed: true,
      tags: ['Personal'],
    },
  ],
});

export const emptyConceptFixture = freezeFixture({
  id: 'concept-empty-v1',
  label: 'Empty list',
  nowIso: '2026-08-24T09:30:00+02:00',
  activeList: 'Someday',
  draft: '',
  availableTags: sharedTags,
  tasks: [],
});

export const errorConceptFixture = freezeFixture({
  id: 'concept-error-v1',
  label: 'Recoverable save error',
  nowIso: '2026-08-24T09:30:00+02:00',
  activeList: 'Today',
  draft: 'Schedule project follow-up',
  availableTags: sharedTags,
  tasks: populatedConceptFixture.tasks.slice(0, 2),
  errorMessage: 'Could not save the task. Keep the draft and try again.',
});

export const conceptFixtureCatalog = Object.freeze([
  populatedConceptFixture,
  emptyConceptFixture,
  errorConceptFixture,
]);

// ---------- P2.1 reopened: app-shell fixture (sidebar, list/smart-list variety, recurring
// tasks and reminders) ----------
//
// The catalog above deliberately stays a flat, single-list task set: it is the smallest
// deterministic surface for comparing task-row presentation. The app-shell fixture below is a
// separate, richer data set for demonstrating the sidebar (Lists/Smart lists/Tags), multiple
// lists, a smart list, an "All lists" aggregate, and recurring/reminder task states -- the four
// gaps the user identified when P2.1 was reopened on 2026-08-25.

export type ConceptListFixture = Readonly<{ id: string; name: string }>;
export type ConceptSmartListFixture = Readonly<{ id: string; name: string; query: string }>;
export type ConceptTagPanelFixture = Readonly<{ id: string; label: string; color: string }>;

export type ConceptViewKey = 'all' | 'list-work' | 'list-personal' | 'smart-today';

export type ConceptShellFixture = Readonly<{
  id: string;
  label: string;
  nowIso: string;
  lists: readonly ConceptListFixture[];
  smartLists: readonly ConceptSmartListFixture[];
  tags: readonly ConceptTagPanelFixture[];
  tasksByView: Readonly<Record<ConceptViewKey, readonly ConceptTaskFixture[]>>;
  initialViewKey: ConceptViewKey;
}>;

const shellReview: ConceptTaskFixture = {
  id: 'shell-task-review',
  title: 'Review Quick Add brief',
  dueLabel: 'Today, 10:00',
  priority: 'high',
  completed: false,
  tags: ['Design'],
};

const shellStandup: ConceptTaskFixture = {
  id: 'shell-task-standup',
  title: 'Daily design standup',
  dueLabel: 'Today, 09:00',
  priority: 'medium',
  completed: false,
  tags: ['Urgent'],
  repeatRule: 'FREQ=DAILY',
};

const shellNotes: ConceptTaskFixture = {
  id: 'shell-task-notes',
  title: 'Consolidate research notes',
  dueLabel: '',
  priority: 'medium',
  completed: false,
  tags: ['Planning'],
  repeatRule: 'FREQ=WEEKLY;BYDAY=MO',
};

const shellGroceries: ConceptTaskFixture = {
  id: 'shell-task-groceries',
  title: 'Pick up groceries',
  dueLabel: 'Today, 18:00',
  priority: 'low',
  completed: true,
  tags: [],
};

export const conceptShellFixture: ConceptShellFixture = Object.freeze({
  id: 'concept-shell-v1',
  label: 'App shell with sidebar',
  nowIso: '2026-08-25T09:30:00+02:00',
  lists: Object.freeze([
    Object.freeze({ id: 'list-work', name: 'Work' }),
    Object.freeze({ id: 'list-personal', name: 'Personal' }),
  ]),
  smartLists: Object.freeze([
    Object.freeze({ id: 'smart-today', name: 'Today', query: 'due:today' }),
  ]),
  tags: Object.freeze([
    Object.freeze({ id: 'tag-design', label: 'Design', color: '#b8d8ff' }),
    Object.freeze({ id: 'tag-planning', label: 'Planning', color: '#ffd6a5' }),
    Object.freeze({ id: 'tag-urgent', label: 'Urgent', color: '#ffadad' }),
  ]),
  tasksByView: Object.freeze({
    all: Object.freeze([shellReview, shellStandup, shellNotes, shellGroceries]),
    'list-work': Object.freeze([shellReview, shellStandup, shellNotes]),
    'list-personal': Object.freeze([shellGroceries]),
    'smart-today': Object.freeze([shellReview, shellStandup]),
  }),
  initialViewKey: 'all',
});
