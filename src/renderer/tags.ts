import type { Tag } from '../types.js';
import { refs } from './dom.js';
import { renderTasks, updateTasksTitle } from './tasks.js';
import { state } from './state.js';
import { makePillActivatable } from './helpers.js';

const truncateTagName = (text: string) => {
  const truncated = text.length > 30 ? `${text.slice(0, 30)}...` : text;
  return {
    label: truncated,
    title: truncated !== text ? text : '',
  };
};

export const sortTags = () => {
  state.tags.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id - b.id);
};

export const mergeTag = (tag: Tag) => {
  const existing = state.tags.find((t) => t.id === tag.id);
  if (existing) {
    existing.name = tag.name;
    existing.color = tag.color;
  } else {
    state.tags.push(tag);
  }
  sortTags();
};

export const detachDeletedTag = (tagId: number) => {
  state.tags = state.tags.filter((t) => t.id !== tagId);
  state.tasks.forEach((task) => {
    if (task.tagIds?.includes(tagId)) {
      task.tagIds = task.tagIds.filter((id) => id !== tagId);
    }
  });
  state.modalTagIds = state.modalTagIds.filter((id) => id !== tagId);
  state.pendingTagIds = state.pendingTagIds.filter((id) => id !== tagId);
  if (state.selectedTagId === tagId) {
    state.selectedTagId = null;
  }
};

export const toggleTagsExpanded = () => {
  state.tagsExpanded = !state.tagsExpanded;
  const icon = refs.tagsToggle?.querySelector('svg path:first-of-type');
  const icon2 = refs.tagsToggle?.querySelector('svg path:last-of-type');
  if (state.tagsExpanded) {
    icon?.setAttribute('d', 'M2 3 L7 8 L12 3');
    icon2?.setAttribute('d', 'M2 8 L7 13 L12 8');
  } else {
    icon?.setAttribute('d', 'M2 8 L7 3 L12 8');
    icon2?.setAttribute('d', 'M2 13 L7 8 L12 13');
  }
  renderTags();
};

const openTaskCount = (tagId: number) =>
  state.tasks.filter((t) => !t.done && (t.tagIds ?? []).includes(tagId)).length;

export const renderTags = () => {
  if (!refs.tagsList) return;
  const container = refs.tagsList;
  container.innerHTML = '';
  if (!state.tagsExpanded) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';

  if (state.tags.length === 0) {
    if (refs.tagsEmpty) {
      container.appendChild(refs.tagsEmpty);
    }
    return;
  }

  state.tags.forEach((tag) => {
    const item = document.createElement('div');
    const isSelected = state.selectedTagId === tag.id;
    item.className = `list-pill tag-pill${isSelected ? ' selected' : ''}`;
    makePillActivatable(item, isSelected);

    const dot = document.createElement('span');
    dot.className = 'tag-dot';
    dot.style.background = tag.color;
    item.appendChild(dot);

    const label = document.createElement('span');
    label.className = 'list-pill-label';
    const { label: text, title } = truncateTagName(tag.name);
    label.textContent = text;
    if (title) {
      label.title = title;
    }
    item.appendChild(label);

    const count = document.createElement('span');
    count.className = 'tag-count';
    count.textContent = String(openTaskCount(tag.id));
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
      state.openTagMenuId = state.openTagMenuId === tag.id ? null : tag.id;
      renderTags();
    });

    const menu = document.createElement('div');
    menu.className = 'list-menu';
    const menuOpen = state.openTagMenuId === tag.id;
    menu.style.display = menuOpen ? 'flex' : 'none';
    // see the note in lists.ts: the panel below would otherwise paint over this menu
    menu.classList.toggle('open', menuOpen);
    menu.addEventListener('click', (event) => event.stopPropagation());

    const renameItem = document.createElement('button');
    renameItem.className = 'list-menu-item';
    renameItem.textContent = 'Rename tag';
    renameItem.addEventListener('click', (event) => {
      event.stopPropagation();
      const evt = new CustomEvent('open-edit-tag-modal', { detail: { tagId: tag.id } });
      document.dispatchEvent(evt);
      state.openTagMenuId = null;
      renderTags();
    });
    menu.appendChild(renameItem);

    const deleteItem = document.createElement('button');
    deleteItem.className = 'list-menu-item list-menu-danger';
    deleteItem.textContent = 'Delete tag';
    deleteItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      const confirmDelete = await window.electronAPI.confirmDeleteTag(tag.name);
      if (!confirmDelete) {
        state.openTagMenuId = null;
        renderTags();
        return;
      }
      try {
        await window.electronAPI.deleteTag(tag.id);
        detachDeletedTag(tag.id);
        state.openTagMenuId = null;
        updateTasksTitle();
        renderTags();
        renderTasks();
      } catch (error) {
        console.error('Failed to delete tag', error);
      }
    });
    menu.appendChild(deleteItem);

    item.appendChild(menuBtn);
    item.appendChild(menu);
    item.addEventListener('click', () => {
      state.selectedTagId = state.selectedTagId === tag.id ? null : tag.id;
      updateTasksTitle();
      renderTags();
      renderTasks();
    });
    container.appendChild(item);
  });
};
