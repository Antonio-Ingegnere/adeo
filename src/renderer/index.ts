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
  const border = value ? priorityColors[value] : priorityColors.none;
  const fill = value ? priorityFillColors[value] : priorityFillColors.none;
  if (refs.priorityChip) {
    refs.priorityChip.style.background = border ?? priorityColors.none;
  }
  if (refs.priorityLabel) {
    const label = value ? value.charAt(0).toUpperCase() + value.slice(1) : 'None';
    refs.priorityLabel.textContent = label;
  }
  if (refs.editDoneInput) {
    refs.editDoneInput.style.borderColor = border ?? priorityColors.none;
    refs.editDoneInput.style.background = fill ?? priorityFillColors.none;
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
