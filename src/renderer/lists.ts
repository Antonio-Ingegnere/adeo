import type { List } from '../types.js';
import { refs } from './dom.js';
import { renderTasks, updateTasksTitle } from './tasks.js';
import { state } from './state.js';

const makeLabel = (text: string) => {
  const span = document.createElement('span');
  span.className = 'list-pill-label';
  const truncated = text.length > 30 ? `${text.slice(0, 30)}...` : text;
  span.textContent = truncated;
  if (truncated !== text) {
    span.title = text;
  }
  return span;
};

export const renderListOptions = (selectEl: HTMLSelectElement | null, selectedId: number | null) => {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  const noneOption = document.createElement('option');
  noneOption.value = '';
  noneOption.textContent = 'No list';
  selectEl.appendChild(noneOption);
  state.lists.forEach((list) => {
    const option = document.createElement('option');
    option.value = String(list.id);
    const fullName = list.name;
    const truncated = fullName.length > 30 ? `${fullName.slice(0, 30)}...` : fullName;
    option.textContent = truncated;
    if (truncated !== fullName) {
      option.title = fullName;
    }
    selectEl.appendChild(option);
  });
  if (selectedId !== null) {
    selectEl.value = String(selectedId);
  } else {
    selectEl.value = '';
  }
};

export const renderLists = () => {
  if (!refs.listsList) return;
  refs.listsList.innerHTML = '';
  if (!state.listsExpanded) {
    refs.listsList.style.display = 'none';
    return;
  }
  refs.listsList.style.display = 'flex';
  const allItem = document.createElement('div');
  allItem.className = `list-pill${state.selectedListId === null ? ' selected' : ''}`;
  allItem.appendChild(makeLabel('All lists'));
  allItem.addEventListener('click', () => {
    state.selectedListId = null;
    updateTasksTitle();
    renderLists();
    renderTasks();
  });
  refs.listsList.appendChild(allItem);

  if (state.lists.length === 0) {
    if (refs.listsEmpty) {
      refs.listsList.appendChild(refs.listsEmpty);
    }
    return;
  }

  state.lists.forEach((list) => {
    const item = document.createElement('div');
    const isSelected = state.selectedListId === list.id;
    item.className = `list-pill${isSelected ? ' selected' : ''}`;
    item.appendChild(makeLabel(list.name));
    item.addEventListener('click', () => {
      state.selectedListId = list.id;
      state.addTaskSelectedListId = list.id;
      updateTasksTitle();
      renderLists();
      renderListOptions(refs.addTaskListSelect, state.addTaskSelectedListId);
      renderTasks();
    });
    item.addEventListener('dblclick', () => {
      const event = new CustomEvent('open-edit-list-modal', { detail: { listId: list.id } });
      document.dispatchEvent(event);
    });
    refs.listsList?.appendChild(item);
  });
};

export const toggleListsExpanded = () => {
  state.listsExpanded = !state.listsExpanded;
  const icon = refs.listsToggle?.querySelector('svg path:first-of-type');
  const icon2 = refs.listsToggle?.querySelector('svg path:last-of-type');
  if (state.listsExpanded) {
    icon?.setAttribute('d', 'M2 3 L7 8 L12 3');
    icon2?.setAttribute('d', 'M2 8 L7 13 L12 8');
  } else {
    icon?.setAttribute('d', 'M2 8 L7 3 L12 8');
    icon2?.setAttribute('d', 'M2 13 L7 8 L12 13');
  }
  renderLists();
};

export const setLists = (lists: List[]) => {
  state.lists = lists ?? [];
  renderLists();
  updateTasksTitle();
  renderListOptions(refs.addTaskListSelect, state.addTaskSelectedListId ?? state.selectedListId);
};
