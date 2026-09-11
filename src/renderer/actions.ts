import type { Tag, Task, TaskSeed } from '../types';
import {
  activeTemplate,
  missingTemplateTagNames,
  renderTemplateHints,
  resolveComposeDestination,
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
import {
  composeSeed,
  paintComposeListLabel,
  resetComposeOptions,
  syncComposeMetaRow,
} from './composeOptions.js';
import { announceComposeSuccess, showComposeError } from './composeFeedback.js';
import { applySidebarSections, stashSidebarUi } from './sidebarUiState.js';
import { setLocale, t } from './i18n/index.js';

const INLINE_TAG_RE = /(^|\s)#([A-Za-z0-9_-]+)/g;

export const addTask = async () => {
  const input = refs.input;
  if (!input) return;
  const raw = input.value;

  const tokenNames: string[] = [];
  const stripped = raw.replace(INLINE_TAG_RE, (_match, lead: string, name: string) => {
    tokenNames.push(name);
    return lead;
  });
  const text = stripped.replace(/\s+/g, ' ').trim();

  // Checked before anything is created: a blank submit must be a true no-op, not a task that
  // silently fails to appear alongside a tag that silently does.
  if (!text) {
    showComposeError('Enter a task before adding.');
    input.focus();
    return;
  }

  const tagIds = [...state.pendingTagIds];

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

  // the smart list's list wins over the sidebar selection, and an explicit compose choice wins
  // over both -- each is a more specific statement of where the user means this task to go.
  // resolveComposeDestination() is the same computation the Task list trigger's label uses.
  const resolved = template ? resolveTemplateNames(template) : null;
  const listId = resolveComposeDestination();
  // tags the smart list names that already existed; the rest were just created above
  resolved?.tagIds.forEach((id) => {
    if (!tagIds.includes(id)) tagIds.push(id);
  });

  // an explicit Options value beats the template-derived one, field by field
  const mergedSeed: TaskSeed = { ...templateSeed(template), ...composeSeed() };
  if (mergedSeed.repeatRule && mergedSeed.reminderDate) {
    // templateSeed derives repeatStart from *its own* reminderDate/today; if a compose
    // reminder date just overrode that field, repeatStart has to follow it or the two disagree.
    mergedSeed.repeatStart = mergedSeed.reminderDate;
  }
  const seed = Object.keys(mergedSeed).length ? mergedSeed : undefined;

  try {
    const createdTask = await window.electronAPI.addTask(text, listId, tagIds, seed);
    if (!createdTask || (createdTask as any).error) {
      showComposeError('Couldn’t add the task. Your draft is kept — try Add again.');
      input.focus();
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
    // the hints memoize on has not moved; resetComposeOptions() below repaints once more with
    // the options cleared, so this is the pre-reset state and that is the post-reset state.
    renderTemplateHints(true);
    const listLabel =
      listId === null ? t('compose.noList') : state.lists.find((l) => l.id === listId)?.name ?? t('compose.noList');
    resetComposeOptions();
    syncComposeMetaRow();
    input.value = '';
    input.focus();
    announceComposeSuccess(text, listLabel);
    // the title carries the search result count, which is now one out of date
    renderViewBar();
    renderTasks();
  } catch (error) {
    console.error('Failed to add task', error);
    showComposeError('Couldn’t add the task. Your draft is kept — try Add again.');
    input.focus();
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
    state.tagColors = settings.tagColors ?? true;
    // Swaps the active dictionary and repaints every data-i18n-tagged element immediately;
    // setLocale() itself falls back to English for anything not in SUPPORTED_LOCALES.
    state.locale = settings.locale ?? 'en';
    setLocale(state.locale);
    state.shortcutOverrides = settings.shortcuts ?? {};
    // Restored sidebar expand/collapse is applied now, before the first sidebar render;
    // the saved selection is replayed after lists / smart lists / boards load (init()).
    if (settings.sidebarUi) {
      applySidebarSections(settings.sidebarUi);
      stashSidebarUi(settings.sidebarUi);
    }
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
    // a rename/delete can change the name the un-overridden Task list trigger resolves to
    paintComposeListLabel();
  } catch (error) {
    console.error('Failed to load lists', error);
  }
};
