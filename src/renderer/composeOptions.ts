// The Quick Add "Options" disclosure: task list, priority and reminder date for the *next*
// task, seeded through the same TaskSeed the smart-list template already uses (see
// activeSmartList.ts's templateSeed). Kept as a leaf module -- it must not import actions.ts,
// index.ts or tasks.ts -- so that actions.ts can call it without a cycle.
import type { TaskSeed } from '../types.js';
import { refs } from './dom.js';
import { state } from './state.js';
import { formatDate } from './helpers.js';
import { attachDatePicker, isDatePickerOpen } from './datepicker.js';
import { renderListOptions } from './lists.js';
import { renderTemplateHints } from './activeSmartList.js';
import { asPriority, setPriorityAttr } from './theme.js';

export const isComposeOptionsOpen = (): boolean =>
  Boolean(refs.composeOptionsPanel && !refs.composeOptionsPanel.hidden);

const isComposeListMenuOpen = (): boolean =>
  Boolean(refs.composeListMenu && refs.composeListMenu.style.display === 'flex');

const isComposePriorityMenuOpen = (): boolean =>
  Boolean(refs.composePriorityMenu && refs.composePriorityMenu.style.display === 'flex');

const closeComposeListMenu = () => {
  if (refs.composeListMenu) refs.composeListMenu.style.display = 'none';
  refs.composeListPicker?.setAttribute('aria-expanded', 'false');
};

const closeComposePriorityMenu = () => {
  if (refs.composePriorityMenu) refs.composePriorityMenu.style.display = 'none';
  refs.composePriorityPicker?.setAttribute('aria-expanded', 'false');
};

/** The menu's own rows are always populated by renderListOptions -- state.lists is dynamic, so
 * there is no static markup for them (unlike priority's fixed four values). See Proposed
 * Solution §9: renderListOptions only knows number | null, so while composeListId is untouched
 * (undefined) its own label output ("No list") would be wrong -- nothing has been overridden
 * yet -- and gets overwritten with "Current list" immediately after. */
const paintComposeListLabel = () => {
  renderListOptions(refs.composeListMenu, state.composeListId ?? null, refs.composeListValue);
  if (state.composeListId === undefined && refs.composeListValue) {
    refs.composeListValue.textContent = 'Current list';
    refs.composeListValue.removeAttribute('title');
  }
};

const paintComposePriority = () => {
  const priority = asPriority(state.composePriority);
  setPriorityAttr(refs.composePriorityChip, priority);
  if (refs.composePriorityValue) {
    refs.composePriorityValue.textContent = priority.charAt(0).toUpperCase() + priority.slice(1);
  }
};

/** True when any of the three fields has been explicitly set -- drives the toggle's data-active
 * cue (the chip row below is the actual non-colour cue; this is only a quiet visual hint). */
export const hasComposeOptions = (): boolean =>
  state.composePriority !== 'none' || state.composeReminderDate !== null || state.composeListId !== undefined;

const paintToggleState = () => {
  if (refs.composeOptionsToggle) {
    refs.composeOptionsToggle.dataset.active = hasComposeOptions() ? 'true' : 'false';
  }
};

export const closeComposeOptions = (restoreFocus: boolean) => {
  if (!refs.composeOptionsPanel || refs.composeOptionsPanel.hidden) return;
  refs.composeOptionsPanel.hidden = true;
  refs.composeOptionsToggle?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) refs.composeOptionsToggle?.focus();
};

const openComposeOptions = () => {
  if (!refs.composeOptionsPanel) return;
  refs.composeOptionsPanel.hidden = false;
  refs.composeOptionsToggle?.setAttribute('aria-expanded', 'true');
  refs.composeListPicker?.focus();
};

/** {} when nothing is set; otherwise priority and/or reminderDate. The list is not part of
 * TaskSeed -- composeListId is read directly by actions.ts as addTask()'s own listId argument
 * (see Proposed Solution §2). */
export const composeSeed = (): Partial<TaskSeed> => {
  const seed: Partial<TaskSeed> = {};
  if (state.composePriority !== 'none') seed.priority = state.composePriority;
  if (state.composeReminderDate) seed.reminderDate = state.composeReminderDate;
  return seed;
};

export const resetComposeOptions = () => {
  state.composePriority = 'none';
  state.composeReminderDate = null;
  state.composeListId = undefined;
  paintComposeListLabel();
  paintComposePriority();
  if (refs.composeReminderDate) refs.composeReminderDate.value = '';
  paintToggleState();
  closeComposeOptions(false);
  renderTemplateHints(true);
};

export const setupComposeOptions = () => {
  paintComposeListLabel();
  paintComposePriority();
  paintToggleState();

  refs.composeOptionsToggle?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (isComposeOptionsOpen()) closeComposeOptions(false);
    else openComposeOptions();
  });

  refs.composeListPicker?.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = !isComposeListMenuOpen();
    // state.lists can change (a list added/renamed/deleted) any time this stays closed, so the
    // menu is refreshed on open rather than kept live -- the same lazy-repaint pattern the edit
    // dialog's own list menu uses (renderModalLists() on openEditModal).
    if (open) paintComposeListLabel();
    if (refs.composeListMenu) refs.composeListMenu.style.display = open ? 'flex' : 'none';
    refs.composeListPicker?.setAttribute('aria-expanded', String(open));
  });

  refs.composeListMenu?.addEventListener('click', (event) => {
    event.stopPropagation();
    const target = event.target as HTMLElement;
    const item = target.closest('.modal-list-item') as HTMLElement | null;
    if (!item) return;
    const val = item.dataset.value ?? '';
    state.composeListId = val ? Number(val) : null;
    renderListOptions(refs.composeListMenu, state.composeListId, refs.composeListValue);
    closeComposeListMenu();
    paintToggleState();
    renderTemplateHints(true);
  });

  refs.composePriorityPicker?.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = !isComposePriorityMenuOpen();
    if (refs.composePriorityMenu) refs.composePriorityMenu.style.display = open ? 'flex' : 'none';
    refs.composePriorityPicker?.setAttribute('aria-expanded', String(open));
  });

  refs.composePriorityMenu?.addEventListener('click', (event) => {
    event.stopPropagation();
    const target = event.target as HTMLElement;
    const item = target.closest('.priority-menu-item') as HTMLElement | null;
    if (!item) return;
    const val = (item.getAttribute('data-value') as typeof state.composePriority) ?? 'none';
    state.composePriority = val;
    paintComposePriority();
    closeComposePriorityMenu();
    paintToggleState();
    renderTemplateHints(true);
  });

  attachDatePicker(refs.composeReminderDate, { accessibleName: 'Reminder' });
  refs.composeReminderDate?.addEventListener('change', (event) => {
    const val = (event.target as HTMLInputElement).value;
    state.composeReminderDate = val || null;
    paintToggleState();
    renderTemplateHints(true);
  });

  refs.composeOptionsPanel?.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    // Escape closes exactly one surface per press (Proposed Solution §5): the list menu, then
    // the priority menu, then the panel itself -- matching the panel's left-to-right order. The
    // date popover owns its own Escape via datepicker.ts and is not handled here.
    if (isComposeListMenuOpen()) {
      event.stopPropagation();
      closeComposeListMenu();
      refs.composeListPicker?.focus();
      return;
    }
    if (isComposePriorityMenuOpen()) {
      event.stopPropagation();
      closeComposePriorityMenu();
      refs.composePriorityPicker?.focus();
      return;
    }
    if (isDatePickerOpen()) return;
    event.stopPropagation();
    closeComposeOptions(true);
  });
};
