/**
 * The rebinding rows in the Settings modal.
 *
 * Edits accumulate in a pending overrides object and are only sent on Save, matching how the
 * rest of the modal behaves — Cancel discards by throwing the object away, and the next open
 * rebuilds it from state.
 */

import { refs } from './dom.js';
import { state } from './state.js';
import {
  findConflicts,
  formatBinding,
  normalizeBinding,
  resolveKeymap,
  toElectronAccelerator,
  type Binding,
} from './shortcutKeys.js';
import {
  CATEGORY_ORDER,
  SHORTCUTS,
  SHORTCUT_IDS,
  defaultKeymap,
  isRebindable,
  scopeOf,
  type ShortcutDef,
} from './shortcutRegistry.js';
import { IS_MAC, beginCapture, cancelCapture, setKeymap } from './shortcuts.js';
import { renderShortcutHints } from './shortcutHints.js';

/**
 * Keys the native Edit and app menus own by role. A renderer binding could never win against
 * these anyway — Electron consumes the accelerator first — so allowing one would only produce
 * a shortcut that silently does nothing. The comment above the Edit submenu in main.ts
 * explains why those roles are load-bearing.
 */
const RESERVED: Record<string, string> = {
  'Mod+A': 'Select All',
  'Mod+C': 'Copy',
  'Mod+V': 'Paste',
  'Mod+X': 'Cut',
  'Mod+Z': 'Undo',
  'Mod+Shift+Z': 'Redo',
  'Mod+Q': 'Quit',
  'Mod+W': 'Close Window',
};

/** Working copy of the overrides, discarded on Cancel. */
let pending: Record<string, Binding[]> = {};
let capturingId: string | null = null;

const rebindable = SHORTCUTS.filter(isRebindable);

const currentKeymap = (): Record<string, Binding[]> =>
  resolveKeymap(defaultKeymap(IS_MAC), pending, SHORTCUT_IDS).keymap;

const showError = (message: string | null) => {
  if (!refs.shortcutError) return;
  refs.shortcutError.textContent = message ?? '';
  refs.shortcutError.style.display = message ? 'block' : 'none';
};

const keycaps = (binding: Binding): HTMLElement => {
  const wrap = document.createElement('span');
  wrap.className = 'shortcut-keys';
  for (const token of formatBinding(binding, IS_MAC)) {
    const kbd = document.createElement('kbd');
    kbd.textContent = token;
    wrap.appendChild(kbd);
  }
  return wrap;
};

const labelFor = (id: string) => SHORTCUTS.find((def) => def.id === id)?.label ?? id;

/**
 * Take a binding off whoever else holds it, and say so. A modal confirm for something the
 * per-row reset already undoes would be friction without a decision behind it. Scoped:
 * Space on a task row and a Space inside a modal never both fire, so they don't conflict.
 */
const stealBinding = (binding: Binding, forId: string): string | null => {
  const keymap = currentKeymap();
  keymap[forId] = [binding];
  const clash = findConflicts(keymap, scopeOf).find((entry) => entry.binding === binding);
  if (!clash) return null;

  const loser = clash.ids.find((id) => id !== forId);
  if (!loser) return null;
  pending[loser] = (keymap[loser] ?? []).filter((existing) => existing !== binding);
  return labelFor(loser);
};

const applyBinding = (def: ShortcutDef, binding: Binding | null) => {
  capturingId = null;
  if (!binding) {
    render();
    return;
  }

  const reserved = RESERVED[binding];
  if (reserved) {
    showError(`${formatBinding(binding, IS_MAC).join('')} belongs to ${reserved} and can't be reassigned.`);
    render();
    return;
  }

  const stolenFrom = stealBinding(binding, def.id);
  pending[def.id] = [binding];
  showError(stolenFrom ? `Taken from ${stolenFrom}.` : null);
  render();
};

const startCapture = (def: ShortcutDef) => {
  capturingId = def.id;
  showError(null);
  render();
  beginCapture((binding) => applyBinding(def, binding));
};

const buildRow = (def: ShortcutDef): HTMLElement => {
  const row = document.createElement('div');
  row.className = 'shortcut-setting-row';

  const label = document.createElement('span');
  label.className = 'shortcut-setting-label';
  label.textContent = def.label;
  row.appendChild(label);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'shortcut-binding-btn';
  button.dataset.id = def.id;

  const bindings = currentKeymap()[def.id] ?? [];
  if (capturingId === def.id) {
    button.classList.add('is-capturing');
    button.textContent = 'Press a key…';
    button.setAttribute('aria-label', `Press a key for ${def.label}, or Escape to cancel`);
  } else if (bindings.length === 0) {
    button.classList.add('is-unbound');
    button.textContent = 'Not set';
    button.setAttribute('aria-label', `${def.label}: not set. Click to assign a key.`);
  } else {
    // Only the first is editable here; a second binding (⌘/ and ? for help) is a shipped
    // default rather than something this row is trying to model.
    button.appendChild(keycaps(bindings[0]));
    button.setAttribute(
      'aria-label',
      `${def.label}: ${formatBinding(bindings[0], IS_MAC).join(' ')}. Click to change.`
    );
  }
  button.addEventListener('click', () => startCapture(def));
  row.appendChild(button);

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'shortcut-icon-btn';
  reset.textContent = '↺';
  reset.title = 'Reset to default';
  reset.setAttribute('aria-label', `Reset ${def.label} to its default`);
  reset.addEventListener('click', () => {
    delete pending[def.id];
    showError(null);
    render();
  });
  row.appendChild(reset);

  const unbind = document.createElement('button');
  unbind.type = 'button';
  unbind.className = 'shortcut-icon-btn';
  unbind.textContent = '✕';
  unbind.title = 'Unbind';
  unbind.setAttribute('aria-label', `Unbind ${def.label}`);
  unbind.addEventListener('click', () => {
    pending[def.id] = [];
    showError(null);
    render();
  });
  row.appendChild(unbind);

  return row;
};

const render = () => {
  if (!refs.shortcutList) return;
  refs.shortcutList.innerHTML = '';

  for (const category of CATEGORY_ORDER) {
    const defs = rebindable.filter((def) => def.category === category);
    if (defs.length === 0) continue;

    const heading = document.createElement('p');
    heading.className = 'shortcut-group-title';
    heading.textContent = category;
    refs.shortcutList.appendChild(heading);
    for (const def of defs) refs.shortcutList.appendChild(buildRow(def));
  }
};

/** Called when the Settings modal opens: reseed from state and discard any earlier editing. */
export const seedShortcutSettings = () => {
  pending = {};
  for (const [id, bindings] of Object.entries(state.shortcutOverrides)) {
    pending[id] = [...bindings];
  }
  capturingId = null;
  cancelCapture();
  showError(null);
  render();
};

export const setupShortcutSettings = () => {
  refs.resetShortcuts?.addEventListener('click', () => {
    pending = {};
    showError('All shortcuts reset to their defaults.');
    render();
  });
};

/**
 * Persist. The menu-owned accelerators are resolved here rather than in main, because main
 * has no registry — see the note on menuItem in shortcutRegistry.ts.
 */
export const saveShortcutSettings = async () => {
  cancelCapture();
  const keymap = currentKeymap();
  const menuAccelerators: Record<string, string> = {};
  for (const def of SHORTCUTS) {
    if (!def.menuItem) continue;
    const accelerator = toElectronAccelerator(keymap[def.id]?.[0] ?? '');
    if (accelerator) menuAccelerators[def.id] = accelerator;
  }

  const defaults = defaultKeymap(IS_MAC);
  const overrides: Record<string, string[]> = {};
  for (const [id, bindings] of Object.entries(pending)) {
    const normalized = bindings
      .map((binding) => normalizeBinding(binding))
      .filter((binding): binding is Binding => binding !== null);
    // An "override" identical to the default is not one. Storing it would pin this id to
    // today's default forever, which is the whole thing storing overrides avoids.
    if (JSON.stringify(normalized) === JSON.stringify(defaults[id])) continue;
    overrides[id] = normalized;
  }

  const result = await window.electronAPI.updateShortcuts({ overrides, menuAccelerators });
  state.shortcutOverrides = result.shortcuts;
  setKeymap(result.shortcuts);
  // The placeholders name these keys, so a rebind that didn't repaint them would leave two
  // labels on screen promising a shortcut that no longer exists.
  renderShortcutHints();
};
