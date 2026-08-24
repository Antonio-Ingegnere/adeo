import type { Meta, StoryObj } from '@storybook/html-vite';

import { createTagChip, createTagDot } from '../../../src/renderer/uiElements';
import './component-stories.css';
import { createComponentStoryShell, createStateSample } from './component-story-shell';

const meta: Meta = {
  title: 'Components/Tag chip and dot',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Production tag chip and dot factories with explicit color, visibility, disabled state, and activation callback inputs.',
      },
    },
  },
};

export default meta;
type Story = StoryObj;

export const States: Story = {
  render: () => {
    const { page, content } = createComponentStoryShell(
      'tag-chip-dot',
      'Tag chip and dot',
      'Tag data supplies the pastel color; the caller explicitly controls color visibility and activation.',
    );

    const normal = createStateSample('Normal and interactive', 'normal');
    const status = document.createElement('output');
    status.className = 'component-story__status';
    status.dataset.testid = 'tag-chip-status';
    status.textContent = 'No tag selected';
    normal.body.appendChild(
      createTagChip({
        label: '#planning',
        color: '#C5D4F5',
        colorsEnabled: true,
        title: 'Filter by #planning',
        onActivate: () => {
          status.textContent = '#planning selected';
        },
      }),
    );
    normal.sample.appendChild(status);

    const plain = createStateSample('Colors disabled', 'plain');
    plain.body.appendChild(
      createTagChip({
        label: '#personal',
        color: '#C9E8C1',
        colorsEnabled: false,
      }),
    );
    const hiddenDot = createTagDot({ color: '#C9E8C1', colorsEnabled: false });
    const hiddenLabel = document.createElement('span');
    hiddenLabel.className = 'component-story__dot-label';
    hiddenLabel.textContent = hiddenDot ? 'Unexpected visible dot' : 'Dot intentionally omitted';
    if (hiddenDot) hiddenLabel.prepend(hiddenDot);
    plain.body.appendChild(hiddenLabel);

    const disabled = createStateSample('Disabled', 'disabled');
    disabled.body.appendChild(
      createTagChip({
        label: '#archived',
        color: '#F6C6C6',
        colorsEnabled: true,
        disabled: true,
      }),
    );

    const longText = createStateSample('Long text', 'long-text');
    longText.body.appendChild(
      createTagChip({
        label: '#quarterly-planning-and-retrospective',
        color: '#DCCDF0',
        colorsEnabled: true,
      }),
    );

    const dots = createStateSample('Palette dots', 'dots', true);
    [
      ['Rose', '#F6C6C6'],
      ['Mint', '#C9E8C1'],
      ['Aqua', '#BEE3E8'],
      ['Periwinkle', '#C5D4F5'],
    ].forEach(([name, color]) => {
      const label = document.createElement('span');
      label.className = 'component-story__dot-label';
      const dot = createTagDot({ color, colorsEnabled: true });
      if (dot) label.appendChild(dot);
      label.appendChild(document.createTextNode(name));
      dots.body.appendChild(label);
    });

    content.append(normal.sample, plain.sample, disabled.sample, longText.sample, dots.sample);
    return page;
  },
};
