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
} from './modals.js';
import { state } from './state.js';

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

  refs.modalPrioritySelect?.addEventListener('change', (event) => {
    const val = (event.target as HTMLSelectElement).value as typeof state.modalPriority;
    state.modalPriority = val ?? 'none';
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
