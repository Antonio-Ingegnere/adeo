import type { Meta, StoryObj } from '@storybook/html-vite';

import {
  createShortcutKeycaps,
  createSidebarPill,
  createTagChip,
} from '../../../src/renderer/uiElements';
import { conceptFixtureCatalog, conceptShellFixture, type ConceptUiFixture } from './fixtures';
import { createProductionTaskPreview } from './production-task-preview';
import { createAppShellPreview } from './app-shell-preview';
import './fixture-catalog.css';

const meta: Meta = {
  title: 'Concepts/Fixture catalog',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Deterministic data states for concept work. This infrastructure is not a proposed product direction.',
      },
    },
  },
};

export default meta;
type Story = StoryObj;

const createFixtureCard = (fixture: ConceptUiFixture): HTMLElement => {
  const card = document.createElement('article');
  card.className = 'concept-fixture';
  card.dataset.fixtureId = fixture.id;

  const heading = document.createElement('header');
  heading.className = 'concept-fixture__header';
  heading.innerHTML = `
    <div>
      <p class="concept-fixture__eyebrow">${fixture.id}</p>
      <h2>${fixture.label}</h2>
    </div>
    <time datetime="${fixture.nowIso}">${fixture.nowIso}</time>
  `;

  const state = document.createElement('dl');
  state.className = 'concept-fixture__state';
  state.innerHTML = `
    <div><dt>Active list</dt><dd>${fixture.activeList}</dd></div>
    <div><dt>Draft</dt><dd>${fixture.draft || 'Empty'}</dd></div>
    <div><dt>Tasks</dt><dd>${fixture.tasks.length}</dd></div>
  `;

  const productionSamples = document.createElement('div');
  productionSamples.className = 'concept-fixture__production-samples';
  productionSamples.setAttribute('role', 'group');
  productionSamples.setAttribute('aria-label', 'Production component samples');
  productionSamples.append(
    createSidebarPill({
      label: fixture.activeList,
      selected: true,
      count: fixture.tasks.length,
    }),
    createShortcutKeycaps({ tokens: ['⌘', 'K'] }),
  );

  const tags = document.createElement('div');
  tags.className = 'concept-fixture__tags';
  tags.setAttribute('role', 'group');
  tags.setAttribute('aria-label', 'Production task tag samples');
  fixture.availableTags.forEach((tag) => {
    tags.append(
      createTagChip({
        label: `#${tag.label}`,
        color: tag.color,
        colorsEnabled: true,
        ariaLabel: `#${tag.label} fixture tag`,
      }),
    );
  });

  const taskSection = document.createElement('section');
  taskSection.className = 'concept-fixture__tasks tasks-section';
  const taskHeading = document.createElement('h3');
  taskHeading.textContent = 'Production task preview';
  taskSection.append(
    taskHeading,
    createProductionTaskPreview({
      tasks: fixture.tasks,
      availableTags: fixture.availableTags,
    }),
  );

  if (fixture.errorMessage) {
    const error = document.createElement('p');
    error.className = 'concept-fixture__error';
    error.setAttribute('role', 'alert');
    error.textContent = fixture.errorMessage;
    taskSection.append(error);
  }

  card.append(heading, state, productionSamples, tags, taskSection);
  return card;
};

export const DeterministicStates: Story = {
  render: () => {
    const theme = document.documentElement.dataset.adeoTheme ?? 'light';
    const page = document.createElement('main');
    page.className = 'concept-catalog';
    page.dataset.storybookConcept = 'ready';
    page.innerHTML = `
      <header class="concept-catalog__header">
        <div>
          <p class="concept-catalog__eyebrow">Storybook design lab</p>
          <h1>Deterministic concept fixtures</h1>
          <p>
            Frozen data states for comparing future concepts without Electron services,
            clocks, random values, or mutable application state.
          </p>
        </div>
        <span class="concept-catalog__theme" data-testid="active-theme">${theme} theme</span>
      </header>
      <section class="concept-catalog__grid" aria-label="Concept fixture catalog"></section>
    `;

    const grid = page.querySelector<HTMLElement>('.concept-catalog__grid');
    conceptFixtureCatalog.forEach((fixture) => grid?.append(createFixtureCard(fixture)));
    return page;
  },
};

/**
 * P2.1 reopened 2026-08-25: the flat fixtures above only ever show one list's worth of tasks in
 * an isolated card, so it never reads as "inside Adeo." This story adds the real sidebar
 * (Lists/Smart lists/Tags), multiple lists, a smart list, an "All lists" aggregate, and
 * recurring/reminder task states, with working view switching and sidebar drag-reorder. See
 * `ui-ux/ux/reviews/p2-1-concept-fixtures-review.md` for the reopened findings.
 */
export const AppShell: Story = {
  render: () => {
    const theme = document.documentElement.dataset.adeoTheme ?? 'light';
    const page = document.createElement('main');
    page.className = 'concept-catalog concept-shell-page';
    page.dataset.storybookConcept = 'ready';
    page.innerHTML = `
      <header class="concept-catalog__header">
        <div>
          <p class="concept-catalog__eyebrow">Storybook design lab · not part of Adeo</p>
          <h1>App shell fixture</h1>
          <p>
            The real Adeo sidebar and task view, driven by deterministic fixture data: multiple
            lists, a smart list, an "All lists" aggregate, recurring tasks, active reminders,
            sidebar drag-reorder, a working view picker, and arrow-key task navigation.
          </p>
        </div>
        <span class="concept-catalog__theme" data-testid="active-theme">${theme} theme</span>
      </header>
    `;
    const frame = document.createElement('div');
    frame.className = 'concept-shell-frame';
    frame.setAttribute('role', 'region');
    frame.setAttribute('aria-label', 'Adeo app shell preview');
    frame.append(createAppShellPreview(conceptShellFixture).element);
    page.append(frame);
    return page;
  },
};
