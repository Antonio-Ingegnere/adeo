export type ConceptPriority = 'none' | 'low' | 'medium' | 'high';

export type ConceptTaskFixture = Readonly<{
  id: string;
  title: string;
  dueLabel: string;
  priority: ConceptPriority;
  completed: boolean;
  tags: readonly string[];
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
    },
    {
      id: 'task-notes',
      title: 'Consolidate research notes',
      dueLabel: 'Today, 14:30',
      priority: 'medium',
      completed: false,
      tags: ['Planning'],
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
