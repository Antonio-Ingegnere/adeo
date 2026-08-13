// Ties a smart list to the search field and the add-task row: which one is running, how it is
// shown in the bar, what defaults it implies, and how those defaults reach a newly created task.
import type { SmartList, TaskSeed } from '../types';
import { refs } from './dom.js';
import { parseQuery } from './query.js';
import { deriveTemplate } from './smartListTemplate.js';
import type { SmartListTemplate } from './smartListTemplate.js';
import { state } from './state.js';
import { paintTagChip } from './tagColor.js';

/**
 * Derived, never stored. A smart list is *running* iff the search bar currently holds exactly
 * its query. Editing the query therefore stops it running on its own -- there is no flag to
 * keep in sync and no way for this to disagree with what is on screen.
 */
export const activeSmartList = (): SmartList | null => {
  if (state.searchMode !== 'advanced') return null;
  const current = state.searchQuery.trim();
  if (!current) return null;
  return state.smartLists.find((f) => f.query.trim() === current) ?? null;
};

export type SmartListAssociation = { smartList: SmartList; edited: boolean };

/**
 * Which smart list the bar is *working on*, which is not the same question as which one is
 * running: refining a saved query is the normal way to edit one, and the refined text matches
 * nothing. An exact match always wins and re-adopts the origin, so a query typed by hand that
 * happens to equal a saved one is still recognised; state.smartListOrigin only carries the
 * association across the edits that break the match.
 */
export const associatedSmartList = (): SmartListAssociation | null => {
  if (state.searchMode !== 'advanced') return null;
  if (!state.searchQuery.trim()) return null;
  const running = activeSmartList();
  if (running) {
    state.smartListOrigin = running.id;
    return { smartList: running, edited: false };
  }
  if (state.smartListOrigin === null) return null;
  const origin = state.smartLists.find((f) => f.id === state.smartListOrigin);
  if (!origin) {
    state.smartListOrigin = null;
    return null;
  }
  return { smartList: origin, edited: true };
};

/** Drops the association without touching the query — see clearSearch and setSearchMode. */
export const clearSmartListOrigin = () => {
  state.smartListOrigin = null;
};

/**
 * Called from applySearchQuery on every keystroke, so it repaints only when the association
 * *changes* rather than rebuilding the sidebar for each character typed. The edited flag is
 * part of the key: crossing from running to edited changes the pill's subtitle even though the
 * id has not moved. `undefined` means "not yet computed", distinct from null ("none").
 */
let lastAssociationKey: string | null | undefined;

const associationKey = (): string | null => {
  const association = associatedSmartList();
  if (!association) return null;
  return `${association.smartList.id}:${association.edited}`;
};

export const syncSmartListUI = (repaint: () => void) => {
  const key = associationKey();
  if (key === lastAssociationKey) return;
  lastAssociationKey = key;
  repaint();
};

/** Forces the next syncSmartListUI to repaint — after the smart-list collection itself changes. */
export const invalidateSmartListUI = () => {
  lastAssociationKey = undefined;
};

/**
 * Derived from the query *in the bar*, not from any saved one: the hints describe what the
 * user can see, so an edited query has to seed from the edit rather than from the version it
 * was saved as. That it also covers unsaved queries is the point -- adding a task under an
 * ad-hoc filter used to make it vanish from view with nothing said about why.
 */
export const activeTemplate = (): SmartListTemplate | null => {
  if (state.searchMode !== 'advanced') return null;
  const query = state.searchQuery.trim();
  if (!query) return null;
  const parsed = parseQuery(query);
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
  if (template.done) seed.done = true;
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

/** The query these hints were last built from — they only change when it does. */
let lastHintQuery: string | null | undefined;

/**
 * Shows what the query on screen will apply to the next task, and what it cannot. Never
 * silent: the user should always be able to see why a new task came out the way it did.
 *
 * `force` is for changes the query cannot express -- creating a tag the query names turns an
 * unapplied constraint into an applied one without a character of the query moving.
 */
export const renderTemplateHints = (force = false) => {
  const container = refs.addTaskTemplate;
  if (!container) return;
  const searching = Boolean(state.searchQuery.trim());
  const key = `${state.searchMode}|${searching ? state.searchQuery.trim() : ''}|${state.selectedListId}`;
  if (!force && key === lastHintQuery) return;
  lastHintQuery = key;
  container.innerHTML = '';

  const template = activeTemplate();
  if (!template && !searching) {
    // the view is a plain list, and the picker above already names it
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';

  const { missing } = template ? resolveTemplateNames(template) : { missing: [] as string[] };

  // While a search is up the picker names the search, not a list, so this is the only place
  // left that can say where the next task will land -- and it always says it.
  if (template?.listName === null) {
    container.appendChild(chip('No list'));
  } else if (template?.listName !== undefined && !missing.length) {
    container.appendChild(chip(template.listName));
  } else {
    const fallback = state.lists.find((l) => l.id === state.selectedListId);
    container.appendChild(chip(fallback ? fallback.name : 'No list'));
  }
  if (!template) return;
  // every tag the query names, whether it exists yet or not — addTask creates missing ones,
  // so leaving them out would understate what the new task is about to get
  template.tagNames.forEach((name) => {
    const known = state.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    // the tag-chip ink assumes a pastel fill; a tag that does not exist yet has none, so it
    // keeps the plain chip styling until it is created
    const el = chip(`#${name}`, known ? 'template-chip-tag' : '');
    if (known) paintTagChip(el, known.color);
    container.appendChild(el);
  });
  if (template.priority) {
    const el = chip(template.priority[0].toUpperCase() + template.priority.slice(1));
    el.dataset.priority = template.priority;
    container.appendChild(el);
  }
  if (template.due) container.appendChild(chip(`Due ${resolveDue(template.due)}`));
  if (template.repeat) container.appendChild(chip(`Repeats ${template.repeat}`));
  // a task created already complete vanishes on the spot while Show completed is off, so this
  // is the one chip that has to be there before the fact rather than explaining it after
  if (template.done) container.appendChild(chip('Done'));

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
