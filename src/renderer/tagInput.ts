import type { Tag } from '../types.js';
import { refs } from './dom.js';
import { positionDropdown } from './helpers.js';
import { mergeTag, renderTags } from './tags.js';
import { state } from './state.js';

const TOKEN_RE = /(^|\s)#([A-Za-z0-9_-]*)$/;

type SuggestItem = { kind: 'tag'; tag: Tag } | { kind: 'create'; name: string };

let suggestOpen = false;
let suggestItems: SuggestItem[] = [];
let activeIndex = 0;
let tokenStart = 0;
let tokenEnd = 0;

export const isTagSuggestOpen = () => suggestOpen;

const closeSuggest = () => {
  suggestOpen = false;
  suggestItems = [];
  if (refs.tagSuggestMenu) {
    refs.tagSuggestMenu.style.display = 'none';
  }
};

export const renderPendingTags = () => {
  if (!refs.addTaskTags) return;
  const container = refs.addTaskTags;
  container.innerHTML = '';
  state.pendingTagIds.forEach((tagId) => {
    const tag = state.tags.find((t) => t.id === tagId);
    if (!tag) return;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'task-tag-chip add-task-tag-chip';
    chip.style.background = tag.color;
    chip.title = 'Remove tag';
    chip.textContent = `#${tag.name} ✕`;
    chip.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.pendingTagIds = state.pendingTagIds.filter((id) => id !== tagId);
      renderPendingTags();
      refs.input?.focus();
    });
    container.appendChild(chip);
  });
};

const renderSuggestMenu = () => {
  if (!refs.tagSuggestMenu || !refs.input) return;
  const menu = refs.tagSuggestMenu;
  menu.innerHTML = '';
  suggestItems.forEach((item, index) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `tag-suggest-item${index === activeIndex ? ' active' : ''}`;
    if (item.kind === 'tag') {
      const dot = document.createElement('span');
      dot.className = 'tag-dot';
      dot.style.background = item.tag.color;
      el.appendChild(dot);
      el.appendChild(document.createTextNode(`#${item.tag.name}`));
    } else {
      el.appendChild(document.createTextNode(`Create "#${item.name}"`));
    }
    el.addEventListener('mousedown', (event) => {
      // mousedown, not click: fires before the input loses focus
      event.preventDefault();
      event.stopPropagation();
      selectSuggestion(index);
    });
    menu.appendChild(el);
  });
  positionDropdown(menu, refs.input);
};

const updateSuggestions = () => {
  const input = refs.input;
  if (!input || !refs.tagSuggestMenu) return;
  const caret = input.selectionStart ?? input.value.length;
  const match = TOKEN_RE.exec(input.value.slice(0, caret));
  if (!match) {
    closeSuggest();
    return;
  }
  const query = match[2];
  tokenStart = caret - query.length - 1;
  tokenEnd = caret;
  const lower = query.toLowerCase();
  const prefix = state.tags.filter((t) => t.name.toLowerCase().startsWith(lower));
  const contains = state.tags.filter(
    (t) => !t.name.toLowerCase().startsWith(lower) && t.name.toLowerCase().includes(lower)
  );
  const matches = [...prefix, ...contains].slice(0, 6);
  suggestItems = matches.map((tag) => ({ kind: 'tag', tag }));
  const hasExact = state.tags.some((t) => t.name.toLowerCase() === lower);
  if (query && !hasExact) {
    suggestItems.push({ kind: 'create', name: query });
  }
  if (suggestItems.length === 0) {
    closeSuggest();
    return;
  }
  activeIndex = 0;
  suggestOpen = true;
  renderSuggestMenu();
};

const selectSuggestion = async (index: number) => {
  const input = refs.input;
  const item = suggestItems[index];
  if (!input || !item) return;
  const start = tokenStart;
  const end = tokenEnd;
  closeSuggest();
  let tag: Tag | null = null;
  if (item.kind === 'tag') {
    tag = item.tag;
  } else {
    try {
      const created = await window.electronAPI.addTag(item.name);
      if (!created || (created as any).error) return;
      tag = created as Tag;
      mergeTag(tag);
      renderTags();
    } catch (error) {
      console.error('Failed to create tag', error);
      return;
    }
  }
  if (!state.pendingTagIds.includes(tag.id)) {
    state.pendingTagIds.push(tag.id);
  }
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  const needsSpace = before.endsWith(' ') && after.startsWith(' ');
  input.value = before + (needsSpace ? after.slice(1) : after);
  input.setSelectionRange(start, start);
  input.focus();
  renderPendingTags();
};

export const setupTagInput = () => {
  const input = refs.input;
  if (!input) return;

  input.addEventListener('input', updateSuggestions);
  input.addEventListener('click', updateSuggestions);

  input.addEventListener('keydown', (event) => {
    if (!suggestOpen) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % suggestItems.length;
      renderSuggestMenu();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + suggestItems.length) % suggestItems.length;
      renderSuggestMenu();
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      selectSuggestion(activeIndex);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      closeSuggest();
    }
  });

  input.addEventListener('blur', () => {
    // slight delay so a mousedown on a suggestion can complete first
    setTimeout(() => closeSuggest(), 100);
  });
};
