import type { Meta, StoryObj } from '@storybook/html-vite';

import {
  attachDatePicker,
  type DatePickerController,
  type DateParts,
} from '../../../src/renderer/datepicker';
import './component-stories.css';
import { createComponentStoryShell, createStateSample } from './component-story-shell';

const meta: Meta = {
  title: 'Components/Date picker',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Production date-picker interaction with explicit formatting and deterministic today inputs for isolated review. Arrow keys move by day or week; Page Up/Down moves by month.',
      },
    },
  },
};

export default meta;
type Story = StoryObj;

const FIXED_TODAY: DateParts = { year: 2026, month: 0, day: 1 };
const formatDayMonthYear = (value: string): string => {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
};

let controllers: DatePickerController[] = [];

const makeField = (
  labelText: string,
  value: string,
  parent: HTMLElement,
): { field: HTMLLabelElement; controller: DatePickerController } => {
  const field = document.createElement('label');
  field.className = 'component-story__date-field';
  field.appendChild(document.createTextNode(labelText));
  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'repeat-date-input';
  input.value = value;
  field.appendChild(input);
  parent.appendChild(field);

  const controller = attachDatePicker(input, {
    accessibleName: labelText,
    formatValue: formatDayMonthYear,
    popoverParent: parent,
    today: FIXED_TODAY,
  });
  if (!controller) throw new Error(`Could not attach the ${labelText} date picker.`);
  controllers.push(controller);
  return { field, controller };
};

export const States: Story = {
  render: () => {
    controllers.forEach((controller) => controller.destroy());
    controllers = [];

    const { page, content } = createComponentStoryShell(
      'date-picker',
      'Date picker',
      'The production picker receives deterministic date and formatting dependencies while retaining the renderer interaction and positioning behavior.',
    );

    const closed = createStateSample('Closed', 'closed');
    makeField('Reminder date', '', closed.body);

    const boundaries = createStateSample('Boundary values', 'boundary-values');
    makeField('Earliest review date', '2000-01-01', boundaries.body);
    makeField('Latest review date', '2099-12-31', boundaries.body);

    const open = createStateSample('Open at year boundary', 'open-year-boundary', true);
    open.body.classList.add('component-story__date-picker-stage');
    const { controller: openController } = makeField('Start date', '2025-12-31', open.body);
    const status = document.createElement('output');
    status.className = 'component-story__status';
    status.dataset.testid = 'date-picker-status';
    status.textContent = 'Selected date: 2025-12-31';
    const openInput = open.body.querySelector<HTMLInputElement>('input');
    openInput?.addEventListener('change', () => {
      status.textContent = `Selected date: ${openInput.value || 'none'}`;
    });
    open.sample.appendChild(status);

    content.append(closed.sample, boundaries.sample, open.sample);
    requestAnimationFrame(() => openController.open());
    return page;
  },
};
