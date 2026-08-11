import type { List } from '../types.js';
import { refs } from './dom.js';
import { renderTasks } from './tasks.js';
import { isListInView } from './currentView.js';
import { renderViewBar } from './viewBar.js';

/**
 * Selecting a list is a view change, and index.ts owns those -- it is the only module that can
 * reach the search field, the smart-list panel and the task list at once. Dispatching rather
 * than calling is what keeps this module free of those imports.
 */
const selectView = (listId: number | null) => {
  document.dispatchEvent(new CustomEvent('select-list', { detail: { listId } }));
};
import { state } from './state.js';
import { makePillActivatable, revealInScroller } from './helpers.js';
import { attachPillDnD, makeDragHandle, moveItem } from './pillDnD.js';

const truncateListName = (text: string) => {
  const truncated = text.length > 30 ? `${text.slice(0, 30)}...` : text;
  return {
    label: truncated,
    title: truncated !== text ? text : '',
  };
};

const makeLabel = (text: string) => {
  const span = document.createElement('span');
  span.className = 'list-pill-label';
  const { label, title } = truncateListName(text);
  span.textContent = label;
  if (title) {
    span.title = title;
  }
  return span;
};

const saveListOrder = async () => {
  try {
    const orderedIds = state.lists.map((l) => l.id);
    await window.electronAPI.updateListOrder(orderedIds);
  } catch (error) {
    console.error('Failed to save list order', error);
  }
};

/**
 * The edit modal's list field: "No list" plus the lists, and never a smart list -- a task
 * belongs to a list or to nothing. The *view* picker is a different menu, built in viewBar.ts,
 * because it answers a different question.
 */
export const renderListOptions = (
  target: HTMLSelectElement | HTMLDivElement | null,
  selectedId: number | null,
  labelEl: HTMLSpanElement | null = null
) => {
  if (!target) return;
  const selectedValue = selectedId !== null ? String(selectedId) : '';
  const entries = [
    { value: '', label: 'No list', title: '' },
    ...state.lists.map((list) => {
      const { label, title } = truncateListName(list.name);
      return { value: String(list.id), label, title: title || list.name };
    }),
  ];
  const activeValue = entries.some((entry) => entry.value === selectedValue) ? selectedValue : '';

  if (target instanceof HTMLSelectElement) {
    target.innerHTML = '';
    entries.forEach((entry) => {
      const option = document.createElement('option');
      option.value = entry.value;
      option.textContent = entry.label;
      if (entry.title && entry.title !== entry.label) {
        option.title = entry.title;
      }
      target.appendChild(option);
    });
    target.value = activeValue;
    return;
  }

  target.innerHTML = '';
  entries.forEach((entry) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'modal-list-item';
    item.dataset.value = entry.value;
    item.textContent = entry.label;
    if (entry.title && entry.title !== entry.label) {
      item.title = entry.title;
    }
    if (entry.value === activeValue) {
      item.classList.add('selected');
    }
    target.appendChild(item);
  });
  const selectedEntry = entries.find((entry) => entry.value === activeValue) ?? entries[0];
  const labelTarget = labelEl || refs.modalListLabel;
  if (labelTarget) {
    labelTarget.textContent = selectedEntry.label;
    labelTarget.title = selectedEntry.title || '';
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
  // the *view*, not the raw selection: while a search is running nothing here is lit, because
  // what is on screen is the search rather than any list
  const allSelected = isListInView(null);
  allItem.className = `list-pill${allSelected ? ' selected' : ''}`;
  makePillActivatable(allItem, allSelected);
  allItem.appendChild(makeLabel('All lists'));
  allItem.addEventListener('click', () => selectView(null));
  container.appendChild(allItem);

  if (state.lists.length === 0) {
    if (refs.listsEmpty) {
      container.appendChild(refs.listsEmpty);
    }
    return;
  }

  state.lists.forEach((list) => {
    const item = document.createElement('div');
    const isSelected = isListInView(list.id);
    item.className = `list-pill${isSelected ? ' selected' : ''}`;
    makePillActivatable(item, isSelected);
    const index = state.lists.findIndex((l) => l.id === list.id);
    attachPillDnD({
      kind: 'list',
      item,
      index,
      reorder: (from, to) => {
        moveItem(state.lists, from, to);
        renderLists();
        // the view picker names every list in array order, so it has to follow the sidebar
        renderViewBar();
        saveListOrder();
      },
    });

    const label = makeLabel(list.name);
    item.appendChild(makeDragHandle());
    item.appendChild(label);

    // matches the tags panel, which has always shown a count
    const count = document.createElement('span');
    count.className = 'tag-count';
    count.textContent = String(state.tasks.filter((t) => !t.done && t.listId === list.id).length);
    item.appendChild(count);

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
    const menuOpen = state.openListMenuId === list.id;
    menu.style.display = menuOpen ? 'flex' : 'none';
    // the panel below would otherwise paint over a menu that hangs past this one's bottom
    // edge, and the rail's own scroller would clip it there
    menu.classList.toggle('open', menuOpen);
    if (menuOpen) revealInScroller(menu);
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
        // the deleted list cannot stay selected, and the title picker has to say so
        if (state.selectedListId === list.id) {
          state.selectedListId = null;
        }
        state.openListMenuId = null;
        renderLists();
        renderTasks();
        renderViewBar();
      } catch (error) {
        console.error('Failed to delete list', error);
      }
    });
    menu.appendChild(deleteItem);

    item.appendChild(menuBtn);
    item.appendChild(menu);
    item.addEventListener('click', () => selectView(list.id));
    item.addEventListener('dblclick', () => {
      const event = new CustomEvent('open-edit-list-modal', { detail: { listId: list.id } });
      document.dispatchEvent(event);
    });
    container.appendChild(item);
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
  renderViewBar();
};
