// Ties a smart list to the search field and the add-task row: which one is running, how it is
// shown in the bar, what defaults it implies, and how those defaults reach a newly created task.
import type { SmartList, TaskSeed } from '../types';
import { refs } from './dom.js';
import { parseQuery } from './query.js';
import { deriveTemplate } from './smartListTemplate.js';
import type { SmartListTemplate } from './smartListTemplate.js';
import { state } from './state.js';

/**
 * Derived, never stored. A smart list is running iff the search bar currently holds exactly its
 * query, so editing the query simply deselects it -- there is no flag to keep in sync and no
 * way for the sidebar highlight to disagree with what is on screen.
 */
export const activeSmartList = (): SmartList | null => {
  if (state.searchMode !== 'advanced') return null;
  const current = state.searchQuery.trim();
  if (!current) return null;
  return state.smartLists.find((f) => f.query.trim() === current) ?? null;
};

/**
 * Called from applySearchQuery on every keystroke, so it repaints only when the *identity* of
 * the running smart list changes rather than rebuilding the sidebar for each character typed.
 * `undefined` means "not yet computed", which is distinct from null ("nothing running").
 */
let lastActiveId: number | null | undefined;

export const syncSmartListUI = (repaint: () => void) => {
  const id = activeSmartList()?.id ?? null;
  if (id === lastActiveId) return;
  lastActiveId = id;
  repaint();
  renderTemplateHints();
  syncSmartListChip();
  syncSaveButton();
};

/** Forces the next syncSmartListUI to repaint — after the smart-list collection itself changes. */
export const invalidateSmartListUI = () => {
  lastActiveId = undefined;
};

/**
 * The name chip that masks the raw query while a smart list is running. It is a *mask*, never a
 * value swap: the input still holds the query, so every downstream consumer (the predicate, the
 * suggest menu, activeSmartList itself) is untouched. Focusing the field lifts the mask, which
 * is what keeps hiding the query fair -- the user is always one click from what is running.
 *
 * Focus changes do not alter which smart list is running, so syncSmartListUI's memo cannot see
 * them; querySearch.ts calls this directly from the field's focus/blur handlers too.
 */
export const syncSmartListChip = () => {
  const chip = refs.searchSmartListChip;
  if (!chip) return;
  const running = activeSmartList();
  const focused = document.activeElement === refs.listsSearchInput;
  const show = state.searchMode === 'advanced' && Boolean(running) && !focused;
  chip.style.display = show ? 'flex' : 'none';
  // the chip carries its own ✕, sitting right beside the name it removes; leaving the field's
  // clear button up too would put two controls with identical behaviour in one field
  if (refs.listsSearchClear) {
    refs.listsSearchClear.style.visibility =
      !show && state.searchQuery ? 'visible' : 'hidden';
  }
  if (!show || !running) return;
  if (refs.searchSmartListChipName) {
    refs.searchSmartListChipName.textContent = running.name;
    refs.searchSmartListChipName.title = running.query;
  }
};

/**
 * The in-field bookmark. Query mode only -- a text search is not a query, so there is nothing
 * to save. `pending` counts as showable on purpose: it only means the user is mid-token, and
 * blinking the button on and off through every keystroke would be worse than letting the modal
 * report a parse error it already checks for.
 *
 * Lives here rather than in querySearch.ts because its *appearance* is a function of which
 * smart list is running, so syncSmartListUI has to be able to reach it. Its *visibility* is a
 * function of the parse, which querySearch.ts drives -- hence the calls from both sides.
 */
export const syncSaveButton = () => {
  const button = refs.searchSaveSmartList;
  if (!button) return;
  const show =
    state.searchMode === 'advanced' &&
    state.searchQuery.trim() !== '' &&
    state.queryStatus !== 'invalid';
  button.style.display = show ? 'inline-flex' : 'none';
  if (!show) return;
  const running = activeSmartList();
  button.classList.toggle('is-saved', Boolean(running));
  const label = running ? `Edit smart list "${running.name}"` : 'Save as smart list';
  button.title = label;
  button.setAttribute('aria-label', label);
};

export const activeTemplate = (): SmartListTemplate | null => {
  const smartList = activeSmartList();
  if (!smartList) return null;
  const parsed = parseQuery(smartList.query);
  if (!parsed.ok) return null;
  return deriveTemplate(parsed.ast);
};

const isoToday = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
};

const addDays = (iso: string, days: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
};

/** today/tomorrow/yesterday are relative to *now*, so they resolve at add time, not save time. */
export const resolveDue = (due: string): string => {
  const today = isoToday();
  if (due === 'today') return today;
  if (due === 'tomorrow') return addDays(today, 1);
  if (due === 'yesterday') return addDays(today, -1);
  return due;
};

const RRULE_BY_FREQ: Record<string, string> = {
  daily: 'FREQ=DAILY',
  weekly: 'FREQ=WEEKLY',
  monthly: 'FREQ=MONTHLY',
  yearly: 'FREQ=YEARLY',
};

/** The parts of a template that POST /tasks takes directly (list and tags go separately). */
export const templateSeed = (template: SmartListTemplate | null): TaskSeed | undefined => {
  if (!template) return undefined;
  const seed: TaskSeed = {};
  if (template.priority) seed.priority = template.priority;
  if (template.due) seed.reminderDate = resolveDue(template.due);
  if (template.repeat && RRULE_BY_FREQ[template.repeat]) {
    seed.repeatRule = RRULE_BY_FREQ[template.repeat];
    seed.repeatStart = seed.reminderDate ?? isoToday();
  }
  return Object.keys(seed).length ? seed : undefined;
};

/**
 * Names in a query are resolved against what actually exists. A list named in the query but
 * since deleted cannot be assigned, so it is reported rather than silently dropped.
 */
export const resolveTemplateNames = (
  template: SmartListTemplate
): { listId: number | null | undefined; tagIds: number[]; missing: string[] } => {
  const missing: string[] = [];
  let listId: number | null | undefined;

  if (template.listName === null) {
    listId = null;
  } else if (template.listName !== undefined) {
    const wanted = template.listName.toLowerCase();
    const found = state.lists.find((l) => l.name.toLowerCase() === wanted);
    if (found) {
      listId = found.id;
    } else {
      missing.push(`list:${template.listName} (no such list)`);
    }
  }

  const tagIds: number[] = [];
  template.tagNames.forEach((name) => {
    const found = state.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    // a missing tag is not an error: addTask creates tags on demand, so it is applied at
    // add time via the pending-tag path
    if (found) tagIds.push(found.id);
  });

  return { listId, tagIds, missing };
};

/** Tag names the smart list asks for that do not exist yet, so addTask can create them. */
export const missingTemplateTagNames = (template: SmartListTemplate | null): string[] => {
  if (!template) return [];
  return template.tagNames.filter(
    (name) => !state.tags.some((t) => t.name.toLowerCase() === name.toLowerCase())
  );
};

const chip = (label: string, className = ''): HTMLSpanElement => {
  const el = document.createElement('span');
  el.className = `template-chip${className ? ` ${className}` : ''}`;
  el.textContent = label;
  return el;
};

/**
 * Shows what the running smart list will apply to the next task, and what it cannot. Never
 * silent: the user should always be able to see why a new task came out the way it did.
 */
export const renderTemplateHints = () => {
  const container = refs.addTaskTemplate;
  if (!container) return;
  container.innerHTML = '';

  const template = activeTemplate();
  if (!template) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';

  const { missing } = resolveTemplateNames(template);

  if (template.listName === null) {
    container.appendChild(chip('No list'));
  } else if (template.listName !== undefined && !missing.length) {
    container.appendChild(chip(template.listName));
  }
  // every tag the query names, whether it exists yet or not — addTask creates missing ones,
  // so leaving them out would understate what the new task is about to get
  template.tagNames.forEach((name) => {
    const known = state.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    // the tag-chip ink assumes a pastel fill; a tag that does not exist yet has none, so it
    // keeps the plain chip styling until it is created
    const el = chip(`#${name}`, known ? 'template-chip-tag' : '');
    if (known) el.style.background = known.color;
    container.appendChild(el);
  });
  if (template.priority) {
    const el = chip(template.priority[0].toUpperCase() + template.priority.slice(1));
    el.dataset.priority = template.priority;
    container.appendChild(el);
  }
  if (template.due) container.appendChild(chip(`Due ${resolveDue(template.due)}`));
  if (template.repeat) container.appendChild(chip(`Repeats ${template.repeat}`));

  const notApplied = [...template.skipped, ...missing];
  if (notApplied.length) {
    const note = document.createElement('span');
    note.className = 'template-warning';
    note.textContent = `⚠ not applied: ${notApplied.join(', ')} — the new task may not appear in this view`;
    container.appendChild(note);
  }

  if (!container.childElementCount) {
    container.style.display = 'none';
  }
};
