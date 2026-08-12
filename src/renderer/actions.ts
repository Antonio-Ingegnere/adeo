import type { Tag, Task } from '../types';
import {
  activeTemplate,
  missingTemplateTagNames,
  renderTemplateHints,
  resolveTemplateNames,
  templateSeed,
} from './activeSmartList.js';
import { refs } from './dom.js';
import { renderLists } from './lists.js';
import { mergeTag, renderTags, sortTags } from './tags.js';
import { renderPendingTags } from './tagInput.js';
import { setKeymap } from './shortcuts.js';
import { renderShortcutHints } from './shortcutHints.js';
import { renderTasks } from './tasks.js';
import { renderViewBar } from './viewBar.js';
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

  // a smart list can name a tag that does not exist yet; create it the same way an inline
  // #token would, so "add a task to this smart list" works on one written ahead of time
  const template = activeTemplate();
  missingTemplateTagNames(template).forEach((name) => {
    if (!tokenNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
      tokenNames.push(name);
    }
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

  // the smart list's list wins over the sidebar selection: it is the more specific statement of
  // where the user means this task to go
  const resolved = template ? resolveTemplateNames(template) : null;
  const listId =
    resolved && resolved.listId !== undefined
      ? resolved.listId
      : state.selectedListId;
  // tags the smart list names that already existed; the rest were just created above
  resolved?.tagIds.forEach((id) => {
    if (!tagIds.includes(id)) tagIds.push(id);
  });

  try {
    const createdTask = await window.electronAPI.addTask(
      text,
      listId,
      tagIds,
      templateSeed(template)
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
    // forced: creating a named-but-missing tag changes what is still unapplied, and the query
    // the hints memoize on has not moved
    renderTemplateHints(true);
    input.value = '';
    input.focus();
    // the title carries the search result count, which is now one out of date
    renderViewBar();
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
    state.shortcutOverrides = settings.shortcuts ?? {};
    setKeymap(state.shortcutOverrides);
    renderShortcutHints();
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
    renderViewBar();
    renderViewBar();
  } catch (error) {
    console.error('Failed to load lists', error);
  }
};
