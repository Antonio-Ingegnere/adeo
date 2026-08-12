/**
 * Every shortcut the app has, as data.
 *
 * Definitions only — no handler functions. A definition carries an id, and index.ts owns the
 * id-to-function table, the same way viewBar.ts dispatches events for index.ts to execute.
 * That is what lets the help overlay, the rebinding UI and the dispatcher all import this
 * module without any of them dragging the others into a cycle.
 *
 * Dom-free, so scripts/query-selftest.mjs can check the defaults for collisions.
 */

import type { Binding } from './shortcutKeys.js';

/**
 * Where a shortcut is allowed to fire.
 *
 * - `list`  — only when the task list has focus, i.e. not in a text field and not under a
 *             modal. This is what lets Space and Enter be bindable at all.
 * - `modal` — only while an overlay is open.
 * - `global`— anywhere, including while typing, but see the dispatcher: an unmodified global
 *             binding is suppressed in a text field, so "?" can't fire mid-query.
 */
export type ShortcutScope = 'global' | 'list' | 'modal';

export type ShortcutCategory = 'Navigate' | 'Task' | 'View' | 'Search' | 'App';

export type ShortcutDef = {
  id: string;
  label: string;
  category: ShortcutCategory;
  scope: ShortcutScope;
  defaults: { mac: Binding[]; other: Binding[] };
  /**
   * This action's key is carried by a native menu *accelerator*, so the dispatcher must not
   * also claim it: Electron consumes a registered accelerator before the page sees the key,
   * and handling it in both places is a double-firing bug waiting to happen. The entry still
   * exists so the shortcut appears in help and can be rebound — the rebind is forwarded to
   * main, which rebuilds the menu. A menu *item* with no accelerator (Help) claims no key
   * and so is not marked here.
   */
  menuItem?: boolean;
  /**
   * Documented in help, never dispatched, never rebindable. Escape and Tab already have
   * correct, layered owners across four modules; re-deriving that here would be risk for no
   * gain, and letting someone unbind Escape means letting them trap themselves in a modal.
   */
  fixed?: boolean;
  /**
   * Replaces the generated keycaps in help. Structured rather than a literal string because
   * the keycaps still have to be platform-formatted — "⌘1 – ⌘9" on macOS is "Ctrl+1 – Ctrl+9"
   * elsewhere, and hardcoding either would be wrong on the other.
   */
  displayAs?: { bindings: Binding[]; separator: string };
};

const both = (...bindings: Binding[]) => ({ mac: bindings, other: bindings });

export const SHORTCUTS: readonly ShortcutDef[] = [
  // ---------- Navigate ----------
  {
    id: 'nav.down',
    label: 'Next task',
    category: 'Navigate',
    scope: 'list',
    defaults: both('ArrowDown'),
  },
  {
    id: 'nav.up',
    label: 'Previous task',
    category: 'Navigate',
    scope: 'list',
    defaults: both('ArrowUp'),
  },
  {
    id: 'nav.first',
    label: 'First task',
    category: 'Navigate',
    scope: 'list',
    defaults: both('Home'),
  },
  {
    id: 'nav.last',
    label: 'Last task',
    category: 'Navigate',
    scope: 'list',
    defaults: both('End'),
  },

  // ---------- Task ----------
  {
    id: 'task.toggleDone',
    label: 'Complete / un-complete',
    category: 'Task',
    scope: 'list',
    defaults: both('Space'),
  },
  {
    id: 'task.open',
    label: 'Open task',
    category: 'Task',
    scope: 'list',
    defaults: both('Enter'),
  },
  {
    id: 'task.toggleDetails',
    label: 'Show / hide details',
    category: 'Task',
    scope: 'list',
    defaults: both('Mod+Enter'),
  },
  {
    id: 'task.moveUp',
    label: 'Move task up',
    category: 'Task',
    scope: 'list',
    defaults: both('Alt+ArrowUp'),
  },
  {
    id: 'task.moveDown',
    label: 'Move task down',
    category: 'Task',
    scope: 'list',
    defaults: both('Alt+ArrowDown'),
  },
  {
    id: 'task.delete',
    label: 'Delete task',
    category: 'Task',
    scope: 'list',
    // Backspace on macOS, Delete elsewhere: the key labelled "delete" is a different physical
    // key on each, and binding both everywhere would put a destructive action under a key the
    // user reaches for to correct themselves.
    defaults: { mac: ['Backspace'], other: ['Delete'] },
  },

  // ---------- Search ----------
  {
    id: 'search.focus',
    label: 'Search',
    category: 'Search',
    scope: 'global',
    defaults: both('Mod+F'),
    menuItem: true,
  },
  {
    id: 'search.clear',
    label: 'Clear search',
    category: 'Search',
    scope: 'global',
    defaults: both('Mod+Shift+F'),
  },
  {
    id: 'search.toggleMode',
    label: 'Switch text / query mode',
    category: 'Search',
    scope: 'global',
    defaults: both('Mod+Shift+K'),
  },

  // ---------- View ----------
  {
    id: 'view.toggleCompleted',
    label: 'Show / hide completed',
    category: 'View',
    scope: 'global',
    // Mod+H is Hide on macOS, delivered by a menu role we don't control.
    defaults: both('Mod+Shift+H'),
    menuItem: true,
  },
  {
    id: 'view.allLists',
    label: 'All lists',
    category: 'View',
    scope: 'global',
    defaults: both('Mod+0'),
  },
  {
    id: 'view.selectListByNumber',
    label: 'Nth list in the sidebar',
    category: 'View',
    scope: 'global',
    // One entry with nine bindings rather than nine entries: the handler reads the digit off
    // the binding it matched, and help and the rebinding UI each get one row instead of nine.
    defaults: both('Mod+1', 'Mod+2', 'Mod+3', 'Mod+4', 'Mod+5', 'Mod+6', 'Mod+7', 'Mod+8', 'Mod+9'),
    displayAs: { bindings: ['Mod+1', 'Mod+9'], separator: '–' },
  },
  {
    id: 'view.clearTagFilter',
    label: 'Clear tag filter',
    category: 'View',
    scope: 'global',
    defaults: both('Mod+Shift+T'),
  },

  // ---------- App ----------
  {
    id: 'app.newTask',
    label: 'New task',
    category: 'App',
    scope: 'global',
    defaults: both('Mod+N'),
  },
  {
    id: 'app.newList',
    label: 'New list',
    category: 'App',
    scope: 'global',
    defaults: both('Mod+Shift+N'),
  },
  {
    id: 'app.newSmartList',
    label: 'New smart list',
    category: 'App',
    scope: 'global',
    defaults: both('Mod+Shift+S'),
  },
  {
    id: 'app.settings',
    label: 'Settings',
    category: 'App',
    scope: 'global',
    defaults: both('Mod+,'),
    menuItem: true,
  },
  {
    id: 'app.help',
    label: 'Keyboard shortcuts',
    category: 'App',
    scope: 'global',
    // Two bindings, so this stays renderer-dispatched: an accelerator can only carry one of
    // them, and losing the bare "?" — the key people actually try — would be the wrong trade.
    // The Help menu item opens the same overlay by click, with no accelerator of its own.
    defaults: both('Mod+/', '?'),
  },

  // ---------- Fixed ----------
  {
    id: 'fixed.escape',
    label: 'Close menu or modal, clear search',
    category: 'App',
    scope: 'global',
    defaults: both('Escape'),
    fixed: true,
  },
  {
    id: 'fixed.tab',
    label: 'Move between controls',
    category: 'App',
    scope: 'global',
    defaults: both('Tab'),
    displayAs: { bindings: ['Tab', 'Shift+Tab'], separator: 'or' },
    fixed: true,
  },
  {
    id: 'fixed.addTask',
    label: 'Add the typed task',
    category: 'App',
    scope: 'global',
    defaults: both('Enter'),
    fixed: true,
  },
];

export const SHORTCUT_BY_ID = new Map(SHORTCUTS.map((def) => [def.id, def]));

export const SHORTCUT_IDS = new Set(SHORTCUTS.map((def) => def.id));

/** Ids that can be rebound: not fixed, and therefore worth showing in the Settings list. */
export const isRebindable = (def: ShortcutDef): boolean => !def.fixed;

export const defaultKeymap = (isMac: boolean): Record<string, Binding[]> => {
  const keymap: Record<string, Binding[]> = {};
  for (const def of SHORTCUTS) {
    keymap[def.id] = [...(isMac ? def.defaults.mac : def.defaults.other)];
  }
  return keymap;
};

export const scopeOf = (id: string): ShortcutScope => SHORTCUT_BY_ID.get(id)?.scope ?? 'global';

export const CATEGORY_ORDER: readonly ShortcutCategory[] = [
  'Navigate',
  'Task',
  'View',
  'Search',
  'App',
];
