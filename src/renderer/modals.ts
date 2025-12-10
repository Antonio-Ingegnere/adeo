import type { List } from '../types.js';
import { renderListOptions, renderLists } from './lists.js';
import { renderTasks, updateTasksTitle } from './tasks.js';
import { refs } from './dom.js';
import { state } from './state.js';

const priorityColors: Record<string, string> = {
  none: '#C9C9C9',
  low: '#7ED957',
  medium: '#FFB866',
  high: '#FF6B6B',
};

const priorityFillColors: Record<string, string> = {
  none: '#ffffff',
  low: '#A4F07F',
  medium: '#FFD08F',
  high: '#FF8A8A',
};

const updatePriorityUI = (value: string | null) => {
  const color = value ? priorityColors[value] : priorityColors.none;
  const fill = value ? priorityFillColors[value] : priorityFillColors.none;
  if (refs.priorityChip) {
    refs.priorityChip.style.background = color ?? priorityColors.none;
  }
  if (refs.priorityLabel) {
    const label = value ? value.charAt(0).toUpperCase() + value.slice(1) : 'None';
    refs.priorityLabel.textContent = label;
  }
  if (refs.editDoneInput) {
    refs.editDoneInput.style.borderColor = color ?? priorityColors.none;
    refs.editDoneInput.style.background = fill ?? priorityFillColors.none;
  }
};

export const openEditModal = (taskId: number) => {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!refs.overlay || !refs.editInput || !refs.editDetailsInput || !task) return;
  state.editingTaskId = taskId;
  state.modalSelectedListId = task.listId ?? null;
  state.modalPriority = task.priority ?? 'none';
  refs.editInput.value = task.text;
  refs.editDetailsInput.value = task.details || '';
  if (refs.editDoneInput) {
    refs.editDoneInput.checked = task.done;
  }
  refs.overlay.classList.add('open');
  renderModalLists();
  updatePriorityUI(state.modalPriority);
  if (refs.priorityMenu) {
    refs.priorityMenu.style.display = 'none';
  }
  setTimeout(() => refs.editInput?.focus(), 0);
};

export const closeEditModal = () => {
  if (!refs.overlay || !refs.editInput || !refs.editDetailsInput) return;
  refs.overlay.classList.remove('open');
  refs.editInput.value = '';
  refs.editDetailsInput.value = '';
  if (refs.editDoneInput) {
    refs.editDoneInput.checked = false;
  }
  state.editingTaskId = null;
  state.modalSelectedListId = null;
  state.modalPriority = 'none';
  updatePriorityUI('none');
  if (refs.priorityMenu) {
    refs.priorityMenu.style.display = 'none';
  }
};

export const saveEdit = async () => {
  if (!state.editingTaskId || !refs.editInput || !refs.editDetailsInput) return;
  const newText = refs.editInput.value.trim();
  const newDetails = refs.editDetailsInput.value;
  const newListId = state.modalSelectedListId;
  const newDone = refs.editDoneInput?.checked ?? false;
  const newPriority = state.modalPriority;
  if (!newText) return;
  try {
    const [textResult, detailsResult, listResult, priorityResult] = await Promise.all([
      window.electronAPI.updateTaskText(state.editingTaskId, newText),
      window.electronAPI.updateTaskDetails(state.editingTaskId, newDetails),
      window.electronAPI.updateTaskList(state.editingTaskId, newListId),
      window.electronAPI.updateTaskDone(state.editingTaskId, newDone),
      window.electronAPI.updateTaskPriority(state.editingTaskId, newPriority),
    ]);
    if (
      !textResult ||
      (textResult as any).error ||
      !detailsResult ||
      (listResult as any)?.error ||
      (priorityResult as any)?.error
    ) {
      return;
    }
    const idx = state.tasks.findIndex((t) => t.id === state.editingTaskId);
    if (idx !== -1) {
      state.tasks[idx].text = newText;
      state.tasks[idx].details = newDetails;
      state.tasks[idx].listId = (listResult as { listId: number | null }).listId ?? null;
      state.tasks[idx].done = newDone;
      state.tasks[idx].priority = newPriority;
      renderTasks();
    }
    closeEditModal();
  } catch (error) {
    console.error('Failed to update task text', error);
  }
};

export const openListModal = () => {
  if (!refs.listOverlay || !refs.listInput) return;
  refs.listOverlay.classList.add('open');
  refs.listInput.value = '';
  const heading = refs.listOverlay.querySelector('h2');
  if (heading) heading.textContent = 'Add list';
  setTimeout(() => refs.listInput?.focus(), 0);
};

export const openEditListModal = (listId: number) => {
  const list = state.lists.find((l) => l.id === listId);
  if (!list || !refs.listOverlay || !refs.listInput) return;
  state.editingListId = listId;
  refs.listOverlay.classList.add('open');
  refs.listInput.value = list.name;
  const heading = refs.listOverlay.querySelector('h2');
  if (heading) heading.textContent = 'Rename list';
  setTimeout(() => refs.listInput?.focus(), 0);
};

export const closeListModal = () => {
  if (!refs.listOverlay || !refs.listInput) return;
  refs.listOverlay.classList.remove('open');
  refs.listInput.value = '';
  state.editingListId = null;
};

export const renderModalLists = () => {
  renderListOptions(refs.modalListSelect, state.modalSelectedListId);
};

export const saveList = () => {
  if (!refs.listInput) return;
  const name = refs.listInput.value.trim();
  if (!name) return;
  if (state.editingListId) {
    window.electronAPI
      .updateListName(state.editingListId, name)
      .then((updated) => {
        if (!updated || (updated as any).error) return;
        const idx = state.lists.findIndex((l) => l.id === state.editingListId);
        if (idx !== -1) {
          state.lists[idx].name = (updated as { name: string }).name;
        }
        if (state.selectedListId === state.editingListId) {
          updateTasksTitle();
        }
        closeListModal();
        renderLists();
        renderListOptions(refs.addTaskListSelect, state.addTaskSelectedListId ?? state.selectedListId);
        renderModalLists();
      })
      .catch((error) => console.error('Failed to update list', error));
  } else {
    window.electronAPI
      .addList(name)
      .then((created) => {
        if (!created || (created as any).error) return;
        const newList: List = { id: (created as List).id, name: (created as List).name };
        state.lists.push(newList);
        closeListModal();
        renderLists();
        renderListOptions(refs.addTaskListSelect, state.addTaskSelectedListId ?? state.selectedListId);
        renderModalLists();
      })
      .catch((error) => console.error('Failed to add list', error));
  }
};
