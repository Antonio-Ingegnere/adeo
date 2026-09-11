/**
 * The shortcut hints shown inside the two always-visible text inputs.
 *
 * Both are otherwise undiscoverable — nothing on screen says the search field has a key, or
 * the add-task field. A hint is only worth having if it is true, so these read the *live*
 * keymap rather than a hardcoded string: rebind the action and the placeholder follows, unbind
 * it and the placeholder stops claiming a key that no longer works.
 *
 * This module sits above both querySearch.ts and shortcuts.ts precisely so neither has to
 * import the other — shortcuts.ts already depends on querySearch.ts for isQuerySuggestOpen.
 */

import { refs } from './dom.js';
import { setSearchShortcutHint } from './querySearch.js';
import { formatBinding } from './shortcutKeys.js';
import { IS_MAC, getBindingsFor } from './shortcuts.js';
import { onLocaleChange, t } from './i18n/index.js';

/**
 * The first binding for an action, as keycaps. Empty when the action is unbound — callers
 * treat that as "say nothing" rather than showing an empty pair of brackets.
 */
export const shortcutHint = (id: string): string => {
  const binding = getBindingsFor(id)[0];
  return binding ? formatBinding(binding, IS_MAC).join('') : '';
};

/** Re-read the keymap and repaint both hints. Cheap; call it after any keymap change. */
export const renderShortcutHints = () => {
  setSearchShortcutHint(shortcutHint('search.focus'));

  if (refs.input) {
    // Read the placeholder from the active dictionary every call: this runs *after* setLocale
    // at boot (loadSettings) and would otherwise pin the field to English. The keyboard hint is
    // appended to whatever the current language calls "Add a new task".
    const base = t('compose.placeholder');
    const hint = shortcutHint('app.newTask');
    refs.input.placeholder = hint ? `${base} (${hint})` : base;
  }
};

// A language change does not otherwise re-run this (the Settings save path calls setLocale but
// not renderShortcutHints), so the add-task placeholder would stay in the previous language.
onLocaleChange(renderShortcutHints);
