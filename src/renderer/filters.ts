// Saved-filter sidebar panel. A saved filter is only a named query string: clicking one loads
// it into the search field in Query mode, so there is no separate filtering path -- the normal
// advanced-search machinery does all the work.
import { refs } from './dom.js';
import { makePillActivatable } from './helpers.js';
import { activeFilter } from './activeFilter.js';
import { state } from './state.js';

export const toggleFiltersExpanded = () => {
  state.filtersExpanded = !state.filtersExpanded;
  const icon = refs.filtersToggle?.querySelector('svg path:first-of-type');
  const icon2 = refs.filtersToggle?.querySelector('svg path:last-of-type');
  if (state.filtersExpanded) {
    icon?.setAttribute('d', 'M2 3 L7 8 L12 3');
    icon2?.setAttribute('d', 'M2 8 L7 13 L12 8');
  } else {
    icon?.setAttribute('d', 'M2 8 L7 3 L12 8');
    icon2?.setAttribute('d', 'M2 13 L7 8 L12 13');
  }
  renderFilters();
};

export const renderFilters = () => {
  if (!refs.filtersList) return;
  const container = refs.filtersList;
  container.innerHTML = '';
  if (!state.filtersExpanded) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';

  if (state.filters.length === 0) {
    if (refs.filtersEmpty) {
      container.appendChild(refs.filtersEmpty);
    }
    return;
  }

  const running = activeFilter();

  state.filters.forEach((filter) => {
    const item = document.createElement('div');
    const isSelected = running?.id === filter.id;
    item.className = `list-pill filter-pill${isSelected ? ' selected' : ''}`;
    makePillActivatable(item, isSelected);

    const label = document.createElement('span');
    label.className = 'list-pill-label';
    label.textContent = filter.name;
    label.title = filter.query;
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
      state.openFilterMenuId = state.openFilterMenuId === filter.id ? null : filter.id;
      renderFilters();
    });

    const menu = document.createElement('div');
    menu.className = 'list-menu';
    menu.style.display = state.openFilterMenuId === filter.id ? 'flex' : 'none';
    menu.addEventListener('click', (event) => event.stopPropagation());

    const editItem = document.createElement('button');
    editItem.className = 'list-menu-item';
    editItem.textContent = 'Edit filter';
    editItem.addEventListener('click', (event) => {
      event.stopPropagation();
      document.dispatchEvent(new CustomEvent('open-edit-filter-modal', { detail: { filterId: filter.id } }));
      state.openFilterMenuId = null;
      renderFilters();
    });
    menu.appendChild(editItem);

    const deleteItem = document.createElement('button');
    deleteItem.className = 'list-menu-item list-menu-danger';
    deleteItem.textContent = 'Delete filter';
    deleteItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      const confirmDelete = await window.electronAPI.confirmDeleteFilter(filter.name);
      if (!confirmDelete) {
        state.openFilterMenuId = null;
        renderFilters();
        return;
      }
      try {
        await window.electronAPI.deleteFilter(filter.id);
        state.filters = state.filters.filter((f) => f.id !== filter.id);
        state.openFilterMenuId = null;
        // the query itself is deliberately left in the search bar: deleting the bookmark
        // should not also throw away the results the user is looking at
        renderFilters();
      } catch (error) {
        console.error('Failed to delete filter', error);
      }
    });
    menu.appendChild(deleteItem);

    item.appendChild(menuBtn);
    item.appendChild(menu);
    item.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('run-saved-filter', { detail: { filterId: filter.id } }));
    });
    container.appendChild(item);
  });
};

export const loadFilters = async () => {
  try {
    const filters = await window.electronAPI.getFilters();
    state.filters = filters ?? [];
    renderFilters();
  } catch (error) {
    console.error('Failed to load filters', error);
  }
};
