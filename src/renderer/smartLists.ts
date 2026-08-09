// Smart-list sidebar panel. A smart list is only a named query string: clicking one loads
// it into the search field in Query mode, so there is no separate filtering path -- the normal
// advanced-search machinery does all the work.
import { refs } from './dom.js';
import { makePillActivatable } from './helpers.js';
import {
  associatedSmartList,
  clearSmartListOrigin,
  invalidateSmartListUI,
  syncSmartListUI,
} from './activeSmartList.js';
import { renderQueryBar } from './queryBar.js';
import { state } from './state.js';

export const toggleSmartListsExpanded = () => {
  state.smartListsExpanded = !state.smartListsExpanded;
  const icon = refs.smartListsToggle?.querySelector('svg path:first-of-type');
  const icon2 = refs.smartListsToggle?.querySelector('svg path:last-of-type');
  if (state.smartListsExpanded) {
    icon?.setAttribute('d', 'M2 3 L7 8 L12 3');
    icon2?.setAttribute('d', 'M2 8 L7 13 L12 8');
  } else {
    icon?.setAttribute('d', 'M2 8 L7 3 L12 8');
    icon2?.setAttribute('d', 'M2 13 L7 8 L12 13');
  }
  renderSmartLists();
};

export const renderSmartLists = () => {
  if (!refs.smartListsList) return;
  const container = refs.smartListsList;
  container.innerHTML = '';
  if (!state.smartListsExpanded) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';

  if (state.smartLists.length === 0) {
    if (refs.smartListsEmpty) {
      container.appendChild(refs.smartListsEmpty);
    }
    return;
  }

  // the association, not the exact match: editing a saved query is how you edit a smart list,
  // and dropping the highlight mid-edit would say the user had left it
  const associated = associatedSmartList();

  state.smartLists.forEach((smartList) => {
    const item = document.createElement('div');
    const isSelected = associated?.smartList.id === smartList.id;
    item.className = `list-pill smart-list-pill${isSelected ? ' selected' : ''}`;
    makePillActivatable(item, isSelected);

    const label = document.createElement('span');
    label.className = 'list-pill-label';
    label.textContent = smartList.name;
    label.title = smartList.query;
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
      state.openSmartListMenuId =
        state.openSmartListMenuId === smartList.id ? null : smartList.id;
      renderSmartLists();
    });

    const menu = document.createElement('div');
    menu.className = 'list-menu';
    menu.style.display = state.openSmartListMenuId === smartList.id ? 'flex' : 'none';
    menu.addEventListener('click', (event) => event.stopPropagation());

    const editItem = document.createElement('button');
    editItem.className = 'list-menu-item';
    editItem.textContent = 'Edit smart list';
    editItem.addEventListener('click', (event) => {
      event.stopPropagation();
      document.dispatchEvent(
        new CustomEvent('open-smart-list-modal', { detail: { smartListId: smartList.id } })
      );
      state.openSmartListMenuId = null;
      renderSmartLists();
    });
    menu.appendChild(editItem);

    const deleteItem = document.createElement('button');
    deleteItem.className = 'list-menu-item list-menu-danger';
    deleteItem.textContent = 'Delete smart list';
    deleteItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      const confirmDelete = await window.electronAPI.confirmDeleteSmartList(smartList.name);
      if (!confirmDelete) {
        state.openSmartListMenuId = null;
        renderSmartLists();
        return;
      }
      try {
        await window.electronAPI.deleteSmartList(smartList.id);
        state.smartLists = state.smartLists.filter((f) => f.id !== smartList.id);
        state.openSmartListMenuId = null;
        // the query itself is deliberately left in the search bar: deleting the name should
        // not also throw away the results the user is looking at. The bar's identity must
        // still come down, and syncSmartListUI's memo would swallow that without the
        // invalidate -- nothing about the *query* changed, only what it is called.
        if (state.smartListOrigin === smartList.id) clearSmartListOrigin();
        invalidateSmartListUI();
        syncSmartListUI(renderSmartLists);
        renderQueryBar();
      } catch (error) {
        console.error('Failed to delete smart list', error);
      }
    });
    menu.appendChild(deleteItem);

    item.appendChild(menuBtn);
    item.appendChild(menu);
    item.addEventListener('click', () => {
      document.dispatchEvent(
        new CustomEvent('run-smart-list', { detail: { smartListId: smartList.id } })
      );
    });
    container.appendChild(item);
  });
};

export const loadSmartLists = async () => {
  try {
    const smartLists = await window.electronAPI.getSmartLists();
    state.smartLists = smartLists ?? [];
    renderSmartLists();
  } catch (error) {
    console.error('Failed to load smart lists', error);
  }
};
