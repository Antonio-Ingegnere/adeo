import type { Meta, StoryObj } from '@storybook/html-vite';

import {
  createShortcutKeycaps,
  createSidebarPill,
  createTagChip,
} from '../../../src/renderer/uiElements';
import { conceptFixtureCatalog, type ConceptUiFixture } from './fixtures';
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
  tags.setAttribute('aria-label', 'Available tags');
  fixture.availableTags.forEach((tag) => {
    tags.append(
      createTagChip({
        label: tag.label,
        color: tag.color,
        colorsEnabled: true,
        ariaLabel: `${tag.label} fixture tag`,
      }),
    );
  });

  const taskSection = document.createElement('section');
  taskSection.className = 'concept-fixture__tasks';
  const taskHeading = document.createElement('h3');
  taskHeading.textContent = 'Task data';
  taskSection.append(taskHeading);

  if (fixture.tasks.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'concept-fixture__empty';
    empty.textContent = 'No tasks in this deterministic state.';
    taskSection.append(empty);
  } else {
    const list = document.createElement('ul');
    fixture.tasks.forEach((task) => {
      const item = document.createElement('li');
      item.dataset.priority = task.priority;
      item.innerHTML = `
        <span class="concept-fixture__task-title">${task.title}</span>
        <span>${task.dueLabel}</span>
        <span>${task.tags.join(', ')}</span>
        <span>${task.completed ? 'Completed' : 'Open'}</span>
      `;
      list.append(item);
    });
    taskSection.append(list);
  }

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
