/**
 * The keyboard-shortcut reference, generated from the registry rather than written out.
 *
 * Written-out rows would be a second source of truth for every binding, and would go stale
 * the moment someone rebound one — which, since bindings are user-editable, is the normal
 * case rather than the exception. Rendering on every open costs nothing at this size and
 * means a rebinding made a moment ago is already reflected.
 */

import { refs } from './dom.js';
import { formatBinding } from './shortcutKeys.js';
import {
  CATEGORY_ORDER,
  SHORTCUTS,
  type ShortcutCategory,
  type ShortcutDef,
} from './shortcutRegistry.js';
import { IS_MAC, getBindingsFor } from './shortcuts.js';

/** One <kbd> per keycap, so ⌘F reads as two keys rather than one wide blob. */
const keycaps = (binding: string): HTMLElement => {
  const wrap = document.createElement('span');
  wrap.className = 'shortcut-keys';
  for (const token of formatBinding(binding, IS_MAC)) {
    const kbd = document.createElement('kbd');
    kbd.textContent = token;
    wrap.appendChild(kbd);
  }
  return wrap;
};

const renderBindings = (id: string, displayAs: ShortcutDef['displayAs']): HTMLElement => {
  const cell = document.createElement('dd');
  cell.className = 'shortcut-binding-list';

  // A range or a pair stands in for its members: nine rows for ⌘1 through ⌘9 would be
  // eight rows of noise.
  const bindings = displayAs ? displayAs.bindings : getBindingsFor(id);
  const separator = displayAs ? displayAs.separator : 'or';

  if (bindings.length === 0) {
    const none = document.createElement('span');
    none.className = 'shortcut-unbound';
    none.textContent = 'Not set';
    cell.appendChild(none);
    return cell;
  }

  bindings.forEach((binding, index) => {
    if (index > 0) {
      const sep = document.createElement('span');
      sep.className = 'shortcut-sep';
      sep.textContent = separator;
      cell.appendChild(sep);
    }
    cell.appendChild(keycaps(binding));
  });
  return cell;
};

export const renderShortcutsHelp = () => {
  if (!refs.shortcutsBody) return;
  refs.shortcutsBody.innerHTML = '';

  const byCategory = new Map<ShortcutCategory, typeof SHORTCUTS>();
  for (const def of SHORTCUTS) {
    byCategory.set(def.category, [...(byCategory.get(def.category) ?? []), def]);
  }

  for (const category of CATEGORY_ORDER) {
    const defs = byCategory.get(category);
    if (!defs || defs.length === 0) continue;

    const section = document.createElement('section');
    section.className = 'shortcuts-section';

    const heading = document.createElement('h3');
    heading.textContent = category;
    section.appendChild(heading);

    const list = document.createElement('dl');
    list.className = 'shortcuts-list';
    for (const def of defs) {
      const row = document.createElement('div');
      // Fixed entries are here to be findable, not to be changed; muting them says so
      // without needing a caption to explain the difference.
      row.className = def.fixed ? 'shortcut-row is-fixed' : 'shortcut-row';

      const label = document.createElement('dt');
      label.textContent = def.label;
      row.appendChild(label);
      row.appendChild(renderBindings(def.id, def.displayAs));

      list.appendChild(row);
    }
    section.appendChild(list);
    refs.shortcutsBody.appendChild(section);
  }
};

export const openShortcutsHelp = () => {
  renderShortcutsHelp();
  refs.shortcutsOverlay?.classList.add('open');
  refs.shortcutsClose?.focus();
};

export const closeShortcutsHelp = () => {
  refs.shortcutsOverlay?.classList.remove('open');
};
