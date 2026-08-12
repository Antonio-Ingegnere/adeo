/**
 * One document-level keydown listener that turns a keypress into a registered action.
 *
 * Registered in capture phase, and deliberately *before* installModalFocusTrap(): both listen
 * on document in capture, so they run in registration order, and being first is what lets
 * capture mode (the rebinding UI) intercept Tab before the focus trap consumes it. In normal
 * operation this listener never claims Tab, so the trap behaves exactly as it always has.
 */

import { activeOverlay } from './focusTrap.js';
import { isQuerySuggestOpen } from './querySearch.js';
import { isTagSuggestOpen } from './tagInput.js';
import { isDatePickerOpen } from './datepicker.js';
import {
  bindingFromEvent,
  hasStrongModifier,
  resolveKeymap,
  type Binding,
} from './shortcutKeys.js';
import {
  SHORTCUT_BY_ID,
  SHORTCUT_IDS,
  defaultKeymap,
  type ShortcutScope,
} from './shortcutRegistry.js';

/**
 * Returning false declines the key: the event is left completely alone, so the browser or a
 * lower handler still gets it. That is how "move task down" backs off at the end of the list
 * instead of swallowing ArrowDown.
 */
export type ShortcutHandler = (binding: Binding) => boolean | void;

/**
 * userAgentData isn't in every Electron version's lib.dom, so fall back to the deprecated but
 * reliable platform string. Case-insensitive: userAgentData.platform reports "macOS" while
 * navigator.platform reports "MacIntel".
 */
export const IS_MAC = /mac|iphone|ipad/i.test(
  (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform
);

let keymap: Record<string, Binding[]> = defaultKeymap(IS_MAC);
let byBinding = new Map<Binding, string[]>();
const handlers = new Map<string, ShortcutHandler>();
let captureCallback: ((binding: Binding | null) => void) | null = null;

const reindex = () => {
  byBinding = new Map();
  for (const [id, bindings] of Object.entries(keymap)) {
    const def = SHORTCUT_BY_ID.get(id);
    if (!def || def.fixed || def.menuItem) continue;
    for (const binding of bindings) {
      const ids = byBinding.get(binding) ?? [];
      ids.push(id);
      byBinding.set(binding, ids);
    }
  }
};
reindex();

/** Lay the user's overrides over the platform defaults. Unknown ids are reported, not kept. */
export const setKeymap = (overrides: Record<string, string[]> | null | undefined) => {
  const { keymap: resolved, dropped } = resolveKeymap(
    defaultKeymap(IS_MAC),
    overrides,
    SHORTCUT_IDS
  );
  // A fixed shortcut has no dispatch path, so an override on one could only ever mislead the
  // help overlay about what the key does.
  for (const id of Object.keys(resolved)) {
    if (SHORTCUT_BY_ID.get(id)?.fixed) resolved[id] = [...defaultKeymap(IS_MAC)[id]];
  }
  keymap = resolved;
  reindex();
  if (dropped.length) {
    console.warn('Ignoring saved shortcuts for unknown actions:', dropped.join(', '));
  }
};

export const getKeymap = (): Record<string, Binding[]> => ({ ...keymap });

export const getBindingsFor = (id: string): Binding[] => keymap[id] ?? [];

export const registerShortcutHandlers = (map: Record<string, ShortcutHandler>) => {
  for (const [id, handler] of Object.entries(map)) handlers.set(id, handler);
};

/**
 * Swallow the next keypress and report it as a binding, for the rebinding UI. Escape cancels
 * with null. This lives in the dispatcher rather than in a listener of its own because it has
 * to beat every other handler in the app, including the focus trap's Tab.
 */
export const beginCapture = (callback: (binding: Binding | null) => void) => {
  captureCallback = callback;
};

export const cancelCapture = () => {
  captureCallback = null;
};

const isTypingTarget = (el: Element | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  // SELECT counts: the repeat modal and the date-format setting are <select>s where the
  // arrow keys change the value, and stealing those would be a regression.
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
};

const currentContext = (): 'modal' | 'typing' | 'list' => {
  if (activeOverlay()) return 'modal';
  if (isTypingTarget(document.activeElement)) return 'typing';
  return 'list';
};

const scopeAllows = (scope: ShortcutScope, context: ReturnType<typeof currentContext>, binding: Binding) => {
  if (scope === 'list') return context === 'list';
  if (scope === 'modal') return context === 'modal';
  // A global shortcut works from inside a text field only if it carries a real modifier.
  // That one rule is what lets Mod+F fire while you're typing a query and keeps "?" inert
  // while you type a query that contains one — without special-casing either of them.
  return context !== 'typing' || hasStrongModifier(binding);
};

const onKeyDown = (event: KeyboardEvent) => {
  if (event.defaultPrevented) return;
  if (event.isComposing) return;

  const binding = bindingFromEvent(event, IS_MAC);
  if (!binding) return;

  if (captureCallback) {
    event.preventDefault();
    event.stopPropagation();
    const callback = captureCallback;
    captureCallback = null;
    callback(event.key === 'Escape' ? null : binding);
    return;
  }

  // These three own their arrows, Enter and Escape while they're up, and the date popover's
  // own handler registers only on open — i.e. after ours — so it can't defend itself here.
  if (isTagSuggestOpen() || isQuerySuggestOpen() || isDatePickerOpen()) return;

  const context = currentContext();
  for (const id of byBinding.get(binding) ?? []) {
    const def = SHORTCUT_BY_ID.get(id);
    if (!def || !scopeAllows(def.scope, context, binding)) continue;
    const handler = handlers.get(id);
    if (!handler) continue;
    if (handler(binding) === false) continue;
    event.preventDefault();
    event.stopPropagation();
    return;
  }
};

export const installShortcuts = () => {
  document.addEventListener('keydown', onKeyDown, true);
};
