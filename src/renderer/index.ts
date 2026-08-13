import { addTask, loadLists, loadSettings, loadTags, loadTasks } from './actions.js';
import { refs } from './dom.js';
import { renderListOptions, renderLists, toggleListsExpanded } from './lists.js';
import { mergeTag, renderTags, toggleTagsExpanded } from './tags.js';
import { loadSmartLists, renderSmartLists, toggleSmartListsExpanded } from './smartLists.js';
import {
  activeSmartList,
  associatedSmartList,
  invalidateSmartListUI,
  syncSmartListUI,
} from './activeSmartList.js';
import { exitViewBarNaming, renderViewBar, showViewBarError } from './viewBar.js';
import { parseQuery } from './query.js';
import {
  applySearchQuery,
  clearSearch,
  closeQueryPopovers,
  setSearchMode,
  setupQuerySearch,
} from './querySearch.js';
import { isTagSuggestOpen, setupTagInput } from './tagInput.js';
import {
  attachTaskListDnD,
  attachTaskListKeyboard,
  deleteTask,
  focusTaskEdge,
  moveTaskByOffset,
  moveTaskFocus,
  renderTasks,
  toggleTaskDone,
} from './tasks.js';
import {
  closeEditModal,
  closeListModal,
  closeTagModal,
  openEditListModal,
  openEditModal,
  openEditTagModal,
  openListModal,
  renderModalLists,
  renderTagsMenu,
  saveEdit,
  saveList,
  saveTag,
  updatePriorityUI,
  updateReminderUI,
  updateRepeatUI,
  updateTagsUI,
} from './modals.js';
import { state } from './state.js';
import type { SmartList, Tag, Theme } from '../types.js';
import { formatDate, positionDropdown } from './helpers.js';
import { attachDatePicker } from './datepicker.js';
import { activeOverlay, installModalFocusTrap } from './focusTrap.js';
import {
  installShortcuts,
  registerShortcutHandlers,
  type ShortcutHandler,
} from './shortcuts.js';
import { renderShortcutHints } from './shortcutHints.js';
import { closeShortcutsHelp, openShortcutsHelp } from './shortcutsHelp.js';
import {
  saveShortcutSettings,
  seedShortcutSettings,
  setupShortcutSettings,
} from './shortcutsSettings.js';

/** Menu down and the button's aria-expanded back to false; the two must never disagree. */
const closeViewMenu = () => {
  if (refs.viewMenu) {
    refs.viewMenu.style.display = 'none';
  }
  refs.viewPicker?.setAttribute('aria-expanded', 'false');
};

/**
 * Selecting a list is a view change: it clears whatever search is running, because the view is
 * one thing at a time and a picker that says "Work" over a screen of query results is the
 * incoherence this whole arrangement exists to remove.
 */
const selectList = (listId: number | null) => {
  state.selectedListId = listId;
  exitViewBarNaming();
  clearSearch();
  closeViewMenu();
  renderViewBar();
  renderLists();
  renderSmartLists();
  renderTasks();
};

// ---------- Smart lists ----------

const showSmartListError = (message: string | null) => {
  if (!refs.smartListModalError) return;
  refs.smartListModalError.textContent = message ?? '';
  refs.smartListModalError.style.display = message ? 'block' : 'none';
};

const closeSmartListModal = () => {
  refs.smartListOverlay?.classList.remove('open');
  state.editingSmartListId = null;
  showSmartListError(null);
};

/** With no id, saves whatever query is currently in the search bar. */
const openSmartListModal = (smartListId?: number) => {
  const existing =
    smartListId !== undefined ? state.smartLists.find((f) => f.id === smartListId) : undefined;
  state.editingSmartListId = existing?.id ?? null;
  showSmartListError(null);

  if (refs.smartListModalTitle) {
    refs.smartListModalTitle.textContent = existing ? 'Edit smart list' : 'Save smart list';
  }
  if (refs.smartListNameInput) {
    refs.smartListNameInput.value = existing?.name ?? '';
  }
  if (refs.smartListQueryInput) {
    refs.smartListQueryInput.value = existing?.query ?? state.searchQuery.trim();
  }

  if (!existing && !refs.smartListQueryInput?.value) {
    // nothing to save: tell the user how to get a query rather than opening an empty dialog
    showSmartListError('Type a query in the search bar first, then save it here.');
  }

  refs.smartListOverlay?.classList.add('open');
  refs.smartListNameInput?.focus();
  refs.smartListNameInput?.select();
};

const clearTagFilter = () => {
  state.selectedTagId = null;
  renderViewBar();
  renderTags();
  renderTasks();
};

// ---------- Settings modal ----------

/** Seeds every control from state, since the modal keeps no scratch copy of its own. */
const openSettingsModal = () => {
  if (!refs.settingsOverlay) return;
  if (state.timeFormat === '24h') {
    if (refs.settingsRadio24) refs.settingsRadio24.checked = true;
  } else if (refs.settingsRadio12) {
    refs.settingsRadio12.checked = true;
  }
  if (refs.dateFormatSelect) {
    refs.dateFormatSelect.value = state.dateFormat;
  }
  seedThemeRadio();
  if (refs.tagColorsCheckbox) refs.tagColorsCheckbox.checked = state.tagColors;
  seedShortcutSettings();
  refs.settingsOverlay.classList.add('open');
};

const closeSettingsModal = () => {
  refs.settingsOverlay?.classList.remove('open');
};

/** The smart list already holding this name, if any — matched case-insensitively, as the DB does. */
const smartListNamed = (name: string, exceptId: number | null) =>
  state.smartLists.find(
    (f) => f.id !== exceptId && f.name.toLowerCase() === name.toLowerCase()
  ) ?? null;

const saveSmartList = async () => {
  const name = refs.smartListNameInput?.value.trim() ?? '';
  const query = refs.smartListQueryInput?.value.trim() ?? '';
  if (!name) {
    showSmartListError('Give the smart list a name.');
    refs.smartListNameInput?.focus();
    return;
  }
  if (!query) {
    showSmartListError('A smart list needs a query.');
    refs.smartListQueryInput?.focus();
    return;
  }
  // refuse to save something that will never run; the error is the parser's own wording
  const parsed = parseQuery(query);
  if (!parsed.ok) {
    showSmartListError(`${parsed.error.message} (column ${parsed.error.position + 1})`);
    refs.smartListQueryInput?.focus();
    return;
  }

  // The name is unique, but reusing one is a normal thing to want -- you refine a query and
  // save it under the name you already think of it by. Caught here rather than left to the
  // server's 400 so it can be offered as a choice instead of reported as a dead end.
  const clash = smartListNamed(name, state.editingSmartListId);
  if (clash) {
    const replace = await window.electronAPI.confirmReplaceSmartList(clash.name);
    if (!replace) {
      refs.smartListNameInput?.focus();
      refs.smartListNameInput?.select();
      return;
    }
    if (state.editingSmartListId === null) {
      // creating under a taken name *is* an edit of the one that has it: keeping its id means
      // its sidebar position survives, and anyone with it running keeps it running
      state.editingSmartListId = clash.id;
    } else {
      // renaming one onto another's name: the other has to go, or the name stays taken. The
      // one being edited keeps its identity, which is the one the user has in front of them.
      await window.electronAPI.deleteSmartList(clash.id);
      state.smartLists = state.smartLists.filter((f) => f.id !== clash.id);
    }
  }

  try {
    if (state.editingSmartListId !== null) {
      const id = state.editingSmartListId;
      // whether this one was running has to be read *before* the edit lands, since
      // activeSmartList compares against the stored query the edit is about to replace
      const wasRunning = activeSmartList()?.id === id;
      const renamed = await window.electronAPI.updateSmartListName(id, name);
      if ((renamed as { error?: string }).error) {
        showSmartListError((renamed as { error: string }).error);
        return;
      }
      const requeried = await window.electronAPI.updateSmartListQuery(id, query);
      if ((requeried as { error?: string }).error) {
        showSmartListError((requeried as { error: string }).error);
        return;
      }
      state.smartLists = state.smartLists.map((f) => (f.id === id ? { ...f, name, query } : f));
      // editing the query of the one on screen would otherwise leave the *old* query running
      // and, because "running" is derived by comparing the two, silently deselect it
      if (wasRunning && refs.listsSearchInput) {
        refs.listsSearchInput.value = query;
        applySearchQuery(query, true);
      }
    } else {
      const created = await window.electronAPI.addSmartList(name, query);
      if ((created as { error?: string }).error) {
        showSmartListError((created as { error: string }).error);
        return;
      }
      state.smartLists.push(created as SmartList);
      // saving the bar's own query means the user is now working on this one
      if (query === state.searchQuery.trim()) {
        state.smartListOrigin = (created as SmartList).id;
      }
    }
    closeSmartListModal();
    invalidateSmartListUI();
    syncSmartListUI(renderSmartLists);
    renderSmartLists();
    renderViewBar();
  } catch (error) {
    console.error('Failed to save smart list', error);
    showSmartListError('Could not save the smart list.');
  }
};

/** Selecting a smart list is just running its query — no separate filtering path. */
const runSmartList = (smartListId: number) => {
  const smartList = state.smartLists.find((f) => f.id === smartListId);
  if (!smartList || !refs.listsSearchInput) return;
  // the *association*, so that clicking the pill of a smart list you have edited puts its
  // saved query back rather than reading as "clear this"
  const current = associatedSmartList();
  const alreadyRunning = current?.smartList.id === smartList.id && !current.edited;
  // clicking the running smart list clears it, matching how list and tag pills toggle
  const nextQuery = alreadyRunning ? '' : smartList.query;
  exitViewBarNaming();
  setSearchMode('advanced');
  state.smartListOrigin = alreadyRunning ? null : smartList.id;
  refs.listsSearchInput.value = nextQuery;
  applySearchQuery(nextQuery, true);
  // clearing one puts the caret back in an empty field, ready to type; running one leaves
  // focus alone, since the query it just loaded is the thing to read
  if (alreadyRunning) refs.listsSearchInput.focus();
  closeViewMenu();
  invalidateSmartListUI();
  syncSmartListUI(renderSmartLists);
  renderSmartLists();
  // the list pills have to give up the highlight this smart list just took, and take it back
  // when the query is cleared: both directions run through the view, so both need the repaint
  renderLists();
  renderViewBar();
};

/**
 * "Update": the whole point of tracking the association. One click, no modal and no name to
 * retype -- saving an edit you are already looking at should not be a dialog.
 */
const updateSmartListFromBar = async () => {
  const association = associatedSmartList();
  if (!association) return;
  const query = state.searchQuery.trim();
  if (!query) return;
  const id = association.smartList.id;
  try {
    const result = await window.electronAPI.updateSmartListQuery(id, query);
    if ((result as { error?: string }).error) {
      showViewBarError((result as { error: string }).error);
      return;
    }
    state.smartLists = state.smartLists.map((f) => (f.id === id ? { ...f, query } : f));
  } catch (error) {
    console.error('Failed to update smart list', error);
    showViewBarError('Could not update the smart list.');
    return;
  }
  // the query now equals the stored one, so the association goes back to a plain match and
  // the "edited" marker comes down on its own
  invalidateSmartListUI();
  syncSmartListUI(renderSmartLists);
  renderSmartLists();
  renderViewBar();
};

/** "Save as smart list" / "Save as new": named in the bar, so there is no modal in the way. */
const createSmartListFromBar = async (name: string) => {
  const query = state.searchQuery.trim();
  if (!query) return;
  const parsed = parseQuery(query);
  if (!parsed.ok) {
    showViewBarError(`${parsed.error.message} (column ${parsed.error.position + 1})`);
    return;
  }
  try {
    const clash = smartListNamed(name, null);
    if (clash) {
      const replace = await window.electronAPI.confirmReplaceSmartList(clash.name);
      if (!replace) {
        showViewBarError('That name is taken.');
        return;
      }
      // replacing keeps the clashing record's id, so its sidebar position survives and anyone
      // running it keeps running it -- only the query changes, and the name is already right
      const result = await window.electronAPI.updateSmartListQuery(clash.id, query);
      if ((result as { error?: string }).error) {
        showViewBarError((result as { error: string }).error);
        return;
      }
      state.smartLists = state.smartLists.map((f) => (f.id === clash.id ? { ...f, query } : f));
      state.smartListOrigin = clash.id;
    } else {
      const created = await window.electronAPI.addSmartList(name, query);
      if ((created as { error?: string }).error) {
        showViewBarError((created as { error: string }).error);
        return;
      }
      state.smartLists.push(created as SmartList);
      state.smartListOrigin = (created as SmartList).id;
    }
  } catch (error) {
    console.error('Failed to save smart list', error);
    showViewBarError('Could not save the smart list.');
    return;
  }
  exitViewBarNaming();
  invalidateSmartListUI();
  syncSmartListUI(renderSmartLists);
  renderSmartLists();
  renderViewBar();
  refs.listsSearchInput?.focus();
};

const toDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const setSelectOptions = (
  select: HTMLSelectElement | null,
  options: Array<{ value: string; label: string; disabled?: boolean }>,
  selectedValue?: string
) => {
  if (!select) return;
  select.innerHTML = '';
  options.forEach((option) => {
    const el = document.createElement('option');
    el.value = option.value;
    el.textContent = option.label;
    if (option.disabled) el.disabled = true;
    select.appendChild(el);
  });
  if (selectedValue !== undefined) {
    select.value = selectedValue;
  }
};

const weekdayMap: Record<string, string> = {
  mon: 'MO',
  tue: 'TU',
  wed: 'WE',
  thu: 'TH',
  fri: 'FR',
  sat: 'SA',
  sun: 'SU',
};

const weekdayLabelMap: Record<string, string> = {
  Monday: 'MO',
  Tuesday: 'TU',
  Wednesday: 'WE',
  Thursday: 'TH',
  Friday: 'FR',
  Saturday: 'SA',
  Sunday: 'SU',
};

const monthLabelMap: Record<string, number> = {
  January: 1,
  February: 2,
  March: 3,
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12,
};

const monthNumberMap: Record<string, string> = {
  '1': 'January',
  '2': 'February',
  '3': 'March',
  '4': 'April',
  '5': 'May',
  '6': 'June',
  '7': 'July',
  '8': 'August',
  '9': 'September',
  '10': 'October',
  '11': 'November',
  '12': 'December',
};

const toRruleDate = (value: string) => value.replace(/-/g, '');

const getDefaultRepeatStart = () => state.modalReminderDate ?? toDateInputValue(new Date());

const syncReminderFromRepeatStart = (repeatStart: string | null) => {
  if (!repeatStart || state.modalReminderDate) return;
  state.modalReminderDate = repeatStart;
  if (refs.reminderDateInput) {
    refs.reminderDateInput.value = repeatStart;
  }
  updateReminderUI(state.modalReminderDate, state.modalReminderTime);
};

const ordinalToBysetpos = (value: string) => {
  switch (value) {
    case 'First':
      return 1;
    case 'Second':
      return 2;
    case 'Third':
      return 3;
    case 'Fourth':
      return 4;
    case 'Last':
      return -1;
    default:
      return 1;
  }
};

const bysetposToOrdinal = (value: string) => {
  switch (value) {
    case '1':
      return 'First';
    case '2':
      return 'Second';
    case '3':
      return 'Third';
    case '4':
      return 'Fourth';
    case '-1':
      return 'Last';
    default:
      return 'First';
  }
};

const buildWeeklyByday = (selected: string[], startDate: string) => {
  if (selected.length) {
    return selected.map((day) => weekdayMap[day]).filter(Boolean);
  }
  const start = new Date(`${startDate}T00:00:00`);
  const dayIndex = start.getDay();
  const order = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  return [order[dayIndex] ?? 'MO'];
};

const buildMonthlyOrYearlyByday = (weekdayValue: string, ordinalValue: string) => {
  const ordinal = ordinalToBysetpos(ordinalValue);
  if (weekdayValue === 'Day') {
    return { bymonthday: ordinal === -1 ? '-1' : String(ordinal) };
  }
  if (weekdayValue === 'Weekday') {
    return { byday: 'MO,TU,WE,TH,FR', bysetpos: String(ordinal) };
  }
  if (weekdayValue === 'Weekend Day') {
    return { byday: 'SA,SU', bysetpos: String(ordinal) };
  }
  const mapped = weekdayLabelMap[weekdayValue];
  if (mapped) {
    return { byday: mapped, bysetpos: String(ordinal) };
  }
  return { byday: 'MO', bysetpos: String(ordinal) };
};

const buildPresetRepeatRule = (type: string) => {
  const start = getDefaultRepeatStart();
  const startDate = start;
  const ruleParts: string[] = [];
  if (type === 'daily') {
    ruleParts.push('FREQ=DAILY');
  } else if (type === 'weekdays') {
    ruleParts.push('FREQ=WEEKLY', 'BYDAY=MO,TU,WE,TH,FR');
  } else if (type === 'weekly') {
    const byday = buildWeeklyByday([], startDate).join(',');
    ruleParts.push('FREQ=WEEKLY', `BYDAY=${byday}`);
  } else if (type === 'monthly') {
    const day = new Date(`${startDate}T00:00:00`).getDate();
    ruleParts.push('FREQ=MONTHLY', `BYMONTHDAY=${day}`);
  } else if (type === 'yearly') {
    const date = new Date(`${startDate}T00:00:00`);
    ruleParts.push('FREQ=YEARLY', `BYMONTH=${date.getMonth() + 1}`, `BYMONTHDAY=${date.getDate()}`);
  } else {
    return null;
  }
  return { rule: ruleParts.join(';'), start };
};

const buildCustomRepeatRule = () => {
  const start = refs.repeatStartDate?.value || getDefaultRepeatStart();
  const type = refs.repeatTypeSelect?.value ?? 'daily';
  const interval = Number(refs.repeatIntervalSelect?.value ?? '1');
  const ruleParts: string[] = [];

  if (type === 'daily') {
    ruleParts.push('FREQ=DAILY');
  } else if (type === 'weekly') {
    const selectedDays = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.repeat-day-button.selected')
    ).map((button) => button.dataset.day || '');
    const byday = buildWeeklyByday(selectedDays, start).join(',');
    ruleParts.push('FREQ=WEEKLY', `BYDAY=${byday}`);
  } else if (type === 'monthly') {
    ruleParts.push('FREQ=MONTHLY');
    const mode =
      (document.querySelector<HTMLInputElement>('input[name="repeat-monthly-mode"]:checked')?.value as string) ?? 'day';
    if (mode === 'day') {
      const day = refs.repeatMonthlyDay?.value ?? '1';
      ruleParts.push(`BYMONTHDAY=${day}`);
    } else {
      const ordinal = refs.repeatMonthlyOrdinal?.value ?? 'First';
      const weekday = refs.repeatMonthlyWeekday?.value ?? 'Monday';
      const parts = buildMonthlyOrYearlyByday(weekday, ordinal);
      if (parts.byday) ruleParts.push(`BYDAY=${parts.byday}`);
      if (parts.bysetpos) ruleParts.push(`BYSETPOS=${parts.bysetpos}`);
      if (parts.bymonthday) ruleParts.push(`BYMONTHDAY=${parts.bymonthday}`);
    }
  } else if (type === 'yearly') {
    ruleParts.push('FREQ=YEARLY');
    const monthLabel = refs.repeatYearlyMonth?.value ?? 'January';
    const month = monthLabelMap[monthLabel] ?? 1;
    ruleParts.push(`BYMONTH=${month}`);
    const mode =
      (document.querySelector<HTMLInputElement>('input[name="repeat-yearly-mode"]:checked')?.value as string) ?? 'day';
    if (mode === 'day') {
      const day = refs.repeatYearlyDay?.value ?? '1';
      ruleParts.push(`BYMONTHDAY=${day}`);
    } else {
      const ordinal = refs.repeatYearlyOrdinal?.value ?? 'First';
      const weekday = refs.repeatYearlyWeekday?.value ?? 'Monday';
      const parts = buildMonthlyOrYearlyByday(weekday, ordinal);
      if (parts.byday) ruleParts.push(`BYDAY=${parts.byday}`);
      if (parts.bysetpos) ruleParts.push(`BYSETPOS=${parts.bysetpos}`);
      if (parts.bymonthday) ruleParts.push(`BYMONTHDAY=${parts.bymonthday}`);
    }
  }

  if (!ruleParts.length) {
    return { rule: null, start: null };
  }

  if (interval > 1 && type !== 'yearly') {
    ruleParts.push(`INTERVAL=${interval}`);
  }

  const endType = refs.repeatEndType?.value ?? 'none';
  if (endType === 'on' && refs.repeatEndDate?.value) {
    ruleParts.push(`UNTIL=${toRruleDate(refs.repeatEndDate.value)}`);
  } else if (endType === 'after' && refs.repeatEndCount?.value) {
    ruleParts.push(`COUNT=${refs.repeatEndCount.value}`);
  }

  return { rule: ruleParts.join(';'), start };
};

const resetWeeklyButtons = () => {
  document.querySelectorAll<HTMLButtonElement>('.repeat-day-button').forEach((button) => {
    button.classList.remove('selected');
  });
};

const setWeeklyButtons = (byday: string[]) => {
  const reverseMap: Record<string, string> = {
    MO: 'mon',
    TU: 'tue',
    WE: 'wed',
    TH: 'thu',
    FR: 'fri',
    SA: 'sat',
    SU: 'sun',
  };
  resetWeeklyButtons();
  byday.forEach((code) => {
    const mapped = reverseMap[code];
    if (!mapped) return;
    const button = document.querySelector<HTMLButtonElement>(`.repeat-day-button[data-day="${mapped}"]`);
    button?.classList.add('selected');
  });
};

const buildNumberOptions = (start: number, end: number) =>
  Array.from({ length: end - start + 1 }, (_, idx) => {
    const value = String(start + idx);
    return { value, label: value };
  });

const normalizeTimeInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
};

const buildTimeOptions = () => {
  if (!refs.reminderTimeOptions) return;
  const optionsHost = refs.reminderTimeOptions;
  optionsHost.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = '';
  optionsHost.appendChild(empty);

  const prefers24Hour = state.timeFormat === '24h';
  const formatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: !prefers24Hour });
  const start = new Date();
  start.setHours(11, 0, 0, 0);
  const end = new Date(start);
  end.setHours(22, 30, 0, 0);
  for (let dt = new Date(start); dt <= end; dt.setMinutes(dt.getMinutes() + 30)) {
    const option = document.createElement('option');
    const hours = dt.getHours().toString().padStart(2, '0');
    const minutes = dt.getMinutes().toString().padStart(2, '0');
    option.value = `${hours}:${minutes}`;
    option.label = prefers24Hour ? `${hours}:${minutes}` : formatter.format(dt);
    optionsHost.appendChild(option);
  }
};

// The theme radios are read on Save and seeded on open, like every other control in the
// Settings modal. Nothing is applied until Save, which is why Cancel needs no revert.
const readSelectedTheme = (): Theme => {
  if (refs.settingsThemeLight?.checked) return 'light';
  if (refs.settingsThemeDark?.checked) return 'dark';
  return 'system';
};

const seedThemeRadio = () => {
  const target =
    state.theme === 'light'
      ? refs.settingsThemeLight
      : state.theme === 'dark'
        ? refs.settingsThemeDark
        : refs.settingsThemeSystem;
  if (target) target.checked = true;
};

const setupEvents = () => {
  attachTaskListDnD();
  attachTaskListKeyboard();

  refs.addButton?.addEventListener('click', addTask);
  refs.input?.addEventListener('keypress', (event) => {
    if (event.key === 'Enter' && !isTagSuggestOpen()) {
      addTask();
    }
  });
  setupTagInput();

  refs.cancelEditBtn?.addEventListener('click', () => closeEditModal());
  refs.saveEditBtn?.addEventListener('click', () => saveEdit());
  refs.editInput?.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      saveEdit();
    }
  });
  refs.overlay?.addEventListener('click', (event) => {
    if (event.target === refs.overlay) {
      closeEditModal();
    }
  });

  window.electronAPI.onShowCompletedChanged((value) => {
    state.showCompleted = value;
    renderTasks();
  });

  refs.listsToggle?.addEventListener('click', () => {
    toggleListsExpanded();
  });

  refs.tagsToggle?.addEventListener('click', () => {
    toggleTagsExpanded();
  });

  refs.smartListsToggle?.addEventListener('click', () => {
    toggleSmartListsExpanded();
  });

  refs.addSmartListBtn?.addEventListener('click', () => openSmartListModal());
  refs.saveSmartListBtn?.addEventListener('click', () => saveSmartList());
  refs.cancelSmartListBtn?.addEventListener('click', () => closeSmartListModal());
  refs.smartListNameInput?.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      saveSmartList();
    }
  });

  refs.addListBtn?.addEventListener('click', () => openListModal());
  refs.saveListBtn?.addEventListener('click', () => saveList());
  refs.cancelListBtn?.addEventListener('click', () => closeListModal());
  refs.listInput?.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      saveList();
    }
  });
  refs.listOverlay?.addEventListener('click', (event) => {
    if (event.target === refs.listOverlay) {
      closeListModal();
    }
  });

  refs.saveTagBtn?.addEventListener('click', () => saveTag());
  refs.cancelTagBtn?.addEventListener('click', () => closeTagModal());
  refs.tagInput?.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      saveTag();
    }
  });
  refs.tagOverlay?.addEventListener('click', (event) => {
    if (event.target === refs.tagOverlay) {
      closeTagModal();
    }
  });

  refs.tagsPicker?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (refs.tagsMenu) {
      if (refs.tagsMenu.style.display === 'flex') {
        refs.tagsMenu.style.display = 'none';
      } else {
        renderTagsMenu();
        positionDropdown(refs.tagsMenu, refs.tagsPicker ?? refs.tagsMenu);
      }
    }
  });

  refs.tagsMenu?.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  refs.tagsMenuNew?.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    const name = refs.tagsMenuNew?.value.trim();
    if (!name) return;
    try {
      const created = await window.electronAPI.addTag(name);
      if (!created || (created as any).error) return;
      const tag = created as Tag;
      mergeTag(tag);
      if (!state.modalTagIds.includes(tag.id)) {
        state.modalTagIds.push(tag.id);
      }
      if (refs.tagsMenuNew) refs.tagsMenuNew.value = '';
      renderTagsMenu();
      updateTagsUI();
      renderTags();
    } catch (error) {
      console.error('Failed to create tag', error);
    }
  });

  // both panels show a count of open tasks, so both have to follow any change to the task
  // collection -- adding one, completing one, or moving one to another list. renderTasks
  // dispatches this after every one of those, which is why neither panel needs to know about
  // the paths that cause them.
  document.addEventListener('tasks-rendered', () => {
    renderLists();
    renderTags();
  });

  document.addEventListener('filter-by-tag', (event) => {
    const detail = (event as CustomEvent<{ tagId: number }>).detail;
    if (detail?.tagId === undefined) return;
    state.selectedTagId = detail.tagId;
    renderViewBar();
    renderTags();
    renderTasks();
  });

  refs.tagFilterChip?.addEventListener('click', clearTagFilter);

  refs.viewPicker?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!refs.viewMenu) return;
    const open = refs.viewMenu.style.display !== 'flex';
    refs.viewMenu.style.display = open ? 'flex' : 'none';
    // aria-expanded is also what keeps the caret up while the menu is open: it is otherwise
    // only drawn on hover, so the control would look shut with its own menu hanging off it
    refs.viewPicker?.setAttribute('aria-expanded', String(open));
  });

  // the items themselves dispatch select-list / run-smart-list (see viewBar.ts); this only has
  // to keep a stray click inside the menu from reaching the document's close-everything handler
  refs.viewMenu?.addEventListener('click', (event) => event.stopPropagation());

  refs.modalListPicker?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (refs.modalListMenu) {
      refs.modalListMenu.style.display = refs.modalListMenu.style.display === 'flex' ? 'none' : 'flex';
    }
  });

  refs.modalListMenu?.addEventListener('click', (event) => {
    event.stopPropagation();
    const target = event.target as HTMLElement;
    const item = target.closest('.modal-list-item') as HTMLElement | null;
    if (!item) return;
    const val = item.dataset.value ?? '';
    state.modalSelectedListId = val ? Number(val) : null;
    renderListOptions(refs.modalListMenu, state.modalSelectedListId, refs.modalListLabel);
    if (refs.modalListMenu) {
      refs.modalListMenu.style.display = 'none';
    }
  });


  refs.priorityPicker?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (refs.priorityMenu) {
      refs.priorityMenu.style.display = refs.priorityMenu.style.display === 'flex' ? 'none' : 'flex';
    }
  });

  refs.priorityMenu?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const item = target.closest('.priority-menu-item') as HTMLElement | null;
    if (!item) return;
    const val = (item.getAttribute('data-value') as typeof state.modalPriority) ?? 'none';
    state.modalPriority = val;
    updatePriorityUI(state.modalPriority);
    if (refs.priorityMenu) refs.priorityMenu.style.display = 'none';
  });

  refs.reminderPicker?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (refs.reminderMenu) {
      refs.reminderMenu.style.display = refs.reminderMenu.style.display === 'flex' ? 'none' : 'flex';
    }
  });

  refs.reminderMenu?.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  refs.reminderDateInput?.addEventListener('change', (event) => {
    const val = (event.target as HTMLInputElement).value;
    state.modalReminderDate = val || null;
    updateReminderUI(state.modalReminderDate, state.modalReminderTime);
  });

  const applyReminderTimeInput = (value: string) => {
    const previous = state.modalReminderTime;
    const normalized = normalizeTimeInput(value);
    if (normalized) {
      state.modalReminderTime = normalized;
      if (refs.reminderTimeInput) refs.reminderTimeInput.value = normalized;
    } else if (!value) {
      state.modalReminderTime = null;
      if (refs.reminderTimeInput) refs.reminderTimeInput.value = '';
    } else if (refs.reminderTimeInput) {
      refs.reminderTimeInput.value = previous ?? '';
    }
    updateReminderUI(state.modalReminderDate, state.modalReminderTime);
  };

  refs.reminderTimeInput?.addEventListener('change', (event) => {
    const val = (event.target as HTMLInputElement).value;
    applyReminderTimeInput(val);
  });

  refs.reminderTimeInput?.addEventListener('blur', (event) => {
    const val = (event.target as HTMLInputElement).value;
    applyReminderTimeInput(val);
  });

  setupQuerySearch();

  refs.repeatPicker?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (refs.repeatMenu) {
      if (refs.repeatMenu.style.display === 'flex') {
        refs.repeatMenu.style.display = 'none';
      } else {
        positionDropdown(refs.repeatMenu, refs.repeatPicker ?? refs.repeatMenu);
      }
    }
  });

  refs.repeatMenu?.addEventListener('click', (event) => {
    event.stopPropagation();
    const target = event.target as HTMLElement;
    const item = target.closest('.repeat-menu-item') as HTMLElement | null;
    if (!item) return;
    const val = item.dataset.value ?? '';
    if (val === 'custom') {
      state.modalRepeat = 'custom';
      updateRepeatUI(state.modalRepeat);
      openRepeatModal();
    } else {
      state.modalRepeat = val || null;
      const presetRule = val ? buildPresetRepeatRule(val) : null;
      state.modalRepeatRule = presetRule?.rule ?? null;
      state.modalRepeatStart = presetRule?.start ?? null;
      updateRepeatUI(state.modalRepeat);
      syncReminderFromRepeatStart(state.modalRepeatStart);
    }
    if (refs.repeatMenu) {
      refs.repeatMenu.style.display = 'none';
    }
  });

  const repeatIntervalRow = document.querySelector<HTMLDivElement>('.repeat-interval-row');
  const repeatIntervalHost = document.querySelector<HTMLDivElement>('#repeat-interval-host');
  const monthlyModeSelector = 'input[name="repeat-monthly-mode"]';
  const yearlyModeSelector = 'input[name="repeat-yearly-mode"]';

  const initializeRepeatOptions = () => {
    setSelectOptions(refs.repeatIntervalSelect, buildNumberOptions(1, 99), '1');
    setSelectOptions(refs.repeatMonthlyDay, buildNumberOptions(1, 31), '1');
    setSelectOptions(refs.repeatYearlyDay, buildNumberOptions(1, 31), '1');
    const ordinals = ['First', 'Second', 'Third', 'Fourth', 'Last'].map((label) => ({ value: label, label }));
    setSelectOptions(refs.repeatMonthlyOrdinal, ordinals, 'First');
    setSelectOptions(refs.repeatYearlyOrdinal, ordinals, 'First');
    const weekdayOptions = [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
      '────────',
      'Day',
      'Weekday',
      'Weekend Day',
    ].map((label) => ({
      value: label,
      label,
      disabled: label === '────────',
    }));
    setSelectOptions(refs.repeatMonthlyWeekday, weekdayOptions, 'Monday');
    setSelectOptions(refs.repeatYearlyWeekday, weekdayOptions, 'Monday');
    const months = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ].map((label) => ({ value: label, label }));
    setSelectOptions(refs.repeatYearlyMonth, months, months[0]?.value);
  };

  const updateRepeatTypeUI = () => {
    const type = refs.repeatTypeSelect?.value ?? 'daily';
    if (refs.repeatIntervalUnit) {
      const unitMap: Record<string, string> = {
        daily: 'day(s)',
        weekly: 'week(s)',
        monthly: 'month(s)',
      };
      refs.repeatIntervalUnit.textContent = unitMap[type] ?? 'day(s)';
    }
    if (repeatIntervalRow) {
      if (type === 'monthly' && refs.repeatMonthlyOptions) {
        if (repeatIntervalRow.parentElement !== refs.repeatMonthlyOptions) {
          refs.repeatMonthlyOptions.prepend(repeatIntervalRow);
        }
      } else if (repeatIntervalHost && repeatIntervalRow.parentElement !== repeatIntervalHost) {
        repeatIntervalHost.append(repeatIntervalRow);
      }
      repeatIntervalRow.style.display = type === 'yearly' ? 'none' : 'flex';
    }
    refs.repeatWeeklyOptions?.classList.toggle('open', type === 'weekly');
    refs.repeatWeekdays?.classList.toggle('open', type === 'weekly');
    refs.repeatMonthlyOptions?.classList.toggle('open', type === 'monthly');
    refs.repeatYearlyOptions?.classList.toggle('open', type === 'yearly');
  };

  const updateRepeatEndUI = () => {
    const endType = refs.repeatEndType?.value ?? 'none';
    if (refs.repeatEndDate) {
      refs.repeatEndDate.style.display = endType === 'on' ? 'inline-flex' : 'none';
    }
    if (refs.repeatEndCount) {
      refs.repeatEndCount.style.display = endType === 'after' ? 'inline-flex' : 'none';
    }
    if (refs.repeatEndOccurrences) {
      refs.repeatEndOccurrences.style.display = endType === 'after' ? 'inline-flex' : 'none';
    }
    if (endType === 'on' && refs.repeatStartDate && refs.repeatEndDate && !refs.repeatEndDate.value) {
      const start = new Date(`${refs.repeatStartDate.value}T00:00:00`);
      start.setMonth(start.getMonth() + 6);
      refs.repeatEndDate.value = toDateInputValue(start);
    }
  };

  const updateRepeatSummaryText = () => {
    if (!refs.repeatSummary || !refs.repeatStartDate || !refs.repeatTypeSelect) return;
    const startValue = refs.repeatStartDate.value;
    if (!startValue) {
      refs.repeatSummary.textContent = '';
      return;
    }
    const startLabel = formatDate(startValue);
    const type = refs.repeatTypeSelect.value;
    const interval = refs.repeatIntervalSelect?.value ?? '1';
    let summary = '';
    if (type === 'daily') {
      summary = `Occurs every ${interval} day(s) starting from ${startLabel}`;
    } else if (type === 'weekly') {
      const selectedDays = Array.from(
        document.querySelectorAll<HTMLButtonElement>('.repeat-day-button.selected')
      ).map((button) => button.textContent?.trim()).filter(Boolean);
      const daysText = selectedDays.length ? ` on ${selectedDays.join(', ')}` : '';
      summary = `Occurs every ${interval} week(s)${daysText} starting from ${startLabel}`;
    } else if (type === 'monthly') {
      const mode =
        (document.querySelector<HTMLInputElement>(`${monthlyModeSelector}:checked`)?.value as string) ?? 'day';
      if (mode === 'day') {
        const day = refs.repeatMonthlyDay?.value ?? '1';
        summary = `Occurs every ${interval} month(s) on day ${day} starting from ${startLabel}`;
      } else {
        const ordinal = refs.repeatMonthlyOrdinal?.value ?? 'First';
        const weekday = refs.repeatMonthlyWeekday?.value ?? 'Monday';
        summary = `Occurs every ${interval} month(s) on ${ordinal} ${weekday} starting from ${startLabel}`;
      }
    } else if (type === 'yearly') {
      const monthLabel = refs.repeatYearlyMonth?.value ?? 'January';
      const mode =
        (document.querySelector<HTMLInputElement>(`${yearlyModeSelector}:checked`)?.value as string) ?? 'day';
      if (mode === 'day') {
        const day = refs.repeatYearlyDay?.value ?? '1';
        summary = `Occurs every ${monthLabel} on day ${day} starting from ${startLabel}`;
      } else {
        const ordinal = refs.repeatYearlyOrdinal?.value ?? 'First';
        const weekday = refs.repeatYearlyWeekday?.value ?? 'Monday';
        summary = `Occurs every ${monthLabel} on ${ordinal} ${weekday} starting from ${startLabel}`;
      }
    }
    const endType = refs.repeatEndType?.value ?? 'none';
    if (endType === 'on' && refs.repeatEndDate?.value) {
      summary += ` until ${formatDate(refs.repeatEndDate.value)}`;
    } else if (endType === 'after' && refs.repeatEndCount?.value) {
      summary += ` for ${refs.repeatEndCount.value} occurrences`;
    }
    refs.repeatSummary.textContent = summary;
  };

  const applyRepeatRuleToUI = () => {
    if (!refs.repeatTypeSelect) return;
    const rule = state.modalRepeatRule;
    const startValue = state.modalRepeatStart ?? state.modalReminderDate ?? getDefaultRepeatStart();
    if (refs.repeatStartDate) {
      refs.repeatStartDate.value = startValue;
    }
    resetWeeklyButtons();
    if (!rule) {
      refs.repeatTypeSelect.value = 'daily';
      updateRepeatTypeUI();
      updateRepeatEndUI();
      updateRepeatSummaryText();
      return;
    }

    const parts = rule.split(';').reduce<Record<string, string>>((acc, part) => {
      const [key, value] = part.split('=');
      if (key && value) acc[key] = value;
      return acc;
    }, {});
    const freq = parts.FREQ ?? 'DAILY';
    const interval = parts.INTERVAL ?? '1';

    refs.repeatTypeSelect.value = freq.toLowerCase();
    if (refs.repeatIntervalSelect) {
      refs.repeatIntervalSelect.value = interval;
    }

    if (freq === 'WEEKLY') {
      const byday = parts.BYDAY ? parts.BYDAY.split(',').filter(Boolean) : [];
      setWeeklyButtons(byday);
    }

    if (freq === 'MONTHLY') {
      const monthlyModeInputs = document.querySelectorAll<HTMLInputElement>('input[name="repeat-monthly-mode"]');
      const hasBymonthday = Boolean(parts.BYMONTHDAY);
      monthlyModeInputs.forEach((input) => {
        input.checked = input.value === (hasBymonthday ? 'day' : 'weekday');
      });
      if (hasBymonthday && refs.repeatMonthlyDay) {
        refs.repeatMonthlyDay.value = parts.BYMONTHDAY;
      } else if (refs.repeatMonthlyOrdinal && refs.repeatMonthlyWeekday) {
        const ordinal = bysetposToOrdinal(parts.BYSETPOS ?? '1');
        refs.repeatMonthlyOrdinal.value = ordinal;
        const byday = parts.BYDAY ?? 'MO';
        if (byday === 'MO,TU,WE,TH,FR') {
          refs.repeatMonthlyWeekday.value = 'Weekday';
        } else if (byday === 'SA,SU') {
          refs.repeatMonthlyWeekday.value = 'Weekend Day';
        } else {
          const mapped = Object.entries(weekdayLabelMap).find(([, code]) => code === byday);
          refs.repeatMonthlyWeekday.value = mapped?.[0] ?? 'Monday';
        }
      }
    }

    if (freq === 'YEARLY') {
      const monthLabel = parts.BYMONTH ? monthNumberMap[parts.BYMONTH] : null;
      if (refs.repeatYearlyMonth && monthLabel) {
        refs.repeatYearlyMonth.value = monthLabel;
      }
      const yearlyModeInputs = document.querySelectorAll<HTMLInputElement>('input[name="repeat-yearly-mode"]');
      const hasBymonthday = Boolean(parts.BYMONTHDAY);
      yearlyModeInputs.forEach((input) => {
        input.checked = input.value === (hasBymonthday ? 'day' : 'weekday');
      });
      if (hasBymonthday && refs.repeatYearlyDay) {
        refs.repeatYearlyDay.value = parts.BYMONTHDAY;
      } else if (refs.repeatYearlyOrdinal && refs.repeatYearlyWeekday) {
        const ordinal = bysetposToOrdinal(parts.BYSETPOS ?? '1');
        refs.repeatYearlyOrdinal.value = ordinal;
        const byday = parts.BYDAY ?? 'MO';
        if (byday === 'MO,TU,WE,TH,FR') {
          refs.repeatYearlyWeekday.value = 'Weekday';
        } else if (byday === 'SA,SU') {
          refs.repeatYearlyWeekday.value = 'Weekend Day';
        } else {
          const mapped = Object.entries(weekdayLabelMap).find(([, code]) => code === byday);
          refs.repeatYearlyWeekday.value = mapped?.[0] ?? 'Monday';
        }
      }
    }

    if (refs.repeatEndType) {
      if (parts.UNTIL && refs.repeatEndDate) {
        refs.repeatEndType.value = 'on';
        const until = parts.UNTIL.replace(/(\d{4})(\d{2})(\d{2}).*/, '$1-$2-$3');
        refs.repeatEndDate.value = until;
      } else if (parts.COUNT && refs.repeatEndCount) {
        refs.repeatEndType.value = 'after';
        refs.repeatEndCount.value = parts.COUNT;
      } else {
        refs.repeatEndType.value = 'none';
      }
    }

    updateRepeatTypeUI();
    updateRepeatEndUI();
    updateRepeatSummaryText();
  };

  const openRepeatModal = () => {
    if (!refs.repeatOverlay || !refs.repeatStartDate) return;
    const start = state.modalReminderDate ? new Date(`${state.modalReminderDate}T00:00:00`) : new Date();
    refs.repeatStartDate.value = toDateInputValue(start);
    if (refs.repeatTypeSelect && !refs.repeatTypeSelect.value) {
      refs.repeatTypeSelect.value = 'daily';
    }
    if (refs.repeatEndDate) {
      const end = new Date(start);
      end.setMonth(end.getMonth() + 6);
      refs.repeatEndDate.value = toDateInputValue(end);
    }
    applyRepeatRuleToUI();
    refs.repeatOverlay.classList.add('open');
  };

  const closeRepeatModal = () => {
    refs.repeatOverlay?.classList.remove('open');
  };

  initializeRepeatOptions();
  updateRepeatTypeUI();
  updateRepeatEndUI();
  updateRepeatSummaryText();

  refs.repeatTypeSelect?.addEventListener('change', () => {
    updateRepeatTypeUI();
    updateRepeatSummaryText();
  });

  refs.repeatStartDate?.addEventListener('change', () => {
    updateRepeatEndUI();
    updateRepeatSummaryText();
  });

  refs.repeatIntervalSelect?.addEventListener('change', updateRepeatSummaryText);
  refs.repeatMonthlyDay?.addEventListener('change', updateRepeatSummaryText);
  refs.repeatMonthlyOrdinal?.addEventListener('change', updateRepeatSummaryText);
  refs.repeatMonthlyWeekday?.addEventListener('change', updateRepeatSummaryText);
  refs.repeatYearlyMonth?.addEventListener('change', updateRepeatSummaryText);
  refs.repeatYearlyDay?.addEventListener('change', updateRepeatSummaryText);
  refs.repeatYearlyOrdinal?.addEventListener('change', updateRepeatSummaryText);
  refs.repeatYearlyWeekday?.addEventListener('change', updateRepeatSummaryText);

  document.querySelectorAll<HTMLInputElement>(monthlyModeSelector).forEach((radio) => {
    radio.addEventListener('change', updateRepeatSummaryText);
  });
  document.querySelectorAll<HTMLInputElement>(yearlyModeSelector).forEach((radio) => {
    radio.addEventListener('change', updateRepeatSummaryText);
  });

  refs.repeatEndType?.addEventListener('change', () => {
    updateRepeatEndUI();
    updateRepeatSummaryText();
  });
  refs.repeatEndDate?.addEventListener('change', updateRepeatSummaryText);
  refs.repeatEndCount?.addEventListener('change', updateRepeatSummaryText);

  refs.repeatWeekdays?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest('.repeat-day-button') as HTMLButtonElement | null;
    if (!button) return;
    button.classList.toggle('selected');
    updateRepeatSummaryText();
  });

  refs.repeatCancel?.addEventListener('click', () => closeRepeatModal());
  refs.repeatSave?.addEventListener('click', () => {
    const customRule = buildCustomRepeatRule();
    state.modalRepeat = 'custom';
    state.modalRepeatRule = customRule.rule;
    state.modalRepeatStart = customRule.start;
    updateRepeatUI(state.modalRepeat);
    syncReminderFromRepeatStart(state.modalRepeatStart);
    closeRepeatModal();
  });
  refs.repeatOverlay?.addEventListener('click', (event) => {
    if (event.target === refs.repeatOverlay) {
      closeRepeatModal();
    }
  });

  refs.settingsSave?.addEventListener('click', async () => {
    const selected: '12h' | '24h' = refs.settingsRadio24?.checked ? '24h' : '12h';
    const selectedDateFormat = refs.dateFormatSelect?.value || state.dateFormat;
    const selectedTheme = readSelectedTheme();
    const tagColors = refs.tagColorsCheckbox?.checked ?? true;
    try {
      const [timeResult, dateResult, themeResult, tagColorResult] = await Promise.all([
        window.electronAPI.updateTimeFormat(selected),
        window.electronAPI.updateDateFormat(selectedDateFormat),
        window.electronAPI.updateTheme(selectedTheme),
        window.electronAPI.updateTagColors(tagColors),
        saveShortcutSettings(),
      ]);
      state.timeFormat = timeResult.timeFormat;
      state.dateFormat = dateResult.dateFormat;
      // no re-render needed: the main process sets nativeTheme.themeSource, which flips
      // prefers-color-scheme and repaints via CSS on its own
      state.theme = themeResult.theme;
      // every tag chip and dot in the app re-reads this, so the repaints below cover it
      state.tagColors = tagColorResult.tagColors;
      buildTimeOptions();
      updateReminderUI(state.modalReminderDate, state.modalReminderTime);
      renderTags();
      renderViewBar();
      renderTagsMenu();
      renderTasks();
    } catch (error) {
      console.error('Failed to save settings', error);
    }
    closeSettingsModal();
  });

  setupShortcutSettings();
  refs.settingsCancel?.addEventListener('click', closeSettingsModal);

  if (refs.settingsOverlay) {
    const overlay = refs.settingsOverlay;
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeSettingsModal();
    });
  }

  window.electronAPI.onOpenTaskEdit((taskId) => {
    openEditModal(taskId);
  });

  window.electronAPI.onOpenSettings(openSettingsModal);
  window.electronAPI.onOpenShortcuts(openShortcutsHelp);

  refs.shortcutsClose?.addEventListener('click', closeShortcutsHelp);
  if (refs.shortcutsOverlay) {
    const overlay = refs.shortcutsOverlay;
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeShortcutsHelp();
    });
  }

  document.addEventListener('open-edit-modal', (event) => {
    const detail = (event as CustomEvent<{ taskId: number }>).detail;
    if (detail?.taskId !== undefined) {
      openEditModal(detail.taskId);
    }
  });

  document.addEventListener('open-edit-list-modal', (event) => {
    const detail = (event as CustomEvent<{ listId: number }>).detail;
    if (detail?.listId !== undefined) {
      openEditListModal(detail.listId);
    }
  });

  document.addEventListener('open-edit-tag-modal', (event) => {
    const detail = (event as CustomEvent<{ tagId: number }>).detail;
    if (detail?.tagId !== undefined) {
      openEditTagModal(detail.tagId);
    }
  });

  // no id means "save what is in the search bar"; the query bar's Edit passes the one it is on
  document.addEventListener('open-smart-list-modal', (event) => {
    const detail = (event as CustomEvent<{ smartListId?: number }>).detail;
    openSmartListModal(detail?.smartListId);
  });

  document.addEventListener('select-list', (event) => {
    const detail = (event as CustomEvent<{ listId: number | null }>).detail;
    selectList(detail?.listId ?? null);
  });

  document.addEventListener('run-smart-list', (event) => {
    const detail = (event as CustomEvent<{ smartListId: number }>).detail;
    if (detail?.smartListId !== undefined) {
      runSmartList(detail.smartListId);
    }
  });

  // the query bar owns its own presentation but nothing else: the API calls, the sidebar
  // repaint and the association all live here, which is what keeps viewBar.ts out of the
  // smartLists.ts import graph it would otherwise cycle with
  document.addEventListener('smart-list-create', (event) => {
    const detail = (event as CustomEvent<{ name: string }>).detail;
    if (detail?.name) void createSmartListFromBar(detail.name);
  });

  document.addEventListener('smart-list-update', () => {
    void updateSmartListFromBar();
  });

  // Escape closes exactly one thing: the topmost overlay. Closing every open overlay at once
  // meant one Escape in the repeat modal — which opens on top of the edit modal — dismissed
  // both, losing the edit underneath.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeViewMenu();
    switch (activeOverlay()?.id) {
      case 'edit-overlay':
        closeEditModal();
        break;
      case 'repeat-overlay':
        refs.repeatOverlay?.classList.remove('open');
        break;
      case 'smart-list-overlay':
        closeSmartListModal();
        break;
      case 'list-overlay':
        closeListModal();
        break;
      case 'tag-overlay':
        closeTagModal();
        break;
      case 'settings-overlay':
        closeSettingsModal();
        break;
      case 'shortcuts-overlay':
        closeShortcutsHelp();
        break;
    }
  });

  document.addEventListener('click', () => {
    if (state.openListMenuId !== null) {
      state.openListMenuId = null;
      renderLists();
    }
    if (state.openTagMenuId !== null) {
      state.openTagMenuId = null;
      renderTags();
    }
    if (state.openSmartListMenuId !== null) {
      state.openSmartListMenuId = null;
      renderSmartLists();
    }
    if (refs.priorityMenu) {
      refs.priorityMenu.style.display = 'none';
    }
    if (refs.reminderMenu) {
      refs.reminderMenu.style.display = 'none';
    }
    closeViewMenu();
    if (refs.repeatMenu) {
      refs.repeatMenu.style.display = 'none';
    }
    if (refs.modalListMenu) {
      refs.modalListMenu.style.display = 'none';
    }
    if (refs.tagsMenu) {
      refs.tagsMenu.style.display = 'none';
    }
    if (refs.tagSuggestMenu) {
      refs.tagSuggestMenu.style.display = 'none';
    }
    closeQueryPopovers();
  });
};

/**
 * The id-to-function table the registry deliberately doesn't hold. Handlers that return false
 * decline the key and leave the event alone — that is how "Nth list" backs off when there is
 * no Nth list, rather than swallowing the keypress.
 */
const shortcutHandlers: Record<string, ShortcutHandler> = {
  'nav.down': () => moveTaskFocus(1),
  'nav.up': () => moveTaskFocus(-1),
  'nav.first': () => focusTaskEdge('first'),
  'nav.last': () => focusTaskEdge('last'),

  'task.toggleDone': () => {
    if (state.focusedTaskId === null) return false;
    void toggleTaskDone(state.focusedTaskId);
  },
  'task.open': () => {
    if (state.focusedTaskId === null) return false;
    openEditModal(state.focusedTaskId);
  },
  'task.toggleDetails': () => {
    const taskId = state.focusedTaskId;
    if (taskId === null) return false;
    // Nothing to show, so decline rather than toggle a state with no visible effect.
    if (!state.tasks.find((t) => t.id === taskId)?.details?.trim()) return false;
    if (state.expandedDetails.has(taskId)) {
      state.expandedDetails.delete(taskId);
    } else {
      state.expandedDetails.add(taskId);
    }
    renderTasks();
  },
  'task.delete': () => {
    if (state.focusedTaskId === null) return false;
    void deleteTask(state.focusedTaskId);
  },
  'task.moveUp': () => (state.focusedTaskId === null ? false : moveTaskByOffset(state.focusedTaskId, -1)),
  'task.moveDown': () => (state.focusedTaskId === null ? false : moveTaskByOffset(state.focusedTaskId, 1)),

  'search.clear': () => {
    if (!state.searchQuery) return false;
    clearSearch();
  },
  'search.toggleMode': () => {
    setSearchMode(state.searchMode === 'simple' ? 'advanced' : 'simple');
  },
  'view.allLists': () => selectList(null),
  'view.selectListByNumber': (binding) => {
    const nth = Number(binding.slice(binding.lastIndexOf('+') + 1));
    const list = state.lists[nth - 1];
    if (!list) return false;
    selectList(list.id);
  },
  'view.clearTagFilter': () => {
    if (state.selectedTagId === null) return false;
    clearTagFilter();
  },
  'app.newTask': () => {
    refs.input?.focus();
    refs.input?.select();
  },
  'app.newList': () => openListModal(),
  'app.newSmartList': () => openSmartListModal(),
  'app.help': () => openShortcutsHelp(),
};

const init = async () => {
  setupEvents();
  registerShortcutHandlers(shortcutHandlers);
  // Before the focus trap: both are capture-phase listeners on document, so they fire in
  // registration order, and the rebinding UI's capture mode has to see Tab first.
  installShortcuts();
  // Defaults are live from the dispatcher's module load, so the hints are correct before
  // loadSettings() lays any user overrides over them and repaints.
  renderShortcutHints();
  installModalFocusTrap();
  attachDatePicker(refs.reminderDateInput);
  attachDatePicker(refs.repeatStartDate);
  attachDatePicker(refs.repeatEndDate);
  renderLists();
  renderModalLists();
  renderViewBar();
  // Initialize lists chevrons orientation
  refs.listsToggle?.dispatchEvent(new Event('click'));
  refs.listsToggle?.dispatchEvent(new Event('click'));
  refs.tagsToggle?.dispatchEvent(new Event('click'));
  refs.tagsToggle?.dispatchEvent(new Event('click'));
  refs.smartListsToggle?.dispatchEvent(new Event('click'));
  refs.smartListsToggle?.dispatchEvent(new Event('click'));
  renderViewBar();
  updatePriorityUI(state.modalPriority);
  await loadSettings();
  buildTimeOptions();
  updateReminderUI(state.modalReminderDate, state.modalReminderTime);
  updateRepeatUI(state.modalRepeat);
  await loadTags();
  await loadTasks();
  await loadLists();
  await loadSmartLists();
  window.electronAPI.notifyRendererReady();
};

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  init().catch((err) => console.error('Failed to init renderer', err));
} else {
  document.addEventListener('DOMContentLoaded', () => {
    init().catch((err) => console.error('Failed to init renderer', err));
  });
}
