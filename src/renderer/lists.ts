import type { List } from '../types.js';
import { listDropIndicator, refs } from './dom.js';
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

const removeListDropIndicator = () => {
  if (listDropIndicator.parentNode) {
    listDropIndicator.parentNode.removeChild(listDropIndicator);
  }
};

const saveListOrder = async () => {
  try {
    const orderedIds = state.lists.map((l) => l.id);
    await window.electronAPI.updateListOrder(orderedIds);
  } catch (error) {
    console.error('Failed to save list order', error);
  }
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
  const container = refs.listsList;
  container.innerHTML = '';
  if (!state.listsExpanded) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';
  const allItem = document.createElement('div');
  allItem.className = `list-pill${state.selectedListId === null ? ' selected' : ''}`;
  allItem.appendChild(makeLabel('All lists'));
  allItem.addEventListener('click', () => {
    state.selectedListId = null;
    updateTasksTitle();
    renderLists();
    renderTasks();
  });
  container.appendChild(allItem);

  if (state.lists.length === 0) {
    if (refs.listsEmpty) {
      container.appendChild(refs.listsEmpty);
    }
    return;
  }

  state.lists.forEach((list) => {
    const item = document.createElement('div');
    const isSelected = state.selectedListId === list.id;
    item.className = `list-pill${isSelected ? ' selected' : ''}`;
    item.dataset.index = String(state.lists.findIndex((l) => l.id === list.id));

    item.setAttribute('draggable', 'true');

    const dragHandle = document.createElement('span');
    dragHandle.className = 'list-drag-handle';
    dragHandle.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z" />
      </svg>
    `;
    dragHandle.addEventListener('click', (event) => event.stopPropagation());

    const label = makeLabel(list.name);
    item.appendChild(dragHandle);
    item.appendChild(label);

    const menuBtn = document.createElement('button');
    menuBtn.className = 'list-menu-btn';
    menuBtn.title = 'More';
    menuBtn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" class="icon-more">
        <path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
      </svg>
    `;
    menuBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      state.openListMenuId = state.openListMenuId === list.id ? null : list.id;
      renderLists();
    });

    const menu = document.createElement('div');
    menu.className = 'list-menu';
    menu.style.display = state.openListMenuId === list.id ? 'flex' : 'none';
    menu.addEventListener('click', (event) => event.stopPropagation());

    const renameItem = document.createElement('button');
    renameItem.className = 'list-menu-item';
    renameItem.textContent = 'Rename list';
    renameItem.addEventListener('click', (event) => {
      event.stopPropagation();
      const evt = new CustomEvent('open-edit-list-modal', { detail: { listId: list.id } });
      document.dispatchEvent(evt);
      state.openListMenuId = null;
      renderLists();
    });
    menu.appendChild(renameItem);

    const deleteItem = document.createElement('button');
    deleteItem.className = 'list-menu-item list-menu-danger';
    deleteItem.textContent = 'Delete list';
    deleteItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      const confirmDelete = await window.electronAPI.confirmDeleteList(list.name);
      if (!confirmDelete) {
        state.openListMenuId = null;
        renderLists();
        return;
      }
      try {
        await window.electronAPI.deleteList(list.id);
        state.lists = state.lists.filter((l) => l.id !== list.id);
        state.tasks = state.tasks.filter((t) => t.listId !== list.id);
        if (state.selectedListId === list.id) {
          state.selectedListId = null;
        }
        if (state.addTaskSelectedListId === list.id) {
          state.addTaskSelectedListId = null;
        }
        state.openListMenuId = null;
        renderLists();
        renderTasks();
        renderListOptions(refs.addTaskListSelect, state.addTaskSelectedListId ?? state.selectedListId);
        updateTasksTitle();
      } catch (error) {
        console.error('Failed to delete list', error);
      }
    });
    menu.appendChild(deleteItem);

    item.appendChild(menuBtn);
    item.appendChild(menu);
    item.addEventListener('click', () => {
      state.selectedListId = list.id;
      state.addTaskSelectedListId = list.id;
      updateTasksTitle();
      renderLists();
      renderListOptions(refs.addTaskListSelect, state.addTaskSelectedListId);
      renderTasks();
    });
    item.addEventListener('dragstart', (event) => {
      state.listDragIndex = Number(item.dataset.index);
      item.classList.add('dragging');
      const dt = event.dataTransfer;
      dt?.setData('text/plain', String(state.listDragIndex));
      if (dt) {
        dt.effectAllowed = 'move';
        const dragImage = item.cloneNode(true) as HTMLElement;
        dragImage.style.position = 'absolute';
        dragImage.style.top = '-9999px';
        dragImage.style.left = '-9999px';
        dragImage.style.width = `${item.getBoundingClientRect().width}px`;
        dragImage.style.boxSizing = 'border-box';
        document.body.appendChild(dragImage);
        const rect = item.getBoundingClientRect();
        const offsetX = Math.min(Math.max(event.clientX - rect.left, 12), rect.width - 12);
        const offsetY = Math.min(Math.max(event.clientY - rect.top, 12), rect.height - 12);
        dt.setDragImage(dragImage, offsetX, offsetY);
        requestAnimationFrame(() => dragImage.remove());
      }
    });

    item.addEventListener('dragend', () => {
      state.listDragIndex = null;
      state.listDropIndex = null;
      item.classList.remove('dragging');
      removeListDropIndicator();
    });

    item.addEventListener('dragover', (event) => {
      event.preventDefault();
      const targetIndex = Number(item.dataset.index);
      const isBefore = event.clientY < item.getBoundingClientRect().top + item.offsetHeight / 2;
      const nextIndex = isBefore ? targetIndex : targetIndex + 1;
      if (state.listDropIndex === nextIndex) {
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'move';
        }
        return;
      }
      state.listDropIndex = nextIndex;
      removeListDropIndicator();
      if (item.parentNode) {
        if (isBefore) {
          item.parentNode.insertBefore(listDropIndicator, item);
        } else {
          item.parentNode.insertBefore(listDropIndicator, item.nextSibling);
        }
      }
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
    });
    item.addEventListener('drop', (event) => {
      event.preventDefault();
      removeListDropIndicator();
      if (state.listDragIndex === null || state.listDropIndex === null) return;
      if (state.listDragIndex === state.listDropIndex || state.listDragIndex + 1 === state.listDropIndex) {
        state.listDragIndex = null;
        state.listDropIndex = null;
        return;
      }
      const [moved] = state.lists.splice(state.listDragIndex, 1);
      const adjustedIndex = state.listDragIndex < state.listDropIndex ? state.listDropIndex - 1 : state.listDropIndex;
      state.lists.splice(adjustedIndex, 0, moved);
      state.listDragIndex = null;
      state.listDropIndex = null;
      renderLists();
      saveListOrder();
    });
    item.addEventListener('dblclick', () => {
      const event = new CustomEvent('open-edit-list-modal', { detail: { listId: list.id } });
      document.dispatchEvent(event);
    });
    container.appendChild(item);
  });

  container.ondragover = (event) => {
    if (state.lists.length === 0) {
      event.preventDefault();
      const dragEvent = event as DragEvent;
      state.listDropIndex = 0;
      removeListDropIndicator();
      container.appendChild(listDropIndicator);
      if (dragEvent.dataTransfer) {
        dragEvent.dataTransfer.dropEffect = 'move';
      }
    }
  };
  container.ondrop = (event) => {
    if (state.lists.length === 0) {
      event.preventDefault();
      if (state.listDragIndex === null || state.listDropIndex === null) {
        removeListDropIndicator();
        return;
      }
      const [moved] = state.lists.splice(state.listDragIndex, 1);
      const adjustedIndex = state.listDragIndex < state.listDropIndex ? state.listDropIndex - 1 : state.listDropIndex;
      state.lists.splice(adjustedIndex, 0, moved);
      state.listDragIndex = null;
      state.listDropIndex = null;
      renderLists();
      saveListOrder();
      removeListDropIndicator();
    }
  };
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
