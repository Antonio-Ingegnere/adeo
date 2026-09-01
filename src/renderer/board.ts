// The multi-column board surface (Alternative B: saved, named boards). Each column mounts the
// real production task list (.tasks-list / .task-row); the board only adds an always-visible
// "Move to…" control and an un-gated drag handle per card. Every column and move operation has
// a visible, non-hover, keyboard-operable control; pointer drag is strictly additive.
//
// Moving a task calls the unmodified production planner (boardMove.ts -> parseQuery /
// compilePredicate / deriveTemplate / resolveDue) and writes only through the existing
// per-attribute task IPC. Deterministic moves apply immediately with an Undo toast (A1);
// best-effort / blocked / no-op moves show an inline preview / confirm.
import type { Task } from '../types.js';
import { refs, dropIndicator } from './dom.js';
import { state, type BoardWorkingColumn } from './state.js';
import {
  applyBoardMove,
  planBoardMove,
  restoreTaskFromSnapshot,
  snapshotTaskForBoard,
  taskInColumn,
  type BoardColumnRef,
  type BoardMovePlan,
} from './boardMove.js';
import { toggleTaskDone, saveTaskOrder } from './tasks.js';
import { createTagChip } from './uiElements.js';
import { setPriorityAttr } from './theme.js';
import { repeatSummaryFromRule } from './repeat.js';
import { formatDate } from './helpers.js';
import { renderViewBar } from './viewBar.js';
import { currentView } from './currentView.js';

let clientIdSeq = 0;
const nextClientId = (): string => `bc-${(clientIdSeq += 1)}`;
const ADD_PICKER = '__add__';

let toastTimer: ReturnType<typeof setTimeout> | null = null;
/** Re-runnable move for the "Retry" affordance after a failed write. */
let lastFailedMove: (() => void) | null = null;

/** Cross-list drag state: taskId and fromClientId from dragstart, dropIndex calculated during dragover */
let boardCrossListDrag: { taskId: number; fromClientId: string; dropIndex: number | null } | null = null;

const removeDropIndicator = (): void => {
  if (dropIndicator.parentNode) {
    dropIndicator.parentNode.removeChild(dropIndicator);
  }
};

const announce = (message: string): void => {
  if (refs.boardLive) refs.boardLive.textContent = message;
};

// ---------- board source picker positioning -------------------------------------------------
// .board-source-menu renders position:fixed (see styles.css) so it escapes .board-columns,
// which is a scroll container (overflow-x:auto forces overflow-y to auto) that would otherwise
// clip it on both axes. Coordinates come from the trigger's viewport rect: the menu sits just
// below the trigger, flips above it when it would overflow the viewport bottom, clamps into
// the viewport horizontally, and caps its height (keeping the inherited overflow-y:auto) to the
// free vertical space. It stays a DOM child of its trigger wrap, so the existing outside-click
// / Escape close logic (closeBoardMenus) is unaffected. Repositioned on scroll + resize while
// open; the listeners are torn down on the next renderBoard.
const BOARD_MENU_GAP = 4;
const BOARD_MENU_MARGIN = 8;
const BOARD_MENU_MIN_HEIGHT = 96;
let boardSourceMenuCleanup: (() => void) | null = null;

const positionBoardSourceMenu = (menu: HTMLElement, trigger: HTMLElement): void => {
  const t = trigger.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  menu.style.maxHeight = 'none';
  const naturalHeight = menu.offsetHeight;
  const menuWidth = menu.offsetWidth;

  const spaceBelow = vh - t.bottom - BOARD_MENU_GAP - BOARD_MENU_MARGIN;
  const spaceAbove = t.top - BOARD_MENU_GAP - BOARD_MENU_MARGIN;
  const flipUp = naturalHeight > spaceBelow && spaceAbove > spaceBelow;
  const available = Math.max(flipUp ? spaceAbove : spaceBelow, BOARD_MENU_MIN_HEIGHT);
  if (naturalHeight > available) menu.style.maxHeight = `${available}px`;

  const height = Math.min(naturalHeight, available);
  const top = flipUp
    ? Math.max(t.top - BOARD_MENU_GAP - height, BOARD_MENU_MARGIN)
    : t.bottom + BOARD_MENU_GAP;

  let left = t.left;
  if (left + menuWidth > vw - BOARD_MENU_MARGIN) left = vw - menuWidth - BOARD_MENU_MARGIN;
  if (left < BOARD_MENU_MARGIN) left = BOARD_MENU_MARGIN;

  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
};

const mountBoardSourceMenu = (menu: HTMLElement, trigger: HTMLElement): void => {
  const reposition = () => positionBoardSourceMenu(menu, trigger);
  reposition();
  requestAnimationFrame(reposition);
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  boardSourceMenuCleanup = () => {
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
    boardSourceMenuCleanup = null;
  };
};

// ---------- column model ------------------------------------------------------------------

export const columnRef = (col: BoardWorkingColumn): BoardColumnRef | null => {
  if (col.sourceKind === 'list') {
    if (col.sourceId === 0) return { kind: 'list', listId: null, label: 'No list' };
    const list = state.lists.find((l) => l.id === col.sourceId);
    return list ? { kind: 'list', listId: list.id, label: list.name } : null;
  }
  const smart = state.smartLists.find((s) => s.id === col.sourceId);
  return smart ? { kind: 'smart', smartListId: smart.id, query: smart.query, label: smart.name } : null;
};

const columnTasks = (ref: BoardColumnRef): Task[] => {
  if (ref.kind === 'list') {
    const base = state.showCompleted ? state.tasks : state.tasks.filter((t) => !t.done);
    return base.filter((t) => (t.listId ?? null) === (ref.listId ?? null));
  }
  return state.tasks.filter((t) => taskInColumn(t, ref));
};

const openCount = (tasks: Task[]): number => tasks.filter((t) => !t.done).length;

// ---------- persistence ------------------------------------------------------------------

const uniqueBoardName = (): string => {
  let n = state.boards.length + 1;
  const taken = new Set(state.boards.map((b) => b.name.toLowerCase()));
  while (taken.has(`board ${n}`)) n += 1;
  return `Board ${n}`;
};

const persistColumns = async (): Promise<void> => {
  if (state.activeBoardId === null) return;
  const board = state.boards.find((b) => b.id === state.activeBoardId);
  if (!board) return;
  try {
    const result = await window.electronAPI.updateBoardColumns(
      board.id,
      state.boardColumns.map((c) => ({ sourceKind: c.sourceKind, sourceId: c.sourceId })),
    );
    if (result && typeof result === 'object' && 'columns' in result) {
      board.columns = (result as { columns: typeof board.columns }).columns;
    }
  } catch (error) {
    console.error('Failed to persist board columns', error);
  }
};

const syncWorkingFromBoard = (): void => {
  const board = state.boards.find((b) => b.id === state.activeBoardId);
  state.boardColumns = (board?.columns ?? []).map((c) => ({
    clientId: nextClientId(),
    sourceKind: c.sourceKind,
    sourceId: c.sourceId,
  }));
};

// ---------- enter / leave --------------------------------------------------------------

export const enterBoardView = async (boardId: number | null): Promise<void> => {
  // seed column 1 from the previously active single view when starting a fresh board
  const prior = currentView();
  const seed: BoardWorkingColumn[] = [];
  if (boardId === null) {
    if (prior.kind === 'list') {
      seed.push({ clientId: nextClientId(), sourceKind: 'list', sourceId: prior.id ?? 0 });
    } else if (prior.kind === 'smart') {
      seed.push({ clientId: nextClientId(), sourceKind: 'smart', sourceId: prior.smartList.id });
    }
  }

  state.boardMode = true;
  state.boardPreview = null;
  state.boardOpenMoveMenu = null;
  state.boardOpenColumnMenuId = null;
  state.boardOpenSourcePickerId = null;

  if (boardId !== null) {
    state.activeBoardId = boardId;
    syncWorkingFromBoard();
  } else {
    // Alternative B: a board is always a persisted object. Create it up front and autosave
    // every column edit, so there is no separate "unsaved" limbo to communicate.
    try {
      const created = await window.electronAPI.addBoard(uniqueBoardName());
      if (created && !('error' in created)) {
        state.boards.push(created);
        state.activeBoardId = created.id;
        state.boardColumns = seed;
        await persistColumns();
      } else {
        state.activeBoardId = null;
        state.boardColumns = seed;
      }
    } catch (error) {
      console.error('Failed to create board', error);
      state.activeBoardId = null;
      state.boardColumns = seed;
    }
  }

  renderBoard();
  renderViewBar();
  // Entering a board is a sidebar view change: the board pill must light and the
  // list / smart-list pills must clear. Dispatched rather than called directly to
  // avoid a board.ts <-> boards.ts import cycle; index.ts owns cross-panel renders.
  document.dispatchEvent(new CustomEvent('board-view-entered'));
  refs.boardRegion?.querySelector<HTMLElement>('.view-picker, .board-add-column')?.focus();
};

export const leaveBoardView = (): void => {
  // seed the single view from the column that last held focus, else the first column
  const focusCol =
    state.boardColumns.find((c) => c.clientId === state.boardFocusColumnId) ?? state.boardColumns[0];
  state.boardMode = false;
  state.boardOpenMoveMenu = null;
  state.boardOpenColumnMenuId = null;
  state.boardOpenSourcePickerId = null;
  state.boardPreview = null;
  if (refs.boardRegion) refs.boardRegion.hidden = true;
  if (refs.tasksSection) refs.tasksSection.hidden = false;

  if (focusCol) {
    const ref = columnRef(focusCol);
    if (ref?.kind === 'list') {
      document.dispatchEvent(new CustomEvent('select-list', { detail: { listId: ref.listId } }));
      renderViewBar();
      return;
    }
    if (ref?.kind === 'smart') {
      document.dispatchEvent(
        new CustomEvent('run-smart-list', { detail: { smartListId: ref.smartListId } }),
      );
      renderViewBar();
      return;
    }
  }
  document.dispatchEvent(new CustomEvent('select-list', { detail: { listId: state.selectedListId } }));
  renderViewBar();
};

// ---------- column operations --------------------------------------------------------

const addColumn = (sourceKind: 'list' | 'smart', sourceId: number): void => {
  const col: BoardWorkingColumn = { clientId: nextClientId(), sourceKind, sourceId };
  state.boardColumns.push(col);
  state.boardOpenSourcePickerId = null;
  void persistColumns();
  renderBoard();
  focusColumnPicker(col.clientId);
  announce(`Column added: ${columnRef(col)?.label ?? 'source'}.`);
};

const setColumnSource = (clientId: string, sourceKind: 'list' | 'smart', sourceId: number): void => {
  const col = state.boardColumns.find((c) => c.clientId === clientId);
  if (!col) return;
  col.sourceKind = sourceKind;
  col.sourceId = sourceId;
  state.boardOpenSourcePickerId = null;
  void persistColumns();
  renderBoard();
  focusColumnPicker(clientId);
  announce(`Column source set to ${columnRef(col)?.label ?? 'source'}.`);
};

const removeColumn = (clientId: string): void => {
  const index = state.boardColumns.findIndex((c) => c.clientId === clientId);
  if (index === -1) return;
  const removed = columnRef(state.boardColumns[index]);
  state.boardColumns.splice(index, 1);
  state.boardOpenColumnMenuId = null;
  void persistColumns();
  renderBoard();
  announce(`Column removed: ${removed?.label ?? 'source'}. The List or Smart list itself is kept.`);
  const neighbour = state.boardColumns[index] ?? state.boardColumns[index - 1];
  if (neighbour) focusColumnPicker(neighbour.clientId);
  else refs.boardRegion?.querySelector<HTMLElement>('.board-add-column')?.focus();
};

const moveColumn = (clientId: string, delta: number): void => {
  const index = state.boardColumns.findIndex((c) => c.clientId === clientId);
  const target = index + delta;
  if (index === -1 || target < 0 || target >= state.boardColumns.length) return;
  const [moved] = state.boardColumns.splice(index, 1);
  state.boardColumns.splice(target, 0, moved);
  state.boardOpenColumnMenuId = null;
  void persistColumns();
  renderBoard();
  focusColumnPicker(clientId);
  announce(`Column moved ${delta < 0 ? 'left' : 'right'}. Now position ${target + 1}.`);
};

const focusColumnPicker = (clientId: string): void => {
  refs.boardColumnsEl
    ?.querySelector<HTMLElement>(`.board-column[data-client-id="${clientId}"] .view-picker`)
    ?.focus();
};

const focusCard = (clientId: string, taskId: number): void => {
  refs.boardColumnsEl
    ?.querySelector<HTMLElement>(
      `.board-column[data-client-id="${clientId}"] .task-row[data-task-id="${taskId}"]`,
    )
    ?.focus();
};

// ---------- move execution ---------------------------------------------------------

const clearToast = (): void => {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  state.boardToast = null;
  state.boardSnapshot = null;
  lastFailedMove = null;
  renderToast();
};

const scheduleToastClear = (): void => {
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.boardToast = null;
    state.boardSnapshot = null;
    lastFailedMove = null;
    renderToast();
  }, 8000);
};

const applyLocally = (task: Task, plan: BoardMovePlan): void => {
  plan.changes.forEach((c) => c.apply(task));
};

const restoreLocally = (task: Task): void => {
  const s = state.boardSnapshot;
  if (!s || s.taskId !== task.id) return;
  task.listId = s.listId;
  task.priority = s.priority;
  task.tagIds = [...s.tagIds];
  task.reminderDate = s.reminderDate;
  task.reminderTime = s.reminderTime;
  task.repeatRule = s.repeatRule;
  task.repeatStart = s.repeatStart;
  task.done = s.done;
};

const performMove = async (
  task: Task,
  fromClientId: string,
  toClientId: string,
  from: BoardColumnRef,
  to: BoardColumnRef,
  plan: BoardMovePlan,
): Promise<void> => {
  if (plan.verdict === 'noop' || plan.verdict === 'blocked') return;

  const snapshot = snapshotTaskForBoard(task);
  state.boardSnapshot = snapshot;
  applyLocally(task, plan);
  state.boardPreview = null;
  state.boardOpenMoveMenu = null;
  lastFailedMove = null;
  renderBoard();
  announce(`Moving "${task.text}" to "${to.label}"…`);

  const result = await applyBoardMove(plan, snapshot);
  if (result.ok) {
    const staysNote = plan.staysInSource ? ` Still in "${from.label}".` : '';
    state.boardToast = { message: `Moved "${task.text}" to "${to.label}".${staysNote}`, undo: true };
    announce(`Moved "${task.text}" to "${to.label}".${staysNote} Press Undo to reverse it.`);
    scheduleToastClear();
    renderBoard();
    focusCard(toClientId, task.id);
  } else {
    restoreLocally(task);
    state.boardSnapshot = null;
    state.boardToast = {
      message: result.rolledBack
        ? `Couldn't move "${task.text}". It's back where it was. ${result.message}`
        : `Couldn't move "${task.text}" and it may be partly changed. ${result.message}`,
      undo: false,
    };
    lastFailedMove = () => {
      void performMove(task, fromClientId, toClientId, from, to, plan);
    };
    announce(state.boardToast.message + ' Use Retry to try again.');
    renderBoard();
    focusCard(fromClientId, task.id);
  }
};

export const undoBoardMove = async (): Promise<void> => {
  const snapshot = state.boardSnapshot;
  if (!snapshot) return;
  const task = state.tasks.find((t) => t.id === snapshot.taskId);
  try {
    await restoreTaskFromSnapshot(snapshot);
  } catch (error) {
    console.error('Undo failed', error);
    announce('Undo failed. The task could not be restored.');
    return;
  }
  if (task) restoreLocally(task);
  state.boardSnapshot = null;
  clearToast();
  renderBoard();
  if (task) {
    announce(`Move undone. "${task.text}" is back where it was.`);
    const home = state.boardColumns.find((c) => {
      const ref = columnRef(c);
      return ref ? taskInColumn(task, ref) : false;
    });
    if (home) focusCard(home.clientId, task.id);
  } else {
    announce('Move undone.');
  }
};

// ---------- rendering -----------------------------------------------------------------

const svgMore = (): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" class="icon-more">` +
  `<path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>`;

const truncate = (text: string, max = 24): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

const menuGroupEl = (label: string): HTMLDivElement => {
  const el = document.createElement('div');
  el.className = 'view-menu-group';
  el.textContent = label;
  return el;
};

const sourceMenuItem = (
  label: string,
  selected: boolean,
  onPick: () => void,
): HTMLButtonElement => {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = `view-menu-item${selected ? ' selected' : ''}`;
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', String(selected));
  item.textContent = label;
  item.title = label;
  item.addEventListener('click', (event) => {
    event.stopPropagation();
    onPick();
  });
  return item;
};

const buildSourceMenu = (
  current: BoardWorkingColumn | null,
  onPick: (kind: 'list' | 'smart', id: number) => void,
): HTMLDivElement => {
  const menu = document.createElement('div');
  menu.className = 'view-menu board-source-menu';
  menu.style.display = 'flex';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'Choose a list or smart list');
  menu.addEventListener('click', (event) => event.stopPropagation());

  menu.appendChild(menuGroupEl('Lists'));
  menu.appendChild(
    sourceMenuItem(
      'No list',
      current?.sourceKind === 'list' && current.sourceId === 0,
      () => onPick('list', 0),
    ),
  );
  state.lists.forEach((list) => {
    menu.appendChild(
      sourceMenuItem(
        list.name,
        current?.sourceKind === 'list' && current.sourceId === list.id,
        () => onPick('list', list.id),
      ),
    );
  });

  if (state.smartLists.length) {
    menu.appendChild(menuGroupEl('Smart lists'));
    state.smartLists.forEach((smart) => {
      menu.appendChild(
        sourceMenuItem(
          smart.name,
          current?.sourceKind === 'smart' && current.sourceId === smart.id,
          () => onPick('smart', smart.id),
        ),
      );
    });
  }
  return menu;
};

const buildBoardCard = (
  task: Task,
  column: BoardWorkingColumn,
  ref: BoardColumnRef,
): HTMLElement => {
  const row = document.createElement('div');
  row.className = 'task-row board-card';
  row.dataset.taskId = String(task.id);
  row.tabIndex = -1;

  // un-gated drag handle (pointer enhancement only)
  const handle = document.createElement('span');
  handle.className = 'drag-handle board-card__handle';
  handle.setAttribute('draggable', 'true');
  handle.title = 'Drag to another column';
  handle.innerHTML =
    `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z" /></svg>`;
  handle.addEventListener('click', (event) => event.stopPropagation());
  handle.addEventListener('dragstart', (event) => {
    event.dataTransfer?.setData(
      'application/x-adeo-board-move',
      JSON.stringify({ taskId: task.id, fromClientId: column.clientId }),
    );
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
    boardCrossListDrag = { taskId: task.id, fromClientId: column.clientId, dropIndex: null };
  });
  handle.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    boardCrossListDrag = null;
    removeDropIndicator();
  });

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.done;
  setPriorityAttr(checkbox, task.priority);
  checkbox.addEventListener('change', (event) => {
    void toggleTaskDone(task.id, (event.target as HTMLInputElement).checked).then(renderBoard);
  });

  const main = document.createElement('div');
  main.className = 'task-main';
  const text = document.createElement('span');
  text.className = 'task-text';
  text.textContent = task.text;
  text.style.textDecoration = task.done ? 'line-through' : 'none';
  text.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    document.dispatchEvent(new CustomEvent('open-edit-modal', { detail: { taskId: task.id } }));
  });
  main.appendChild(text);

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
      if (reminderText.textContent) reminder.appendChild(document.createTextNode(' • '));
      const repeatText = document.createElement('span');
      repeatText.className = 'task-repeat';
      repeatText.textContent = repeatSummaryFromRule(task.repeatRule);
      reminder.appendChild(repeatText);
    }
    main.appendChild(reminder);
  }

  if (task.tagIds?.length) {
    const tagsRow = document.createElement('div');
    tagsRow.className = 'task-tags';
    task.tagIds.forEach((tagId) => {
      const tag = state.tags.find((t) => t.id === tagId);
      if (!tag) return;
      tagsRow.appendChild(
        createTagChip({
          label: `#${tag.name}`,
          color: tag.color,
          colorsEnabled: state.tagColors,
          title: `Filter by #${tag.name}`,
          onActivate: (event) => {
            event.preventDefault();
            event.stopPropagation();
            document.dispatchEvent(new CustomEvent('filter-by-tag', { detail: { tagId } }));
          },
        }),
      );
    });
    if (tagsRow.childElementCount) main.appendChild(tagsRow);
  }

  row.appendChild(handle);
  row.appendChild(checkbox);
  row.appendChild(main);

  // always-visible "Move to…" control
  const others = state.boardColumns.filter((c) => c.clientId !== column.clientId);
  const moveBtn = document.createElement('button');
  moveBtn.type = 'button';
  moveBtn.className = 'view-bar-action board-card__move';
  moveBtn.textContent = 'Move to…';
  moveBtn.setAttribute('aria-haspopup', 'menu');
  const menuOpen =
    state.boardOpenMoveMenu?.taskId === task.id &&
    state.boardOpenMoveMenu?.columnId === column.clientId;
  moveBtn.setAttribute('aria-expanded', String(menuOpen));
  if (others.length === 0) {
    moveBtn.disabled = true;
    moveBtn.title = 'No other columns';
  }
  moveBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    state.boardOpenMoveMenu = menuOpen ? null : { taskId: task.id, columnId: column.clientId };
    state.boardPreview = null;
    renderBoard();
  });
  row.appendChild(moveBtn);

  if (menuOpen && others.length) {
    const menu = document.createElement('div');
    menu.className = 'list-menu board-move-menu open';
    menu.setAttribute('role', 'menu');
    menu.style.display = 'flex';
    menu.addEventListener('click', (event) => event.stopPropagation());
    others.forEach((otherCol) => {
      const otherRef = columnRef(otherCol);
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'list-menu-item';
      item.setAttribute('role', 'menuitem');
      if (!otherRef) {
        item.textContent = 'Removed source';
        item.setAttribute('aria-disabled', 'true');
        item.disabled = true;
        menu.appendChild(item);
        return;
      }
      const plan = planBoardMove(task, ref, otherRef);
      if (plan.verdict === 'noop') {
        item.textContent = `Already in "${otherRef.label}"`;
        item.setAttribute('aria-disabled', 'true');
        item.disabled = true;
      } else if (plan.verdict === 'blocked') {
        item.textContent = `${otherRef.label} — can't move here`;
        item.setAttribute('aria-disabled', 'true');
        item.setAttribute('aria-label', `Can't move to ${otherRef.label}. ${plan.note}`);
        item.title = plan.note;
        item.disabled = true;
      } else if (plan.verdict === 'best-effort') {
        item.textContent = `Move to "${otherRef.label}"…`;
        item.addEventListener('click', () => {
          state.boardOpenMoveMenu = null;
          showBoardMoveDialog(task, column.clientId, otherCol.clientId, ref, otherRef, plan);
          renderBoard();
        });
      } else {
        item.textContent = `Move to "${otherRef.label}"`;
        item.addEventListener('click', () => {
          void performMove(task, column.clientId, otherCol.clientId, ref, otherRef, plan);
        });
      }
      menu.appendChild(item);
    });
    row.appendChild(menu);
  }

  // inline preview / confirm for a best-effort move on this card+destination
  const preview = state.boardPreview;
  if (
    preview &&
    preview.taskId === task.id &&
    preview.fromColumnId === column.clientId
  ) {
    const destCol = state.boardColumns.find((c) => c.clientId === preview.destColumnId);
    const destRef = destCol ? columnRef(destCol) : null;
    if (destCol && destRef) {
      const plan = planBoardMove(task, ref, destRef);
      row.appendChild(buildPreview(task, column.clientId, destCol.clientId, ref, destRef, plan));
    }
  }

  return row;
};

const buildPreview = (
  task: Task,
  fromClientId: string,
  toClientId: string,
  from: BoardColumnRef,
  to: BoardColumnRef,
  plan: BoardMovePlan,
): HTMLElement => {
  const box = document.createElement('div');
  box.className = 'board-preview template-hints';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', `Move "${task.text}" to "${to.label}"`);

  const chips = document.createElement('div');
  chips.className = 'board-preview__chips';
  plan.changes.forEach((change) => {
    const chip = document.createElement('span');
    chip.className = 'template-chip';
    chip.textContent = change.chip;
    if (change.priority) chip.dataset.priority = change.priority;
    chips.appendChild(chip);
  });
  if (plan.changes.length) box.appendChild(chips);

  const note = document.createElement('p');
  note.className = 'board-preview__note';
  note.textContent = plan.note;
  box.appendChild(note);

  const actions = document.createElement('div');
  actions.className = 'board-preview__actions';

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'view-bar-action board-primary';
  confirm.textContent = plan.verdict === 'best-effort' ? 'Move anyway' : 'Move';
  confirm.addEventListener('click', () => {
    void performMove(task, fromClientId, toClientId, from, to, plan);
  });

  const openTask = document.createElement('button');
  openTask.type = 'button';
  openTask.className = 'view-bar-action';
  openTask.textContent = 'Open task…';
  openTask.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('open-edit-modal', { detail: { taskId: task.id } }));
  });

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'view-bar-action';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => {
    state.boardPreview = null;
    renderBoard();
    refs.boardColumnsEl
      ?.querySelector<HTMLElement>(
        `.board-column[data-client-id="${fromClientId}"] .task-row[data-task-id="${task.id}"] .board-card__move`,
      )
      ?.focus();
  });

  actions.appendChild(confirm);
  actions.appendChild(openTask);
  actions.appendChild(cancel);
  box.appendChild(actions);
  box.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      cancel.click();
    }
  });
  return box;
};

const attachBodyRoving = (body: HTMLElement): void => {
  body.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const rows = Array.from(body.querySelectorAll<HTMLElement>('.task-row'));
    if (!rows.length) return;
    const active = document.activeElement as HTMLElement | null;
    const current = active ? rows.indexOf(active.closest('.task-row') as HTMLElement) : -1;
    let next = current;
    if (event.key === 'ArrowDown') next = current < 0 ? 0 : Math.min(current + 1, rows.length - 1);
    else if (event.key === 'ArrowUp') next = current < 0 ? rows.length - 1 : Math.max(current - 1, 0);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = rows.length - 1;
    if (next === current || next < 0) return;
    event.preventDefault();
    rows.forEach((r, i) => (r.tabIndex = i === next ? 0 : -1));
    rows[next].focus();
  });
};

const buildColumn = (col: BoardWorkingColumn, index: number): HTMLElement => {
  const ref = columnRef(col);
  const el = document.createElement('div');
  el.className = 'board-column';
  el.dataset.clientId = col.clientId;
  el.setAttribute('role', 'group');

  const header = document.createElement('div');
  header.className = 'board-column__header';

  const pickerWrap = document.createElement('div');
  pickerWrap.className = 'view-picker-wrap board-column__picker-wrap';
  const picker = document.createElement('button');
  picker.type = 'button';
  picker.className = 'view-picker';
  picker.setAttribute('aria-haspopup', 'listbox');
  const pickerOpen = state.boardOpenSourcePickerId === col.clientId;
  picker.setAttribute('aria-expanded', String(pickerOpen));
  const label = document.createElement('span');
  label.textContent = ref ? truncate(ref.label) : 'Removed source';
  if (ref && ref.label.length > 24) label.title = ref.label;
  picker.appendChild(label);
  const caret = document.createElement('span');
  caret.className = 'view-picker-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.textContent = '▾';
  picker.appendChild(caret);
  picker.addEventListener('click', (event) => {
    event.stopPropagation();
    state.boardOpenSourcePickerId = pickerOpen ? null : col.clientId;
    state.boardOpenColumnMenuId = null;
    renderBoard();
  });
  pickerWrap.appendChild(picker);
  if (pickerOpen) {
    const menu = buildSourceMenu(col, (kind, id) => setColumnSource(col.clientId, kind, id));
    pickerWrap.appendChild(menu);
    mountBoardSourceMenu(menu, picker);
  }
  header.appendChild(pickerWrap);

  const tasks = ref ? columnTasks(ref) : [];

  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'list-menu-btn board-column__menu-btn';
  menuBtn.setAttribute('aria-haspopup', 'menu');
  const colMenuOpen = state.boardOpenColumnMenuId === col.clientId;
  menuBtn.setAttribute('aria-expanded', String(colMenuOpen));
  menuBtn.setAttribute('aria-label', 'Column options');
  menuBtn.innerHTML = svgMore();
  menuBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    state.boardOpenColumnMenuId = colMenuOpen ? null : col.clientId;
    state.boardOpenSourcePickerId = null;
    renderBoard();
  });
  header.appendChild(menuBtn);

  if (colMenuOpen) {
    const menu = document.createElement('div');
    menu.className = 'list-menu board-column__menu open';
    menu.setAttribute('role', 'menu');
    menu.style.display = 'flex';
    menu.addEventListener('click', (event) => event.stopPropagation());
    const mkItem = (text: string, disabled: boolean, onClick: () => void, danger = false) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `list-menu-item${danger ? ' list-menu-danger' : ''}`;
      item.setAttribute('role', 'menuitem');
      item.textContent = text;
      if (disabled) {
        item.disabled = true;
        item.setAttribute('aria-disabled', 'true');
      } else {
        item.addEventListener('click', onClick);
      }
      menu.appendChild(item);
    };
    mkItem('Move column left', index === 0, () => moveColumn(col.clientId, -1));
    mkItem('Move column right', index === state.boardColumns.length - 1, () =>
      moveColumn(col.clientId, 1),
    );
    mkItem('Remove column', false, () => removeColumn(col.clientId), true);
    header.appendChild(menu);
  }

  el.appendChild(header);

  el.setAttribute(
    'aria-label',
    ref
      ? `${ref.label}, ${openCount(tasks)} open of ${tasks.length}`
      : 'Column source was removed',
  );

  const body = document.createElement('div');
  body.className = 'board-column__body';
  body.addEventListener('focusin', () => {
    state.boardFocusColumnId = col.clientId;
  });

  if (!ref) {
    const gone = document.createElement('div');
    gone.className = 'empty-state';
    gone.textContent = 'This source was removed. Pick another from the header, or remove the column.';
    body.appendChild(gone);
  } else if (tasks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent =
      ref.kind === 'list'
        ? `Nothing in "${ref.label}" yet.`
        : `Nothing matches "${ref.label}".`;
    body.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'tasks-list board-column__list';
    tasks.forEach((task, i) => {
      const card = buildBoardCard(task, col, ref);
      card.tabIndex = i === 0 ? 0 : -1;
      list.appendChild(card);
    });
    body.appendChild(list);
    attachBodyRoving(body);
  }

  // additive pointer drop target with per-row drop indicators for position selection
  body.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes('application/x-adeo-board-move')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    el.classList.add('board-column--drop');

    // Show drop indicator on the specific row being dragged over
    if (!boardCrossListDrag) return;
    const target = event.target instanceof HTMLElement ? event.target.closest('.board-card') : null;
    if (target && target.parentNode) {
      const rect = (target as HTMLElement).getBoundingClientRect();
      const isBefore = event.clientY < rect.top + rect.height / 2;
      removeDropIndicator();
      if (isBefore) {
        target.parentNode.insertBefore(dropIndicator, target);
      } else {
        target.parentNode.insertBefore(dropIndicator, target.nextSibling);
      }
      // Calculate insertion index into state.tasks based on tasks in this column
      const targetTaskId = Number((target as HTMLElement).dataset.taskId);
      const targetIndex = state.tasks.findIndex((t) => t.id === targetTaskId);
      if (targetIndex !== -1) {
        boardCrossListDrag.dropIndex = isBefore ? targetIndex : targetIndex + 1;
      }
    }
  });
  body.addEventListener('dragleave', () => el.classList.remove('board-column--drop'));
  body.addEventListener('drop', (event) => {
    el.classList.remove('board-column--drop');
    removeDropIndicator();
    const raw = event.dataTransfer?.getData('application/x-adeo-board-move');
    if (!raw || !ref) return;
    event.preventDefault();
    let payload: { taskId: number; fromClientId: string };
    try {
      payload = JSON.parse(raw);
    } catch {
      boardCrossListDrag = null;
      return;
    }
    if (payload.fromClientId === col.clientId) {
      boardCrossListDrag = null;
      return;
    }
    const fromCol = state.boardColumns.find((c) => c.clientId === payload.fromClientId);
    const fromRef = fromCol ? columnRef(fromCol) : null;
    const task = state.tasks.find((t) => t.id === payload.taskId);
    if (!fromCol || !fromRef || !task) {
      boardCrossListDrag = null;
      return;
    }

    // If drop position was calculated, reorder task in state.tasks before applying the move
    if (boardCrossListDrag && boardCrossListDrag.dropIndex !== null) {
      const currentIndex = state.tasks.indexOf(task);
      if (currentIndex !== -1) {
        const newIndex = boardCrossListDrag.dropIndex;
        // Only reorder if different position
        if (currentIndex !== newIndex && currentIndex + 1 !== newIndex) {
          state.tasks.splice(currentIndex, 1);
          state.tasks.splice(currentIndex < newIndex ? newIndex - 1 : newIndex, 0, task);
          void saveTaskOrder();
        }
      }
    }
    boardCrossListDrag = null;

    const plan = planBoardMove(task, fromRef, ref);
    if (plan.verdict === 'noop') {
      announce(`"${task.text}" is already in "${ref.label}".`);
      return;
    }
    if (plan.verdict === 'blocked') {
      announce(`Can't move "${task.text}" to "${ref.label}". ${plan.note}`);
      return;
    }
    if (plan.verdict === 'best-effort') {
      showBoardMoveDialog(task, fromCol.clientId, col.clientId, fromRef, ref, plan);
      renderBoard();
      return;
    }
    void performMove(task, fromCol.clientId, col.clientId, fromRef, ref, plan);
  });

  el.appendChild(body);
  return el;
};

/**
 * Modal dialog for best-effort board move confirmation. Shows when the user
 * selects a destination that the move cannot fully cover, and provides options
 * to proceed, open the task for editing, or cancel.
 */
let pendingBoardMoveData: {
  task: Task;
  fromClientId: string;
  toClientId: string;
  from: BoardColumnRef;
  to: BoardColumnRef;
  plan: BoardMovePlan;
} | null = null;

const showBoardMoveDialog = (
  task: Task,
  fromClientId: string,
  toClientId: string,
  from: BoardColumnRef,
  to: BoardColumnRef,
  plan: BoardMovePlan,
): void => {
  const overlay = refs.boardMoveOverlay;
  const messageEl = refs.boardMoveMessage;
  if (!overlay || !messageEl) return;

  pendingBoardMoveData = { task, fromClientId, toClientId, from, to, plan };

  let message = `These changes don't cover the whole filter, so the task may not stay in "${plan.destinationLabel}".`;
  if (!plan.staysInSource) {
    message += ` Moves out of the "${plan.sourceLabel}" list.`;
  }
  messageEl.textContent = message;
  overlay.classList.add('open');
};

const closeBoardMoveDialog = (): void => {
  const overlay = refs.boardMoveOverlay;
  if (!overlay) return;
  overlay.classList.remove('open');
  pendingBoardMoveData = null;
};

const initBoardMoveDialog = (): void => {
  if (!refs.boardMoveOverlay) return;

  // Confirm button: perform the move
  refs.boardMoveConfirm?.addEventListener('click', () => {
    const d = pendingBoardMoveData;
    closeBoardMoveDialog();
    if (d) void performMove(d.task, d.fromClientId, d.toClientId, d.from, d.to, d.plan);
  });

  // Cancel button: just close
  refs.boardMoveCancel?.addEventListener('click', () => {
    closeBoardMoveDialog();
  });

  // Open task button: close dialog and dispatch open event
  refs.boardMoveOpen?.addEventListener('click', () => {
    const id = pendingBoardMoveData?.task.id;
    closeBoardMoveDialog();
    if (id != null) document.dispatchEvent(new CustomEvent('open-edit-modal', { detail: { taskId: id } }));
  });

  // Overlay backdrop click
  refs.boardMoveOverlay.addEventListener('click', (event) => {
    if (event.target === refs.boardMoveOverlay) {
      closeBoardMoveDialog();
    }
  });

  // Escape key
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !refs.boardMoveOverlay?.hidden) {
      closeBoardMoveDialog();
    }
  });
};

initBoardMoveDialog();

const renderToast = (): void => {
  const host = refs.boardToastEl;
  if (!host) return;
  host.innerHTML = '';
  if (!state.boardToast) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  const text = document.createElement('span');
  text.className = 'board-toast__text';
  text.textContent = state.boardToast.message;
  host.appendChild(text);
  if (state.boardToast.undo) {
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'view-bar-action board-toast__action';
    undo.textContent = 'Undo';
    undo.addEventListener('click', () => {
      void undoBoardMove();
    });
    host.appendChild(undo);
  }
  if (lastFailedMove) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'view-bar-action board-toast__action';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => {
      const fn = lastFailedMove;
      clearToast();
      fn?.();
    });
    host.appendChild(retry);
  }
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'view-bar-action board-toast__action';
  dismiss.textContent = 'Dismiss';
  dismiss.addEventListener('click', clearToast);
  host.appendChild(dismiss);
};

export const renderBoard = (): void => {
  const region = refs.boardRegion;
  const host = refs.boardColumnsEl;
  if (!region || !host) return;

  // Drop any scroll/resize listeners from a source picker that is about to be rebuilt.
  boardSourceMenuCleanup?.();

  if (refs.boardToggle) {
    // The board area carries no "Leave board" control: while a board is open the
    // toggle is removed entirely (leaving happens via the sidebar pills / view
    // picker). Outside board mode it is the plain "Board" entry point again.
    refs.boardToggle.textContent = 'Board';
    refs.boardToggle.setAttribute('aria-pressed', String(state.boardMode));
    refs.boardToggle.hidden = state.boardMode;
  }
  if (!state.boardMode) {
    region.hidden = true;
    if (refs.tasksSection) refs.tasksSection.hidden = false;
    closeBoardMoveDialog();
    return;
  }
  region.hidden = false;
  if (refs.tasksSection) refs.tasksSection.hidden = true;

  const view = currentView();
  const boardName = view.kind === 'board' && view.board ? view.board.name : 'Board';
  region.setAttribute('aria-label', `Board: ${boardName}`);

  host.innerHTML = '';

  if (state.boardColumns.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'board-empty empty-state';
    empty.textContent = `No columns yet. Add a column to start the "${boardName}" board.`;
    host.appendChild(empty);
  } else {
    state.boardColumns.forEach((col, index) => host.appendChild(buildColumn(col, index)));
  }

  // end-of-row add-column control (also the primary action of an empty board)
  const addWrap = document.createElement('div');
  addWrap.className = 'view-picker-wrap board-add-column-wrap';
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'view-picker board-add-column';
  add.setAttribute('aria-haspopup', 'listbox');
  const addOpen = state.boardOpenSourcePickerId === ADD_PICKER;
  add.setAttribute('aria-expanded', String(addOpen));
  add.textContent = '＋ Add column';
  add.addEventListener('click', (event) => {
    event.stopPropagation();
    state.boardOpenSourcePickerId = addOpen ? null : ADD_PICKER;
    state.boardOpenColumnMenuId = null;
    renderBoard();
  });
  addWrap.appendChild(add);
  if (addOpen) {
    const menu = buildSourceMenu(null, (kind, id) => addColumn(kind, id));
    addWrap.appendChild(menu);
    mountBoardSourceMenu(menu, add);
  }
  host.appendChild(addWrap);

  renderToast();
};

/** Close any open board menu / picker on an outside click (wired from index.ts). */
export const closeBoardMenus = (): void => {
  if (
    state.boardOpenColumnMenuId !== null ||
    state.boardOpenSourcePickerId !== null ||
    state.boardOpenMoveMenu !== null
  ) {
    state.boardOpenColumnMenuId = null;
    state.boardOpenSourcePickerId = null;
    state.boardOpenMoveMenu = null;
    if (state.boardMode) renderBoard();
  }
};
