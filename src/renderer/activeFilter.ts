// Ties a saved filter to the add-task row: which filter is running, what defaults it implies,
// and how those defaults reach a newly created task.
import type { SavedFilter, TaskSeed } from '../types';
import { refs } from './dom.js';
import { parseQuery } from './query.js';
import { deriveTemplate } from './filterTemplate.js';
import type { FilterTemplate } from './filterTemplate.js';
import { state } from './state.js';

/**
 * Derived, never stored. A filter is running iff the search bar currently holds exactly its
 * query, so editing the query simply deselects it -- there is no flag to keep in sync and no
 * way for the sidebar highlight to disagree with what is on screen.
 */
export const activeFilter = (): SavedFilter | null => {
  if (state.searchMode !== 'advanced') return null;
  const current = state.searchQuery.trim();
  if (!current) return null;
  return state.filters.find((f) => f.query.trim() === current) ?? null;
};

/**
 * Called from applySearchQuery on every keystroke, so it repaints only when the *identity* of
 * the running filter changes rather than rebuilding the sidebar for each character typed.
 * `undefined` means "not yet computed", which is distinct from null ("no filter running").
 */
let lastActiveId: number | null | undefined;

export const syncFilterUI = (repaint: () => void) => {
  const id = activeFilter()?.id ?? null;
  if (id === lastActiveId) return;
  lastActiveId = id;
  repaint();
  renderTemplateHints();
};

/** Forces the next syncFilterUI to repaint — after the filter list itself changes. */
export const invalidateFilterUI = () => {
  lastActiveId = undefined;
};

export const activeTemplate = (): FilterTemplate | null => {
  const filter = activeFilter();
  if (!filter) return null;
  const parsed = parseQuery(filter.query);
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
export const templateSeed = (template: FilterTemplate | null): TaskSeed | undefined => {
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
 * Names in a query are resolved against what actually exists. A list named in the filter but
 * since deleted cannot be assigned, so it is reported rather than silently dropped.
 */
export const resolveTemplateNames = (
  template: FilterTemplate
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

/** Tag names the filter asks for that do not exist yet, so addTask can create them. */
export const missingTemplateTagNames = (template: FilterTemplate | null): string[] => {
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
 * Shows what the active filter will apply to the next task, and what it cannot. Never silent:
 * the user should always be able to see why a new task came out the way it did.
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
  // every tag the filter names, whether it exists yet or not — addTask creates missing ones,
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
