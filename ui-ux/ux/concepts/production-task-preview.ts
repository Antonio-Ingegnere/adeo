import type { Task } from '../../../src/types';
import { createDetailsElement } from '../../../src/renderer/helpers';
import { createTagChip } from '../../../src/renderer/uiElements';
import { setPriorityAttr } from '../../../src/renderer/theme';
import { repeatSummaryFromRule } from '../../../src/renderer/repeat';
import type { ConceptTaskFixture, ConceptUiFixture } from './fixtures';

type ProductionTaskPreviewOptions = Readonly<{
  tasks: readonly ConceptTaskFixture[];
  availableTags: ConceptUiFixture['availableTags'];
}>;

const createDragHandle = (): HTMLSpanElement => {
  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.title = 'Drag to reorder';
  handle.setAttribute('aria-hidden', 'true');
  handle.setAttribute('draggable', 'true');
  handle.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z" />
    </svg>
  `;
  handle.addEventListener('dragstart', (event) => event.preventDefault());
  return handle;
};

const createTaskRow = (
  task: ConceptTaskFixture,
  index: number,
  availableTags: ConceptUiFixture['availableTags'],
  expandedTaskIds: Set<string>,
  detailsByTaskId: Map<string, string>,
  rerender: () => void,
): HTMLDivElement => {
  const row = document.createElement('div');
  row.className = 'task-row';
  row.dataset.index = String(index);
  row.dataset.taskId = task.id;
  row.tabIndex = index === 0 ? 0 : -1;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.completed;
  checkbox.setAttribute(
    'aria-label',
    `${task.completed ? 'Mark incomplete' : 'Mark complete'}: ${task.title}`,
  );
  setPriorityAttr(checkbox, task.priority);
  checkbox.addEventListener('click', (event) => event.preventDefault());

  const title = document.createElement('span');
  title.className = 'task-text';
  title.textContent = task.title;
  title.style.textDecoration = task.completed ? 'line-through' : 'none';

  const main = document.createElement('div');
  main.className = 'task-main';
  main.append(title);

  const visibleDueLabel = task.dueLabel === 'No date' ? '' : task.dueLabel;
  let reminder: HTMLDivElement | null = null;
  if (visibleDueLabel || task.repeatRule) {
    reminder = document.createElement('div');
    reminder.className = 'task-reminder';
    const reminderText = document.createElement('span');
    reminderText.className = 'task-reminder-text';
    reminderText.textContent = visibleDueLabel;
    reminder.append(reminderText);
    if (task.repeatRule) {
      const repeatLine = document.createElement('span');
      repeatLine.className = 'task-repeat';
      const repeatIcon = document.createElement('span');
      repeatIcon.className = 'task-repeat-icon';
      repeatIcon.setAttribute('aria-hidden', 'true');
      repeatIcon.innerHTML = `
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M7 7h8a3 3 0 0 1 3 3v2h2v-2a5 5 0 0 0-5-5H7V2L3 6l4 4V7zm10 10H9a3 3 0 0 1-3-3v-2H4v2a5 5 0 0 0 5 5h8v3l4-4-4-4v3z" />
        </svg>
      `;
      const repeatText = document.createElement('span');
      repeatText.textContent = repeatSummaryFromRule(task.repeatRule);
      repeatLine.append(repeatIcon, repeatText);
      if (reminderText.textContent) {
        reminder.append(document.createTextNode(' • '));
      }
      reminder.append(repeatLine);
    }
    main.append(reminder);
  }

  if (task.tags.length > 0) {
    const tags = document.createElement('div');
    tags.className = 'task-tags';
    task.tags.forEach((label) => {
      const tag = availableTags.find((candidate) => candidate.label === label);
      if (!tag) return;
      tags.append(
        createTagChip({
          label: `#${label}`,
          color: tag.color,
          colorsEnabled: true,
          title: `Filter by #${label}`,
          onActivate: (event) => {
            event.preventDefault();
            event.stopPropagation();
          },
        }),
      );
    });
    if (tags.childElementCount > 0) {
      (reminder ?? main).append(tags);
    }
  }

  const taskDetails = detailsByTaskId.get(task.id) ?? task.details ?? '';
  const hasDetails = Boolean(taskDetails.trim());
  const isExpanded = hasDetails && expandedTaskIds.has(task.id);
  if (hasDetails) {
    const productionTask: Task = {
      id: index + 1,
      text: task.title,
      details: taskDetails,
      done: task.completed,
      position: index,
      listId: null,
      priority: task.priority,
    };
    const details = createDetailsElement(
      productionTask,
      async (_taskId, nextDetails) => {
        detailsByTaskId.set(task.id, nextDetails);
      },
      rerender,
    );
    details.style.display = isExpanded ? 'block' : 'none';
    main.append(details);
  }

  row.append(createDragHandle(), checkbox, main);

  if (hasDetails) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'expand-btn';
    toggle.title = isExpanded ? 'Collapse details' : 'Expand details';
    toggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    const icon = document.createElement('span');
    icon.className = 'expand-chevrons';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = isExpanded
      ? '<svg viewBox="0 0 14 14" focusable="false"><path d="M2 8 L7 3 L12 8"></path><path d="M2 13 L7 8 L12 13"></path></svg>'
      : '<svg viewBox="0 0 14 14" focusable="false"><path d="M2 3 L7 8 L12 3"></path><path d="M2 8 L7 13 L12 8"></path></svg>';
    toggle.append(icon);
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (expandedTaskIds.has(task.id)) {
        expandedTaskIds.delete(task.id);
      } else {
        expandedTaskIds.add(task.id);
      }
      const list = row.parentElement;
      rerender();
      const nextToggle = list?.querySelector<HTMLButtonElement>(
        `.task-row[data-task-id="${task.id}"] .expand-btn`,
      );
      nextToggle?.focus();
    });
    row.append(toggle);
  }
  return row;
};

/**
 * Production's roving cursor keys off `state.focusedTaskId` and a global rerender; this concept
 * has neither, so it moves `tabindex`/focus directly across the current `.task-row` set. Kept
 * local and dependency-free, matching how the shared preview already avoids Electron/global
 * `state` coupling.
 */
const attachRovingTaskCursor = (list: HTMLDivElement): void => {
  list.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const rows = Array.from(list.querySelectorAll<HTMLElement>('.task-row'));
    if (rows.length === 0) return;
    const currentIndex = rows.findIndex((row) => row === document.activeElement);
    if (currentIndex === -1) return;
    let nextIndex = currentIndex;
    if (event.key === 'ArrowDown') nextIndex = Math.min(currentIndex + 1, rows.length - 1);
    else if (event.key === 'ArrowUp') nextIndex = Math.max(currentIndex - 1, 0);
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = rows.length - 1;
    if (nextIndex === currentIndex) return;
    event.preventDefault();
    rows[currentIndex].tabIndex = -1;
    rows[nextIndex].tabIndex = 0;
    rows[nextIndex].focus();
  });
};

export const createProductionTaskPreview = ({
  tasks,
  availableTags,
}: ProductionTaskPreviewOptions): HTMLDivElement => {
  const list = document.createElement('div');
  list.className = 'tasks-list';
  attachRovingTaskCursor(list);
  const expandedTaskIds = new Set(
    tasks.filter((task) => task.detailsExpanded && task.details?.trim()).map((task) => task.id),
  );
  const detailsByTaskId = new Map(
    tasks.filter((task) => task.details?.trim()).map((task) => [task.id, task.details ?? '']),
  );

  const render = (): void => {
    list.replaceChildren();
    if (tasks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Nothing added yet. Enter a task and hit Add.';
      list.append(empty);
      return;
    }

    tasks.forEach((task, index) => {
      list.append(
        createTaskRow(task, index, availableTags, expandedTaskIds, detailsByTaskId, render),
      );
    });
  };
  render();
  return list;
};
