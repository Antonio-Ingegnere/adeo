import type { List } from '../types.js';
import { renderListOptions, renderLists, syncListPicker } from './lists.js';
import { renderTags, sortTags } from './tags.js';
import { renderTasks, updateTasksTitle } from './tasks.js';
import { refs } from './dom.js';
import { state } from './state.js';
import { formatDate } from './helpers.js';
import { asPriority, setPriorityAttr } from './theme.js';

export const updatePriorityUI = (value: string | null) => {
  const priority = asPriority(value);
  setPriorityAttr(refs.priorityChip, priority);
  setPriorityAttr(refs.editDoneInput, priority);
  if (refs.priorityLabel) {
    refs.priorityLabel.textContent = priority.charAt(0).toUpperCase() + priority.slice(1);
  }
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

export const updateTagsUI = () => {
  if (!refs.tagsLabel) return;
  const selected = state.modalTagIds
    .map((id) => state.tags.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));
  if (selected.length === 0) {
    refs.tagsLabel.textContent = 'None';
  } else if (selected.length === 1) {
    refs.tagsLabel.textContent = selected[0].name;
  } else {
    refs.tagsLabel.textContent = `${selected[0].name} +${selected.length - 1}`;
  }
};

export const renderTagsMenu = () => {
  if (!refs.tagsMenuList) return;
  const container = refs.tagsMenuList;
  container.innerHTML = '';
  if (state.tags.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tags-menu-empty';
    empty.textContent = 'No tags yet';
    container.appendChild(empty);
    return;
  }
  state.tags.forEach((tag) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'tags-menu-item';
    const dot = document.createElement('span');
    dot.className = 'tag-dot';
    dot.style.background = tag.color;
    const name = document.createElement('span');
    name.className = 'tags-menu-name';
    name.textContent = tag.name;
    item.appendChild(dot);
    item.appendChild(name);
    if (state.modalTagIds.includes(tag.id)) {
      const check = document.createElement('span');
      check.className = 'tags-menu-check';
      check.textContent = '✓';
      item.appendChild(check);
    }
    item.addEventListener('click', (event) => {
      event.stopPropagation();
      if (state.modalTagIds.includes(tag.id)) {
        state.modalTagIds = state.modalTagIds.filter((id) => id !== tag.id);
      } else {
        state.modalTagIds.push(tag.id);
      }
      renderTagsMenu();
      updateTagsUI();
    });
    container.appendChild(item);
  });
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
  state.modalTagIds = [...(task.tagIds ?? [])];
  refs.editInput.value = task.text;
  refs.editDetailsInput.value = task.details || '';
  if (refs.reminderDateInput) {
    refs.reminderDateInput.value = state.modalReminderDate ?? '';
  }
  if (refs.reminderTimeInput) {
    refs.reminderTimeInput.value = state.modalReminderTime ?? '';
  }
  if (refs.editDoneInput) {
    refs.editDoneInput.checked = task.done;
  }
  refs.overlay.classList.add('open');
  renderModalLists();
  updatePriorityUI(state.modalPriority);
  updateReminderUI(state.modalReminderDate, state.modalReminderTime);
  updateRepeatUI(state.modalRepeat);
  renderTagsMenu();
  updateTagsUI();
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
  if (refs.tagsMenu) {
    refs.tagsMenu.style.display = 'none';
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
  state.modalTagIds = [];
  if (refs.reminderDateInput) refs.reminderDateInput.value = '';
  if (refs.reminderTimeInput) refs.reminderTimeInput.value = '';
  updatePriorityUI('none');
  updateReminderUI(null, null);
  updateRepeatUI(null);
  updateTagsUI();
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
  if (refs.tagsMenu) {
    refs.tagsMenu.style.display = 'none';
  }
};

export const saveEdit = async () => {
  if (!state.editingTaskId || !refs.editInput || !refs.editDetailsInput) return;
  const newText = refs.editInput.value.trim();
  const newDetails = refs.editDetailsInput.value;
  const newListId = state.modalSelectedListId;
  const newDone = refs.editDoneInput?.checked ?? false;
  const newPriority = state.modalPriority;
  const reminderDate =
    state.modalReminderDate ?? (state.modalRepeatRule && state.modalRepeatStart ? state.modalRepeatStart : null);
  const reminderTime = state.modalReminderTime ?? null;
  const repeatRule = state.modalRepeatRule ?? null;
  const repeatStart = state.modalRepeatStart ?? null;
  if (!newText) return;
  const newTagIds = [...state.modalTagIds];
  try {
    const [textResult, detailsResult, listResult, doneResult, priorityResult, reminderResult, repeatResult, tagsResult] = await Promise.all([
      window.electronAPI.updateTaskText(state.editingTaskId, newText),
      window.electronAPI.updateTaskDetails(state.editingTaskId, newDetails),
      window.electronAPI.updateTaskList(state.editingTaskId, newListId),
      window.electronAPI.updateTaskDone(state.editingTaskId, newDone),
      window.electronAPI.updateTaskPriority(state.editingTaskId, newPriority),
      window.electronAPI.updateTaskReminder(state.editingTaskId, reminderDate, reminderTime),
      window.electronAPI.updateTaskRepeat(state.editingTaskId, repeatRule, repeatStart),
      window.electronAPI.setTaskTags(state.editingTaskId, newTagIds),
    ]);
    if (
      !textResult ||
      (textResult as any).error ||
      !detailsResult ||
      (listResult as any)?.error ||
      (doneResult as any)?.error ||
      (priorityResult as any)?.error ||
      (reminderResult as any)?.error ||
      (repeatResult as any)?.error ||
      (tagsResult as any)?.error
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
      state.tasks[idx].tagIds = (tagsResult as { tagIds: number[] }).tagIds ?? newTagIds;
      renderTasks();
    }
    closeEditModal();
  } catch (error) {
    console.error('Failed to update task text', error);
  }
};

export const openEditTagModal = (tagId: number) => {
  const tag = state.tags.find((t) => t.id === tagId);
  if (!tag || !refs.tagOverlay || !refs.tagInput) return;
  state.editingTagId = tagId;
  refs.tagOverlay.classList.add('open');
  refs.tagInput.value = tag.name;
  setTimeout(() => refs.tagInput?.focus(), 0);
};

export const closeTagModal = () => {
  if (!refs.tagOverlay || !refs.tagInput) return;
  refs.tagOverlay.classList.remove('open');
  refs.tagInput.value = '';
  state.editingTagId = null;
};

export const saveTag = () => {
  if (!refs.tagInput || !state.editingTagId) return;
  const name = refs.tagInput.value.trim();
  if (!name) return;
  window.electronAPI
    .updateTagName(state.editingTagId, name)
    .then((updated) => {
      if (!updated || (updated as any).error) return;
      const idx = state.tags.findIndex((t) => t.id === state.editingTagId);
      if (idx !== -1) {
        state.tags[idx].name = (updated as { name: string }).name;
        sortTags();
      }
      closeTagModal();
      updateTasksTitle();
      renderTags();
      renderTasks();
      renderTagsMenu();
      updateTagsUI();
    })
    .catch((error) => console.error('Failed to update tag', error));
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
        syncListPicker();
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
        syncListPicker();
        renderModalLists();
      })
      .catch((error) => console.error('Failed to add list', error));
  }
};
