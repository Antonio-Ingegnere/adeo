import type { Task } from '../types.js';
import { createDetailsElement } from './helpers.js';
import { dropIndicator, refs } from './dom.js';
import { state } from './state.js';
import { repeatSummaryFromRule } from './repeat.js';

const removeDropIndicator = () => {
  if (dropIndicator.parentNode) {
    dropIndicator.parentNode.removeChild(dropIndicator);
  }
};

export const getVisibleTasks = (): Task[] => {
  let base = state.showCompleted ? state.tasks : state.tasks.filter((t) => !t.done);
  if (state.selectedListId !== null) {
    base = base.filter((t) => t.listId === state.selectedListId);
  }
  return base;
};

const formatDate = (date: string | null) => {
  if (!date) return '';
  const [y, m, d] = date.split('-');
  const map: Record<string, string> = {
    'YYYY-MM-DD': `${y}-${m}-${d}`,
    'DD/MM/YYYY': `${d}/${m}/${y}`,
    'MM/DD/YYYY': `${m}/${d}/${y}`,
    'DD.MM.YYYY': `${d}.${m}.${y}`,
    'YYYY/MM/DD': `${y}/${m}/${d}`,
    'MM-DD-YYYY': `${m}-${d}-${y}`,
    'DD-MM-YYYY': `${d}-${m}-${y}`,
    'MMM DD, YYYY': new Date(`${y}-${m}-${d}`).toLocaleDateString(undefined, {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
    }),
    'DD MMM YYYY': new Date(`${y}-${m}-${d}`).toLocaleDateString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }),
    'YYYY.MM.DD': `${y}.${m}.${d}`,
  };
  return map[state.dateFormat] ?? `${y}-${m}-${d}`;
};

export const updateTasksTitle = () => {
  if (!refs.tasksTitleEl) return;
  if (state.searchQuery.trim()) {
    refs.tasksTitleEl.textContent = 'Search results';
    return;
  }
  if (state.selectedListId === null) {
    refs.tasksTitleEl.textContent = 'All tasks';
    return;
  }
  const list = state.lists.find((l) => l.id === state.selectedListId);
  refs.tasksTitleEl.textContent = list ? list.name : 'Tasks';
};

export const saveTaskOrder = async () => {
  try {
    const orderedIds = state.tasks.map((task) => task.id);
    state.tasks.forEach((task, index) => {
      task.position = index;
    });
    await window.electronAPI.updateTaskOrder(orderedIds);
  } catch (error) {
    console.error('Failed to save task order', error);
  }
};


const priorityBorderColors: Record<string, string> = {
  none: '#b0b0b0',
  low: '#6ecb4d',
  medium: '#f3a84f',
  high: '#ff5f5f',
};

const priorityFillColors: Record<string, string> = {
  none: '#ffffff',
  low: '#A4F07F',
  medium: '#FFD08F',
  high: '#FF8A8A',
};

const applyPriorityStyles = (checkbox: HTMLInputElement, task: Task) => {
  const priority = task.priority ?? 'none';
  const borderColor = priorityBorderColors[priority] ?? '#b0b0b0';
  const fillColor = priorityFillColors[priority] ?? '#ffffff';
  checkbox.style.borderColor = borderColor;
  checkbox.style.background = fillColor;
  checkbox.style.boxShadow = 'none';
};

const refreshTasksFromApi = async () => {
  try {
    const existingTasks = await window.electronAPI.getTasks();
    state.tasks.splice(0, state.tasks.length, ...existingTasks);
    state.tasks.forEach((t) => {
      if ((t as any).listId === undefined) {
        t.listId = null;
      }
      if (!(t as any).priority) {
        (t as any).priority = 'none';
      }
      if ((t as any).reminderDate === undefined) {
        (t as any).reminderDate = null;
      }
      if ((t as any).reminderTime === undefined) {
        (t as any).reminderTime = null;
      }
      if ((t as any).repeatRule === undefined) {
        (t as any).repeatRule = null;
      }
      if ((t as any).repeatStart === undefined) {
        (t as any).repeatStart = null;
      }
      if ((t as any).seriesId === undefined) {
        (t as any).seriesId = null;
      }
    });
    updateTasksTitle();
    renderTasks();
  } catch (error) {
    console.error('Failed to refresh tasks', error);
  }
};

const buildTaskRow = (task: Task, index: number, rerender: () => void) => {
  const row = document.createElement('div');
  row.className = 'task-row';
  row.dataset.index = String(index);

  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z" />
    </svg>
  `;
  handle.title = 'Drag to reorder';
  handle.setAttribute('draggable', 'true');
  handle.addEventListener('dragstart', (event) => {
    state.dragIndex = index;
    row.classList.add('dragging');
    event.dataTransfer?.setData('text/plain', String(index));
    event.dataTransfer?.setDragImage(row, 10, 10);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  });
  handle.addEventListener('dragend', () => {
    state.dragIndex = null;
    state.dropIndex = null;
    row.classList.remove('dragging');
    removeDropIndicator();
  });

  row.addEventListener('dragover', (event) => {
    event.preventDefault();
    const rect = row.getBoundingClientRect();
    const isBefore = event.clientY < rect.top + rect.height / 2;
    const targetIndex = Number(row.dataset.index);
    state.dropIndex = isBefore ? targetIndex : targetIndex + 1;
    removeDropIndicator();
    if (row.parentNode) {
      if (isBefore) {
        row.parentNode.insertBefore(dropIndicator, row);
      } else {
        row.parentNode.insertBefore(dropIndicator, row.nextSibling);
      }
    }
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  });
  row.addEventListener('drop', (event) => {
    event.preventDefault();
    removeDropIndicator();
    if (state.dragIndex === null || state.dropIndex === null) {
      return;
    }
    if (state.dragIndex === state.dropIndex || state.dragIndex + 1 === state.dropIndex) {
      state.dragIndex = null;
      state.dropIndex = null;
      return;
    }
    const [moved] = state.tasks.splice(state.dragIndex, 1);
    const adjustedIndex = state.dragIndex < state.dropIndex ? state.dropIndex - 1 : state.dropIndex;
    state.tasks.splice(adjustedIndex, 0, moved);
    state.dragIndex = null;
    state.dropIndex = null;
    rerender();
    saveTaskOrder();
  });

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.done;
  applyPriorityStyles(checkbox, task);
  checkbox.addEventListener('change', async (event) => {
    const checked = (event.target as HTMLInputElement).checked;
    state.tasks[index].done = checked;
    applyPriorityStyles(checkbox, state.tasks[index]);
    textSpan.style.textDecoration = checked ? 'line-through' : 'none';
    try {
      await window.electronAPI.updateTaskDone(task.id, checked);
      if (checked) {
        await refreshTasksFromApi();
      }
    } catch (error) {
      console.error('Failed to update task status', error);
    }
  });

  const textSpan = document.createElement('span');
  textSpan.textContent = task.text;
  textSpan.className = 'task-text';
  textSpan.style.textDecoration = task.done ? 'line-through' : 'none';
  textSpan.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const custom = new CustomEvent('open-edit-modal', { detail: { taskId: task.id } });
    document.dispatchEvent(custom);
  });

  const detailsDiv = createDetailsElement(task, async (taskId, details) => {
    await window.electronAPI.updateTaskDetails(taskId, details);
  }, rerender);
  const hasDetails = Boolean(task.details?.trim());
  const isExpanded = state.expandedDetails.has(task.id);
  detailsDiv.style.display = hasDetails && isExpanded ? 'block' : 'none';

  const mainBlock = document.createElement('div');
  mainBlock.className = 'task-main';
  mainBlock.appendChild(textSpan);

  if (task.reminderDate || task.reminderTime || task.repeatRule) {
    const reminder = document.createElement('div');
    reminder.className = 'task-reminder';
    const parts: string[] = [];
    if (task.reminderDate) parts.push(formatDate(task.reminderDate));
    if (task.reminderTime) parts.push(task.reminderTime);
    const reminderText = document.createElement('span');
    reminderText.className = 'task-reminder-text';
    reminderText.textContent = parts.join(' ');
    reminder.appendChild(reminderText);
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
      repeatLine.appendChild(repeatIcon);
      repeatLine.appendChild(repeatText);
      if (reminderText.textContent) {
        reminder.appendChild(document.createTextNode(' • '));
      }
      reminder.appendChild(repeatLine);
    }
    mainBlock.appendChild(reminder);
  }
  if (hasDetails) {
    mainBlock.appendChild(detailsDiv);
  }

  row.appendChild(handle);
  row.appendChild(checkbox);
  row.appendChild(mainBlock);

  if (hasDetails) {
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'expand-btn';
    toggleBtn.title = isExpanded ? 'Collapse details' : 'Expand details';
    const iconWrapper = document.createElement('span');
    iconWrapper.className = 'expand-chevrons';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 14 14');
    svg.setAttribute('focusable', 'false');
    const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const setPaths = (expanded: boolean) => {
      if (expanded) {
        path1.setAttribute('d', 'M2 8 L7 3 L12 8');
        path2.setAttribute('d', 'M2 13 L7 8 L12 13');
      } else {
        path1.setAttribute('d', 'M2 3 L7 8 L12 3');
        path2.setAttribute('d', 'M2 8 L7 13 L12 8');
      }
    };
    setPaths(isExpanded);
    svg.appendChild(path1);
    svg.appendChild(path2);
    iconWrapper.appendChild(svg);
    toggleBtn.appendChild(iconWrapper);
    toggleBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.expandedDetails.has(task.id)) {
        state.expandedDetails.delete(task.id);
      } else {
        state.expandedDetails.add(task.id);
      }
      rerender();
    });
    row.appendChild(toggleBtn);
  }

  return row;
};

export const renderTasks = () => {
  if (!refs.tasksList) return;
  removeDropIndicator();
  refs.tasksList.innerHTML = '';

  const searchQuery = state.searchQuery.trim().toLowerCase();
  if (searchQuery) {
    const matches = state.tasks.filter((task) => {
      const text = task.text.toLowerCase();
      const details = task.details?.toLowerCase() ?? '';
      return text.includes(searchQuery) || details.includes(searchQuery);
    });

    if (matches.length === 0) {
      if (refs.emptyState) {
        refs.tasksList.appendChild(refs.emptyState);
      }
      return;
    }

    const grouped = new Map<number | null, Task[]>();
    matches.forEach((task) => {
      const listId = task.listId ?? null;
      const existing = grouped.get(listId) ?? [];
      existing.push(task);
      grouped.set(listId, existing);
    });

    state.lists.forEach((list) => {
      const tasks = grouped.get(list.id);
      if (!tasks || tasks.length === 0) return;
      const header = document.createElement('p');
      header.className = 'tasks-title';
      header.textContent = list.name;
      refs.tasksList?.appendChild(header);
      tasks.forEach((task) => {
        const index = state.tasks.findIndex((t) => t.id === task.id);
        if (index === -1) return;
        const row = buildTaskRow(task, index, renderTasks);
        refs.tasksList?.appendChild(row);
      });
      grouped.delete(list.id);
    });

    const unlisted = grouped.get(null);
    if (unlisted && unlisted.length) {
      const header = document.createElement('p');
      header.className = 'tasks-title';
      header.textContent = 'No list';
      refs.tasksList?.appendChild(header);
      unlisted.forEach((task) => {
        const index = state.tasks.findIndex((t) => t.id === task.id);
        if (index === -1) return;
        const row = buildTaskRow(task, index, renderTasks);
        refs.tasksList?.appendChild(row);
      });
    }
    return;
  }

  const visibleTasks = getVisibleTasks();

  if (visibleTasks.length === 0) {
    if (refs.emptyState) {
      refs.tasksList.appendChild(refs.emptyState);
    }
    return;
  }

  visibleTasks.forEach((task) => {
    const index = state.tasks.findIndex((t) => t.id === task.id);
    if (index === -1) return;
    const row = buildTaskRow(task, index, renderTasks);
    refs.tasksList?.appendChild(row);
  });
};

export const attachTaskListDnD = () => {
  if (!refs.tasksList) return;
  refs.tasksList.addEventListener('dragover', (event) => {
    event.preventDefault();
    const visibleTasks = getVisibleTasks();
    if (visibleTasks.length === 0) {
      state.dropIndex = 0;
      removeDropIndicator();
      refs.tasksList?.appendChild(dropIndicator);
    } else if (event.target === refs.tasksList) {
      const lastVisible = visibleTasks[visibleTasks.length - 1];
      const lastVisibleIndex = state.tasks.findIndex((t) => t.id === lastVisible.id);
      state.dropIndex = lastVisibleIndex + 1;
      removeDropIndicator();
      refs.tasksList?.appendChild(dropIndicator);
    }
    const dt = (event as DragEvent).dataTransfer;
    if (dt) {
      dt.dropEffect = 'move';
    }
  });

  refs.tasksList.addEventListener('drop', (event) => {
    event.preventDefault();
    if (state.dragIndex === null || state.dropIndex === null) {
      removeDropIndicator();
      return;
    }
    const [moved] = state.tasks.splice(state.dragIndex, 1);
    const adjustedIndex = state.dragIndex < state.dropIndex ? state.dropIndex - 1 : state.dropIndex;
    state.tasks.splice(adjustedIndex, 0, moved);
    state.dragIndex = null;
    state.dropIndex = null;
    renderTasks();
    saveTaskOrder();
    removeDropIndicator();
  });
};
