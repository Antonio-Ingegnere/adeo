import type { Task } from '../types.js';
import { createDetailsElement, formatDate } from './helpers.js';
import { getSearchMatches, isSearching, isStale } from './searchMatches.js';
import { renderViewBar } from './viewBar.js';
import { dropIndicator, refs } from './dom.js';
import { state } from './state.js';
import { repeatSummaryFromRule } from './repeat.js';
import { setPriorityAttr } from './theme.js';

const removeDropIndicator = () => {
  if (dropIndicator.parentNode) {
    dropIndicator.parentNode.removeChild(dropIndicator);
  }
};

const defaultEmptyText = refs.emptyState?.textContent ?? '';

export const getVisibleTasks = (): Task[] => {
  let base = state.showCompleted ? state.tasks : state.tasks.filter((t) => !t.done);
  if (state.selectedListId !== null) {
    base = base.filter((t) => t.listId === state.selectedListId);
  }
  if (state.selectedTagId !== null) {
    base = base.filter((t) => (t.tagIds ?? []).includes(state.selectedTagId!));
  }
  return base;
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


const applyPriorityStyles = (checkbox: HTMLInputElement, task: Task) => {
  setPriorityAttr(checkbox, task.priority);
};

/**
 * The rendered rows in visual order. In search mode they are grouped under list headers,
 * so this is deliberately not getVisibleTasks() — anything walking the list by position
 * (the keyboard cursor, move up/down) has to agree with what is on screen.
 */
export const taskRows = (): HTMLElement[] =>
  Array.from(refs.tasksList?.querySelectorAll<HTMLElement>('.task-row') ?? []);

/** Move state.tasks[fromIndex] to the insertion point insertAt, in pre-removal coordinates. */
const moveTaskInState = (fromIndex: number, insertAt: number) => {
  const [moved] = state.tasks.splice(fromIndex, 1);
  const adjusted = fromIndex < insertAt ? insertAt - 1 : insertAt;
  state.tasks.splice(adjusted, 0, moved);
};

/**
 * Move the ring and the single tab stop onto one row. Roving tabindex: exactly one row is
 * reachable by Tab, so the list is one stop rather than one per task.
 */
const markCursorRow = (target: HTMLElement | null) => {
  taskRows().forEach((row, index) => {
    // With no cursor, the first row still holds tabindex 0 — otherwise the list would have
    // no tab stop at all and Tab could never reach it.
    const isTarget = target ? row === target : index === 0;
    row.classList.toggle('focused', Boolean(target) && isTarget);
    row.tabIndex = isTarget ? 0 : -1;
  });
};

const rowForTask = (taskId: number | null): HTMLElement | null =>
  taskId === null
    ? null
    : refs.tasksList?.querySelector<HTMLElement>(`.task-row[data-task-id="${taskId}"]`) ?? null;

/**
 * Put the keyboard cursor on a task: roving tabindex, the ring, and real DOM focus.
 *
 * Real focus rather than only a class, because document.activeElement being a task row is
 * exactly what makes the shortcut dispatcher report "list" context. With a class alone focus
 * would sit on <body>, arrow keys would scroll the page, and every arrow shortcut would need
 * a blanket preventDefault that then has to be undone for the search field.
 */
export const focusTaskRow = (taskId: number | null, scroll = true): boolean => {
  const row = rowForTask(taskId);
  if (!row) return false;
  state.focusedTaskId = taskId;
  markCursorRow(row);
  row.focus({ preventScroll: true });
  // 'nearest', never 'center': .main-column is the scroller and yanking it around under a
  // cursor key is disorienting when the row is already on screen.
  if (scroll) row.scrollIntoView({ block: 'nearest' });
  return true;
};

/** Move the cursor by whole rows in visual order. Returns false at either end. */
export const moveTaskFocus = (offset: number): boolean => {
  const rows = taskRows();
  if (rows.length === 0) return false;

  const current = rows.findIndex((row) => Number(row.dataset.taskId) === state.focusedTaskId);
  // Entering the list from nowhere: down lands on the first row, up on the last.
  if (current === -1) {
    return focusTaskRow(Number((offset < 0 ? rows[rows.length - 1] : rows[0]).dataset.taskId));
  }
  const next = current + offset;
  if (next < 0 || next >= rows.length) return false;
  return focusTaskRow(Number(rows[next].dataset.taskId));
};

export const focusTaskEdge = (edge: 'first' | 'last'): boolean => {
  const rows = taskRows();
  if (rows.length === 0) return false;
  const row = edge === 'first' ? rows[0] : rows[rows.length - 1];
  return focusTaskRow(Number(row.dataset.taskId));
};

/**
 * Re-seat the cursor after renderTasksInner has thrown the old rows away.
 *
 * hadFocus is not optional. renderTasks() is called from around fifteen places, several where
 * focus legitimately belongs somewhere else — saving the edit modal, or addTask(), which puts
 * the caret back in the add-task input. Restoring focus unconditionally would yank it out
 * from under the user mid-keystroke.
 */
const applyTaskFocus = (hadFocus: boolean, previousOrdinal: number) => {
  const rows = taskRows();
  if (rows.length === 0) {
    state.focusedTaskId = null;
    return;
  }

  let target = rowForTask(state.focusedTaskId);
  if (!target) {
    // The focused task is gone: completed with Show completed off, filtered out by a new
    // search, or deleted. Hold the position instead of the task, so completing a run of
    // tasks with Space walks down the list rather than dumping the cursor at the top.
    if (previousOrdinal < 0) {
      state.focusedTaskId = null;
      markCursorRow(null);
      return;
    }
    target = rows[Math.min(previousOrdinal, rows.length - 1)];
  }

  state.focusedTaskId = Number(target.dataset.taskId);
  markCursorRow(target);
  if (hadFocus) {
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'nearest' });
  }
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
      if (!Array.isArray((t as any).tagIds)) {
        (t as any).tagIds = [];
      }
    });
    renderViewBar();
    renderTasks();
  } catch (error) {
    console.error('Failed to refresh tasks', error);
  }
};

const buildTaskRow = (task: Task, index: number, rerender: () => void) => {
  const row = document.createElement('div');
  row.className = 'task-row';
  // Two different coordinates, deliberately both present: dataset.index is the position in
  // state.tasks that drag-and-drop computes drop points against, and every reorder or
  // refetch invalidates it. dataset.taskId is stable, and is what the keyboard cursor uses.
  row.dataset.index = String(index);
  row.dataset.taskId = String(task.id);
  // Roving tabindex: applyTaskFocus promotes exactly one row to 0, so the list is a single
  // tab stop rather than one per task. No role="option" — rows hold a checkbox and buttons,
  // and role=option forbids interactive descendants (same trap as the sidebar pills).
  row.tabIndex = -1;

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
    moveTaskInState(state.dragIndex, state.dropIndex);
    state.dragIndex = null;
    state.dropIndex = null;
    rerender();
    saveTaskOrder();
  });

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.done;
  applyPriorityStyles(checkbox, task);
  checkbox.addEventListener('change', (event) => {
    void toggleTaskDone(task.id, (event.target as HTMLInputElement).checked);
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
  if (task.tagIds?.length) {
    const tagsRow = document.createElement('div');
    tagsRow.className = 'task-tags';
    task.tagIds.forEach((tagId) => {
      const tag = state.tags.find((t) => t.id === tagId);
      if (!tag) return;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'task-tag-chip';
      chip.textContent = `#${tag.name}`;
      chip.style.background = tag.color;
      chip.title = `Filter by #${tag.name}`;
      chip.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        document.dispatchEvent(new CustomEvent('filter-by-tag', { detail: { tagId } }));
      });
      tagsRow.appendChild(chip);
    });
    if (tagsRow.childElementCount > 0) {
      const reminderLine = mainBlock.querySelector('.task-reminder');
      (reminderLine ?? mainBlock).appendChild(tagsRow);
    }
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
  // The cursor is bracketed around the rebuild rather than threaded through it: renderTasksInner
  // has several early returns and re-seating the cursor inside a 'tasks-rendered' listener would
  // race the paint and split the logic across modules.
  const active = document.activeElement;
  const hadFocus =
    active === document.body || (active instanceof Node && !!refs.tasksList?.contains(active));
  const previousOrdinal = taskRows().findIndex(
    (row) => Number(row.dataset.taskId) === state.focusedTaskId
  );

  renderTasksInner();
  applyTaskFocus(hadFocus, previousOrdinal);
  document.dispatchEvent(new CustomEvent('tasks-rendered'));
};

/**
 * Complete or un-complete a task, by id. Keyed by id rather than by row index because the
 * keyboard cursor and the checkbox are both callers and only one of them has a row.
 * Optimistic: state and the rendering move first, the API call follows.
 */
export const toggleTaskDone = async (taskId: number, next?: boolean): Promise<void> => {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const checked = next ?? !task.done;
  task.done = checked;
  renderTasks();
  try {
    await window.electronAPI.updateTaskDone(taskId, checked);
    // Completing a repeating task inserts its next occurrence server-side, so the local
    // list is now short a task. Un-completing can't add anything, so it needs no refetch.
    if (checked) await refreshTasksFromApi();
  } catch (error) {
    console.error('Failed to update task status', error);
  }
};

/**
 * Delete a task, after a native confirm. Not optimistic, unlike toggling done: this is the
 * one action with nothing to undo it, so nothing is removed until the server says it's gone.
 */
export const deleteTask = async (taskId: number): Promise<void> => {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  if (!(await window.electronAPI.confirmDeleteTask(task.text))) return;
  try {
    await window.electronAPI.deleteTask(taskId);
  } catch (error) {
    console.error('Failed to delete task', error);
    return;
  }
  const index = state.tasks.findIndex((t) => t.id === taskId);
  if (index !== -1) state.tasks.splice(index, 1);
  state.expandedDetails.delete(taskId);
  // focusedTaskId deliberately still points at the deleted task: renderTasks reads its ordinal
  // off the *old* DOM before rebuilding, then fails to find it and seats the cursor on whatever
  // row takes its place. Clearing it here would instead drop the cursor entirely.
  renderTasks();
  void saveTaskOrder();
};

/**
 * Swap a task with the row above or below it. Returns false when it can't act, which is
 * how a shortcut declines and leaves the key to the browser.
 */
export const moveTaskByOffset = (taskId: number, offset: number): boolean => {
  // In search mode rows are grouped by list, so "the row below" can sit under a different
  // heading and reordering against it would mean nothing.
  if (isSearching()) return false;

  const rows = taskRows();
  const from = rows.findIndex((row) => Number(row.dataset.taskId) === taskId);
  if (from === -1) return false;
  const to = from + offset;
  if (to < 0 || to >= rows.length) return false;

  const fromIndex = state.tasks.findIndex((t) => t.id === taskId);
  const toIndex = state.tasks.findIndex((t) => t.id === Number(rows[to].dataset.taskId));
  if (fromIndex === -1 || toIndex === -1) return false;

  // Insertion point, not target index: past the neighbour going down, before it going up.
  moveTaskInState(fromIndex, offset > 0 ? toIndex + 1 : toIndex);
  renderTasks();
  void saveTaskOrder();
  return true;
};

const renderTasksInner = () => {
  if (!refs.tasksList) return;
  removeDropIndicator();
  refs.tasksList.innerHTML = '';

  const stale = isStale();
  refs.tasksList.classList.toggle('results-stale', stale);

  if (isSearching()) {
    const matches = getSearchMatches();

    if (matches.length === 0) {
      // while the query is invalid these rows belong to the previous query, so claiming
      // "no tasks match" would assert something about a query we could not parse
      if (refs.emptyState) {
        refs.emptyState.textContent = stale
          ? 'The last valid query matched no tasks'
          : 'No tasks match your search';
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
      header.className = 'tasks-group-title';
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
      header.className = 'tasks-group-title';
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
      refs.emptyState.textContent = defaultEmptyText;
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

/**
 * Keep the cursor in step with wherever focus actually lands — tabbing into the list, or
 * clicking a tag chip inside a row. Listening rather than hijacking clicks means the cursor
 * ends up somewhere sensible without this fighting the document click handler.
 */
export const attachTaskListKeyboard = () => {
  if (!refs.tasksList) return;
  refs.tasksList.addEventListener('focusin', (event) => {
    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('.task-row');
    if (!row) return;
    const taskId = Number(row.dataset.taskId);
    if (taskId === state.focusedTaskId) return;
    state.focusedTaskId = taskId;
    markCursorRow(row);
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
    moveTaskInState(state.dragIndex, state.dropIndex);
    state.dragIndex = null;
    state.dropIndex = null;
    renderTasks();
    saveTaskOrder();
    removeDropIndicator();
  });
};
