import type { Meta, StoryObj } from '@storybook/html-vite';

import { setPriorityAttr } from '../../../src/renderer/theme';
import {
  conceptShellFixture,
  emptyConceptFixture,
  errorConceptFixture,
  populatedConceptFixture,
  type ConceptShellFixture,
  type ConceptTagPanelFixture,
  type ConceptTaskFixture,
  type ConceptUiFixture,
} from './fixtures';
import { createAppShellPreview, type AppShellPreviewHandle } from './app-shell-preview';
import './quick-add-pilot.css';

type Direction = 'inline' | 'smart' | 'presets';
type FixtureKey = 'populated' | 'empty' | 'error';
type ListChoice = 'current' | 'none' | 'work' | 'personal';
type PriorityChoice = 'none' | 'low' | 'medium' | 'high';
type MetadataKind = 'list' | 'priority' | 'reminderDate';

type ConceptModel = {
  fixtureKey: FixtureKey;
  draft: string;
  tasks: ConceptTaskFixture[];
  list: ListChoice;
  priority: PriorityChoice;
  reminderDate: string;
  smartManual: MetadataDefaults;
  ignoredMetadataSyntax: MetadataKind[];
  status: string;
  error: string;
};

type DirectionNotes = {
  title: string;
  summary: string;
  goal: string;
  benefits: readonly string[];
  tradeoffs: readonly string[];
  complexity: string;
  keyboard: string;
  accessibility: string;
  escape: string;
  emptyError: string;
};

const fixtures: Record<FixtureKey, ConceptUiFixture> = {
  populated: populatedConceptFixture,
  empty: emptyConceptFixture,
  error: errorConceptFixture,
};

const quickTaskTags: readonly ConceptTagPanelFixture[] =
  populatedConceptFixture.availableTags.map((tag, index) => ({
    id: `quick-task-tag-${index}`,
    label: tag.label,
    color: tag.color,
  }));

const createQuickTaskShellFixture = (
  fixtureKey: FixtureKey,
  tasks: readonly ConceptTaskFixture[],
): ConceptShellFixture => {
  const fixture = fixtures[fixtureKey];
  return {
    id: `quick-task-shell-${fixtureKey}`,
    label: fixture.label,
    nowIso: fixture.nowIso,
    lists: conceptShellFixture.lists,
    smartLists: conceptShellFixture.smartLists,
    tags: quickTaskTags,
    tasksByView: {
      all: tasks,
      'list-work': [],
      'list-personal': [],
      'smart-today': [],
    },
    initialViewKey: 'all',
  };
};

const notes: Record<Direction, DirectionNotes> = {
  inline: {
    title: 'Inline essentials',
    summary: 'Show the three production metadata fields together as soon as Quick Add opens.',
    goal: 'Let users scan and set list, priority, and reminder without opening another disclosure.',
    benefits: [
      'All consequential choices are visible and directly editable.',
      'The interaction is closest to the production Options panel, reducing implementation risk.',
      'Plain capture still works from the task field with Enter.',
    ],
    tradeoffs: [
      'The row is wider and visually busier than the other directions.',
      'Users who only want a title still pass three visible choices they may not need.',
    ],
    complexity:
      'Low. It composes the current list picker, priority picker, and native reminder-date input without a disclosure step.',
    keyboard:
      'Mod+N reveals the strip and focuses Task. Tab order is Task, Add, Task list, Priority, Reminder. Enter in Task submits; Arrow keys open and move within either menu; Enter selects.',
    accessibility:
      'The strip is a labelled group. Pickers expose aria-haspopup/aria-expanded, menu rows use menuitemradio with aria-checked, and the date retains a programmatic label. Save results use alert or polite status semantics.',
    escape:
      'Escape closes only the active list or priority menu first and restores its trigger. With no menu open, Escape hides the metadata strip and returns focus to Task; another Mod+N restores it.',
    emptyError:
      'Blank submit keeps focus in Task and announces the missing title. The empty fixture keeps the composer visible; the error fixture preserves title and metadata for retry.',
  },
  smart: {
    title: 'Smart capture',
    summary:
      'Keep one fast task field, recognize lightweight metadata shorthand, and confirm every interpretation before the task is added.',
    goal: 'Let users capture and organize in one pass without requiring command syntax or a prescribed field order.',
    benefits: [
      'Typing “tomorrow”, “!high”, or “#work” updates the effective metadata without leaving the task field.',
      'A live “Will apply” row makes parsing visible, reversible, and safe before Enter submits.',
      'Contextual defaults handle untouched fields, while one unified chooser keeps every field available in any order.',
    ],
    tradeoffs: [
      'Natural-language recognition needs conservative grammar, localization, and conflict rules.',
      'Shorthand is an accelerator rather than a complete replacement for visible controls.',
    ],
    complexity:
      'Medium–high. The concept uses a small deterministic grammar; production would need localized parsing, telemetry-informed aliases, and explicit precedence. The fallback reuses the production controls.',
    keyboard:
      'Mod+N reveals the surface and focuses Task. Enter adds the cleaned title with confirmed metadata. Tab reaches removable parsed chips, then Choose metadata; the unified panel supports the production menu and date-control keys in any order.',
    accessibility:
      'The input is described by visible syntax help. Parsed values are announced through a polite status; recognized chips are buttons with specific remove labels, while contextual-default chips remain non-interactive text.',
    escape:
      'Escape closes an open production menu first, then the unified metadata panel and restores its trigger, then the smart-capture support surface and restores Task. One press dismisses one layer.',
    emptyError:
      'A shorthand-only or blank title is rejected and focus returns to Task. Save failure preserves raw input, parsed confirmation, manual overrides, and the same retry path.',
  },
  presets: {
    title: 'Metadata presets',
    summary: 'Bundle common list, priority, and reminder combinations into one-keystroke choices.',
    goal: 'Apply a complete organization pattern with one action, while making the individual list, priority, and due-date fields obvious for exceptions.',
    benefits: [
      'Frequent task types become one click or one shortcut.',
      'A live “Will apply” summary communicates the effective metadata before submission.',
      'Choose list, priority, or due date exposes the same production fields when no preset fits.',
    ],
    tradeoffs: [
      'Preset names and defaults need validation against real usage patterns.',
      'Changing one field breaks the preset match, so the individual-choice control must clearly indicate that state.',
    ],
    complexity:
      'Medium. Preset application is small, but productizing it requires persistence, naming, and conflict rules; the exception path reuses production controls.',
    keyboard:
      'Mod+N reveals presets and focuses Task. Mod+1, Mod+2, or Mod+3 applies a bundle while focus stays in the composer. Tab reaches Task, Add, each preset, then Choose list, priority, or due date; Enter opens the individual production fields.',
    accessibility:
      'Presets are a labelled group of toggle buttons with aria-pressed and a polite selection announcement. The explicitly named individual-choice button owns the production panel through aria-controls/aria-expanded; the live “Will apply” status reports the effective values and all fields keep their production labels.',
    escape:
      'Escape closes a list/priority menu first, then the individual-choice panel and restores its trigger, then the preset row and restores Task. Each press dismisses exactly one layer.',
    emptyError:
      'Blank and failed submits preserve the chosen bundle and draft. The fixed error fixture demonstrates retry without mutating fixture data or generating IDs.',
  },
};

const meta: Meta = {
  title: 'Concepts/Quick task add metadata',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Three non-production approaches for choosing Quick Add metadata without a forced sequence. All compose controls reuse current Adeo production markup, classes, and tokens.',
      },
    },
  },
};

export default meta;
type Story = StoryObj;

const listLabels: Record<ListChoice, string> = {
  current: 'Current list',
  none: 'No list',
  work: 'Work',
  personal: 'Personal',
};

const priorityLabels: Record<PriorityChoice, string> = {
  none: 'None',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

const reminderLabels: Record<string, string> = {
  '': 'No reminder',
  '2026-08-24': 'Today',
  '2026-08-25': 'Tomorrow',
};

type MetadataDefaults = Pick<ConceptModel, 'list' | 'priority' | 'reminderDate'>;

const metadataDefaultsForFixture = (fixtureKey: FixtureKey): MetadataDefaults => ({
  list: fixtureKey === 'empty' ? 'current' : fixtureKey === 'error' ? 'personal' : 'work',
  priority: fixtureKey === 'error' ? 'high' : fixtureKey === 'empty' ? 'none' : 'medium',
  reminderDate: fixtureKey === 'empty' ? '' : fixtureKey === 'error' ? '2026-08-25' : '2026-08-24',
});

type ParsedMetadataDraft = Readonly<{
  title: string;
  list?: ListChoice;
  priority?: PriorityChoice;
  reminderDate?: string;
}>;

const listSyntax = /#(current|none|work|personal)\b/gi;
const prioritySyntax = /!(none|low|medium|high)\b/gi;
const reminderSyntax = /\b(today|tomorrow)\b/gi;

const lastSyntaxValue = <T extends string>(draft: string, pattern: RegExp): T | undefined => {
  const matches = Array.from(draft.matchAll(pattern));
  return matches.at(-1)?.[1]?.toLowerCase() as T | undefined;
};

const parseMetadataDraft = (
  draft: string,
  ignored: readonly MetadataKind[] = [],
): ParsedMetadataDraft => {
  const list = ignored.includes('list') ? undefined : lastSyntaxValue<ListChoice>(draft, listSyntax);
  const priority = ignored.includes('priority')
    ? undefined
    : lastSyntaxValue<PriorityChoice>(draft, prioritySyntax);
  const reminderWord = ignored.includes('reminderDate')
    ? undefined
    : lastSyntaxValue<'today' | 'tomorrow'>(draft, reminderSyntax);
  const title = (
    ignored.includes('list') ? draft : draft.replace(listSyntax, '')
  )
    .replace(ignored.includes('priority') ? /$^/ : prioritySyntax, '')
    .replace(ignored.includes('reminderDate') ? /$^/ : reminderSyntax, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return {
    title,
    list,
    priority,
    reminderDate:
      reminderWord === 'today' ? '2026-08-24' : reminderWord === 'tomorrow' ? '2026-08-25' : undefined,
  };
};

const removeMetadataSyntax = (
  draft: string,
  kind: MetadataKind,
): string => {
  const pattern =
    kind === 'list' ? listSyntax : kind === 'priority' ? prioritySyntax : reminderSyntax;
  return draft.replace(pattern, '').replace(/\s{2,}/g, ' ').trim();
};

const resetModel = (model: ConceptModel, fixtureKey: FixtureKey): void => {
  const fixture = fixtures[fixtureKey];
  const defaults = metadataDefaultsForFixture(fixtureKey);
  model.fixtureKey = fixtureKey;
  model.draft = fixture.draft;
  model.tasks = fixture.tasks.map((task) => ({ ...task, tags: [...task.tags] }));
  model.list = defaults.list;
  model.priority = defaults.priority;
  model.reminderDate = defaults.reminderDate;
  model.smartManual = { ...defaults };
  model.ignoredMetadataSyntax = [];
  model.status = '';
  model.error = fixture.errorMessage ?? '';
};

const makeButton = (label: string, className = ''): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  return button;
};

const appendNotesList = (parent: HTMLElement, heading: string, items: readonly string[]): void => {
  const section = document.createElement('section');
  const title = document.createElement('h3');
  title.textContent = heading;
  const list = document.createElement('ul');
  items.forEach((item) => {
    const row = document.createElement('li');
    row.textContent = item;
    list.append(row);
  });
  section.append(title, list);
  parent.append(section);
};

const createAnnotations = (direction: Direction): HTMLElement => {
  const copy = notes[direction];
  const aside = document.createElement('aside');
  aside.className = 'quick-add-notes';
  aside.setAttribute('aria-label', `${copy.title} evaluation notes`);

  const heading = document.createElement('h2');
  heading.textContent = 'Evaluation';
  const goalHeading = document.createElement('h3');
  goalHeading.textContent = 'User goal';
  const goal = document.createElement('p');
  goal.textContent = copy.goal;
  aside.append(heading, goalHeading, goal);
  appendNotesList(aside, 'Benefits', copy.benefits);
  appendNotesList(aside, 'Trade-offs', copy.tradeoffs);

  const details = [
    ['Implementation complexity', copy.complexity],
    ['Keyboard behavior and focus order', copy.keyboard],
    ['Accessibility behavior', copy.accessibility],
    ['Escape handling', copy.escape],
    ['Empty and error behavior', copy.emptyError],
  ] as const;
  details.forEach(([title, body]) => {
    const section = document.createElement('section');
    const sectionHeading = document.createElement('h3');
    sectionHeading.textContent = title;
    const paragraph = document.createElement('p');
    paragraph.textContent = body;
    section.append(sectionHeading, paragraph);
    aside.append(section);
  });
  return aside;
};

const createProductionAddButton = (submit: () => void): HTMLButtonElement => {
  const button = makeButton('', 'primary-button icon-btn');
  button.setAttribute('aria-label', 'Add task');
  button.innerHTML = `
    <svg class="icon-add" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z" fill="currentColor" />
    </svg>
  `;
  button.addEventListener('click', submit);
  return button;
};

const createProductionInputRow = (
  prefix: string,
  model: ConceptModel,
  submit: () => void,
): { row: HTMLDivElement; input: HTMLInputElement } => {
  const row = document.createElement('div');
  row.className = 'input-row';
  const inputWrap = document.createElement('div');
  inputWrap.className = 'add-task-input-wrap';
  const input = document.createElement('input');
  input.id = `${prefix}-message-input`;
  input.type = 'text';
  input.className = 'text-input';
  input.placeholder = 'Add a new task (⌘N)';
  input.value = model.draft;
  input.setAttribute('aria-label', 'Task');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', `${prefix}-tag-suggest-menu`);
  input.dataset.quickAddInput = 'true';
  input.addEventListener('input', () => {
    model.draft = input.value;
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submit();
  });

  const suggestions = document.createElement('div');
  suggestions.id = `${prefix}-tag-suggest-menu`;
  suggestions.className = 'tag-suggest-menu';
  suggestions.setAttribute('role', 'listbox');
  suggestions.setAttribute('aria-label', 'Tag suggestions');
  suggestions.style.display = 'none';
  inputWrap.append(input, suggestions);
  row.append(inputWrap, createProductionAddButton(submit));
  return { row, input };
};

type OptionControl = { element: HTMLDivElement; focus: () => void };

const createListControl = (
  prefix: string,
  model: ConceptModel,
  onChange: () => void,
): OptionControl => {
  const option = document.createElement('div');
  option.className = 'compose-option';
  const label = document.createElement('p');
  label.id = `${prefix}-list-label`;
  label.className = 'compose-option-label';
  label.textContent = 'Task list';

  const wrap = document.createElement('div');
  wrap.className = 'modal-list-select-wrap reminder-select-wrap';
  const picker = makeButton('', 'reminder-picker');
  picker.setAttribute('aria-haspopup', 'menu');
  picker.setAttribute('aria-expanded', 'false');
  picker.setAttribute('aria-labelledby', `${label.id} ${prefix}-list-value`);
  const value = document.createElement('span');
  value.id = `${prefix}-list-value`;
  const caret = document.createElement('span');
  caret.className = 'priority-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.textContent = '▾';
  picker.append(value, caret);

  const menu = document.createElement('div');
  menu.id = `${prefix}-list-menu`;
  menu.className = 'modal-list-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Task list');
  picker.setAttribute('aria-controls', menu.id);
  const choices = Object.keys(listLabels) as ListChoice[];

  const close = (restoreFocus: boolean): void => {
    menu.style.display = 'none';
    picker.setAttribute('aria-expanded', 'false');
    if (restoreFocus) picker.focus();
  };

  const paint = (): void => {
    value.textContent = listLabels[model.list];
    menu.querySelectorAll<HTMLButtonElement>('.modal-list-item').forEach((item) => {
      const selected = item.dataset.value === model.list;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-checked', String(selected));
    });
  };

  const select = (choice: ListChoice): void => {
    model.list = choice;
    paint();
    close(false);
    onChange();
  };

  choices.forEach((choice) => {
    const item = makeButton(listLabels[choice], 'modal-list-item');
    item.dataset.value = choice;
    item.setAttribute('role', 'menuitemradio');
    item.addEventListener('click', () => select(choice));
    menu.append(item);
  });

  const open = (edge: 'selected' | 'first' | 'last' = 'selected'): void => {
    menu.style.display = 'flex';
    picker.setAttribute('aria-expanded', 'true');
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('.modal-list-item'));
    const selectedIndex = Math.max(0, choices.indexOf(model.list));
    const index = edge === 'first' ? 0 : edge === 'last' ? items.length - 1 : selectedIndex;
    items[index]?.focus();
  };

  picker.addEventListener('click', () => {
    if (menu.style.display === 'flex') close(false);
    else open();
  });
  picker.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open(event.key === 'ArrowDown' ? 'first' : 'last');
    }
  });
  menu.addEventListener('keydown', (event) => {
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('.modal-list-item'));
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  });

  paint();
  wrap.append(picker, menu);
  option.append(label, wrap);
  return { element: option, focus: () => picker.focus() };
};

const createPriorityControl = (
  prefix: string,
  model: ConceptModel,
  onChange: () => void,
): OptionControl => {
  const option = document.createElement('div');
  option.className = 'compose-option';
  const label = document.createElement('p');
  label.id = `${prefix}-priority-label`;
  label.className = 'compose-option-label';
  label.textContent = 'Priority';

  const wrap = document.createElement('div');
  wrap.className = 'priority-select-wrap';
  const picker = makeButton('', 'priority-picker');
  picker.setAttribute('aria-haspopup', 'menu');
  picker.setAttribute('aria-expanded', 'false');
  picker.setAttribute('aria-labelledby', `${label.id} ${prefix}-priority-value`);
  const chip = document.createElement('span');
  chip.className = 'priority-chip';
  chip.setAttribute('aria-hidden', 'true');
  const value = document.createElement('span');
  value.id = `${prefix}-priority-value`;
  const caret = document.createElement('span');
  caret.className = 'priority-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.textContent = '▾';
  picker.append(chip, value, caret);

  const menu = document.createElement('div');
  menu.id = `${prefix}-priority-menu`;
  menu.className = 'priority-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Priority');
  picker.setAttribute('aria-controls', menu.id);
  const choices = Object.keys(priorityLabels) as PriorityChoice[];

  const close = (restoreFocus: boolean): void => {
    menu.style.display = 'none';
    picker.setAttribute('aria-expanded', 'false');
    if (restoreFocus) picker.focus();
  };

  const paint = (): void => {
    value.textContent = priorityLabels[model.priority];
    setPriorityAttr(chip, model.priority);
    menu.querySelectorAll<HTMLElement>('.priority-menu-item').forEach((item) => {
      item.setAttribute('aria-checked', String(item.dataset.value === model.priority));
    });
  };

  const select = (choice: PriorityChoice): void => {
    model.priority = choice;
    paint();
    close(false);
    onChange();
  };

  choices.forEach((choice) => {
    const item = document.createElement('div');
    item.className = 'priority-menu-item';
    item.dataset.value = choice;
    item.setAttribute('role', 'menuitemradio');
    item.tabIndex = -1;
    const itemChip = document.createElement('span');
    itemChip.className = `priority-chip priority-chip--${choice}`;
    itemChip.setAttribute('aria-hidden', 'true');
    const itemLabel = document.createElement('span');
    itemLabel.textContent = priorityLabels[choice];
    item.append(itemChip, itemLabel);
    item.addEventListener('click', () => select(choice));
    item.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      select(choice);
    });
    menu.append(item);
  });

  const open = (edge: 'selected' | 'first' | 'last' = 'selected'): void => {
    menu.style.display = 'flex';
    picker.setAttribute('aria-expanded', 'true');
    const items = Array.from(menu.querySelectorAll<HTMLElement>('.priority-menu-item'));
    const selectedIndex = Math.max(0, choices.indexOf(model.priority));
    const index = edge === 'first' ? 0 : edge === 'last' ? items.length - 1 : selectedIndex;
    items[index]?.focus();
  };

  picker.addEventListener('click', () => {
    if (menu.style.display === 'flex') close(false);
    else open();
  });
  picker.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open(event.key === 'ArrowDown' ? 'first' : 'last');
    }
  });
  menu.addEventListener('keydown', (event) => {
    const items = Array.from(menu.querySelectorAll<HTMLElement>('.priority-menu-item'));
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  });

  paint();
  wrap.append(picker, menu);
  option.append(label, wrap);
  return { element: option, focus: () => picker.focus() };
};

const createReminderControl = (
  prefix: string,
  model: ConceptModel,
  onChange: () => void,
): OptionControl => {
  const option = document.createElement('div');
  option.className = 'compose-option';
  const label = document.createElement('label');
  label.htmlFor = `${prefix}-reminder-date`;
  label.className = 'compose-option-label';
  label.textContent = 'Reminder';
  const input = document.createElement('input');
  input.id = label.htmlFor;
  input.type = 'date';
  input.className = 'reminder-date-input';
  input.min = '2026-08-24';
  input.value = model.reminderDate;
  input.addEventListener('change', () => {
    model.reminderDate = input.value;
    onChange();
  });
  option.append(label, input);
  return { element: option, focus: () => input.focus() };
};

const createMetadataSummary = (model: ConceptModel, label: string): HTMLDivElement => {
  const summary = document.createElement('div');
  summary.className = 'add-task-template';
  summary.style.display = 'flex';
  summary.setAttribute('role', 'status');
  summary.setAttribute('aria-label', label);
  const list = document.createElement('span');
  list.className = 'template-chip';
  list.textContent = listLabels[model.list];
  const priority = document.createElement('span');
  priority.className = 'template-chip';
  priority.textContent = `${priorityLabels[model.priority]} priority`;
  setPriorityAttr(priority, model.priority);
  const reminder = document.createElement('span');
  reminder.className = 'template-chip';
  reminder.textContent = reminderLabels[model.reminderDate] ?? model.reminderDate;
  summary.append(list, priority, reminder);
  return summary;
};

const isModN = (event: KeyboardEvent): boolean =>
  (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'n';

const attachQuickAddShortcut = (
  composer: HTMLElement,
  input: HTMLInputElement,
  reveal: () => void,
): void => {
  document.addEventListener('keydown', (event) => {
    // Storybook can replace a story without reloading its iframe. The connectivity guard keeps
    // detached concept instances inert, matching app-shell-preview's document listener pattern.
    if (!composer.isConnected || !isModN(event)) return;
    event.preventDefault();
    reveal();
    input.focus();
  });
};

const createInlineComposer = (
  model: ConceptModel,
  submit: () => void,
): { element: HTMLElement; input: HTMLInputElement } => {
  const prefix = 'inline-quick-task';
  const composer = document.createElement('section');
  composer.className = 'quick-add-composer quick-add-composer--compact';
  composer.setAttribute('aria-label', 'Inline essentials Quick Add concept');
  const { row, input } = createProductionInputRow(prefix, model, submit);

  const intro = document.createElement('div');
  intro.className = 'compose-options';
  const introLabel = document.createElement('p');
  introLabel.id = `${prefix}-support-label`;
  introLabel.className = 'compose-option-label';
  introLabel.textContent = 'Set before adding';
  intro.append(introLabel);

  const panel = document.createElement('div');
  panel.className = 'compose-options-panel';
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-labelledby', introLabel.id);
  panel.append(
    createListControl(`${prefix}-field`, model, () => undefined).element,
    createPriorityControl(`${prefix}-field`, model, () => undefined).element,
    createReminderControl(`${prefix}-field`, model, () => undefined).element,
  );

  let revealed = true;
  const reveal = (): void => {
    revealed = true;
    intro.hidden = false;
    panel.hidden = false;
  };
  const hide = (): void => {
    revealed = false;
    intro.hidden = true;
    panel.hidden = true;
    input.focus();
  };
  composer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && revealed) {
      event.preventDefault();
      hide();
    }
  });
  attachQuickAddShortcut(composer, input, reveal);

  composer.append(row, intro, panel);
  return { element: composer, input };
};

const createSmartComposer = (
  model: ConceptModel,
  submit: () => void,
): { element: HTMLElement; input: HTMLInputElement } => {
  const prefix = 'smart-quick-task';
  const composer = document.createElement('section');
  composer.className = 'quick-add-composer quick-add-composer--compact';
  composer.setAttribute('aria-label', 'Smart capture Quick Add concept');
  const { row, input } = createProductionInputRow(prefix, model, submit);
  input.placeholder = 'Add a task · try tomorrow !high #work';

  const intro = document.createElement('div');
  intro.className = 'compose-options';
  const hint = document.createElement('p');
  hint.id = `${prefix}-hint`;
  hint.className = 'compose-option-label quick-add-smart-hint';
  hint.textContent = 'Optional shorthand: tomorrow · !high · #work';
  intro.append(hint);
  input.setAttribute('aria-describedby', hint.id);

  const summarySlot = document.createElement('div');
  summarySlot.className = 'quick-add-smart-summary';
  const summaryHeading = document.createElement('p');
  summaryHeading.id = `${prefix}-summary-label`;
  summaryHeading.className = 'compose-option-label';
  summaryHeading.textContent = 'Will apply';
  const summaryValues = document.createElement('div');
  summaryValues.className = 'add-task-template quick-add-smart-values';
  summaryValues.style.display = 'flex';
  summaryValues.setAttribute('role', 'group');
  summaryValues.setAttribute('aria-labelledby', summaryHeading.id);
  const titlePreview = document.createElement('p');
  titlePreview.className = 'compose-option-label quick-add-smart-title-preview';
  const parseStatus = document.createElement('span');
  parseStatus.className = 'visually-hidden';
  parseStatus.setAttribute('role', 'status');
  parseStatus.setAttribute('aria-live', 'polite');
  summarySlot.append(summaryHeading, summaryValues, titlePreview, parseStatus);

  const controls = document.createElement('div');
  controls.className = 'compose-options';
  const choose = makeButton('Choose metadata…', 'view-bar-action compose-options-toggle');
  choose.setAttribute('aria-expanded', 'false');
  choose.setAttribute('aria-controls', `${prefix}-metadata-panel`);
  controls.append(choose);

  const panel = document.createElement('div');
  panel.id = `${prefix}-metadata-panel`;
  panel.className = 'compose-options-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'Choose task list, priority, or due date in any order');

  const manual = model.smartManual;
  let revealed = true;
  let previousSignature = '';

  const syntaxPatternFor = (kind: MetadataKind): RegExp =>
    kind === 'list' ? listSyntax : kind === 'priority' ? prioritySyntax : reminderSyntax;

  const clearIgnoredSyntaxWithoutToken = (): void => {
    model.ignoredMetadataSyntax = model.ignoredMetadataSyntax.filter((kind) =>
      syntaxPatternFor(kind).test(model.draft),
    );
    listSyntax.lastIndex = 0;
    prioritySyntax.lastIndex = 0;
    reminderSyntax.lastIndex = 0;
  };

  const createValueChip = (
    kind: MetadataKind,
    label: string,
    priority: PriorityChoice | null,
    parsed: boolean,
  ): HTMLElement => {
    const chip = parsed
      ? makeButton('', 'template-chip quick-add-parsed-chip')
      : document.createElement('span');
    if (!parsed) chip.className = 'template-chip';
    if (priority) setPriorityAttr(chip, priority);
    if (!parsed) {
      chip.textContent = label;
      return chip;
    }
    chip.setAttribute('aria-label', `Keep ${label} as task text; do not apply it as metadata`);
    chip.title = 'Keep the typed shorthand in the task title instead';
    const text = document.createElement('span');
    text.textContent = label;
    const remove = document.createElement('span');
    remove.setAttribute('aria-hidden', 'true');
    remove.textContent = '×';
    chip.append(text, remove);
    chip.addEventListener('click', () => {
      if (!model.ignoredMetadataSyntax.includes(kind)) model.ignoredMetadataSyntax.push(kind);
      paint(`Kept ${label} as task text and restored the chosen ${kind === 'reminderDate' ? 'due date' : kind}.`);
      input.focus();
    });
    return chip;
  };

  const paint = (announcement = ''): void => {
    clearIgnoredSyntaxWithoutToken();
    const parsed = parseMetadataDraft(model.draft, model.ignoredMetadataSyntax);
    model.list = parsed.list ?? manual.list;
    model.priority = parsed.priority ?? manual.priority;
    model.reminderDate = parsed.reminderDate ?? manual.reminderDate;
    const listSummary =
      model.list === 'none'
        ? 'No list'
        : model.list === 'current'
          ? 'Current list'
          : `${listLabels[model.list]} list`;
    summaryValues.replaceChildren(
      createValueChip('list', listSummary, null, parsed.list !== undefined),
      createValueChip(
        'priority',
        `${priorityLabels[model.priority]} priority`,
        model.priority,
        parsed.priority !== undefined,
      ),
      createValueChip(
        'reminderDate',
        reminderLabels[model.reminderDate] ?? model.reminderDate,
        null,
        parsed.reminderDate !== undefined,
      ),
    );
    const parsedCount = [parsed.list, parsed.priority, parsed.reminderDate].filter(
      (value) => value !== undefined,
    ).length;
    titlePreview.textContent = parsed.title
      ? `Task title: “${parsed.title}” · ${parsedCount ? `${parsedCount} recognized` : 'using contextual defaults'}`
      : 'Add a task title; recognized shorthand is removed from the saved title.';
    const signature = `${parsed.list ?? ''}|${parsed.priority ?? ''}|${parsed.reminderDate ?? ''}`;
    if (announcement) parseStatus.textContent = announcement;
    else if (signature !== previousSignature) {
      parseStatus.textContent = parsedCount
        ? `${parsedCount} metadata ${parsedCount === 1 ? 'value' : 'values'} recognized. ${listLabels[model.list]}, ${priorityLabels[model.priority]} priority, ${reminderLabels[model.reminderDate] ?? model.reminderDate}.`
        : 'No metadata shorthand recognized. Contextual defaults will apply.';
    }
    previousSignature = signature;
  };

  const updateManualChoice = (kind: MetadataKind): void => {
    const keepSyntaxAsText = model.ignoredMetadataSyntax.includes(kind);
    if (!keepSyntaxAsText) model.draft = removeMetadataSyntax(model.draft, kind);
    input.value = model.draft;
    if (kind === 'list') manual.list = model.list;
    else if (kind === 'priority') manual.priority = model.priority;
    else manual.reminderDate = model.reminderDate;
    paint(`${kind === 'reminderDate' ? 'Due date' : kind === 'list' ? 'Task list' : 'Priority'} updated.`);
  };

  const renderPanel = (): void => {
    panel.replaceChildren(
      createListControl(`${prefix}-manual`, model, () => updateManualChoice('list')).element,
      createPriorityControl(`${prefix}-manual`, model, () => updateManualChoice('priority')).element,
      createReminderControl(`${prefix}-manual`, model, () => updateManualChoice('reminderDate')).element,
    );
  };

  const closePanel = (restoreFocus: boolean): void => {
    panel.hidden = true;
    choose.setAttribute('aria-expanded', 'false');
    if (restoreFocus) choose.focus();
  };

  choose.addEventListener('click', () => {
    const opening = panel.hidden;
    if (!opening) {
      closePanel(false);
      return;
    }
    renderPanel();
    panel.hidden = false;
    choose.setAttribute('aria-expanded', 'true');
    panel.querySelector<HTMLButtonElement>('.reminder-picker')?.focus();
  });

  input.addEventListener('input', () => paint());

  const reveal = (): void => {
    revealed = true;
    intro.hidden = false;
    summarySlot.hidden = false;
    controls.hidden = false;
    paint();
  };
  const hide = (): void => {
    revealed = false;
    closePanel(false);
    intro.hidden = true;
    summarySlot.hidden = true;
    controls.hidden = true;
    input.focus();
  };

  composer.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !revealed) return;
    event.preventDefault();
    if (!panel.hidden) closePanel(true);
    else hide();
  });
  attachQuickAddShortcut(composer, input, reveal);

  paint();
  composer.append(row, intro, summarySlot, controls, panel);
  return { element: composer, input };
};

type Preset = Readonly<{
  label: string;
  list: ListChoice;
  priority: PriorityChoice;
  reminderDate: string;
}>;

const presets: readonly Preset[] = [
  { label: 'Current · Anytime', list: 'current', priority: 'none', reminderDate: '' },
  { label: 'Work · Today · High', list: 'work', priority: 'high', reminderDate: '2026-08-24' },
  {
    label: 'Personal · Tomorrow',
    list: 'personal',
    priority: 'medium',
    reminderDate: '2026-08-25',
  },
];

const createPresetComposer = (
  model: ConceptModel,
  submit: () => void,
): { element: HTMLElement; input: HTMLInputElement } => {
  const prefix = 'preset-quick-task';
  const composer = document.createElement('section');
  composer.className = 'quick-add-composer quick-add-composer--compact';
  composer.setAttribute('aria-label', 'Metadata presets Quick Add concept');
  const { row, input } = createProductionInputRow(prefix, model, submit);

  const intro = document.createElement('div');
  intro.className = 'compose-options';
  const introLabel = document.createElement('p');
  introLabel.id = `${prefix}-presets-label`;
  introLabel.className = 'compose-option-label';
  introLabel.textContent = 'Choose a task pattern';
  const selectionStatus = document.createElement('span');
  selectionStatus.className = 'visually-hidden';
  selectionStatus.setAttribute('role', 'status');
  selectionStatus.setAttribute('aria-live', 'polite');
  intro.append(introLabel, selectionStatus);

  const presetPanel = document.createElement('div');
  presetPanel.className = 'compose-options-panel';
  presetPanel.setAttribute('role', 'group');
  presetPanel.setAttribute('aria-labelledby', introLabel.id);

  const controls = document.createElement('div');
  controls.className = 'compose-options';
  const customize = makeButton(
    'Choose list, priority, or due date…',
    'view-bar-action compose-options-toggle',
  );
  customize.setAttribute('aria-expanded', 'false');
  customize.setAttribute('aria-controls', `${prefix}-custom-panel`);
  controls.append(customize);

  const customPanel = document.createElement('div');
  customPanel.id = `${prefix}-custom-panel`;
  customPanel.className = 'compose-options-panel';
  customPanel.hidden = true;
  customPanel.setAttribute('role', 'group');
  customPanel.setAttribute('aria-label', 'Choose list, priority, or due date individually');

  const summarySlot = document.createElement('div');
  summarySlot.className = 'compose-options';
  const summaryLabel = document.createElement('p');
  summaryLabel.className = 'compose-option-label';
  summaryLabel.textContent = 'Will apply';
  const summaryValues = document.createElement('div');
  summarySlot.append(summaryLabel, summaryValues);
  const buttons: HTMLButtonElement[] = [];
  let revealed = true;

  const matchingPreset = (): number =>
    presets.findIndex(
      (preset) =>
        preset.list === model.list &&
        preset.priority === model.priority &&
        preset.reminderDate === model.reminderDate,
    );

  const paint = (announcement = ''): void => {
    const selectedIndex = matchingPreset();
    buttons.forEach((button, index) => {
      button.setAttribute('aria-pressed', String(index === selectedIndex));
    });
    customize.dataset.active = selectedIndex === -1 ? 'true' : 'false';
    summaryValues.replaceChildren(createMetadataSummary(model, 'Metadata that will be applied'));
    selectionStatus.textContent = announcement;
  };

  const applyPreset = (index: number): void => {
    const preset = presets[index];
    if (!preset) return;
    model.list = preset.list;
    model.priority = preset.priority;
    model.reminderDate = preset.reminderDate;
    paint(`${preset.label} selected.`);
    input.focus();
  };

  presets.forEach((preset, index) => {
    const button = makeButton(`${index + 1} · ${preset.label}`, 'template-chip');
    button.setAttribute('aria-pressed', 'false');
    setPriorityAttr(button, preset.priority);
    button.addEventListener('click', () => applyPreset(index));
    buttons.push(button);
    presetPanel.append(button);
  });

  const onCustomChange = (): void => paint('Custom metadata updated.');
  customPanel.append(
    createListControl(`${prefix}-custom`, model, onCustomChange).element,
    createPriorityControl(`${prefix}-custom`, model, onCustomChange).element,
    createReminderControl(`${prefix}-custom`, model, onCustomChange).element,
  );

  const closeCustom = (restoreFocus: boolean): void => {
    customPanel.hidden = true;
    customize.setAttribute('aria-expanded', 'false');
    if (restoreFocus) customize.focus();
  };
  customize.addEventListener('click', () => {
    const opening = customPanel.hidden;
    customPanel.hidden = !opening;
    customize.setAttribute('aria-expanded', String(opening));
    if (opening) customPanel.querySelector<HTMLButtonElement>('.reminder-picker')?.focus();
  });

  const reveal = (): void => {
    revealed = true;
    intro.hidden = false;
    presetPanel.hidden = false;
    controls.hidden = false;
    summarySlot.hidden = false;
  };
  const hide = (): void => {
    revealed = false;
    closeCustom(false);
    intro.hidden = true;
    presetPanel.hidden = true;
    controls.hidden = true;
    summarySlot.hidden = true;
    input.focus();
  };

  composer.addEventListener('keydown', (event) => {
    const presetIndex = Number(event.key) - 1;
    if ((event.metaKey || event.ctrlKey) && presetIndex >= 0 && presetIndex < presets.length) {
      event.preventDefault();
      applyPreset(presetIndex);
      return;
    }
    if (event.key !== 'Escape' || !revealed) return;
    event.preventDefault();
    if (!customPanel.hidden) closeCustom(true);
    else hide();
  });
  attachQuickAddShortcut(composer, input, reveal);

  paint();
  composer.append(row, summarySlot, intro, presetPanel, controls, customPanel);
  return { element: composer, input };
};

const createQuickTaskConcept = (direction: Direction): HTMLElement => {
  const copy = notes[direction];
  const theme = document.documentElement.dataset.adeoTheme ?? 'light';
  const model = {} as ConceptModel;
  resetModel(model, 'populated');

  const page = document.createElement('main');
  page.className = 'quick-add-pilot';
  page.dataset.storybookConcept = 'ready';
  page.dataset.quickTaskDirection = direction;

  const header = document.createElement('header');
  header.className = 'quick-add-pilot__header';
  header.innerHTML = `
    <div>
      <p class="quick-add-pilot__eyebrow">Quick task add · concept</p>
      <h1>${copy.title}</h1>
      <p>${copy.summary}</p>
    </div>
    <span class="quick-add-pilot__theme" data-testid="active-theme">${theme} theme</span>
  `;

  const layout = document.createElement('div');
  layout.className = 'quick-add-pilot__layout';
  const preview = document.createElement('section');
  preview.className = 'quick-add-preview';
  preview.setAttribute('aria-label', `${copy.title} interactive preview`);

  const fixtureLabel = document.createElement('p');
  fixtureLabel.className = 'quick-add-fixture-label';
  fixtureLabel.textContent = 'Storybook fixture controls — not part of Adeo';
  const stateControls = document.createElement('div');
  stateControls.className = 'quick-add-state-controls';
  stateControls.setAttribute('role', 'group');
  stateControls.setAttribute('aria-label', 'Fixture state');
  const stateLabels: Record<FixtureKey, string> = {
    populated: 'Populated',
    empty: 'Empty',
    error: 'Save error',
  };

  const shellFrame = document.createElement('div');
  shellFrame.className = 'quick-add-shell-frame';
  shellFrame.setAttribute('role', 'region');
  shellFrame.setAttribute('aria-label', 'Adeo task view preview');
  const feedback = document.createElement('div');
  feedback.className = 'quick-add-feedback';
  let shellHandle: AppShellPreviewHandle | null = null;

  const renderFeedback = (): void => {
    feedback.replaceChildren();
    if (model.error) {
      const error = document.createElement('p');
      error.className = 'quick-add-feedback__error';
      error.setAttribute('role', 'alert');
      error.textContent = model.error;
      feedback.append(error);
      return;
    }
    const status = document.createElement('p');
    status.className = 'quick-add-feedback__status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = model.status;
    feedback.append(status);
  };

  const buildComposer = (): { element: HTMLElement; input: HTMLInputElement } =>
    direction === 'inline'
      ? createInlineComposer(model, submit)
      : direction === 'smart'
        ? createSmartComposer(model, submit)
        : createPresetComposer(model, submit);

  const mountComposer = (focusInput = false): void => {
    const composer = buildComposer();
    shellHandle?.setComposer(composer.element);
    renderFeedback();
    if (focusInput) composer.input.focus();
  };

  function submit(): void {
    const title =
      direction === 'smart'
        ? parseMetadataDraft(model.draft, model.ignoredMetadataSyntax).title
        : model.draft.trim();
    if (!title) {
      model.status = '';
      model.error = 'Enter a task before adding.';
      mountComposer(true);
      return;
    }
    if (model.fixtureKey === 'error') {
      model.status = '';
      model.error = errorConceptFixture.errorMessage ?? 'Could not save the task. Try again.';
      mountComposer(true);
      return;
    }
    model.tasks = [
      {
        id: 'quick-task-concept-added',
        title,
        dueLabel: reminderLabels[model.reminderDate] ?? model.reminderDate,
        priority: model.priority,
        completed: false,
        tags: [],
      },
      ...model.tasks,
    ];
    model.draft = '';
    model.ignoredMetadataSyntax = [];
    model.error = '';
    model.status = `Added “${title}” to ${listLabels[model.list]}.`;
    shellHandle?.setViewTasks('all', model.tasks);
    mountComposer(true);
  }

  const mountShell = (focusInput = false): void => {
    const composer = buildComposer();
    shellHandle = createAppShellPreview(
      createQuickTaskShellFixture(model.fixtureKey, model.tasks),
      { composer: composer.element },
    );
    shellFrame.replaceChildren(shellHandle.element);
    renderFeedback();
    if (focusInput) composer.input.focus();
  };

  const renderStateButtons = (): void => {
    stateControls.replaceChildren();
    (Object.keys(stateLabels) as FixtureKey[]).forEach((key) => {
      const button = makeButton(stateLabels[key], 'quick-add-state-button');
      button.setAttribute('aria-pressed', String(model.fixtureKey === key));
      button.addEventListener('click', () => {
        resetModel(model, key);
        renderStateButtons();
        mountShell(true);
      });
      stateControls.append(button);
    });
  };

  renderStateButtons();
  mountShell();
  preview.append(fixtureLabel, stateControls, shellFrame, feedback);
  layout.append(preview, createAnnotations(direction));
  page.append(header, layout);
  return page;
};

export const InlineEssentials: Story = {
  name: 'Inline essentials',
  render: () => createQuickTaskConcept('inline'),
};

export const SmartCapture: Story = {
  name: 'Smart capture',
  render: () => createQuickTaskConcept('smart'),
};

export const MetadataPresets: Story = {
  name: 'Metadata presets',
  render: () => createQuickTaskConcept('presets'),
};
