// The Quick Add metadata row: task list, priority and reminder date for the *next* task,
// seeded through the same TaskSeed the smart-list template already uses (see
// activeSmartList.ts's templateSeed). Kept as a leaf module -- it must not import actions.ts,
// index.ts or tasks.ts -- so that actions.ts can call it without a cycle.
//
// The row carries no visible labels (the field name lives in each trigger's aria-label) and
// is *revealed by composer activity*, never a toggle: `shouldShowComposeMeta()` is a single
// derived predicate and `syncComposeMetaRow()` is its one applier, so the row's visibility
// can never disagree with the state that produced it. The predicate is written over *open
// surfaces* rather than DOM containment on purpose: the date popover lives in document.body
// (outside the compose block) and pressing the mouse on a role-less priority <div> row blurs
// the trigger to <body> before the click lands -- a `:focus-within` rule would collapse the
// row in both cases. See CLAUDE.md "Quick Add options".
import type { TaskSeed } from '../types.js';
import { refs } from './dom.js';
import { state } from './state.js';
import { attachDatePicker, isDatePickerOpen } from './datepicker.js';
import { renderListOptions } from './lists.js';
import { renderTemplateHints, resolveComposeDestination } from './activeSmartList.js';
import { asPriority, setPriorityAttr } from './theme.js';
import { onLocaleChange, t } from './i18n/index.js';

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

/** True while any of the row's three menus/popovers is open. Part of the visibility predicate
 * and the reason picking a value via the mouse (which blurs the trigger to <body>) does not
 * collapse the row mid-click. */
const anyComposeSurfaceOpen = (): boolean =>
  isComposeListMenuOpen() || isComposePriorityMenuOpen() || isDatePickerOpen();

const focusWithinComposeBlock = (): boolean =>
  Boolean(
    refs.composeBlock &&
      document.activeElement &&
      refs.composeBlock.contains(document.activeElement)
  );

const draftNonEmpty = (): boolean => Boolean(refs.input && refs.input.value.trim() !== '');

/** Single source of truth for whether the metadata row is shown. */
const shouldShowComposeMeta = (): boolean =>
  !state.boardMode &&
  !state.composeMetaDismissed &&
  (focusWithinComposeBlock() || draftNonEmpty() || anyComposeSurfaceOpen());

/** {} when nothing is set; otherwise priority and/or reminderDate. The list is not part of
 * TaskSeed -- composeListId is read directly by actions.ts via resolveComposeDestination(). */
export const composeSeed = (): Partial<TaskSeed> => {
  const seed: Partial<TaskSeed> = {};
  if (state.composePriority !== 'none') seed.priority = state.composePriority;
  if (state.composeReminderDate) seed.reminderDate = state.composeReminderDate;
  return seed;
};

/** The menu's own rows are always populated by renderListOptions -- state.lists is dynamic, so
 * there is no static markup for them (unlike priority's fixed four values). While
 * composeListId is untouched (undefined) the trigger names the *resolved* destination -- the
 * list the task would actually reach -- rather than a placeholder; the state stays undefined,
 * the name is display only (writing it back would strand a stale override on a view change). */
export const paintComposeListLabel = () => {
  renderListOptions(refs.composeListMenu, state.composeListId ?? null, refs.composeListValue);
  const explicit = state.composeListId !== undefined;
  if (!explicit && refs.composeListValue) {
    const destId = resolveComposeDestination();
    const list = destId === null ? null : state.lists.find((l) => l.id === destId) ?? null;
    const name = list ? list.name : t('compose.noList');
    refs.composeListValue.textContent = name;
    if (list) refs.composeListValue.title = list.name;
    else refs.composeListValue.removeAttribute('title');
  }
  const value = refs.composeListValue?.textContent || t('compose.noList');
  refs.composeListPicker?.setAttribute('aria-label', `${t('compose.listLabel')}: ${value}`);
  refs.composeListField?.setAttribute('data-set', String(explicit));
  refs.composeListPicker?.setAttribute('data-set', String(explicit));
};

const paintComposePriority = () => {
  const priority = asPriority(state.composePriority);
  setPriorityAttr(refs.composePriorityChip, priority);
  const word = t(`priority.${state.composePriority}` as const);
  if (refs.composePriorityValue) refs.composePriorityValue.textContent = word;
  refs.composePriorityPicker?.setAttribute('aria-label', `${t('compose.priorityLabel')}: ${word}`);
  const set = state.composePriority !== 'none';
  refs.composePriorityField?.setAttribute('data-set', String(set));
  refs.composePriorityPicker?.setAttribute('data-set', String(set));
};

const paintComposeReminder = () => {
  const set = state.composeReminderDate !== null;
  refs.composeReminderField?.setAttribute('data-set', String(set));
  // the trigger's own aria-label and visible label are maintained by datepicker.ts
  refs.composeReminderField
    ?.querySelector('.date-picker-trigger')
    ?.setAttribute('data-set', String(set));
};

export const resetComposeOptions = () => {
  state.composePriority = 'none';
  state.composeReminderDate = null;
  state.composeListId = undefined;
  if (refs.composeReminderDate) refs.composeReminderDate.value = '';
  paintComposeListLabel();
  paintComposePriority();
  paintComposeReminder();
  renderTemplateHints(true);
};

let composeMetaShown = false;

/** Applies shouldShowComposeMeta(). On a shown -> hidden transition every field is returned to
 * its default, so a hidden row can never leave metadata silently armed for the next task. */
export const syncComposeMetaRow = () => {
  const show = shouldShowComposeMeta();
  if (show === composeMetaShown) return;
  composeMetaShown = show;
  if (refs.composeMetaRow) refs.composeMetaRow.hidden = !show;
  if (!show) resetComposeOptions();
};

export const setupComposeOptions = () => {
  paintComposeListLabel();
  paintComposePriority();
  paintComposeReminder();

  // These labels ("No list" / resolved list name, the priority word) and the picker
  // aria-labels are built from t() here, which runs in init() before loadSettings() calls
  // setLocale -- and paintComposePriority() is never re-run afterwards. Re-paint them (and the
  // list menu's generated rows) whenever the language changes.
  onLocaleChange(() => {
    paintComposeListLabel();
    paintComposePriority();
    paintComposeReminder();
  });

  // --- shared selection + keyboard for the list and priority menus --------------------------
  const selectComposeListItem = (item: HTMLElement) => {
    const val = item.dataset.value ?? '';
    state.composeListId = val ? Number(val) : null;
    closeComposeListMenu();
    // restore focus to the trigger so the activity predicate keeps the row shown after a
    // mouse pick (the role-less rows are not focusable, so the click blurred it to <body>)
    refs.composeListPicker?.focus();
    paintComposeListLabel();
    renderTemplateHints(true);
    syncComposeMetaRow();
  };

  const selectComposePriorityItem = (item: HTMLElement) => {
    const val = (item.getAttribute('data-value') as typeof state.composePriority) ?? 'none';
    state.composePriority = val;
    closeComposePriorityMenu();
    refs.composePriorityPicker?.focus();
    paintComposePriority();
    renderTemplateHints(true);
    syncComposeMetaRow();
  };

  /** Roving focus (Up/Down/Home/End) plus Enter/Space activation for one open menu. Items
   *  carry focus themselves -- list rows are <button>s already, priority rows are given
   *  tabindex -1 when the menu opens -- so this only moves focus and fires the selection.
   *  preventDefault() on Enter/Space also suppresses a <button>'s synthetic click, so the
   *  selection never runs twice. Arrow keys reach here because focus sits inside #compose-block,
   *  where the global list-scoped nav shortcuts are declined. */
  const wireComposeMenuKeys = (
    menu: HTMLElement | null,
    itemSelector: string,
    select: (item: HTMLElement) => void
  ) => {
    menu?.addEventListener('keydown', (event) => {
      const items = Array.from(menu.querySelectorAll<HTMLElement>(itemSelector));
      if (items.length === 0) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      let next = -1;
      switch (event.key) {
        case 'ArrowDown':
          next = index < 0 ? 0 : (index + 1) % items.length;
          break;
        case 'ArrowUp':
          next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = items.length - 1;
          break;
        case 'Enter':
        case ' ':
          if (index < 0) return;
          event.preventDefault();
          select(items[index]);
          return;
        default:
          return;
      }
      event.preventDefault();
      items[next]?.focus();
    });
  };

  /** Move focus onto the current value's row (or the first) when a menu opens. */
  const focusComposeMenu = (menu: HTMLElement | null, itemSelector: string, activeValue: string) => {
    if (!menu) return;
    const items = Array.from(menu.querySelectorAll<HTMLElement>(itemSelector));
    items.forEach((el) => {
      // <button> rows stay in the Tab order; the priority menu's <div> rows need a tabindex to
      // be focusable at all, and -1 keeps the menu a single Tab stop (arrows move within it).
      if (el.tagName !== 'BUTTON' && !el.hasAttribute('tabindex')) el.tabIndex = -1;
    });
    const current = items.find((el) => (el.dataset.value ?? '') === activeValue);
    (current ?? items[0])?.focus();
  };

  refs.composeListPicker?.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = !isComposeListMenuOpen();
    // Only one of the row's three surfaces is open at a time -- opening this one closes the
    // other two (their own stopPropagation() keeps the document-level closer from doing it).
    if (open) {
      closeComposePriorityMenu();
      composeDatePicker?.close();
    }
    // state.lists can change (a list added/renamed/deleted) any time this stays closed, so the
    // menu is refreshed on open rather than kept live -- the same lazy-repaint pattern the edit
    // dialog's own list menu uses (renderModalLists() on openEditModal).
    if (open) paintComposeListLabel();
    if (refs.composeListMenu) refs.composeListMenu.style.display = open ? 'flex' : 'none';
    refs.composeListPicker?.setAttribute('aria-expanded', String(open));
    if (open) {
      focusComposeMenu(
        refs.composeListMenu,
        '.modal-list-item',
        state.composeListId != null ? String(state.composeListId) : ''
      );
    }
    syncComposeMetaRow();
  });

  refs.composeListMenu?.addEventListener('click', (event) => {
    event.stopPropagation();
    const item = (event.target as HTMLElement).closest('.modal-list-item') as HTMLElement | null;
    if (item) selectComposeListItem(item);
  });
  wireComposeMenuKeys(refs.composeListMenu, '.modal-list-item', selectComposeListItem);

  refs.composePriorityPicker?.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = !isComposePriorityMenuOpen();
    if (open) {
      closeComposeListMenu();
      composeDatePicker?.close();
    }
    if (refs.composePriorityMenu) refs.composePriorityMenu.style.display = open ? 'flex' : 'none';
    refs.composePriorityPicker?.setAttribute('aria-expanded', String(open));
    if (open) {
      focusComposeMenu(refs.composePriorityMenu, '.priority-menu-item', state.composePriority);
    }
    syncComposeMetaRow();
  });

  refs.composePriorityMenu?.addEventListener('click', (event) => {
    event.stopPropagation();
    const item = (event.target as HTMLElement).closest('.priority-menu-item') as HTMLElement | null;
    if (item) selectComposePriorityItem(item);
  });
  wireComposeMenuKeys(refs.composePriorityMenu, '.priority-menu-item', selectComposePriorityItem);

  const composeDatePicker = attachDatePicker(refs.composeReminderDate, {
    accessibleName: t('compose.reminderAria'),
  });
  // Opening the reminder popover closes the list and priority menus. Its own trigger handler
  // stopPropagation()s, so the document-level closer never sees the click; this runs right
  // after that handler (registered later on the same element) and drops the other two.
  composeDatePicker?.trigger.addEventListener('click', () => {
    if (!composeDatePicker.isOpen()) return;
    closeComposeListMenu();
    closeComposePriorityMenu();
    syncComposeMetaRow();
  });
  paintComposeReminder(); // the generated .date-picker-trigger now exists
  refs.composeReminderDate?.addEventListener('change', (event) => {
    const val = (event.target as HTMLInputElement).value;
    state.composeReminderDate = val || null;
    paintComposeReminder();
    renderTemplateHints(true);
    syncComposeMetaRow();
  });

  // Escape, one surface per press, layered by stopPropagation(): the tag suggestion menu
  // (owned by tagInput.ts on #message-input, runs first) -> the reminder date popover (owned
  // by datepicker.ts) -> the list menu -> the priority menu -> collapse the row. A hidden row
  // takes no Escape, so it falls through to the app's own handler (clear search / close menu).
  refs.composeBlock?.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
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
    if (refs.composeMetaRow && !refs.composeMetaRow.hidden) {
      event.stopPropagation();
      state.composeMetaDismissed = true;
      syncComposeMetaRow();
      refs.input?.focus();
    }
  });

  // Visibility follows composer activity. Both focusin and focusout re-check on the next frame
  // rather than synchronously: the shown -> hidden transition hides three focusable elements
  // that sit *before* the task list in tab order, and doing that inside the focusin handler of
  // the element Tab just moved to (the first task row) can strand focus on <body>, so the row
  // ends up needing a second Tab to reach it. Deferring lets the browser settle focus and the
  // task list paint its cursor ring first. The dismissed flag clears whenever focus enters the
  // compose block from outside, which is how the row comes back after Escape.
  let wasFocusInside = false;
  const onFocusChange = () => {
    const inside = focusWithinComposeBlock();
    if (inside && !wasFocusInside) state.composeMetaDismissed = false;
    wasFocusInside = inside;
    syncComposeMetaRow();
  };
  document.addEventListener('focusin', () => requestAnimationFrame(onFocusChange));
  document.addEventListener('focusout', () => requestAnimationFrame(onFocusChange));

  syncComposeMetaRow();
};
