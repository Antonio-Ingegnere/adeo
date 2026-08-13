/**
 * The Settings dialog's vertical tab rail.
 *
 * A `role="tablist"` of buttons with roving tabindex — exactly one tab is tabbable, the arrow
 * keys move between them — rather than the visually-hidden radios the search-mode switch uses.
 * The reason is the focus trap: it decides the modal's boundary from the first and last
 * *tabbable* element, and `HTMLElement.tabIndex` is what distinguishes a `tabindex="-1"` button.
 * Radios all report 0 whether checked or not, so a radio rail would leave a non-tabbable
 * element at the boundary and Tab would walk straight out of the dialog.
 *
 * The tabs and panels are static markup in index.html, not generated: `refs` in dom.ts is a
 * module-level object literal, so anything created later would be `null` there forever.
 */

import { refs } from './dom.js';
import { abortShortcutCapture } from './shortcutsSettings.js';

export type SettingsTab = 'general' | 'tasks' | 'shortcuts';

const DEFAULT_TAB: SettingsTab = 'general';

/**
 * Module-local, not UIState: no module outside this dialog needs to know which panel is up,
 * and the dialog is short-lived. Matches `pendingTagColor` in modals.ts and `pending` in
 * shortcutsSettings.ts, both modal-scoped for the same reason.
 */
let activeTab: SettingsTab = DEFAULT_TAB;

const tabs = (): HTMLButtonElement[] =>
  Array.from(refs.settingsRail?.querySelectorAll<HTMLButtonElement>('.settings-tab') ?? []);

const panelFor = (tab: HTMLButtonElement): HTMLElement | null =>
  document.getElementById(tab.getAttribute('aria-controls') ?? '');

export const selectSettingsTab = (name: SettingsTab, opts: { focus?: boolean } = {}) => {
  const all = tabs();
  if (all.length === 0) return;
  const target = all.find((tab) => tab.dataset.tab === name) ?? all[0];
  activeTab = (target.dataset.tab as SettingsTab) ?? DEFAULT_TAB;

  // A capture armed on the Shortcuts panel swallows every keypress, including the arrow keys
  // this rail wants. Leaving one running while another tab is up means the next key pressed
  // anywhere gets bound to something the user can no longer see.
  abortShortcutCapture();

  for (const tab of all) {
    const selected = tab === target;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    const panel = panelFor(tab);
    if (panel) panel.hidden = !selected;
  }
  if (opts.focus) target.focus();
};

const step = (offset: number) => {
  const all = tabs();
  const current = all.findIndex((tab) => tab.dataset.tab === activeTab);
  if (current === -1) return;
  const next = all[(current + offset + all.length) % all.length];
  selectSettingsTab(next.dataset.tab as SettingsTab, { focus: true });
};

export const setupSettingsTabs = () => {
  const rail = refs.settingsRail;
  if (!rail) return;

  rail.addEventListener('click', (event) => {
    const tab = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('.settings-tab');
    if (!tab?.dataset.tab) return;
    selectSettingsTab(tab.dataset.tab as SettingsTab);
  });

  rail.addEventListener('keydown', (event) => {
    // Left/Right are deliberately ignored: aria-orientation="vertical" promises they do nothing.
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        step(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        step(-1);
        break;
      case 'Home':
        event.preventDefault();
        selectSettingsTab(tabs()[0]?.dataset.tab as SettingsTab, { focus: true });
        break;
      case 'End':
        event.preventDefault();
        selectSettingsTab(tabs()[tabs().length - 1]?.dataset.tab as SettingsTab, { focus: true });
        break;
    }
  });
};

/**
 * Back to the first tab on every open. The dialog reseeds everything else from state, and
 * reopening onto Shortcuts because that is where you were last week reads as a glitch.
 */
export const seedSettingsTabs = () => {
  selectSettingsTab(DEFAULT_TAB);
};

export const focusActiveSettingsTab = () => {
  tabs()
    .find((tab) => tab.getAttribute('aria-selected') === 'true')
    ?.focus();
};
