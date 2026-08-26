import type { Meta, StoryObj } from '@storybook/html-vite';

import { createProductionTaskPreview } from './production-task-preview';
import {
  OVERDUE_NOW_ISO,
  isOverdue,
  overdueAvailableTags,
  overdueCount,
  overdueScenarios,
  type OverdueScenario,
  type OverdueTaskFixture,
} from './overdue-fixtures';
import './overdue-treatments.css';

/**
 * Exploration only. Three ways to say "this task is past its due date and is not done", all built
 * on the *same* production task-row DOM: `createProductionTaskPreview` renders the real
 * `.task-row` / `.task-main` / `.task-reminder` / `.task-reminder-text` structure, and each
 * treatment is applied afterwards as a decoration pass keyed by `data-task-id`. No alternative
 * forks the row builder, so a fidelity drift between a concept and production is not possible
 * here by construction.
 *
 * No direction is approved. Only the user can choose one.
 */

type TreatmentId = 'meta' | 'chip' | 'rail';

type TreatmentNotes = Readonly<{
  id: TreatmentId;
  name: string;
  whatItIs: string;
  reusedFromProduction: readonly string[];
  benefits: readonly string[];
  tradeoffs: readonly string[];
  complexity: string;
  keyboardAndAccessibility: readonly string[];
  platforms: Readonly<Record<'Desktop (Electron)' | 'Web' | 'Mobile / touch', string>>;
}>;

const treatments: Readonly<Record<TreatmentId, TreatmentNotes>> = {
  meta: {
    id: 'meta',
    name: 'A — Overdue meta emphasis',
    whatItIs:
      'The existing meta line under the task title states the condition in words. A small warning glyph and the word "Overdue" lead the line, and the due date behind it switches to --danger at weight 600. No new box, no change to row geometry.',
    reusedFromProduction: [
      '.task-row, .task-main, .task-reminder, .task-reminder-text (unchanged markup)',
      '--danger / --font-xs / --space-4 tokens',
      'The repeat summary and tag chips keep their existing position in the same line',
    ],
    benefits: [
      'Smallest possible delta: one class on the row plus one span inside a line that already exists.',
      'The word "Overdue" is literal text, so the state is not carried by hue alone (principles.md 5).',
      'Costs no vertical space, so list density at 390px is unchanged.',
    ],
    tradeoffs: [
      'Scans weakly at a distance: at 11px the emphasis competes with tag chips already on that line.',
      'Measured: in a ~315px-wide column the overdue meta line overflowed the row (.task-row scrollWidth 375 vs clientWidth 315). Production .task-reminder is inline-flex with non-shrinking, nowrap children, so adopting A means allowing that line to wrap.',
      'It does not distinguish "overdue" from "due soon" any more strongly than the date already does.',
    ],
    complexity:
      'Low. One derived boolean on the task, one CSS rule, one inserted span in the existing reminder branch of createTaskElement.',
    keyboardAndAccessibility: [
      'No new focus stop and no change to the roving task cursor; Tab and Arrow behaviour are untouched.',
      'The glyph is aria-hidden; the word "Overdue" is real text, so it is announced as part of the row.',
      'Measured in the rendered story: the "Overdue" flag text is 7.33:1 (light) and 6.56:1 (dark) against its effective background. The state also survives a greyscale check because of the word.',
    ],
    platforms: {
      'Desktop (Electron)': 'Works as-is; no layout or menu implications.',
      Web: 'Portable with no assumption beyond the token set.',
      'Mobile / touch':
        'Cheapest of the three on a narrow row, but the meta line must be allowed to wrap; it is currently inline-flex with nowrap children.',
    },
  },
  chip: {
    id: 'chip',
    name: 'B — Overdue chip',
    whatItIs:
      'The due date stays in its normal muted ink, and a discrete "Overdue" chip is added to the front of the meta line, using the metrics of the existing tag/template chips (11px, 1px border, 9px radius) with the danger token pair.',
    reusedFromProduction: [
      '.task-reminder as the chip host; chip metrics copied from .tag-filter-chip / .template-chip',
      '--danger, --danger-bg tokens (already the pairing used by error surfaces)',
      'Row markup and priority checkbox untouched',
    ],
    benefits: [
      'Uses an object Adeo already has a vocabulary for; a chip reads as "a fact about this task".',
      'The due date keeps its normal ink, so the date is still read as data rather than as an alarm.',
      'Filled shape scans noticeably better than coloured text at a glance.',
    ],
    tradeoffs: [
      'The meta line now holds a chip plus a date plus possibly a repeat summary plus tag chips — a real crowding risk, worst on a recurring, tagged, long-titled task. It shares A’s measured need to let that line wrap.',
      'Chips in this app are mostly interactive (tag chips filter). A non-interactive chip is a new sub-pattern and may invite a click.',
      'Adds ~2px to the meta line height, which multiplies down a long list.',
    ],
    complexity:
      'Low to medium. New chip class plus the decision about whether the chip is inert or becomes a filter affordance later.',
    keyboardAndAccessibility: [
      'Rendered as a span, not a button: it adds no tab stop and no keyboard target that does nothing.',
      'Label text is announced; no ARIA needed. If it ever becomes interactive it must become a real button with an accessible name.',
      'Measured in the rendered story: chip label on --danger-bg is 6.22:1 (light) and 5.94:1 (dark).',
    ],
    platforms: {
      'Desktop (Electron)': 'Fits the existing density; no other surface changes.',
      Web: 'Portable; chip is pure CSS.',
      'Mobile / touch':
        'Safe while inert. If it is made tappable it needs a 44x44 target, which this 18px-tall chip cannot provide without changing row height.',
    },
  },
  rail: {
    id: 'rail',
    name: 'C — Row rail and tint',
    whatItIs:
      'The state moves from the text to the row: a 3px --danger rail in the left gutter plus a --danger-bg row tint, with the meta line left exactly as production renders it. A visually-hidden "Overdue" is added for assistive technology, since nothing visible carries the word.',
    reusedFromProduction: [
      '.task-row (position: relative already), .visually-hidden utility, --radius-s',
      '--danger and --danger-bg tokens',
      'Meta line, tags, priority checkbox and details expander are untouched',
    ],
    benefits: [
      'By far the strongest scan: you can count overdue rows without reading a single date.',
      'Leaves the meta line alone, so recurring and heavily tagged tasks do not get more crowded.',
      'Two independent signals (rail edge and fill) rather than one, so it survives a low-saturation display.',
    ],
    tradeoffs: [
      'Loudest option; a list with many overdue tasks becomes a wall of tint, which is exactly when the user is least helped by alarm.',
      'Nothing visible says the word "overdue" — the meaning is learned, and the visually-hidden text is the only literal statement. This is the weakest of the three against principles.md 5.',
      'Observed in the rendered story: two consecutive overdue rows merge into a single tinted block, because the tint fills the row and the .task-row::after divider is suppressed. Grouped overdue tasks stop reading as separate rows.',
      'Real geometry change: production .task-row has no left padding, so every row must be indented to keep one text baseline. The tint also collides with the .task-row.focused inset ring and the ::after divider, both of which need rules.',
    ],
    complexity:
      'Medium. Row-level class plus indent, divider suppression, focus-ring interaction, and a hidden-text affordance; also needs a decision about drag/hover/selected states over a tinted row.',
    keyboardAndAccessibility: [
      'Adds no tab stop, but the tint sits under the .task-row.focused outline (--accent-focus, inset 2px) — that pairing needs direct checking, not assumption.',
      'Requires the visually-hidden "Overdue" span; without it the state is colour-only and fails.',
      'Measured over the tint: task title 13.5:1 (light) / 12.16:1 (dark) and the due-date meta line 4.87:1 (light) / 6.43:1 (dark) — the meta line is the tight one and would fail if the tint were darkened. The rail itself is a colour-only edge and cannot be the sole indicator.',
    ],
    platforms: {
      'Desktop (Electron)': 'Needs review against drag-and-drop states: .dragging sets opacity and the drop indicator sits between rows.',
      Web: 'Portable, but the same focus/selection interactions apply.',
      'Mobile / touch':
        'Best of the three at 390px because the signal is not competing for meta-line width; the left gutter is free once the hover-only drag handle is not shown.',
    },
  },
};

const warningGlyph = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 2 1 21h22L12 2zm1 15h-2v-2h2v2zm0-4h-2V8h2v5z" />
  </svg>
`;

const createVisuallyHiddenOverdue = (): HTMLSpanElement => {
  const hidden = document.createElement('span');
  hidden.className = 'visually-hidden';
  hidden.textContent = 'Overdue. ';
  return hidden;
};

const createMetaFlag = (): HTMLSpanElement => {
  const flag = document.createElement('span');
  flag.className = 'ovd-flag';
  flag.innerHTML = warningGlyph;
  flag.append(document.createTextNode('Overdue'));
  return flag;
};

const createOverdueChip = (): HTMLSpanElement => {
  const chip = document.createElement('span');
  chip.className = 'ovd-chip';
  chip.textContent = 'Overdue';
  return chip;
};

/**
 * The single point where a treatment touches the production DOM. It only adds a class to the row
 * and inserts one marker element into the meta line that production already renders; it never
 * rewrites or replaces production markup.
 */
const decorateOverdue = (
  list: HTMLElement,
  tasks: readonly OverdueTaskFixture[],
  treatment: TreatmentId,
): void => {
  list.classList.add(`ovd--${treatment}`);
  tasks.filter((task) => isOverdue(task)).forEach((task) => {
    const row = list.querySelector<HTMLElement>(`.task-row[data-task-id="${task.id}"]`);
    if (!row) throw new Error(`Overdue concept could not find a rendered row for ${task.id}.`);
    row.classList.add('ovd-overdue');
    const meta = row.querySelector<HTMLElement>('.task-reminder');
    if (!meta) throw new Error(`Overdue concept expected a .task-reminder line on ${task.id}.`);
    if (treatment === 'meta') meta.prepend(createMetaFlag());
    else if (treatment === 'chip') meta.prepend(createOverdueChip());
    else meta.prepend(createVisuallyHiddenOverdue());
  });
};

const appendList = (parent: HTMLElement, heading: string, items: readonly string[]): void => {
  const section = document.createElement('section');
  const title = document.createElement('h3');
  title.textContent = heading;
  const list = document.createElement('ul');
  items.forEach((item) => {
    const entry = document.createElement('li');
    entry.textContent = item;
    list.append(entry);
  });
  section.append(title, list);
  parent.append(section);
};

const createNotes = (notes: TreatmentNotes): HTMLElement => {
  const wrapper = document.createElement('div');
  wrapper.className = 'ovd-notes';
  appendList(wrapper, 'Reused from production', notes.reusedFromProduction);
  appendList(wrapper, 'Benefits', notes.benefits);
  appendList(wrapper, 'Trade-offs', notes.tradeoffs);
  appendList(wrapper, 'Keyboard and accessibility', notes.keyboardAndAccessibility);
  appendList(
    wrapper,
    'Desktop / web / mobile',
    Object.entries(notes.platforms).map(([platform, text]) => `${platform}: ${text}`),
  );
  appendList(wrapper, 'Implementation complexity', [notes.complexity]);
  return wrapper;
};

const createStatePanel = (scenario: OverdueScenario, treatment: TreatmentId): HTMLElement => {
  const panel = document.createElement('article');
  panel.className = 'ovd-state';
  panel.dataset.scenarioId = scenario.id;

  const heading = document.createElement('h3');
  heading.textContent = scenario.label;

  const description = document.createElement('p');
  description.textContent = scenario.description;

  const meta = document.createElement('p');
  meta.className = 'ovd-state__meta';
  meta.textContent = `${scenario.tasks.length} tasks · ${overdueCount(scenario.tasks)} overdue · now ${OVERDUE_NOW_ISO}`;

  const preview = createProductionTaskPreview({
    tasks: scenario.tasks,
    availableTags: overdueAvailableTags,
  });
  decorateOverdue(preview, scenario.tasks, treatment);

  panel.append(heading, description, meta, preview);
  return panel;
};

/**
 * The board root is a `<main>` landmark, not a plain div: axe's `region` and `landmark-one-main`
 * best-practice rules fire on every top-level node otherwise, and that noise is story chrome
 * rather than a finding about any of the three treatments.
 */
const createBoard = (children: readonly HTMLElement[], intro: string): HTMLElement => {
  const board = document.createElement('main');
  board.className = 'ovd-board';

  const inner = document.createElement('div');
  inner.className = 'ovd-board__inner';

  const header = document.createElement('header');
  header.className = 'ovd-board__header';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'ovd-eyebrow';
  eyebrow.textContent = 'Concept — not approved';
  const title = document.createElement('h1');
  title.textContent = 'Overdue task treatments';
  const lead = document.createElement('p');
  lead.textContent = intro;
  header.append(eyebrow, title, lead);

  const notice = document.createElement('p');
  notice.className = 'ovd-notice';
  notice.textContent = `Exploration only — no direction has been chosen and only the user can approve one. Every row below is the production task-row DOM produced by createProductionTaskPreview; the treatment is applied on top of it. The clock is fixed at ${OVERDUE_NOW_ISO}, so "overdue" never depends on when this story is opened.`;

  inner.append(header, notice, ...children);
  board.append(inner);
  return board;
};

const createTreatmentStory = (treatment: TreatmentId): HTMLElement => {
  const notes = treatments[treatment];

  const card = document.createElement('section');
  card.className = 'ovd-card';
  card.dataset.treatment = treatment;

  const title = document.createElement('h2');
  title.textContent = notes.name;
  const summary = document.createElement('p');
  summary.textContent = notes.whatItIs;

  const states = document.createElement('div');
  states.className = 'ovd-states';
  overdueScenarios.forEach((scenario) => states.append(createStatePanel(scenario, treatment)));

  card.append(title, summary, createNotes(notes), states);

  return createBoard(
    [card],
    'One alternative for marking a task whose due date has passed while it is still open. Compare it against the other two before deciding anything.',
  );
};

const meta: Meta = {
  title: 'Concepts/Overdue task treatments',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Three non-production ways to show that a task is overdue, rendered on the real production task-row DOM with a fixed clock. Exploration only; no direction is approved.',
      },
    },
  },
};

export default meta;
type Story = StoryObj;

export const AMetaEmphasis: Story = {
  name: 'A — Overdue meta emphasis',
  render: () => createTreatmentStory('meta'),
};

export const BOverdueChip: Story = {
  name: 'B — Overdue chip',
  render: () => createTreatmentStory('chip'),
};

export const CRowRailAndTint: Story = {
  name: 'C — Row rail and tint',
  render: () => createTreatmentStory('rail'),
};

export const CompareAlternatives: Story = {
  name: 'Compare A / B / C',
  render: () => {
    const compare = document.createElement('div');
    compare.className = 'ovd-compare';

    (['meta', 'chip', 'rail'] as const).forEach((treatment) => {
      const card = document.createElement('section');
      card.className = 'ovd-card';
      card.dataset.treatment = treatment;

      const title = document.createElement('h2');
      title.textContent = treatments[treatment].name;
      const summary = document.createElement('p');
      summary.textContent = treatments[treatment].whatItIs;

      const states = document.createElement('div');
      states.className = 'ovd-states';
      overdueScenarios.forEach((scenario) => states.append(createStatePanel(scenario, treatment)));

      card.append(title, summary, states);
      compare.append(card);
    });

    return createBoard(
      [compare],
      'The same three data states under each alternative, side by side at wide viewports and stacked below 1024px.',
    );
  },
};
