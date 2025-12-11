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

  const formatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const start = new Date();
  start.setHours(11, 0, 0, 0);
  const end = new Date(start);
  end.setHours(22, 30, 0, 0);
  for (let dt = new Date(start); dt <= end; dt.setMinutes(dt.getMinutes() + 30)) {
    const option = document.createElement('option');
    const hours = dt.getHours().toString().padStart(2, '0');
    const minutes = dt.getMinutes().toString().padStart(2, '0');
    option.value = `${hours}:${minutes}`;
    option.textContent = formatter.format(dt);
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

  refs.addTaskListSelect?.addEventListener('change', (event) => {
    const val = (event.target as HTMLSelectElement).value;
    state.addTaskSelectedListId = val ? Number(val) : null;
  });

  refs.modalListSelect?.addEventListener('change', (event) => {
    const val = (event.target as HTMLSelectElement).value;
    state.modalSelectedListId = val ? Number(val) : null;
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
  });
};

const init = async () => {
  setupEvents();
  renderLists();
  renderModalLists();
  renderListOptions(refs.addTaskListSelect, state.addTaskSelectedListId ?? state.selectedListId);
  // Initialize lists chevrons orientation
  refs.listsToggle?.dispatchEvent(new Event('click'));
  refs.listsToggle?.dispatchEvent(new Event('click'));
  updateTasksTitle();
  updatePriorityUI(state.modalPriority);
  buildTimeOptions();
  updateReminderUI(state.modalReminderDate, state.modalReminderTime);
  await loadSettings();
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
