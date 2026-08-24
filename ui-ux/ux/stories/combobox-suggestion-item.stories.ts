import type { Meta, StoryObj } from '@storybook/html-vite';

import { createComboboxSuggestionItem } from '../../../src/renderer/uiElements';
import './component-stories.css';
import { createComponentStoryShell, createStateSample } from './component-story-shell';

const meta: Meta = {
  title: 'Components/Combobox suggestion item',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Production listbox option factory with explicit label, metadata, active/disabled state, optional tag color, and selection callback.',
      },
    },
  },
};

export default meta;
type Story = StoryObj;

export const States: Story = {
  render: () => {
    const { page, content } = createComponentStoryShell(
      'combobox-suggestion-item',
      'Combobox suggestion item',
      'The input owns focus and navigation; each option receives its complete visual state and callback explicitly.',
    );

    const gallery = createStateSample('Listbox states', 'all-states', true);
    const listbox = document.createElement('div');
    listbox.className = 'component-story__listbox';
    listbox.setAttribute('role', 'listbox');
    listbox.setAttribute('aria-label', 'Suggestion item states');

    const status = document.createElement('output');
    status.className = 'component-story__status';
    status.dataset.testid = 'suggestion-status';
    status.textContent = 'No suggestion selected';

    listbox.append(
      createComboboxSuggestionItem({
        id: 'story-suggestion-normal',
        label: '#planning',
        color: '#C5D4F5',
        colorsEnabled: true,
        active: false,
        onSelect: () => {
          status.textContent = '#planning selected';
        },
      }),
      createComboboxSuggestionItem({
        id: 'story-suggestion-active',
        label: 'priority:high',
        hint: 'High priority',
        variant: 'query',
        active: true,
        onSelect: () => {
          status.textContent = 'priority:high selected';
        },
      }),
      createComboboxSuggestionItem({
        id: 'story-suggestion-disabled',
        label: '#archived',
        color: '#F6C6C6',
        colorsEnabled: true,
        active: false,
        disabled: true,
      }),
      createComboboxSuggestionItem({
        id: 'story-suggestion-long',
        label: 'tag:quarterly-planning-and-retrospective',
        hint: 'A deliberately long metadata label that must remain readable',
        variant: 'query',
        active: false,
        onSelect: () => {
          status.textContent = 'Long suggestion selected';
        },
      }),
    );

    gallery.body.appendChild(listbox);
    gallery.sample.appendChild(status);
    content.appendChild(gallery.sample);
    return page;
  },
};
