import type { Meta, StoryObj } from '@storybook/html-vite';

import { createTagChip } from '../../../src/renderer/uiElements';
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

type Direction = 'compact' | 'command' | 'touch';
type FixtureKey = 'populated' | 'empty' | 'error';

type ConceptModel = {
  fixtureKey: FixtureKey;
  draft: string;
  tasks: ConceptTaskFixture[];
  selectedTags: string[];
  priority: 'none' | 'high';
  due: 'No date' | 'Today';
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
  emptyError: string;
  platforms: Readonly<Record<'Desktop' | 'Web' | 'Mobile', string>>;
};

const fixtures: Record<FixtureKey, ConceptUiFixture> = {
  populated: populatedConceptFixture,
  empty: emptyConceptFixture,
  error: errorConceptFixture,
};

/**
 * P2.2 reopened (shell adoption): the populated/empty/error fixtures above are flat
 * (`ConceptUiFixture`) and used to render inside an isolated mock card. They now mount inside the
 * shared P2.1 app-shell instead, so each composer's tag set becomes the shell's Tags panel too
 * (kept as this file's own `sharedTags`-derived set, not `conceptShellFixture.tags`, so the
 * sidebar Tags panel always matches exactly what the composer's `#tag`/`/` suggestions offer).
 * The Work/Personal lists and Today smart list are reused from `conceptShellFixture` for sidebar
 * richness, but carry no tasks here -- switching to them shows the real production empty state
 * rather than tasks tagged from a different tag set.
 */
const quickAddShellTags: readonly ConceptTagPanelFixture[] = populatedConceptFixture.availableTags.map(
  (tag, index) => ({ id: `quick-add-tag-${index}`, label: tag.label, color: tag.color }),
);

const createQuickAddShellFixture = (
  fixtureKey: FixtureKey,
  tasks: readonly ConceptTaskFixture[],
): ConceptShellFixture => {
  const fixture = fixtures[fixtureKey];
  return {
    id: `quick-add-shell-${fixtureKey}`,
    label: fixture.label,
    nowIso: fixture.nowIso,
    lists: conceptShellFixture.lists,
    smartLists: conceptShellFixture.smartLists,
    tags: quickAddShellTags,
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
  compact: {
    title: 'Compact / current direction',
    summary: 'Keep capture visually quiet and reveal metadata only when requested.',
    goal: 'Add a task with the shortest familiar path while preserving optional tags, date, and priority.',
    benefits: [
      'Closest to the current production flow and approved capture-first principle.',
      'Plain tasks remain one field plus Enter.',
      'Optional controls stay visually subordinate until expanded.',
    ],
    tradeoffs: [
      'Metadata remains less discoverable than persistent controls.',
      'Inline tag grammar and a secondary options panel create two interaction models.',
    ],
    complexity: 'Low–medium. Reuses the current row and tag behavior; adds one explicit metadata disclosure surface.',
    keyboard: 'Enter adds. # opens tag suggestions; Arrow keys move; Enter selects; Escape closes suggestions or options.',
    emptyError: 'Blank submit names the missing task. Empty lists keep the row visible. Save failure preserves the draft and same retry action.',
    platforms: {
      Desktop: 'Best density match; existing shortcut and inline-tag habits transfer directly.',
      Web: 'Works without native capabilities; focus and popover positioning need browser coverage.',
      Mobile: 'Usable, but the compact row and hidden metadata are less touch-discoverable.',
    },
  },
  command: {
    title: 'Command style',
    summary: 'Put task text and optional organization into one keyboard-oriented command surface.',
    goal: 'Capture and organize without leaving the input or tabbing through metadata controls.',
    benefits: [
      'Fastest path for experienced keyboard users.',
      'Commands scale without permanently widening the composer.',
      'The palette teaches available syntax in context.',
    ],
    tradeoffs: [
      'Higher learning cost and greater parsing/error-design burden.',
      'Touch users still need visible equivalents for every command.',
    ],
    complexity: 'High. Requires a command grammar, discoverable palette, collision rules, validation, and accessible announcements.',
    keyboard: 'Type / or # to open the palette; Arrow keys move, Enter applies, Escape closes. Enter with no open palette adds.',
    emptyError: 'Blank submit is rejected in place. Invalid commands must identify correction. Save failure retains resolved metadata and draft.',
    platforms: {
      Desktop: 'Excellent for shortcut-heavy capture once learned.',
      Web: 'Viable, but browser and IME input semantics need careful testing.',
      Mobile: 'Weakest default: slash grammar competes with soft keyboards and needs visible alternatives.',
    },
  },
  touch: {
    title: 'Touch first',
    summary: 'Expose large, explicit metadata controls and a full-width Add action.',
    goal: 'Make task capture and organization obvious and comfortable without hover, precision, or command knowledge.',
    benefits: [
      'Primary actions and metadata meet the 44px touch target direction.',
      'No hidden hover affordances or syntax prerequisite.',
      'The same visible controls support keyboard and pointer discovery.',
    ],
    tradeoffs: [
      'Consumes the most vertical space on desktop and phone.',
      'More visible choices can slow plain capture and conflict with progressive disclosure.',
    ],
    complexity: 'Medium–high. Needs a mobile keyboard-safe metadata surface and responsive desktop density.',
    keyboard: 'Tab reaches every visible control; Enter in the field adds; Escape closes the tag surface and returns to Tags.',
    emptyError: 'Blank submit stays focused with direct guidance. Empty lists retain the composer. Failure keeps the draft and large retry action.',
    platforms: {
      Desktop: 'Clear but comparatively spacious; could be offered as a density preference rather than the default.',
      Web: 'Strong pointer and keyboard discoverability with no native dependency.',
      Mobile: 'Strongest fit; controls remain visible above the task list and require no hover.',
    },
  },
};

const meta: Meta = {
  title: 'Concepts/Quick Add pilot',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Three non-production Quick Add directions for comparison. Only the user can approve a direction.',
      },
    },
  },
};

export default meta;
type Story = StoryObj;

const makeButton = (label: string, className = ''): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  return button;
};

const createProductionAddButton = (submit: () => void): HTMLButtonElement => {
  const button = makeButton('', 'primary-button icon-btn quick-add-production-submit');
  button.setAttribute('aria-label', 'Add task');
  button.innerHTML = `
    <svg class="icon-add" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z" fill="currentColor" />
    </svg>
  `;
  button.addEventListener('click', submit);
  return button;
};

const resetModel = (model: ConceptModel, fixtureKey: FixtureKey): void => {
  const fixture = fixtures[fixtureKey];
  model.fixtureKey = fixtureKey;
  model.draft = fixture.draft;
  model.tasks = fixture.tasks.map((task) => ({ ...task, tags: [...task.tags] }));
  model.selectedTags = fixtureKey === 'empty' ? [] : ['Design'];
  model.priority = fixtureKey === 'error' ? 'high' : 'none';
  model.due = fixtureKey === 'populated' ? 'Today' : 'No date';
  model.status = '';
  model.error = fixture.errorMessage ?? '';
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
    ['Keyboard behavior', copy.keyboard],
    ['Empty and error behavior', copy.emptyError],
  ] as const;
  details.forEach(([title, text]) => {
    const section = document.createElement('section');
    const sectionHeading = document.createElement('h3');
    sectionHeading.textContent = title;
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    section.append(sectionHeading, paragraph);
    aside.append(section);
  });

  const platformSection = document.createElement('section');
  const platformHeading = document.createElement('h3');
  platformHeading.textContent = 'Desktop, web, and mobile';
  const platformList = document.createElement('dl');
  Object.entries(copy.platforms).forEach(([platform, implication]) => {
    const term = document.createElement('dt');
    term.textContent = platform;
    const definition = document.createElement('dd');
    definition.textContent = implication;
    platformList.append(term, definition);
  });
  platformSection.append(platformHeading, platformList);
  aside.append(platformSection);
  return aside;
};

const renderSelectedTags = (host: HTMLElement, model: ConceptModel): void => {
  host.replaceChildren();
  model.selectedTags.forEach((label) => {
    const tag = fixtures[model.fixtureKey].availableTags.find((candidate) => candidate.label === label);
    if (!tag) return;
    host.append(
      createTagChip({
        label: `#${label} ×`,
        color: tag.color,
        colorsEnabled: true,
        variant: 'pending',
        title: `Remove ${label} tag`,
        onActivate: () => {
          model.selectedTags = model.selectedTags.filter((selected) => selected !== label);
          renderSelectedTags(host, model);
        },
      }),
    );
  });
};

const createMetadataSummary = (model: ConceptModel): HTMLElement => {
  const summary = document.createElement('div');
  summary.className = 'quick-add-metadata-summary';
  summary.setAttribute('role', 'group');
  summary.setAttribute('aria-label', 'Draft metadata');
  [model.due, model.priority === 'high' ? 'High priority' : 'No priority'].forEach((label) => {
    const chip = document.createElement('span');
    chip.className = 'template-chip quick-add-meta-chip';
    chip.textContent = label;
    summary.append(chip);
  });
  const tags = document.createElement('div');
  tags.className = 'quick-add-selected-tags';
  renderSelectedTags(tags, model);
  summary.append(tags);
  return summary;
};

const createCompactComposer = (
  model: ConceptModel,
  submit: () => void,
): { element: HTMLElement; input: HTMLInputElement } => {
  const composer = document.createElement('section');
  composer.className = 'quick-add-composer quick-add-composer--compact';
  composer.setAttribute('aria-label', 'Compact Quick Add concept');

  const row = document.createElement('div');
  row.className = 'input-row';
  const inputWrap = document.createElement('div');
  inputWrap.className = 'add-task-input-wrap';
  const input = document.createElement('input');
  input.id = 'compact-quick-add-input';
  input.className = 'text-input';
  input.value = model.draft;
  input.placeholder = 'Add a new task (⌘N)';
  input.setAttribute('aria-label', 'Task');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', 'compact-tag-suggestions');
  input.dataset.quickAddInput = 'true';
  const add = createProductionAddButton(submit);
  inputWrap.append(input);
  row.append(inputWrap, add);

  const selectedTags = document.createElement('div');
  selectedTags.className = 'add-task-tags quick-add-selected-tags';
  renderSelectedTags(selectedTags, model);

  const menu = document.createElement('div');
  menu.id = 'compact-tag-suggestions';
  menu.className = 'tag-suggest-menu quick-add-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'Tag suggestions');
  menu.hidden = true;
  let activeIndex = 0;
  let matches: ConceptUiFixture['availableTags'] = [];

  const closeMenu = (): void => {
    menu.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };

  const selectTag = (index: number): void => {
    const tag = matches[index];
    if (!tag) return;
    if (!model.selectedTags.includes(tag.label)) model.selectedTags.push(tag.label);
    model.draft = input.value.replace(/#[A-Za-z0-9_-]*$/, '').trimEnd();
    input.value = model.draft;
    renderSelectedTags(selectedTags, model);
    closeMenu();
    input.focus();
  };

  const renderMenu = (): void => {
    const token = /#([A-Za-z0-9_-]*)$/.exec(input.value);
    if (!token) {
      closeMenu();
      return;
    }
    const query = token[1].toLowerCase();
    matches = fixtures[model.fixtureKey].availableTags.filter((tag) =>
      tag.label.toLowerCase().includes(query),
    );
    if (matches.length === 0) {
      closeMenu();
      return;
    }
    activeIndex = Math.min(activeIndex, matches.length - 1);
    menu.replaceChildren();
    matches.forEach((tag, index) => {
      const option = makeButton(`#${tag.label}`, 'tag-suggest-item');
      option.id = `compact-tag-option-${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', index === activeIndex ? 'true' : 'false');
      option.classList.toggle('active', index === activeIndex);
      option.addEventListener('mousedown', (event) => event.preventDefault());
      option.addEventListener('click', () => selectTag(index));
      menu.append(option);
    });
    menu.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', `compact-tag-option-${activeIndex}`);
  };

  input.addEventListener('input', () => {
    model.draft = input.value;
    renderMenu();
  });
  input.addEventListener('keydown', (event) => {
    if (!menu.hidden && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      activeIndex =
        (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      renderMenu();
      return;
    }
    if (!menu.hidden && event.key === 'Enter') {
      event.preventDefault();
      selectTag(activeIndex);
      return;
    }
    if (!menu.hidden && event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });

  const optionsButton = makeButton('Options', 'view-bar-action quick-add-disclosure');
  optionsButton.setAttribute('aria-expanded', 'false');
  optionsButton.setAttribute('aria-controls', 'compact-options');
  const options = document.createElement('div');
  options.id = 'compact-options';
  options.className = 'quick-add-options';
  options.hidden = true;
  const today = makeButton('Today', 'quick-add-option');
  const high = makeButton('High priority', 'quick-add-option');
  [today, high].forEach((button) => button.setAttribute('aria-pressed', 'false'));
  today.setAttribute('aria-pressed', model.due === 'Today' ? 'true' : 'false');
  high.setAttribute('aria-pressed', model.priority === 'high' ? 'true' : 'false');
  today.addEventListener('click', () => {
    model.due = model.due === 'Today' ? 'No date' : 'Today';
    today.setAttribute('aria-pressed', model.due === 'Today' ? 'true' : 'false');
  });
  high.addEventListener('click', () => {
    model.priority = model.priority === 'high' ? 'none' : 'high';
    high.setAttribute('aria-pressed', model.priority === 'high' ? 'true' : 'false');
  });
  options.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    options.hidden = true;
    optionsButton.setAttribute('aria-expanded', 'false');
    optionsButton.focus();
  });
  options.append(today, high);
  optionsButton.addEventListener('click', () => {
    const willOpen = options.hidden;
    options.hidden = !willOpen;
    optionsButton.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    if (willOpen) today.focus();
  });

  const footer = document.createElement('div');
  footer.className = 'quick-add-composer__footer';
  footer.append(optionsButton);
  inputWrap.append(menu);
  composer.append(row, selectedTags, options, footer);
  return { element: composer, input };
};

const createCommandComposer = (
  model: ConceptModel,
  submit: () => void,
): { element: HTMLElement; input: HTMLInputElement } => {
  const composer = document.createElement('section');
  composer.className = 'quick-add-composer quick-add-composer--command';
  composer.setAttribute('aria-label', 'Command-style Quick Add concept');
  const row = document.createElement('div');
  row.className = 'input-row';
  const inputWrap = document.createElement('div');
  inputWrap.className = 'add-task-input-wrap';
  const input = document.createElement('input');
  input.id = 'command-quick-add-input';
  input.className = 'text-input';
  input.value = model.draft;
  input.placeholder = 'Add a task, /today, /high, or #tag';
  input.setAttribute('aria-label', 'Task or command');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', 'command-palette');
  input.dataset.quickAddInput = 'true';
  const add = createProductionAddButton(submit);
  inputWrap.append(input);
  row.append(inputWrap, add);

  const palette = document.createElement('div');
  palette.id = 'command-palette';
  palette.className = 'tag-suggest-menu quick-add-menu quick-add-command-palette';
  palette.setAttribute('role', 'listbox');
  palette.setAttribute('aria-label', 'Quick Add commands');
  palette.hidden = true;
  const commands = [
    { token: '/today', label: 'Due today', apply: () => (model.due = 'Today' as const) },
    { token: '/high', label: 'High priority', apply: () => (model.priority = 'high' as const) },
    {
      token: '#design',
      label: 'Design tag',
      apply: () => {
        if (!model.selectedTags.includes('Design')) model.selectedTags.push('Design');
      },
    },
  ];
  let activeIndex = 0;
  let matches = commands;
  const summaryHost = document.createElement('div');
  const renderSummary = (): void => summaryHost.replaceChildren(createMetadataSummary(model));
  renderSummary();

  const closePalette = (): void => {
    palette.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  const selectCommand = (index: number): void => {
    const command = matches[index];
    if (!command) return;
    command.apply();
    model.draft = input.value.replace(/(?:\/|#)[A-Za-z0-9_-]*$/, '').trimEnd();
    input.value = model.draft;
    closePalette();
    renderSummary();
    input.focus();
  };
  const renderPalette = (): void => {
    const token = /((?:\/|#)[A-Za-z0-9_-]*)$/.exec(input.value)?.[1]?.toLowerCase();
    if (!token) {
      closePalette();
      return;
    }
    matches = commands.filter((command) => command.token.startsWith(token));
    if (matches.length === 0) {
      closePalette();
      return;
    }
    activeIndex = Math.min(activeIndex, matches.length - 1);
    palette.replaceChildren();
    matches.forEach((command, index) => {
      const option = makeButton(`${command.token} — ${command.label}`, 'tag-suggest-item');
      option.id = `command-option-${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', index === activeIndex ? 'true' : 'false');
      option.classList.toggle('active', index === activeIndex);
      option.addEventListener('mousedown', (event) => event.preventDefault());
      option.addEventListener('click', () => selectCommand(index));
      palette.append(option);
    });
    palette.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', `command-option-${activeIndex}`);
  };
  input.addEventListener('input', () => {
    model.draft = input.value;
    renderPalette();
  });
  input.addEventListener('keydown', (event) => {
    if (!palette.hidden && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      activeIndex =
        (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      renderPalette();
      return;
    }
    if (!palette.hidden && event.key === 'Enter') {
      event.preventDefault();
      selectCommand(activeIndex);
      return;
    }
    if (!palette.hidden && event.key === 'Escape') {
      event.preventDefault();
      closePalette();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });
  inputWrap.append(palette);
  composer.append(row, summaryHost);
  return { element: composer, input };
};

const createTouchComposer = (
  model: ConceptModel,
  submit: () => void,
): { element: HTMLElement; input: HTMLInputElement } => {
  const composer = document.createElement('section');
  composer.className = 'quick-add-composer quick-add-composer--touch';
  composer.setAttribute('aria-label', 'Touch-first Quick Add concept');
  const label = document.createElement('label');
  label.htmlFor = 'touch-quick-add-input';
  label.textContent = 'What needs doing?';
  const input = document.createElement('input');
  input.id = 'touch-quick-add-input';
  input.className = 'quick-add-input';
  input.value = model.draft;
  input.placeholder = 'Add a task';
  input.dataset.quickAddInput = 'true';
  input.addEventListener('input', () => (model.draft = input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });

  const actions = document.createElement('div');
  actions.className = 'quick-add-touch-actions';
  const today = makeButton('Today', 'quick-add-touch-control');
  today.setAttribute('aria-pressed', model.due === 'Today' ? 'true' : 'false');
  today.addEventListener('click', () => {
    model.due = model.due === 'Today' ? 'No date' : 'Today';
    today.setAttribute('aria-pressed', model.due === 'Today' ? 'true' : 'false');
  });
  const priority = makeButton('Priority', 'quick-add-touch-control');
  priority.setAttribute('aria-pressed', model.priority === 'high' ? 'true' : 'false');
  priority.addEventListener('click', () => {
    model.priority = model.priority === 'high' ? 'none' : 'high';
    priority.setAttribute('aria-pressed', model.priority === 'high' ? 'true' : 'false');
  });
  const tagsButton = makeButton('Tags', 'quick-add-touch-control');
  tagsButton.setAttribute('aria-expanded', 'false');
  tagsButton.setAttribute('aria-controls', 'touch-tag-surface');
  actions.append(today, priority, tagsButton);

  const tagSurface = document.createElement('div');
  tagSurface.id = 'touch-tag-surface';
  tagSurface.className = 'quick-add-touch-surface';
  tagSurface.setAttribute('role', 'dialog');
  tagSurface.setAttribute('aria-label', 'Choose tags');
  tagSurface.hidden = true;
  fixtures[model.fixtureKey].availableTags.forEach((tag) => {
    const option = makeButton(tag.label, 'quick-add-touch-control');
    option.setAttribute('aria-pressed', model.selectedTags.includes(tag.label) ? 'true' : 'false');
    option.addEventListener('click', () => {
      if (model.selectedTags.includes(tag.label)) {
        model.selectedTags = model.selectedTags.filter((selected) => selected !== tag.label);
      } else {
        model.selectedTags.push(tag.label);
      }
      option.setAttribute('aria-pressed', model.selectedTags.includes(tag.label) ? 'true' : 'false');
    });
    tagSurface.append(option);
  });
  const done = makeButton('Done', 'quick-add-touch-control');
  done.addEventListener('click', () => {
    tagSurface.hidden = true;
    tagsButton.setAttribute('aria-expanded', 'false');
    tagsButton.focus();
  });
  tagSurface.append(done);
  tagsButton.addEventListener('click', () => {
    const willOpen = tagSurface.hidden;
    tagSurface.hidden = !willOpen;
    tagsButton.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    if (willOpen) tagSurface.querySelector<HTMLButtonElement>('button')?.focus();
  });
  tagSurface.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    tagSurface.hidden = true;
    tagsButton.setAttribute('aria-expanded', 'false');
    tagsButton.focus();
  });

  const add = makeButton('Add task', 'quick-add-submit quick-add-submit--touch');
  add.addEventListener('click', submit);
  composer.append(label, input, actions, tagSurface, createMetadataSummary(model), add);
  return { element: composer, input };
};

const createQuickAddPilot = (direction: Direction): HTMLElement => {
  const copy = notes[direction];
  const theme = document.documentElement.dataset.adeoTheme ?? 'light';
  const model = {} as ConceptModel;
  resetModel(model, 'populated');

  const page = document.createElement('main');
  page.className = 'quick-add-pilot';
  page.dataset.storybookConcept = 'ready';
  page.dataset.quickAddDirection = direction;

  const header = document.createElement('header');
  header.className = 'quick-add-pilot__header';
  header.innerHTML = `
    <div>
      <p class="quick-add-pilot__eyebrow">Quick Add pilot · not approved</p>
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

  const stateControls = document.createElement('div');
  stateControls.className = 'quick-add-state-controls';
  stateControls.setAttribute('role', 'group');
  stateControls.setAttribute('aria-label', 'Fixture state');
  const stateLabels: Record<FixtureKey, string> = {
    populated: 'Populated',
    empty: 'Empty',
    error: 'Save error',
  };
  const fixtureLabel = document.createElement('p');
  fixtureLabel.className = 'quick-add-fixture-label';
  fixtureLabel.textContent = 'Storybook fixture controls — not part of Adeo';

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
    } else {
      const status = document.createElement('p');
      status.className = 'quick-add-feedback__status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.textContent = model.status;
      feedback.append(status);
    }
  };

  const buildComposer = (): { element: HTMLElement; input: HTMLInputElement } =>
    direction === 'compact'
      ? createCompactComposer(model, submit)
      : direction === 'command'
        ? createCommandComposer(model, submit)
        : createTouchComposer(model, submit);

  const mountComposer = (focusInput = false): void => {
    const composer = buildComposer();
    shellHandle?.setComposer(composer.element);
    renderFeedback();
    if (focusInput) composer.input.focus();
  };

  function submit(): void {
    const taskTitle = model.draft.trim();
    if (!taskTitle) {
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
        id: 'concept-added-task',
        title: taskTitle,
        dueLabel: model.due,
        priority: model.priority,
        completed: false,
        tags: [...model.selectedTags],
      },
      ...model.tasks,
    ];
    model.draft = '';
    model.error = '';
    model.status = `Added “${taskTitle}”.`;
    shellHandle?.setViewTasks('all', model.tasks);
    mountComposer(true);
  }

  const mountShell = (focusInput = false): void => {
    const composer = buildComposer();
    const shellFixture = createQuickAddShellFixture(model.fixtureKey, model.tasks);
    shellHandle = createAppShellPreview(shellFixture, { composer: composer.element });
    shellFrame.replaceChildren(shellHandle.element);
    renderFeedback();
    if (focusInput) composer.input.focus();
  };

  const renderStateButtons = (): void => {
    stateControls.replaceChildren();
    (Object.keys(stateLabels) as FixtureKey[]).forEach((key) => {
      const button = makeButton(stateLabels[key], 'quick-add-state-button');
      button.setAttribute('aria-pressed', model.fixtureKey === key ? 'true' : 'false');
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

export const CompactCurrentDirection: Story = {
  name: 'Compact / current direction',
  render: () => createQuickAddPilot('compact'),
};

export const CommandStyle: Story = {
  name: 'Command style',
  render: () => createQuickAddPilot('command'),
};

export const TouchFirst: Story = {
  name: 'Touch first',
  render: () => createQuickAddPilot('touch'),
};
