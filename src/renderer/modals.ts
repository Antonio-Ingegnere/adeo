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

export const updatePriorityUI = (value: string | null) => {
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

const formatDate = (date: string | null) => {
  if (!date) return '';
  const [y, m, d] = date.split('-');
  const base = `${y}-${m}-${d}`;
  const map: Record<string, string> = {
    'YYYY-MM-DD': `${y}-${m}-${d}`,
    'DD/MM/YYYY': `${d}/${m}/${y}`,
    'MM/DD/YYYY': `${m}/${d}/${y}`,
    'DD.MM.YYYY': `${d}.${m}.${y}`,
    'YYYY/MM/DD': `${y}/${m}/${d}`,
    'MM-DD-YYYY': `${m}-${d}-${y}`,
    'DD-MM-YYYY': `${d}-${m}-${y}`,
    'MMM DD, YYYY': new Date(base).toLocaleDateString(undefined, {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
    }),
    'DD MMM YYYY': new Date(base).toLocaleDateString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }),
    'YYYY.MM.DD': `${y}.${m}.${d}`,
  };
  return map[state.dateFormat] ?? `${y}-${m}-${d}`;
};

const formatReminderLabel = (date: string | null, time: string | null) => {
  if (!date && !time) return 'None';
  let label = '';
  if (date) {
    label += formatDate(date);
  }
  if (time) {
    label += label ? ' • ' : '';
    const [hours, minutes] = time.split(':').map((v) => Number(v));
    const dt = new Date();
    dt.setHours(hours);
    dt.setMinutes(minutes);
    if (state.timeFormat === '24h') {
      const hh = hours.toString().padStart(2, '0');
      const mm = minutes.toString().padStart(2, '0');
      label += `${hh}:${mm}`;
    } else {
      label += dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
    }
  }
  return label || 'None';
};

export const updateReminderUI = (date: string | null, time: string | null) => {
  if (refs.reminderLabel) {
    refs.reminderLabel.textContent = formatReminderLabel(date, time);
  }
};

export const updateRepeatUI = (value: string | null) => {
  if (!refs.repeatLabel) return;
  if (!value) {
    refs.repeatLabel.textContent = 'None';
    return;
  }
  const label = value.charAt(0).toUpperCase() + value.slice(1);
  refs.repeatLabel.textContent = label;
};

const deriveRepeatLabel = (repeatRule: string | null) => {
  if (!repeatRule) return null;
  const parts = repeatRule.split(';').reduce<Record<string, string>>((acc, part) => {
    const [key, value] = part.split('=');
    if (key && value) acc[key] = value;
    return acc;
  }, {});
  const freq = parts.FREQ;
  const hasEnd = Boolean(parts.COUNT || parts.UNTIL);
  const hasInterval = Boolean(parts.INTERVAL && parts.INTERVAL !== '1');
  if (hasEnd || hasInterval) return 'custom';
  if (freq === 'DAILY' && !parts.BYDAY) return 'daily';
  if (freq === 'WEEKLY' && parts.BYDAY === 'MO,TU,WE,TH,FR') {
    return 'weekdays';
  }
  if (freq === 'WEEKLY') {
    const bydayValues = parts.BYDAY ? parts.BYDAY.split(',').filter(Boolean) : [];
    if (bydayValues.length <= 1) return 'weekly';
    return 'custom';
  }
  if (freq === 'MONTHLY') return 'monthly';
  if (freq === 'YEARLY') return 'yearly';
  return 'custom';
};

export const openEditModal = (taskId: number) => {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!refs.overlay || !refs.editInput || !refs.editDetailsInput || !task) return;
  state.editingTaskId = taskId;
  state.modalSelectedListId = task.listId ?? null;
  state.modalPriority = task.priority ?? 'none';
  state.modalReminderDate = task.reminderDate ?? null;
  state.modalReminderTime = task.reminderTime ?? null;
  state.modalRepeatRule = task.repeatRule ?? null;
  state.modalRepeatStart = task.repeatStart ?? null;
  state.modalRepeat = deriveRepeatLabel(task.repeatRule ?? null);
  refs.editInput.value = task.text;
  refs.editDetailsInput.value = task.details || '';
  if (refs.reminderDateInput) {
    refs.reminderDateInput.value = state.modalReminderDate ?? '';
  }
  if (refs.reminderTimeSelect) {
    refs.reminderTimeSelect.value = state.modalReminderTime ?? '';
  }
  if (refs.editDoneInput) {
    refs.editDoneInput.checked = task.done;
  }
  refs.overlay.classList.add('open');
  renderModalLists();
  updatePriorityUI(state.modalPriority);
  updateReminderUI(state.modalReminderDate, state.modalReminderTime);
  updateRepeatUI(state.modalRepeat);
  if (refs.priorityMenu) {
    refs.priorityMenu.style.display = 'none';
  }
  if (refs.reminderMenu) {
    refs.reminderMenu.style.display = 'none';
  }
  if (refs.repeatMenu) {
    refs.repeatMenu.style.display = 'none';
  }
  if (refs.repeatOverlay) {
    refs.repeatOverlay.classList.remove('open');
  }
  if (refs.modalListMenu) {
    refs.modalListMenu.style.display = 'none';
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
  state.modalReminderDate = null;
  state.modalReminderTime = null;
  state.modalRepeat = null;
  state.modalRepeatRule = null;
  state.modalRepeatStart = null;
  if (refs.reminderDateInput) refs.reminderDateInput.value = '';
  if (refs.reminderTimeSelect) refs.reminderTimeSelect.value = '';
  updatePriorityUI('none');
  updateReminderUI(null, null);
  updateRepeatUI(null);
  renderModalLists();
  if (refs.priorityMenu) {
    refs.priorityMenu.style.display = 'none';
  }
  if (refs.reminderMenu) {
    refs.reminderMenu.style.display = 'none';
  }
  if (refs.repeatMenu) {
    refs.repeatMenu.style.display = 'none';
  }
  if (refs.repeatOverlay) {
    refs.repeatOverlay.classList.remove('open');
  }
  if (refs.modalListMenu) {
    refs.modalListMenu.style.display = 'none';
  }
};

export const saveEdit = async () => {
  if (!state.editingTaskId || !refs.editInput || !refs.editDetailsInput) return;
  const newText = refs.editInput.value.trim();
  const newDetails = refs.editDetailsInput.value;
  const newListId = state.modalSelectedListId;
  const newDone = refs.editDoneInput?.checked ?? false;
  const newPriority = state.modalPriority;
  const reminderDate = state.modalReminderDate ?? null;
  const reminderTime = state.modalReminderTime ?? null;
  const repeatRule = state.modalRepeatRule ?? null;
  const repeatStart = state.modalRepeatStart ?? null;
  if (!newText) return;
  try {
    const [textResult, detailsResult, listResult, priorityResult, reminderResult, repeatResult] = await Promise.all([
      window.electronAPI.updateTaskText(state.editingTaskId, newText),
      window.electronAPI.updateTaskDetails(state.editingTaskId, newDetails),
      window.electronAPI.updateTaskList(state.editingTaskId, newListId),
      window.electronAPI.updateTaskDone(state.editingTaskId, newDone),
      window.electronAPI.updateTaskPriority(state.editingTaskId, newPriority),
      window.electronAPI.updateTaskReminder(state.editingTaskId, reminderDate, reminderTime),
      window.electronAPI.updateTaskRepeat(state.editingTaskId, repeatRule, repeatStart),
    ]);
    if (
      !textResult ||
      (textResult as any).error ||
      !detailsResult ||
      (listResult as any)?.error ||
      (priorityResult as any)?.error ||
      (reminderResult as any)?.error ||
      (repeatResult as any)?.error
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
      state.tasks[idx].reminderDate = reminderDate;
      state.tasks[idx].reminderTime = reminderTime;
      state.tasks[idx].repeatRule = repeatRule;
      state.tasks[idx].repeatStart = repeatStart;
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
  renderListOptions(refs.modalListMenu, state.modalSelectedListId, refs.modalListLabel);
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
        renderListOptions(refs.addTaskListMenu, state.addTaskSelectedListId ?? state.selectedListId, refs.addTaskListLabel);
        renderModalLists();
      })
      .catch((error) => console.error('Failed to update list', error));
  } else {
    window.electronAPI
      .addList(name)
      .then((created) => {
        if (!created || (created as any).error) return;
        const newList: List = {
          id: (created as List).id,
          name: (created as List).name,
          position: (created as List).position ?? state.lists.length,
        };
        state.lists.push(newList);
        closeListModal();
        renderLists();
        renderListOptions(refs.addTaskListMenu, state.addTaskSelectedListId ?? state.selectedListId, refs.addTaskListLabel);
        renderModalLists();
      })
      .catch((error) => console.error('Failed to add list', error));
  }
};
