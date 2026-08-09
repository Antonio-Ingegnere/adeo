import type { Tag, Task } from '../types';
import { refs } from './dom.js';
import { renderLists, renderListOptions } from './lists.js';
import { mergeTag, renderTags, sortTags } from './tags.js';
import { renderPendingTags } from './tagInput.js';
import { renderTasks, updateTasksTitle } from './tasks.js';
import { state } from './state.js';

const INLINE_TAG_RE = /(^|\s)#([A-Za-z0-9_-]+)/g;

export const addTask = async () => {
  const input = refs.input;
  if (!input) return;
  const raw = input.value;

  const tagIds = [...state.pendingTagIds];
  const tokenNames: string[] = [];
  const stripped = raw.replace(INLINE_TAG_RE, (_match, lead: string, name: string) => {
    tokenNames.push(name);
    return lead;
  });

  for (const name of tokenNames) {
    try {
      const created = await window.electronAPI.addTag(name);
      if (created && !(created as any).error) {
        const tag = created as Tag;
        mergeTag(tag);
        if (!tagIds.includes(tag.id)) {
          tagIds.push(tag.id);
        }
      }
    } catch (error) {
      console.error('Failed to resolve tag', error);
    }
  }

  const text = stripped.replace(/\s+/g, ' ').trim();
  if (!text) {
    if (tokenNames.length) {
      renderTags();
    }
    return;
  }

  try {
    const createdTask = await window.electronAPI.addTask(
      text,
      state.addTaskSelectedListId ?? state.selectedListId,
      tagIds
    );
    if (!createdTask || (createdTask as any).error) {
      return;
    }

    state.tasks.push({
      ...(createdTask as Task),
      priority: (createdTask as any).priority ?? 'none',
      tagIds: (createdTask as any).tagIds ?? tagIds,
    });
    state.pendingTagIds = [];
    renderPendingTags();
    input.value = '';
    input.focus();
    renderTasks();
  } catch (error) {
    console.error('Failed to add task', error);
  }
};

export const loadTasks = async () => {
  try {
    const existingTasks = await window.electronAPI.getTasks();
    state.tasks.splice(0, state.tasks.length, ...existingTasks);
    state.tasks.forEach((t) => {
      if ((t as any).listId === undefined) {
        t.listId = null;
      }
      if (!(t as any).priority) {
        (t as any).priority = 'none';
      }
      if ((t as any).reminderDate === undefined) {
        (t as any).reminderDate = null;
      }
      if ((t as any).reminderTime === undefined) {
        (t as any).reminderTime = null;
      }
      if ((t as any).repeatRule === undefined) {
        (t as any).repeatRule = null;
      }
      if ((t as any).repeatStart === undefined) {
        (t as any).repeatStart = null;
      }
      if (!Array.isArray((t as any).tagIds)) {
        (t as any).tagIds = [];
      }
    });
    renderTasks();
  } catch (error) {
    console.error('Failed to load tasks', error);
  }
};

export const loadSettings = async () => {
  try {
    const settings = await window.electronAPI.getSettings();
    state.showCompleted = settings.showCompleted;
    state.timeFormat = settings.timeFormat ?? '12h';
    state.dateFormat = settings.dateFormat ?? state.dateFormat;
    // only used to seed the Settings radio; the theme itself is applied in the main
    // process via nativeTheme.themeSource, which drives prefers-color-scheme here
    state.theme = settings.theme ?? 'system';
    renderTasks();
  } catch (error) {
    console.error('Failed to load settings', error);
  }
};

export const loadTags = async () => {
  try {
    const existingTags = await window.electronAPI.getTags();
    state.tags.splice(0, state.tags.length, ...(existingTags ?? []));
    sortTags();
    renderTags();
  } catch (error) {
    console.error('Failed to load tags', error);
  }
};

export const loadLists = async () => {
  try {
    const existingLists = await window.electronAPI.getLists();
    state.lists = (existingLists ?? []).map((l, idx) => ({
      ...l,
      position: typeof l.position === 'number' ? l.position : idx,
    }));
    state.lists.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id);
    renderLists();
    updateTasksTitle();
    renderListOptions(refs.addTaskListMenu, state.addTaskSelectedListId ?? state.selectedListId, refs.addTaskListLabel);
  } catch (error) {
    console.error('Failed to load lists', error);
  }
};
