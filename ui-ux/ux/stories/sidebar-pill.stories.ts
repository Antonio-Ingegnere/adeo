import type { Meta, StoryObj } from '@storybook/html-vite';

import { createSidebarPill } from '../../../src/renderer/uiElements';
import './component-stories.css';
import { createComponentStoryShell, createStateSample } from './component-story-shell';

const meta: Meta = {
  title: 'Components/Sidebar pill',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Production list-pill presentation with explicit label, count, selected state, and activation callback. Drag ordering remains feature-owned and is intentionally absent.',
      },
    },
  },
};

export default meta;
type Story = StoryObj;

let focusedPill: HTMLElement | null = null;

export const States: Story = {
  render: () => {
    focusedPill = null;
    const { page, content } = createComponentStoryShell(
      'sidebar-pill',
      'Sidebar pill',
      'The production list renderer owns data and drag ordering; this shared boundary renders explicit presentation and activation state.',
    );

    const status = document.createElement('output');
    status.className = 'component-story__status';
    status.dataset.testid = 'sidebar-pill-status';
    status.textContent = 'No list selected';

    const normal = createStateSample('Unselected', 'unselected');
    const normalRail = document.createElement('div');
    normalRail.className = 'component-story__sidebar';
    normalRail.appendChild(
      createSidebarPill({
        label: 'Personal',
        selected: false,
        count: 4,
        onActivate: () => {
          status.textContent = 'Personal selected';
        },
      }),
    );
    normal.body.appendChild(normalRail);

    const selected = createStateSample('Selected and keyboard focused', 'selected-focused');
    const selectedRail = document.createElement('div');
    selectedRail.className = 'component-story__sidebar';
    focusedPill = createSidebarPill({
      label: 'Planning',
      selected: true,
      count: 12,
      onActivate: () => {
        status.textContent = 'Planning activated by keyboard';
      },
    });
    focusedPill.dataset.testid = 'focused-sidebar-pill';
    selectedRail.appendChild(focusedPill);
    selected.body.appendChild(selectedRail);

    const longText = createStateSample('Long label', 'long-label', true);
    const longRail = document.createElement('div');
    longRail.className = 'component-story__sidebar';
    longRail.appendChild(
      createSidebarPill({
        label: 'Quarterly planning and retrospective follow-up actions',
        selected: false,
        count: 128,
      }),
    );
    longText.body.appendChild(longRail);
    longText.sample.appendChild(status);

    content.append(normal.sample, selected.sample, longText.sample);
    requestAnimationFrame(() => focusedPill?.focus());
    return page;
  },
};
