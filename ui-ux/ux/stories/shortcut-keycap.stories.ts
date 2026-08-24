import type { Meta, StoryObj } from '@storybook/html-vite';

import { createShortcutKeycaps } from '../../../src/renderer/uiElements';
import './component-stories.css';
import { createComponentStoryShell, createStateSample } from './component-story-shell';

const meta: Meta = {
  title: 'Components/Shortcut keycap',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Production keycap presentation accepts already-formatted display tokens and carries no keymap or platform dependency.',
      },
    },
  },
};

export default meta;
type Story = StoryObj;

export const States: Story = {
  render: () => {
    const { page, content } = createComponentStoryShell(
      'shortcut-keycap',
      'Shortcut keycap',
      'Feature code formats bindings; this factory renders explicit display tokens as individual keycaps.',
    );

    const standard = createStateSample('Standard chord', 'normal');
    standard.body.appendChild(createShortcutKeycaps({ tokens: ['⌘', 'K'] }));

    const sequence = createStateSample('Multi-key chord', 'multi-key');
    sequence.body.appendChild(
      createShortcutKeycaps({ tokens: ['Shift', 'Enter'] }),
    );

    const single = createStateSample('Single key', 'single-key');
    single.body.appendChild(createShortcutKeycaps({ tokens: ['?'] }));

    const longText = createStateSample('Long key label', 'long-text');
    longText.body.appendChild(
      createShortcutKeycaps({ tokens: ['Page Down'] }),
    );

    content.append(standard.sample, sequence.sample, single.sample, longText.sample);
    return page;
  },
};
