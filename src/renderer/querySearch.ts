// Search-field wiring: simple/advanced mode toggle, live parse status, syntax
// help popover, and context-aware autocomplete for the advanced query mode.
// All listeners on the search input live here (single keydown owner).
import { refs } from './dom.js';
import { positionDropdown } from './helpers.js';
import { FIELDS, compilePredicate, parseQuery, queryUsesField, tokenize } from './query.js';
import type { FieldSpec, Token } from './query.js';
import { renderTasks, updateTasksTitle } from './tasks.js';
import { state } from './state.js';

const RENDER_DEBOUNCE_MS = 150;

const OP_HINTS: Record<string, string> = {
  ':': 'is',
  '~': 'contains',
  '!=': 'is not',
  '<': 'before',
  '<=': 'on or before',
  '>': 'after',
  '>=': 'on or after',
};

type SuggestItem = {
  label: string;
  hint?: string;
  color?: string;
  start: number;
  end: number;
  text: string;
  trailingSpace: boolean;
};

let renderTimer: number | null = null;
let suggestOpen = false;
let suggestItems: SuggestItem[] = [];
let activeIndex = 0;

export const isQuerySuggestOpen = () => suggestOpen;

const closeSuggest = () => {
  suggestOpen = false;
  suggestItems = [];
  if (refs.querySuggestMenu) {
    refs.querySuggestMenu.style.display = 'none';
  }
};

export const closeQueryPopovers = () => {
  closeSuggest();
  if (refs.searchHelpPopover) {
    refs.searchHelpPopover.style.display = 'none';
  }
};

const flushRender = () => {
  if (renderTimer !== null) {
    window.clearTimeout(renderTimer);
    renderTimer = null;
  }
  updateTasksTitle();
  renderTasks();
};

const scheduleRender = () => {
  if (renderTimer !== null) {
    window.clearTimeout(renderTimer);
  }
  renderTimer = window.setTimeout(() => {
    renderTimer = null;
    updateTasksTitle();
    renderTasks();
  }, RENDER_DEBOUNCE_MS);
};

const renderSearchStatus = () => {
  if (!refs.searchStatusText) return;
  const el = refs.searchStatusText;
  el.classList.remove('ok', 'err');
  if (!state.searchQuery.trim()) {
    el.textContent = 'field:value · AND OR NOT · ( ) — ? for help';
    el.title = '';
    return;
  }
  if (state.queryError) {
    el.classList.add('err');
    el.textContent = `⚠ ${state.queryError.message}`;
    el.title = `${state.queryError.message} (at column ${state.queryError.position + 1})`;
    return;
  }
  el.classList.add('ok');
  el.textContent = '✓ Valid query';
  el.title = '';
};

export const applySearchQuery = (value: string, immediate = false) => {
  state.searchQuery = value;
  if (refs.listsSearchClear) {
    refs.listsSearchClear.style.visibility = value ? 'visible' : 'hidden';
  }
  if (state.searchMode === 'advanced') {
    const trimmed = value.trim();
    if (!trimmed) {
      state.queryPredicate = null;
      state.queryError = null;
      state.queryUsesDone = false;
    } else {
      const result = parseQuery(trimmed);
      if (result.ok) {
        state.queryPredicate = compilePredicate(result.ast);
        state.queryError = null;
        state.queryUsesDone = queryUsesField(result.ast, 'done');
      } else {
        state.queryError = result.error; // keep last-good predicate (and its usesDone)
      }
    }
    renderSearchStatus();
    if (immediate) {
      flushRender();
    } else {
      scheduleRender();
    }
  } else {
    flushRender();
  }
};

const clearSearch = () => {
  closeSuggest();
  if (refs.listsSearchInput) {
    refs.listsSearchInput.value = '';
  }
  state.queryPredicate = null;
  state.queryError = null;
  state.queryUsesDone = false;
  applySearchQuery('', true);
};

// ---------- Mode toggle ----------

const applyModeUI = () => {
  const advanced = state.searchMode === 'advanced';
  refs.listsSearchInput?.classList.toggle('query-mode', advanced);
  if (refs.listsSearchInput) {
    refs.listsSearchInput.placeholder = advanced ? 'Query… e.g. list:Home AND due<=today' : 'Search';
  }
  if (refs.searchModeToggle) {
    refs.searchModeToggle.classList.toggle('active', advanced);
    refs.searchModeToggle.setAttribute('aria-pressed', advanced ? 'true' : 'false');
  }
  if (refs.searchStatus) {
    refs.searchStatus.style.display = advanced ? 'flex' : 'none';
  }
  if (!advanced) {
    closeQueryPopovers();
  }
};

const setMode = (mode: 'simple' | 'advanced') => {
  state.searchMode = mode;
  state.queryPredicate = null;
  state.queryError = null;
  state.queryUsesDone = false;
  applyModeUI();
  applySearchQuery(refs.listsSearchInput?.value ?? '', true);
};

// ---------- Autocomplete ----------

const fieldByName = new Map(FIELDS.map((f) => [f.name, f]));
const EXTENDABLE_OPS = new Set(['<', '>']);

const rankByPrefix = <T>(items: T[], prefix: string, label: (item: T) => string): T[] => {
  const lower = prefix.toLowerCase();
  const starts = items.filter((i) => label(i).toLowerCase().startsWith(lower));
  const contains = items.filter(
    (i) => !label(i).toLowerCase().startsWith(lower) && label(i).toLowerCase().includes(lower)
  );
  return [...starts, ...contains];
};

const needsQuoting = (value: string) => /[^A-Za-z0-9_#-]/.test(value);

const valueItem = (
  value: string,
  start: number,
  end: number,
  hint?: string,
  color?: string
): SuggestItem => ({
  label: value,
  hint,
  color,
  start,
  end,
  text: needsQuoting(value) ? `"${value}"` : value,
  trailingSpace: true,
});

const valueSuggestions = (field: FieldSpec, op: string, prefix: string, start: number, end: number): SuggestItem[] => {
  let candidates: SuggestItem[] = [];
  if (field.type === 'list') {
    candidates = state.lists.map((l) => valueItem(l.name, start, end));
    candidates.push(valueItem('none', start, end, 'no list'));
  } else if (field.type === 'tag') {
    candidates = state.tags.map((t) => valueItem(t.name, start, end, undefined, t.color));
    candidates.push(valueItem('none', start, end, 'no tags'), valueItem('any', start, end, 'has tags'));
  } else if (field.type === 'date') {
    const comparison = op !== ':' && op !== '!=';
    candidates = ['today', 'tomorrow', 'yesterday'].map((v) => valueItem(v, start, end));
    const now = new Date();
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    candidates.push(valueItem(iso, start, end));
    if (!comparison) {
      candidates.push(valueItem('none', start, end, 'no due date'), valueItem('any', start, end, 'has due date'));
    }
  } else {
    candidates = field.values.map((v) => valueItem(v, start, end));
  }
  return rankByPrefix(candidates, prefix, (i) => i.label).slice(0, 8);
};

const opSuggestions = (field: FieldSpec, prefix: string, start: number, end: number): SuggestItem[] => {
  const ops = field.ops.filter((op) => op.startsWith(prefix));
  return ops.map((op) => ({
    label: op,
    hint: OP_HINTS[op],
    start,
    end,
    text: op,
    trailingSpace: false,
  }));
};

const termStartSuggestions = (
  prefix: string,
  start: number,
  end: number,
  afterTerm: boolean
): SuggestItem[] => {
  const fields: SuggestItem[] = FIELDS.map((f) => ({
    label: f.name,
    hint: f.type === 'string' ? 'text field' : f.type,
    start,
    end,
    text: f.name,
    trailingSpace: false,
  }));
  const keywords: SuggestItem[] = (afterTerm ? ['AND', 'OR', 'NOT'] : ['NOT']).map((k) => ({
    label: k,
    start,
    end,
    text: k,
    trailingSpace: true,
  }));
  const ranked = rankByPrefix([...keywords, ...fields], prefix, (i) => i.label);
  // with no prefix, lead with fields (keywords are easy to type anyway)
  const items = prefix ? ranked : [...fields, ...keywords];
  return items.slice(0, 8);
};

const computeSuggestions = (): SuggestItem[] => {
  const input = refs.listsSearchInput;
  if (!input) return [];
  const value = input.value;
  const caret = input.selectionStart ?? value.length;
  const tokenized = tokenize(value);
  if (!tokenized.ok) return []; // inside an unclosed quote — leave the user alone
  const tokens = tokenized.tokens.filter((t) => t.kind !== 'eof');

  const cur = tokens.find((t) => t.start < caret && caret <= t.end);
  const before = tokens.filter((t) => t.end <= caret && t !== cur);
  const prev: Token | undefined = before[before.length - 1];
  const prev2: Token | undefined = before[before.length - 2];

  const isKeywordTok = (t: Token | undefined) =>
    t?.kind === 'word' && ['AND', 'OR', 'NOT'].includes(t.text.toUpperCase());
  const fieldOf = (t: Token | undefined): FieldSpec | undefined =>
    t?.kind === 'word' ? fieldByName.get(t.text.toLowerCase()) : undefined;

  if (cur?.kind === 'quoted') return [];

  if (cur?.kind === 'op') {
    const field = fieldOf(prev);
    if (!field) return [];
    if (caret < cur.end || EXTENDABLE_OPS.has(cur.text)) {
      const ops = opSuggestions(field, cur.text, cur.start, cur.end);
      if (caret === cur.end && EXTENDABLE_OPS.has(cur.text)) {
        // '<' may become '<=': offer the longer op plus values for the current one
        return [...ops, ...valueSuggestions(field, cur.text, '', caret, caret)].slice(0, 8);
      }
      return ops;
    }
    return valueSuggestions(field, cur.text, '', caret, caret);
  }

  if (cur?.kind === 'word') {
    if (prev?.kind === 'op') {
      const field = fieldOf(prev2);
      if (field) {
        return valueSuggestions(field, prev.text, cur.text, cur.start, cur.end);
      }
      return [];
    }
    if (isKeywordTok(cur)) return [];
    const curField = fieldOf(cur);
    if (curField && caret === cur.end) {
      // a fully typed field name — offer its operators next
      return opSuggestions(curField, '', caret, caret);
    }
    const afterTerm = Boolean(prev && (prev.kind === 'quoted' || prev.kind === 'rparen' || (prev.kind === 'word' && !isKeywordTok(prev))));
    return termStartSuggestions(cur.text, cur.start, cur.end, afterTerm);
  }

  // caret in whitespace / at the ends
  if (prev?.kind === 'op') {
    const field = fieldOf(prev2);
    return field ? valueSuggestions(field, prev.text, '', caret, caret) : [];
  }
  const prevField = fieldOf(prev);
  if (prevField && !isKeywordTok(prev)) {
    return opSuggestions(prevField, '', caret, caret);
  }
  const afterTerm = Boolean(prev && (prev.kind === 'quoted' || prev.kind === 'rparen' || (prev.kind === 'word' && !isKeywordTok(prev))));
  if (prev && afterTerm) {
    return termStartSuggestions('', caret, caret, true);
  }
  return termStartSuggestions('', caret, caret, false);
};

const renderSuggestMenu = () => {
  const menu = refs.querySuggestMenu;
  const input = refs.listsSearchInput;
  if (!menu || !input) return;
  menu.innerHTML = '';
  suggestItems.forEach((item, index) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `tag-suggest-item query-suggest-item${index === activeIndex ? ' active' : ''}`;
    if (item.color) {
      const dot = document.createElement('span');
      dot.className = 'tag-dot';
      dot.style.background = item.color;
      el.appendChild(dot);
    }
    el.appendChild(document.createTextNode(item.label));
    if (item.hint) {
      const hint = document.createElement('span');
      hint.className = 'query-suggest-hint';
      hint.textContent = item.hint;
      el.appendChild(hint);
    }
    el.addEventListener('mousedown', (event) => {
      // mousedown, not click: fires before the input loses focus
      event.preventDefault();
      event.stopPropagation();
      selectSuggestion(index);
    });
    menu.appendChild(el);
  });
  positionDropdown(menu, input);
};

const updateSuggestions = () => {
  if (state.searchMode !== 'advanced') {
    closeSuggest();
    return;
  }
  suggestItems = computeSuggestions();
  if (suggestItems.length === 0) {
    closeSuggest();
    return;
  }
  activeIndex = 0;
  suggestOpen = true;
  renderSuggestMenu();
};

const selectSuggestion = (index: number) => {
  const input = refs.listsSearchInput;
  const item = suggestItems[index];
  if (!input || !item) return;
  const inserted = item.text + (item.trailingSpace ? ' ' : '');
  input.value = input.value.slice(0, item.start) + inserted + input.value.slice(item.end);
  const caret = item.start + inserted.length;
  input.setSelectionRange(caret, caret);
  input.focus();
  applySearchQuery(input.value);
  updateSuggestions();
};

// ---------- Setup ----------

export const setupQuerySearch = () => {
  const input = refs.listsSearchInput;

  applyModeUI();
  renderSearchStatus();

  refs.searchModeToggle?.addEventListener('click', (event) => {
    event.stopPropagation();
    setMode(state.searchMode === 'advanced' ? 'simple' : 'advanced');
    input?.focus();
  });

  refs.searchHelpBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (refs.searchHelpPopover) {
      const open = refs.searchHelpPopover.style.display === 'block';
      refs.searchHelpPopover.style.display = open ? 'none' : 'block';
    }
  });
  refs.searchHelpPopover?.addEventListener('click', (event) => event.stopPropagation());

  input?.addEventListener('input', () => {
    applySearchQuery(input.value);
    updateSuggestions();
  });

  input?.addEventListener('click', (event) => {
    event.stopPropagation();
    updateSuggestions();
  });

  input?.addEventListener('keydown', (event) => {
    if (suggestOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        activeIndex = (activeIndex + 1) % suggestItems.length;
        renderSuggestMenu();
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        activeIndex = (activeIndex - 1 + suggestItems.length) % suggestItems.length;
        renderSuggestMenu();
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        selectSuggestion(activeIndex);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeSuggest();
        return;
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      clearSearch();
    }
  });

  input?.addEventListener('blur', () => {
    // slight delay so a mousedown on a suggestion can complete first
    setTimeout(() => closeSuggest(), 100);
  });

  refs.listsSearchClear?.addEventListener('click', () => {
    clearSearch();
    input?.focus();
  });

  if (refs.listsSearchClear) {
    refs.listsSearchClear.style.visibility = state.searchQuery ? 'visible' : 'hidden';
  }

  window.electronAPI.onFocusSearch?.(() => {
    input?.focus();
    input?.select();
  });
};
