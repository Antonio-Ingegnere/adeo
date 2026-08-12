// Search-field wiring: simple/advanced mode toggle, live parse status, syntax
// help popover, and context-aware autocomplete for the advanced query mode.
// All listeners on the search input live here (single keydown owner).
import {
  clearSmartListOrigin,
  renderTemplateHints,
  syncSmartListUI,
} from './activeSmartList.js';
import { refs } from './dom.js';
import { renderViewBar } from './viewBar.js';
import { currentView } from './currentView.js';
import { renderLists } from './lists.js';
import { renderSmartLists } from './smartLists.js';
import { positionDropdown, syncComboboxAria } from './helpers.js';
import { FIELDS, compilePredicate, parseQuery, queryUsesField, tokenize } from './query.js';
import type { FieldSpec, ParseError, Token } from './query.js';
import { renderTasks } from './tasks.js';
import { state } from './state.js';

const RENDER_DEBOUNCE_MS = 150;

// S6: the shortcut is otherwise undiscoverable, so the placeholder names it. Pushed in from
// shortcutHints.ts rather than read from the keymap here: shortcuts.ts already imports this
// module for isQuerySuggestOpen, so importing it back would be a cycle. Empty means the
// action is unbound, and then the placeholder promises nothing.
let searchShortcutHint = '';

export const setSearchShortcutHint = (hint: string) => {
  if (hint === searchShortcutHint) return;
  searchShortcutHint = hint;
  applyModeUI();
};

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
  syncComboboxAria(refs.listsSearchInput, false, null);
  syncStatusLine();
};

export const closeQueryPopovers = () => {
  closeSuggest();
  if (refs.searchHelpPopover) {
    refs.searchHelpPopover.style.display = 'none';
  }
  syncStatusLine();
};

const flushRender = () => {
  if (renderTimer !== null) {
    window.clearTimeout(renderTimer);
    renderTimer = null;
  }
  renderViewBar();
  renderTasks();
};

const scheduleRender = () => {
  if (renderTimer !== null) {
    window.clearTimeout(renderTimer);
  }
  renderTimer = window.setTimeout(() => {
    renderTimer = null;
    renderViewBar();
    renderTasks();
  }, RENDER_DEBOUNCE_MS);
};

// only settled states are announced; 'pending' deliberately leaves the live region alone
const announce = (message: string | null) => {
  if (!refs.searchStatusLive || message === null) return;
  if (refs.searchStatusLive.textContent !== message) {
    refs.searchStatusLive.textContent = message;
  }
};

const searchField = () => refs.listsSearchInput?.closest('.lists-search-field') ?? null;

/**
 * The error line shares the strip just under the field with the suggest menu and, at wider
 * sizes, overlaps the help popover. It yields to both: whenever either is open the user is
 * mid-interaction and the red border alone carries the "this does not parse" signal.
 */
const syncStatusLine = () => {
  if (!refs.searchStatusLine) return;
  const helpOpen = refs.searchHelpPopover?.style.display === 'block';
  const show =
    state.queryStatus === 'invalid' && Boolean(state.queryError) && !suggestOpen && !helpOpen;
  refs.searchStatusLine.style.display = show ? 'block' : 'none';
};

/** Drops every query-validity signal. Simple mode has no parse, so it has no verdict either. */
const clearSearchStatus = () => {
  searchField()?.classList.remove('is-valid', 'is-invalid');
  if (refs.searchStatusLine) {
    refs.searchStatusLine.style.display = 'none';
  }
};

const renderSearchStatus = () => {
  const field = searchField();
  field?.classList.remove('is-valid', 'is-invalid');

  if (state.queryStatus === 'invalid' && state.queryError) {
    field?.classList.add('is-invalid');
    if (refs.searchStatusLine) {
      refs.searchStatusLine.textContent =
        `⚠ ${state.queryError.message} (column ${state.queryError.position + 1})`;
    }
    announce(`Invalid query: ${state.queryError.message}`);
  } else if (state.queryStatus === 'valid') {
    // no prose: the border tint plus the "Search results · N" count already confirm the parse
    field?.classList.add('is-valid');
    announce('Valid query');
  } else if (state.queryStatus === 'empty') {
    announce('');
  }
  // 'pending' means mid-token: show nothing at all rather than accuse the user of a syntax
  // error they are still in the middle of typing, and leave the live region alone.

  syncStatusLine();
  // here rather than earlier in applySearchQuery: the bar's actions key off state.queryStatus,
  // which is only settled by the time this runs
  renderViewBar();
};

/**
 * True when a parse failure is only about the fragment the user is still typing, rather
 * than a mistake they have finished making. Two signals, both requiring the caret to sit
 * at the end of the input:
 *   - everything before the final token parses cleanly, so only the tail is at fault
 *     (`tag:` -> `tag`, `list:Home AND` -> `list:Home`); or
 *   - the error points inside the final token and there is no trailing space, i.e. the
 *     token is still being typed (`priority:hi` on the way to `high`).
 * A trailing space means the user has moved past the token, so its error is real.
 */
const isPendingTail = (value: string, error: ParseError): boolean => {
  const input = refs.listsSearchInput;
  if (!input) return false;
  const caretAtEnd = input.selectionStart === null || input.selectionStart >= value.length;
  if (!caretAtEnd) return false;

  const tokenized = tokenize(value);
  if (!tokenized.ok) return true; // e.g. an unclosed quote being typed right now
  const real = tokenized.tokens.filter((t) => t.kind !== 'eof');
  if (real.length === 0) return true;

  const last = real[real.length - 1];
  const head = value.slice(0, last.start);
  if (!head.trim() || parseQuery(head).ok) return true;

  return error.position >= last.start && value === value.trimEnd();
};

/** Follows the field's *value*, so it has to run on every keystroke rather than on the parse. */
const syncClearButton = () => {
  if (!refs.listsSearchClear) return;
  refs.listsSearchClear.style.visibility = state.searchQuery ? 'visible' : 'hidden';
};

/**
 * The list pills are lit by the *view*, so starting a search puts them all out and clearing one
 * gives the highlight back to the list that was selected before. Only that transition matters,
 * so the sidebar is not rebuilt on every keystroke.
 */
let lastInAList: boolean | undefined;
const syncListPills = () => {
  const inAList = currentView().kind === 'list';
  if (inAList === lastInAList) return;
  lastInAList = inAList;
  renderLists();
};

export const applySearchQuery = (value: string, immediate = false) => {
  state.searchQuery = value;
  syncClearButton();
  // an emptied query is not an edit of anything: without this the association would survive a
  // ⌫-to-nothing and the next thing typed would come out marked as edits to whatever ran last
  if (!value.trim()) clearSmartListOrigin();
  // the sidebar highlight follows the association, which changes as the query does
  syncSmartListUI(renderSmartLists);
  syncListPills();
  // the hints describe the query on screen, so they follow it rather than the association
  renderTemplateHints();
  if (state.searchMode === 'advanced') {
    const trimmed = value.trim();
    const previousStatus = state.queryStatus;
    if (!trimmed) {
      state.queryPredicate = null;
      state.queryError = null;
      state.queryUsesDone = false;
      state.queryStatus = 'empty';
    } else {
      const result = parseQuery(trimmed);
      if (result.ok) {
        state.queryPredicate = compilePredicate(result.ast);
        state.queryError = null;
        state.queryUsesDone = queryUsesField(result.ast, 'done');
        state.queryStatus = 'valid';
      } else if (isPendingTail(value, result.error)) {
        // keep the last-good predicate AND the results it produced: re-filtering here is
        // what used to make an in-progress query look like it had zero matches
        state.queryError = null;
        state.queryStatus = 'pending';
      } else {
        state.queryError = result.error; // keep last-good predicate (and its usesDone)
        state.queryStatus = 'invalid';
      }
    }
    renderSearchStatus();
    // a pending tail changes nothing on screen, so skip the render entirely unless we are
    // arriving from a state that did change something
    if (state.queryStatus === 'pending' && previousStatus === 'pending') {
      return;
    }
    if (immediate) {
      flushRender();
    } else {
      scheduleRender();
    }
  } else {
    // Text mode never reaches renderSearchStatus, and the bar still has to switch between the
    // list's name and "Search results · N"
    renderViewBar();
    flushRender();
  }
};

/**
 * Exported because selecting a list is a view change and has to drop whatever search is
 * running: one view at a time.
 */
export const clearSearch = () => {
  closeSuggest();
  if (refs.listsSearchInput) {
    refs.listsSearchInput.value = '';
  }
  state.queryPredicate = null;
  state.queryError = null;
  state.queryStatus = 'empty';
  state.queryUsesDone = false;
  applySearchQuery('', true);
};

// ---------- Mode toggle ----------

const applyModeUI = () => {
  const advanced = state.searchMode === 'advanced';
  // a text search is not a query, so it belongs to no smart list. Before the bar is painted,
  // which reads the association this drops.
  if (!advanced) clearSmartListOrigin();
  refs.listsSearchInput?.classList.toggle('query-mode', advanced);
  if (refs.listsSearchInput) {
    refs.listsSearchInput.placeholder = advanced
      ? 'Query… e.g. list:Home AND due<=today'
      : searchShortcutHint
        ? `Search (${searchShortcutHint})`
        : 'Search';
  }
  if (refs.searchModeSimple && refs.searchModeAdvanced) {
    refs.searchModeSimple.checked = !advanced;
    refs.searchModeAdvanced.checked = advanced;
  }
  // help is available in both modes; in simple mode it explains text search and points at
  // the Query switch, which is where a user who wants more goes looking
  if (refs.searchHelpSimple && refs.searchHelpAdvanced) {
    refs.searchHelpSimple.style.display = advanced ? 'none' : 'block';
    refs.searchHelpAdvanced.style.display = advanced ? 'block' : 'none';
  }
  refs.searchHelpPopover?.classList.toggle('simple', !advanced);
  refs.searchHelpBtn?.setAttribute('aria-label', advanced ? 'Query syntax help' : 'Search help');
  renderViewBar();
  if (!advanced) {
    closeQueryPopovers();
    // applySearchQuery's simple branch never reaches renderSearchStatus, so the last
    // verdict would otherwise stay painted on the field after leaving query mode
    clearSearchStatus();
  }
};

export const setSearchMode = (mode: 'simple' | 'advanced') => {
  state.searchMode = mode;
  state.queryPredicate = null;
  state.queryError = null;
  state.queryStatus = 'empty';
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
    el.id = `query-suggest-option-${index}`;
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', index === activeIndex ? 'true' : 'false');
    el.tabIndex = -1; // the input keeps focus; the listbox is driven by aria-activedescendant
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
  syncComboboxAria(input, true, `query-suggest-option-${activeIndex}`);
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
  // renderSearchStatus() already ran (via applySearchQuery) before the menu opened
  syncStatusLine();
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

  // 'change' rather than 'click': it also fires for the arrow-key navigation the native radio
  // group gives us for free.
  const onModeChange =
    (mode: 'simple' | 'advanced', radio: HTMLInputElement) => (event: Event) => {
      event.stopPropagation();
      if (state.searchMode === mode) return;
      setSearchMode(mode);
      // Clicking the switch means "now let me type"; arrowing across it does not -- stealing
      // focus there would strand the user, since they could no longer arrow back. A radio
      // matches :focus-visible only when it was reached by keyboard, which is the distinction.
      if (!radio.matches(':focus-visible')) {
        input?.focus();
      }
    };
  if (refs.searchModeSimple) {
    refs.searchModeSimple.addEventListener('change', onModeChange('simple', refs.searchModeSimple));
  }
  if (refs.searchModeAdvanced) {
    refs.searchModeAdvanced.addEventListener(
      'change',
      onModeChange('advanced', refs.searchModeAdvanced)
    );
  }

  refs.searchHelpBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (refs.searchHelpPopover) {
      const open = refs.searchHelpPopover.style.display === 'block';
      refs.searchHelpPopover.style.display = open ? 'none' : 'block';
      syncStatusLine();
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

  // slight delay so a mousedown on a suggestion can complete first
  input?.addEventListener('blur', () => setTimeout(() => closeSuggest(), 100));

  refs.listsSearchClear?.addEventListener('click', () => {
    clearSearch();
    input?.focus();
  });

  syncClearButton();

  window.electronAPI.onFocusSearch?.(() => {
    input?.focus();
    input?.select();
  });
};
