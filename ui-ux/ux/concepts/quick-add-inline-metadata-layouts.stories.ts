import type { Meta, StoryObj } from '@storybook/html-vite';

import { setPriorityAttr } from '../../../src/renderer/theme';
import {
  attachDatePicker,
  type DateParts,
  type DatePickerController,
} from '../../../src/renderer/datepicker';
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
import './quick-add-inline-layouts.css';

/**
 * Follow-up exploration for the "Inline essentials" direction of
 * `quick-task-add-metadata.stories.ts`. That direction keeps the production Options-panel
 * layout, where every field stacks an 11px `.compose-option-label` above its control. The
 * user's feedback was that the stacked labels cost too much space, so these four layouts
 * drop the visible label and keep the field's name only as its accessible name.
 *
 * Everything else about Inline essentials is deliberately unchanged: all three production
 * fields stay visible and directly editable, plain-text capture still submits with Enter,
 * and no metadata is ever typed as command syntax.
 */

type Layout = 'values' | 'chips' | 'cluster' | 'bar';
type FixtureKey = 'populated' | 'empty' | 'error' | 'long';
type ListChoice = 'current' | 'none' | 'work' | 'personal' | 'quarterly';
type PriorityChoice = 'none' | 'low' | 'medium' | 'high';

type LayoutModel = {
  fixtureKey: FixtureKey;
  draft: string;
  tasks: ConceptTaskFixture[];
  list: ListChoice;
  priority: PriorityChoice;
  reminderDate: string;
  status: string;
  error: string;
};

const fixtures: Record<FixtureKey, ConceptUiFixture> = {
  populated: populatedConceptFixture,
  empty: emptyConceptFixture,
  error: errorConceptFixture,
  long: populatedConceptFixture,
};

const listLabels: Record<ListChoice, string> = {
  current: 'Current list',
  none: 'No list',
  work: 'Work',
  personal: 'Personal',
  quarterly: 'Quarterly planning and stakeholder review',
};

const priorityLabels: Record<PriorityChoice, string> = {
  none: 'None',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

/** Fixed clock shared with the concept fixtures: 2026-08-24. */
const FIXED_TODAY: DateParts = { year: 2026, month: 7, day: 24 };
const MONTH_ABBREVIATIONS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Stands in for the user's `formatDate` preference without reading renderer state. */
const formatReminder = (value: string): string => {
  const [year, month, day] = value.split('-');
  const monthLabel = MONTH_ABBREVIATIONS[Number(month) - 1] ?? month;
  return `${Number(day)} ${monthLabel} ${year}`;
};

const defaultsForFixture = (
  fixtureKey: FixtureKey,
): Pick<LayoutModel, 'list' | 'priority' | 'reminderDate'> => {
  if (fixtureKey === 'empty') return { list: 'current', priority: 'none', reminderDate: '' };
  if (fixtureKey === 'error') return { list: 'personal', priority: 'high', reminderDate: '2026-08-25' };
  if (fixtureKey === 'long') {
    return { list: 'quarterly', priority: 'high', reminderDate: '2026-12-31' };
  }
  return { list: 'work', priority: 'medium', reminderDate: '2026-08-24' };
};

const longDraft =
  'Consolidate the quarterly planning notes and circulate the stakeholder review agenda';

const resetModel = (model: LayoutModel, fixtureKey: FixtureKey): void => {
  const fixture = fixtures[fixtureKey];
  const defaults = defaultsForFixture(fixtureKey);
  model.fixtureKey = fixtureKey;
  model.draft = fixtureKey === 'long' ? longDraft : fixture.draft;
  model.tasks = fixture.tasks.map((task) => ({ ...task, tags: [...task.tags] }));
  model.list = defaults.list;
  model.priority = defaults.priority;
  model.reminderDate = defaults.reminderDate;
  model.status = '';
  // The error fixture's message appears when a save is attempted, not before it.
  model.error = '';
};

const layoutTags: readonly ConceptTagPanelFixture[] = populatedConceptFixture.availableTags.map(
  (tag, index) => ({ id: `qaim-tag-${index}`, label: tag.label, color: tag.color }),
);

const createShellFixture = (
  fixtureKey: FixtureKey,
  tasks: readonly ConceptTaskFixture[],
): ConceptShellFixture => ({
  id: `qaim-shell-${fixtureKey}`,
  label: fixtures[fixtureKey].label,
  nowIso: fixtures[fixtureKey].nowIso,
  lists: conceptShellFixture.lists,
  smartLists: conceptShellFixture.smartLists,
  tags: layoutTags,
  tasksByView: {
    all: tasks,
    'list-work': [],
    'list-personal': [],
    'smart-today': [],
  },
  initialViewKey: 'all',
});

const makeButton = (label: string, className = ''): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  return button;
};

const LIST_ICON = `
  <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
    <path d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01"></path>
  </svg>
`;

const makeIcon = (markup: string): HTMLSpanElement => {
  const icon = document.createElement('span');
  icon.className = 'qaim-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = markup;
  return icon;
};

type FieldHandle = {
  element: HTMLElement;
  paint: () => void;
  /** Returns true when this field actually had an open surface to dismiss. */
  closeSurface: (restoreFocus: boolean) => boolean;
  destroy: () => void;
};

const isChipLayout = (layout: Layout): boolean => layout === 'chips';

const triggerClassName = (layout: Layout): string =>
  isChipLayout(layout) ? 'template-chip qaim-chip' : 'reminder-picker qaim-trigger';

/**
 * One menu field used by every layout. The layouts differ only in the trigger's production
 * class and in the surrounding container, so the keyboard and ARIA behavior stays identical:
 * a real <button> trigger with aria-haspopup/aria-expanded, real <button role="menuitemradio">
 * rows, Arrow/Home/End movement, Enter/Space selection, and Escape that closes only this menu
 * and returns focus to the trigger.
 *
 * The shipped priority menu does not do this (`index.html` rows are role-less divs with a
 * click-only handler -- findings F-01/F-02 in ui-ux/handoffs/phase3-handoff.md). These concept
 * controls are written the correct way on purpose.
 */
const createMenuField = <T extends string>(config: {
  prefix: string;
  layout: Layout;
  kind: 'list' | 'priority';
  fieldName: string;
  menuClass: string;
  choices: readonly T[];
  labels: Record<T, string>;
  getValue: () => T;
  setValue: (value: T) => void;
  isSet: (value: T) => boolean;
  onChange: () => void;
}): FieldHandle => {
  const {
    prefix,
    layout,
    kind,
    fieldName,
    menuClass,
    choices,
    labels,
    getValue,
    setValue,
    isSet,
    onChange,
  } = config;

  const wrap = document.createElement('div');
  wrap.className = isChipLayout(layout)
    ? `qaim-field qaim-field--${kind} qaim-field--chip`
    : `modal-list-select-wrap reminder-select-wrap qaim-field qaim-field--${kind}`;

  const trigger = makeButton('', triggerClassName(layout));
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');

  const icon =
    kind === 'list'
      ? makeIcon(LIST_ICON)
      : isChipLayout(layout)
        ? null
        : (() => {
            const chip = document.createElement('span');
            chip.className = 'priority-chip';
            chip.setAttribute('aria-hidden', 'true');
            return chip;
          })();

  const value = document.createElement('span');
  value.className = 'qaim-value';
  const caret = document.createElement('span');
  caret.className = 'priority-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.textContent = '▾';
  if (icon) trigger.append(icon);
  trigger.append(value, caret);

  const menu = document.createElement('div');
  menu.id = `${prefix}-${kind}-menu`;
  menu.className = menuClass;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', fieldName);
  menu.style.display = 'none';
  trigger.setAttribute('aria-controls', menu.id);

  const itemClass = kind === 'list' ? 'modal-list-item' : 'priority-menu-item';
  const items: HTMLButtonElement[] = choices.map((choice) => {
    const item = makeButton('', itemClass);
    item.dataset.value = choice;
    item.setAttribute('role', 'menuitemradio');
    item.tabIndex = -1;
    if (kind === 'priority') {
      const swatch = document.createElement('span');
      swatch.className = `priority-chip priority-chip--${choice}`;
      swatch.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.textContent = labels[choice];
      item.append(swatch, text);
    } else {
      item.textContent = labels[choice];
    }
    item.addEventListener('click', () => select(choice));
    menu.append(item);
    return item;
  });

  const isOpen = (): boolean => menu.style.display === 'flex';

  const close = (restoreFocus: boolean): boolean => {
    if (!isOpen()) return false;
    menu.style.display = 'none';
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
    return true;
  };

  const open = (edge: 'selected' | 'first' | 'last' = 'selected'): void => {
    menu.style.display = 'flex';
    trigger.setAttribute('aria-expanded', 'true');
    const selectedIndex = Math.max(0, choices.indexOf(getValue()));
    const index = edge === 'first' ? 0 : edge === 'last' ? items.length - 1 : selectedIndex;
    items[index]?.focus();
  };

  function select(choice: T): void {
    setValue(choice);
    paint();
    close(false);
    trigger.focus();
    onChange();
  }

  function paint(): void {
    const current = getValue();
    value.textContent = labels[current];
    trigger.setAttribute('aria-label', `${fieldName}: ${labels[current]}`);
    wrap.dataset.set = String(isSet(current));
    trigger.dataset.set = String(isSet(current));
    if (kind === 'priority') {
      if (isChipLayout(layout)) setPriorityAttr(trigger, current);
      else if (icon) setPriorityAttr(icon, current);
    }
    items.forEach((item) => {
      const selected = item.dataset.value === current;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-checked', String(selected));
    });
  }

  trigger.addEventListener('click', () => {
    if (isOpen()) close(false);
    else open();
  });
  trigger.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    open(event.key === 'ArrowDown' ? 'first' : 'last');
  });
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === 'Tab') {
      close(false);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  });

  paint();
  wrap.append(trigger, menu);
  return {
    element: wrap,
    paint,
    closeSurface: close,
    destroy: () => close(false),
  };
};

const createListField = (
  prefix: string,
  layout: Layout,
  model: LayoutModel,
  onChange: () => void,
): FieldHandle =>
  createMenuField<ListChoice>({
    prefix,
    layout,
    kind: 'list',
    fieldName: 'Task list',
    menuClass: 'modal-list-menu',
    choices: ['current', 'none', 'work', 'personal', 'quarterly'],
    labels: listLabels,
    getValue: () => model.list,
    setValue: (next) => {
      model.list = next;
    },
    isSet: (current) => current !== 'current',
    onChange,
  });

const createPriorityField = (
  prefix: string,
  layout: Layout,
  model: LayoutModel,
  onChange: () => void,
): FieldHandle =>
  createMenuField<PriorityChoice>({
    prefix,
    layout,
    kind: 'priority',
    fieldName: 'Priority',
    menuClass: 'priority-menu',
    choices: ['none', 'low', 'medium', 'high'],
    labels: priorityLabels,
    getValue: () => model.priority,
    setValue: (next) => {
      model.priority = next;
    },
    isSet: (current) => current !== 'none',
    onChange,
  });

/**
 * Reminder reuses the production date picker (`attachDatePicker`) rather than the native
 * date input the Options panel uses. That is what makes a label-free reminder honest: the
 * production trigger already renders "value + calendar glyph" and already sets its own
 * accessible name to "Reminder: <value>", plus Escape-with-focus-restore and a Today/Clear
 * footer. Deterministic `today` and `formatValue` are injected, so no clock is read.
 */
const createReminderField = (
  layout: Layout,
  model: LayoutModel,
  popoverParent: HTMLElement,
  onChange: () => void,
): FieldHandle => {
  const wrap = document.createElement('div');
  wrap.className = isChipLayout(layout)
    ? 'qaim-field qaim-field--reminder qaim-field--chip'
    : 'qaim-field qaim-field--reminder';

  const input = document.createElement('input');
  input.type = 'date';
  input.className = isChipLayout(layout) ? 'template-chip qaim-chip' : 'reminder-date-input';
  input.setAttribute('aria-label', 'Reminder');
  input.value = model.reminderDate;
  wrap.append(input);

  const controller: DatePickerController | null = attachDatePicker(input, {
    accessibleName: 'Reminder',
    formatValue: formatReminder,
    popoverParent,
    today: FIXED_TODAY,
  });
  if (!controller) throw new Error('Could not attach the concept reminder date picker.');

  input.addEventListener('change', () => {
    model.reminderDate = input.value;
    paint();
    onChange();
  });

  function paint(): void {
    input.value = model.reminderDate;
    wrap.dataset.set = String(Boolean(model.reminderDate));
    controller!.trigger.dataset.set = String(Boolean(model.reminderDate));
  }

  paint();
  return {
    element: wrap,
    paint,
    closeSurface: (restoreFocus: boolean) => {
      if (!controller.isOpen()) return false;
      controller.close();
      if (restoreFocus) controller.trigger.focus();
      return true;
    },
    destroy: () => controller.destroy(),
  };
};

// ---------- Composer ----------

const createInputParts = (
  prefix: string,
  model: LayoutModel,
  submit: () => void,
): { inputWrap: HTMLDivElement; input: HTMLInputElement; addButton: HTMLButtonElement } => {
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

  const addButton = makeButton('', 'primary-button icon-btn');
  addButton.setAttribute('aria-label', 'Add task');
  addButton.innerHTML = `
    <svg class="icon-add" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z" fill="currentColor" />
    </svg>
  `;
  addButton.addEventListener('click', submit);
  return { inputWrap, input, addButton };
};

type ComposerHandle = {
  element: HTMLElement;
  input: HTMLInputElement;
  paint: () => void;
  destroy: () => void;
};

/** The row's accessible name replaces the removed visible "Set before adding" label. */
const GROUP_LABEL = 'Details for the next task';

const createComposer = (
  layout: Layout,
  model: LayoutModel,
  popoverParent: HTMLElement,
  submit: () => void,
): ComposerHandle => {
  const prefix = `qaim-${layout}`;
  const composer = document.createElement('section');
  composer.className = 'quick-add-composer quick-add-composer--compact';
  composer.dataset.qaimLayout = layout;
  composer.setAttribute('aria-label', `${layout} Quick Add metadata layout concept`);

  const { inputWrap, input, addButton } = createInputParts(prefix, model, submit);

  const fields: FieldHandle[] = [
    createListField(prefix, layout, model, () => undefined),
    createPriorityField(prefix, layout, model, () => undefined),
    createReminderField(layout, model, popoverParent, () => undefined),
  ];
  // The right-most field opens its menu leftwards so a narrow column never pushes it past
  // the app's right edge.
  fields.at(-1)?.element.setAttribute('data-menu-align', 'end');

  const group = document.createElement('div');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', GROUP_LABEL);
  fields.forEach((field) => group.append(field.element));

  const feedback = document.createElement('div');
  feedback.className = 'compose-options';
  const error = document.createElement('p');
  error.className = 'compose-error';
  error.setAttribute('role', 'alert');
  const status = document.createElement('span');
  status.className = 'visually-hidden';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  feedback.append(error, status);

  if (layout === 'cluster') {
    group.className = 'qaim-cluster';
    const row = document.createElement('div');
    row.className = 'input-row qaim-input-row';
    row.append(inputWrap, group, addButton);
    composer.append(row, feedback);
  } else {
    group.className =
      layout === 'chips'
        ? 'add-task-template qaim-chip-row'
        : layout === 'bar'
          ? 'qaim-bar'
          : 'qaim-row qaim-row--values';
    const row = document.createElement('div');
    row.className = 'input-row';
    row.append(inputWrap, addButton);
    composer.append(row, group, feedback);
  }

  const closeTopSurface = (): boolean =>
    fields.some((field) => field.closeSurface(true));

  composer.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    // One surface per press: a field's own menu handler already stopped propagation, so this
    // only runs when nothing inside the row is open. The row itself is permanent, so there is
    // nothing further to dismiss and the draft is left untouched.
    if (closeTopSurface()) event.preventDefault();
  });

  const onDocumentClick = (event: MouseEvent): void => {
    if (!composer.isConnected) return;
    if (composer.contains(event.target as Node)) return;
    fields.forEach((field) => field.closeSurface(false));
  };
  document.addEventListener('click', onDocumentClick);

  const paint = (): void => {
    input.value = model.draft;
    fields.forEach((field) => field.paint());
    error.textContent = model.error;
    status.textContent = model.status;
  };

  paint();
  return {
    element: composer,
    input,
    paint,
    destroy: () => {
      document.removeEventListener('click', onDocumentClick);
      fields.forEach((field) => field.destroy());
    },
  };
};

// ---------- Notes ----------

type LayoutNotes = {
  title: string;
  summary: string;
  goal: string;
  space: string;
  benefits: readonly string[];
  tradeoffs: readonly string[];
  complexity: string;
  keyboard: string;
  accessibility: string;
  escape: string;
  emptyError: string;
};

const notes: Record<Layout, LayoutNotes> = {
  values: {
    title: 'A. Value row',
    summary:
      'One row of three self-describing controls: glyph plus current value, no visible field label.',
    goal: 'Keep all three fields one click away while removing the stacked label above each control.',
    space:
      'Measured compose block: 110px at desktop widths against the stacked-label baseline’s 157px, and 128px at a 315px column against 307px. A long list name at 315px wraps the row to 180px.',
    benefits: [
      'Closest to the current Options panel, so the visual language and menus are unchanged.',
      'The chosen value is always the largest text in the control, which is what users scan for.',
      'The glyph (list rule, priority swatch, calendar) distinguishes the fields without a word.',
    ],
    tradeoffs: [
      'A bare value such as "Medium" or "Personal" is only unambiguous once the glyph is learned.',
      'Three separate pill controls still read as three objects; the row is quieter, not silent.',
    ],
    complexity:
      'Low. Same controls as the shipped Options panel, minus the label element, plus a leading glyph and a released width.',
    keyboard:
      'Tab order is Task, Add, Task list, Priority, Reminder. Enter in Task submits. Arrow Down/Up opens a menu at the first/last row; Arrow, Home and End move; Enter or Space selects and returns focus to the trigger.',
    accessibility:
      'The row is a role="group" with an invisible accessible name. Each trigger carries aria-label "<field>: <value>", aria-haspopup, aria-expanded and aria-controls. Menu rows are real buttons with role="menuitemradio" and aria-checked. Priority is never colour-only: the value word is always present.',
    escape:
      'Escape closes the open menu and returns focus to its trigger; the date popover closes itself the same way. With nothing open the row stays (it is permanent) and the draft is untouched.',
    emptyError:
      'Empty fixture: every field shows its unset value ("Current list", "None", "Select date"). Error fixture: a failed save keeps the draft and every chosen value, and reports the failure in the production alert region.',
  },
  chips: {
    title: 'B. Meta chips',
    summary:
      'The three fields become the same chips Adeo already uses to announce what the next task will get.',
    goal: 'Present the metadata as a compact statement of the outcome rather than as three form fields.',
    space:
      'Measured compose block: 112px at desktop widths and 134px at a 315px column (baseline 157px / 307px). Chip padding is 2px/9px against the pickers’ 6px/8px, so the row is horizontally the lightest, but the 44px narrow-width touch floor evens out the height.',
    benefits: [
      'Reuses the production add-task-template chip language, so the row reads as "what this task will get".',
      'The priority chip carries the production priority tint, matching how priority already appears elsewhere.',
      'Lightest visual weight and the least horizontal space at narrow widths.',
    ],
    tradeoffs: [
      'Chips look informational in Adeo today, so their editability has to be taught by the caret and hover/focus styling.',
      'A chip is a smaller pointer and touch target than a picker; it needs the 44px floor at narrow widths.',
      'The existing template hints row also uses chips, so the two rows must not be confusable when a smart list is running.',
    ],
    complexity:
      'Medium. The controls are production menus, but the chip becomes an interactive element for the first time, which needs its own hover/focus/pressed styling and a decision about its relationship to the template hints row.',
    keyboard:
      'Identical to A: the chips are buttons in the natural tab order with the same menu key handling.',
    accessibility:
      'Each chip is a <button> with aria-label "<field>: <value>". Priority keeps its word inside the chip, so the tint is decoration rather than the only signal. The unset chips use --text-hint, which must be verified against the chip fill in both themes.',
    escape:
      'Same single-surface rule as A: menu first, then nothing (the chip row is permanent).',
    emptyError:
      'Empty fixture shows unset chips ("Current list", "None", "Select date"). Error fixture preserves the chips and the draft.',
  },
  cluster: {
    title: 'C. Same-line cluster',
    summary:
      'The three controls move onto the Quick Add line itself and collapse to a single glyph until they are set.',
    goal: 'Cost zero extra vertical space for the common case of typing a task and pressing Enter.',
    space:
      'Measured compose block: 76px at desktop widths — the shortest of the four, and no added row at all — but 170px at a 315px column and 218px there with a long list name, which makes it the tallest option below roughly 400px.',
    benefits: [
      'A plain capture keeps the composer exactly one line tall, matching principle 1.',
      'A set value expands in place, so a chosen list or reminder stays visible without a summary row.',
      'The controls sit immediately before Add, which is where the eye already ends the row.',
    ],
    tradeoffs: [
      'The task field loses width to the cluster. Without an explicit floor it collapsed to about one character at a 315px column, and the cluster still wraps to its own line below roughly 400px.',
      'A collapsed glyph shows the field but not its value, and the collapsed priority glyph is the neutral priority-chip swatch, which does not by itself say "priority".',
      'Three icon-only buttons beside the input can read as a toolbar rather than as task metadata.',
    ],
    complexity:
      'Medium. Needs a collapsed/expanded rule per field, wrapping behavior for the input row, and a width policy so the task field never becomes unusably narrow.',
    keyboard:
      'DOM order matches visual order: Task, Task list, Priority, Reminder, Add. Enter in Task still submits; menu keys are unchanged.',
    accessibility:
      'A collapsed control keeps the full accessible name "<field>: <value>", so a screen reader is never told less than a sighted user. The visible-label question is the sighted user’s: the glyph must be recognisable, which needs a tooltip/title decision before production.',
    escape:
      'Menu or date popover first, then nothing. The cluster never hides, so Escape cannot orphan a chosen value.',
    emptyError:
      'Empty fixture is the collapsed state: three glyphs and a full-width task field. Error fixture keeps the draft, expands whatever was chosen, and shows the alert below the row.',
  },
  bar: {
    title: 'D. Unified context bar',
    summary:
      'One sunken bar containing the three values, divided by hairlines instead of separated into three pills.',
    goal: 'Read the metadata as a single line of context for the next task rather than as three independent inputs.',
    space:
      'Measured compose block: 112px at desktop widths and 128px at a 315px column — and the only layout that still holds one line at 315px with a long list name, because the list value truncates inside the shared bar while priority and the date keep their width.',
    benefits: [
      'One object rather than three reduces the perceived busyness the stacked labels caused.',
      'The bar is content-sized and left-aligned, so it never stretches to fill the column.',
      'Hairline dividers keep the fields distinct without three separate borders.',
    ],
    tradeoffs: [
      'A segmented bar is a new composite in Adeo; the closest existing pattern is the segmented control, which means something different (a single choice).',
      'Hover and focus have to be per-segment, or the bar looks like one button.',
      'Very long list names must truncate inside a shared bar rather than growing their own pill.',
    ],
    complexity:
      'Medium. The controls are production controls, but the bar itself is a new container with its own divider, radius, hover and focus rules to add to the design language.',
    keyboard:
      'Same as A: three tab stops after Add, with the same menu key handling. Arrow keys deliberately do not move between segments, because these are three independent fields and not one radio group.',
    accessibility:
      'The bar is a role="group" with an accessible name; each segment keeps its own aria-label and menu semantics. The divider is decorative. Segment focus uses the global focus ring, which must remain visible against the shared sunken fill.',
    escape:
      'Menu or date popover first, then nothing; the bar is permanent.',
    emptyError:
      'Empty fixture shows three unset values inside the bar. Error fixture keeps the draft and the chosen values and reports the failure below the bar.',
  },
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

const createAnnotations = (layout: Layout): HTMLElement => {
  const copy = notes[layout];
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
    ['Space', copy.space],
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

// ---------- Page ----------

const stateLabels: Record<FixtureKey, string> = {
  populated: 'Populated',
  empty: 'Empty',
  error: 'Save error',
  long: 'Long content',
};

const createLayoutConcept = (layout: Layout): HTMLElement => {
  const copy = notes[layout];
  const theme = document.documentElement.dataset.adeoTheme ?? 'light';
  const model = {} as LayoutModel;
  resetModel(model, 'populated');

  const page = document.createElement('main');
  page.className = 'quick-add-pilot';
  page.dataset.storybookConcept = 'ready';
  page.dataset.qaimLayout = layout;

  const header = document.createElement('header');
  header.className = 'quick-add-pilot__header';
  const headerText = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'quick-add-pilot__eyebrow';
  eyebrow.textContent = 'Inline essentials · label-free layouts';
  const title = document.createElement('h1');
  title.textContent = copy.title;
  const summary = document.createElement('p');
  summary.textContent = copy.summary;
  headerText.append(eyebrow, title, summary);
  const themeBadge = document.createElement('span');
  themeBadge.className = 'quick-add-pilot__theme';
  themeBadge.dataset.testid = 'active-theme';
  themeBadge.textContent = `${theme} theme`;
  header.append(headerText, themeBadge);

  const layoutEl = document.createElement('div');
  layoutEl.className = 'quick-add-pilot__layout';
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

  const shellFrame = document.createElement('div');
  shellFrame.className = 'quick-add-shell-frame';
  shellFrame.setAttribute('role', 'region');
  shellFrame.setAttribute('aria-label', 'Adeo task view preview');

  const measure = document.createElement('p');
  measure.className = 'qaim-measure';
  measure.dataset.testid = 'compose-block-height';

  let shellHandle: AppShellPreviewHandle | null = null;
  let composerHandle: ComposerHandle | null = null;

  const reportHeight = (): void => {
    requestAnimationFrame(() => {
      const block = shellFrame.querySelector<HTMLElement>('.compose-block');
      if (!block) return;
      measure.innerHTML = '';
      const strong = document.createElement('b');
      strong.textContent = `${Math.round(block.getBoundingClientRect().height)}px`;
      measure.append(
        document.createTextNode('Measured compose block height (view bar to the end of the metadata row): '),
        strong,
      );
    });
  };

  function submit(): void {
    const title = model.draft.trim();
    if (!title) {
      model.status = '';
      model.error = 'Enter a task before adding.';
      composerHandle?.paint();
      composerHandle?.input.focus();
      reportHeight();
      return;
    }
    if (model.fixtureKey === 'error') {
      model.status = '';
      model.error = errorConceptFixture.errorMessage ?? 'Could not save the task. Try again.';
      composerHandle?.paint();
      composerHandle?.input.focus();
      reportHeight();
      return;
    }
    model.tasks = [
      {
        id: 'qaim-added-task',
        title,
        dueLabel: model.reminderDate ? formatReminder(model.reminderDate) : '',
        priority: model.priority,
        completed: false,
        tags: [],
      },
      ...model.tasks,
    ];
    model.draft = '';
    model.error = '';
    model.status = `Added “${title}” to ${listLabels[model.list]}.`;
    shellHandle?.setViewTasks('all', model.tasks);
    composerHandle?.paint();
    composerHandle?.input.focus();
    reportHeight();
  }

  const mountShell = (focusInput = false): void => {
    composerHandle?.destroy();
    composerHandle = createComposer(layout, model, preview, submit);
    shellHandle = createAppShellPreview(createShellFixture(model.fixtureKey, model.tasks), {
      composer: composerHandle.element,
    });
    shellFrame.replaceChildren(shellHandle.element);
    if (focusInput) composerHandle.input.focus();
    reportHeight();
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
  preview.append(fixtureLabel, stateControls, shellFrame, measure);
  layoutEl.append(preview, createAnnotations(layout));
  page.append(header, layoutEl);
  return page;
};

const meta: Meta = {
  title: 'Concepts/Quick Add inline metadata layouts',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Four label-free layouts for the Inline essentials direction of Quick Add metadata. Each keeps Task list, Priority and Reminder visible and directly editable, drops the stacked field labels, and keeps the field name as the control’s accessible name. All controls are production controls; only their layout differs.',
      },
    },
  },
};

export default meta;
type Story = StoryObj;

export const ValueRow: Story = {
  name: 'A · Value row',
  render: () => createLayoutConcept('values'),
};

export const MetaChips: Story = {
  name: 'B · Meta chips',
  render: () => createLayoutConcept('chips'),
};

export const SameLineCluster: Story = {
  name: 'C · Same-line cluster',
  render: () => createLayoutConcept('cluster'),
};

export const UnifiedContextBar: Story = {
  name: 'D · Unified context bar',
  render: () => createLayoutConcept('bar'),
};
