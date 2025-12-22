import { addTask, loadLists, loadSettings, loadTasks } from './actions.js';
import { refs } from './dom.js';
import { renderListOptions, renderLists, toggleListsExpanded } from './lists.js';
import { attachTaskListDnD, renderTasks, updateTasksTitle } from './tasks.js';
import {
  closeEditModal,
  closeListModal,
  openEditListModal,
  openEditModal,
  openListModal,
  renderModalLists,
  saveEdit,
  saveList,
  updatePriorityUI,
  updateReminderUI,
  updateRepeatUI,
} from './modals.js';
import { state } from './state.js';

const buildTimeOptions = () => {
  if (!refs.reminderTimeSelect) return;
  const select = refs.reminderTimeSelect;
  select.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = 'No time';
  select.appendChild(empty);

  const prefers24Hour = state.timeFormat === '24h';
  const formatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: !prefers24Hour });
  const start = new Date();
  start.setHours(11, 0, 0, 0);
  const end = new Date(start);
  end.setHours(22, 30, 0, 0);
  for (let dt = new Date(start); dt <= end; dt.setMinutes(dt.getMinutes() + 30)) {
    const option = document.createElement('option');
    const hours = dt.getHours().toString().padStart(2, '0');
    const minutes = dt.getMinutes().toString().padStart(2, '0');
    option.value = `${hours}:${minutes}`;
    option.textContent = prefers24Hour ? `${hours}:${minutes}` : formatter.format(dt);
    select.appendChild(option);
  }
};

const setupEvents = () => {
  attachTaskListDnD();

  refs.addButton?.addEventListener('click', addTask);
  refs.input?.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      addTask();
    }
  });

  refs.cancelEditBtn?.addEventListener('click', () => closeEditModal());
  refs.saveEditBtn?.addEventListener('click', () => saveEdit());
  refs.editInput?.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      saveEdit();
    }
  });
  refs.overlay?.addEventListener('click', (event) => {
    if (event.target === refs.overlay) {
      closeEditModal();
    }
  });

  window.electronAPI.onShowCompletedChanged((value) => {
    state.showCompleted = value;
    renderTasks();
  });

  refs.listsToggle?.addEventListener('click', () => {
    toggleListsExpanded();
  });

  refs.addListBtn?.addEventListener('click', () => openListModal());
  refs.saveListBtn?.addEventListener('click', () => saveList());
  refs.cancelListBtn?.addEventListener('click', () => closeListModal());
  refs.listInput?.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      saveList();
    }
  });
  refs.listOverlay?.addEventListener('click', (event) => {
    if (event.target === refs.listOverlay) {
      closeListModal();
    }
  });

  refs.addTaskListPicker?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (refs.addTaskListMenu) {
      refs.addTaskListMenu.style.display = refs.addTaskListMenu.style.display === 'flex' ? 'none' : 'flex';
    }
  });

  refs.addTaskListMenu?.addEventListener('click', (event) => {
    event.stopPropagation();
    const target = event.target as HTMLElement;
    const item = target.closest('.add-task-list-item') as HTMLElement | null;
    if (!item) return;
    const val = item.dataset.value ?? '';
    state.addTaskSelectedListId = val ? Number(val) : null;
    renderListOptions(refs.addTaskListMenu, state.addTaskSelectedListId ?? state.selectedListId, refs.addTaskListLabel);
    if (refs.addTaskListMenu) {
      refs.addTaskListMenu.style.display = 'none';
    }
  });

  refs.modalListPicker?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (refs.modalListMenu) {
      refs.modalListMenu.style.display = refs.modalListMenu.style.display === 'flex' ? 'none' : 'flex';
    }
  });

  refs.modalListMenu?.addEventListener('click', (event) => {
    event.stopPropagation();
    const target = event.target as HTMLElement;
    const item = target.closest('.modal-list-item') as HTMLElement | null;
    if (!item) return;
    const val = item.dataset.value ?? '';
    state.modalSelectedListId = val ? Number(val) : null;
    renderListOptions(refs.modalListMenu, state.modalSelectedListId, refs.modalListLabel);
    if (refs.modalListMenu) {
      refs.modalListMenu.style.display = 'none';
    }
  });


  refs.priorityPicker?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (refs.priorityMenu) {
      refs.priorityMenu.style.display = refs.priorityMenu.style.display === 'flex' ? 'none' : 'flex';
    }
  });

  refs.priorityMenu?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const item = target.closest('.priority-menu-item') as HTMLElement | null;
    if (!item) return;
    const val = (item.getAttribute('data-value') as typeof state.modalPriority) ?? 'none';
    state.modalPriority = val;
    updatePriorityUI(state.modalPriority);
    if (refs.priorityMenu) refs.priorityMenu.style.display = 'none';
  });

  refs.reminderPicker?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (refs.reminderMenu) {
      refs.reminderMenu.style.display = refs.reminderMenu.style.display === 'flex' ? 'none' : 'flex';
    }
  });

  refs.reminderMenu?.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  refs.reminderDateInput?.addEventListener('change', (event) => {
    const val = (event.target as HTMLInputElement).value;
    state.modalReminderDate = val || null;
    updateReminderUI(state.modalReminderDate, state.modalReminderTime);
  });

  refs.reminderTimeSelect?.addEventListener('change', (event) => {
    const val = (event.target as HTMLSelectElement).value;
    state.modalReminderTime = val || null;
    updateReminderUI(state.modalReminderDate, state.modalReminderTime);
  });

  refs.repeatPicker?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (refs.repeatMenu) {
      refs.repeatMenu.style.display = refs.repeatMenu.style.display === 'flex' ? 'none' : 'flex';
    }
  });

  refs.repeatMenu?.addEventListener('click', (event) => {
    event.stopPropagation();
    const target = event.target as HTMLElement;
    const item = target.closest('.repeat-menu-item') as HTMLElement | null;
    if (!item) return;
    const val = item.dataset.value ?? '';
    if (val === 'custom') {
      state.modalRepeat = 'custom';
      updateRepeatUI(state.modalRepeat);
      if (refs.repeatOverlay) {
        refs.repeatOverlay.classList.add('open');
      }
    } else {
      state.modalRepeat = val || null;
      updateRepeatUI(state.modalRepeat);
    }
    if (refs.repeatMenu) {
      refs.repeatMenu.style.display = 'none';
    }
  });

  if (refs.repeatUnitSelect && refs.repeatWeekdays) {
    if (refs.repeatUnitSelect.value === 'week') {
      refs.repeatWeekdays.classList.add('open');
    } else {
      refs.repeatWeekdays.classList.remove('open');
    }
  }

  refs.repeatUnitSelect?.addEventListener('change', (event) => {
    const unit = (event.target as HTMLSelectElement).value;
    if (!refs.repeatWeekdays) return;
    if (unit === 'week') {
      refs.repeatWeekdays.classList.add('open');
    } else {
      refs.repeatWeekdays.classList.remove('open');
    }
  });

  refs.repeatWeekdays?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest('.repeat-day-button') as HTMLButtonElement | null;
    if (!button) return;
    button.classList.toggle('selected');
  });

  const closeRepeatModal = () => {
    if (refs.repeatOverlay) {
      refs.repeatOverlay.classList.remove('open');
    }
  };

  refs.repeatCancel?.addEventListener('click', () => closeRepeatModal());
  refs.repeatSave?.addEventListener('click', () => closeRepeatModal());
  refs.repeatOverlay?.addEventListener('click', (event) => {
    if (event.target === refs.repeatOverlay) {
      closeRepeatModal();
    }
  });

  refs.settingsSave?.addEventListener('click', async () => {
    const selected: '12h' | '24h' = refs.settingsRadio24?.checked ? '24h' : '12h';
    const selectedDateFormat = refs.dateFormatSelect?.value || state.dateFormat;
    try {
      const [timeResult, dateResult] = await Promise.all([
        window.electronAPI.updateTimeFormat(selected),
        window.electronAPI.updateDateFormat(selectedDateFormat),
      ]);
      state.timeFormat = timeResult.timeFormat;
      state.dateFormat = dateResult.dateFormat;
      buildTimeOptions();
      updateReminderUI(state.modalReminderDate, state.modalReminderTime);
      renderTasks();
    } catch (error) {
      console.error('Failed to update time format', error);
    }
    refs.settingsOverlay?.classList.remove('open');
  });

  refs.settingsCancel?.addEventListener('click', () => {
    refs.settingsOverlay?.classList.remove('open');
  });

  if (refs.settingsOverlay) {
    const overlay = refs.settingsOverlay;
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        overlay.classList.remove('open');
      }
    });
  }

  window.electronAPI.onOpenSettings(() => {
    if (refs.settingsOverlay) {
      if (state.timeFormat === '24h') {
        if (refs.settingsRadio24) refs.settingsRadio24.checked = true;
      } else if (refs.settingsRadio12) {
        refs.settingsRadio12.checked = true;
      }
      if (refs.dateFormatSelect) {
        refs.dateFormatSelect.value = state.dateFormat;
      }
      refs.settingsOverlay.classList.add('open');
    }
  });

  document.addEventListener('open-edit-modal', (event) => {
    const detail = (event as CustomEvent<{ taskId: number }>).detail;
    if (detail?.taskId !== undefined) {
      openEditModal(detail.taskId);
    }
  });

  document.addEventListener('open-edit-list-modal', (event) => {
    const detail = (event as CustomEvent<{ listId: number }>).detail;
    if (detail?.listId !== undefined) {
      openEditListModal(detail.listId);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (refs.overlay?.classList.contains('open')) {
      closeEditModal();
    }
    if (refs.repeatOverlay?.classList.contains('open')) {
      refs.repeatOverlay.classList.remove('open');
    }
  });

  document.addEventListener('click', () => {
    if (state.openListMenuId !== null) {
      state.openListMenuId = null;
      renderLists();
    }
    if (refs.priorityMenu) {
      refs.priorityMenu.style.display = 'none';
    }
    if (refs.reminderMenu) {
      refs.reminderMenu.style.display = 'none';
    }
    if (refs.addTaskListMenu) {
      refs.addTaskListMenu.style.display = 'none';
    }
    if (refs.repeatMenu) {
      refs.repeatMenu.style.display = 'none';
    }
    if (refs.modalListMenu) {
      refs.modalListMenu.style.display = 'none';
    }
  });
};

const init = async () => {
  setupEvents();
  renderLists();
  renderModalLists();
  renderListOptions(refs.addTaskListMenu, state.addTaskSelectedListId ?? state.selectedListId, refs.addTaskListLabel);
  // Initialize lists chevrons orientation
  refs.listsToggle?.dispatchEvent(new Event('click'));
  refs.listsToggle?.dispatchEvent(new Event('click'));
  updateTasksTitle();
  updatePriorityUI(state.modalPriority);
  await loadSettings();
  buildTimeOptions();
  updateReminderUI(state.modalReminderDate, state.modalReminderTime);
  updateRepeatUI(state.modalRepeat);
  await loadTasks();
  await loadLists();
};

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  init().catch((err) => console.error('Failed to init renderer', err));
} else {
  document.addEventListener('DOMContentLoaded', () => {
    init().catch((err) => console.error('Failed to init renderer', err));
  });
}
