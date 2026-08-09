import { addTask, loadLists, loadSettings, loadTags, loadTasks } from './actions.js';
import { refs } from './dom.js';
import { renderListOptions, renderLists, toggleListsExpanded } from './lists.js';
import { mergeTag, renderTags, toggleTagsExpanded } from './tags.js';
import { loadFilters, renderFilters, toggleFiltersExpanded } from './filters.js';
import { activeFilter, invalidateFilterUI, syncFilterUI } from './activeFilter.js';
import { parseQuery } from './query.js';
import { applySearchQuery, closeQueryPopovers, setSearchMode, setupQuerySearch } from './querySearch.js';
import { isTagSuggestOpen, setupTagInput } from './tagInput.js';
import { attachTaskListDnD, renderTasks, updateTasksTitle } from './tasks.js';
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
import type { SavedFilter, Tag, Theme } from '../types.js';
import { formatDate, positionDropdown } from './helpers.js';
import { attachDatePicker } from './datepicker.js';
import { installModalFocusTrap } from './focusTrap.js';

// ---------- Saved filters ----------

const showFilterError = (message: string | null) => {
  if (!refs.filterModalError) return;
  refs.filterModalError.textContent = message ?? '';
  refs.filterModalError.style.display = message ? 'block' : 'none';
};

const closeFilterModal = () => {
  refs.filterOverlay?.classList.remove('open');
  state.editingFilterId = null;
  showFilterError(null);
};

/** With no id, saves whatever query is currently in the search bar. */
const openFilterModal = (filterId?: number) => {
  const existing = filterId !== undefined ? state.filters.find((f) => f.id === filterId) : undefined;
  state.editingFilterId = existing?.id ?? null;
  showFilterError(null);

  if (refs.filterModalTitle) {
    refs.filterModalTitle.textContent = existing ? 'Edit filter' : 'Save filter';
  }
  if (refs.filterNameInput) {
    refs.filterNameInput.value = existing?.name ?? '';
  }
  if (refs.filterQueryInput) {
    refs.filterQueryInput.value = existing?.query ?? state.searchQuery.trim();
  }

  if (!existing && !refs.filterQueryInput?.value) {
    // nothing to save: tell the user how to get a query rather than opening an empty dialog
    showFilterError('Type a query in the search bar first, then save it here.');
  }

  refs.filterOverlay?.classList.add('open');
  refs.filterNameInput?.focus();
  refs.filterNameInput?.select();
};

const saveFilter = async () => {
  const name = refs.filterNameInput?.value.trim() ?? '';
  const query = refs.filterQueryInput?.value.trim() ?? '';
  if (!name) {
    showFilterError('Give the filter a name.');
    refs.filterNameInput?.focus();
    return;
  }
  if (!query) {
    showFilterError('A filter needs a query.');
    refs.filterQueryInput?.focus();
    return;
  }
  // refuse to save something that will never run; the error is the parser's own wording
  const parsed = parseQuery(query);
  if (!parsed.ok) {
    showFilterError(`${parsed.error.message} (column ${parsed.error.position + 1})`);
    refs.filterQueryInput?.focus();
    return;
  }

  try {
    if (state.editingFilterId !== null) {
      const id = state.editingFilterId;
      const renamed = await window.electronAPI.updateFilterName(id, name);
      if ((renamed as { error?: string }).error) {
        showFilterError((renamed as { error: string }).error);
        return;
      }
      const requeried = await window.electronAPI.updateFilterQuery(id, query);
      if ((requeried as { error?: string }).error) {
        showFilterError((requeried as { error: string }).error);
        return;
      }
      state.filters = state.filters.map((f) => (f.id === id ? { ...f, name, query } : f));
    } else {
      const created = await window.electronAPI.addFilter(name, query);
      if ((created as { error?: string }).error) {
        showFilterError((created as { error: string }).error);
        return;
      }
      state.filters.push(created as SavedFilter);
    }
    closeFilterModal();
    invalidateFilterUI();
    syncFilterUI(renderFilters);
    renderFilters();
  } catch (error) {
    console.error('Failed to save filter', error);
    showFilterError('Could not save the filter.');
  }
};

/** Selecting a saved filter is just running its query — no separate filtering path. */
const runSavedFilter = (filterId: number) => {
  const filter = state.filters.find((f) => f.id === filterId);
  if (!filter || !refs.listsSearchInput) return;
  const alreadyRunning = activeFilter()?.id === filter.id;
  // clicking the running filter clears it, matching how list and tag pills toggle
  const nextQuery = alreadyRunning ? '' : filter.query;
  setSearchMode('advanced');
  refs.listsSearchInput.value = nextQuery;
  applySearchQuery(nextQuery, true);
  invalidateFilterUI();
  syncFilterUI(renderFilters);
  renderFilters();
  refs.listsSearchInput.focus();
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

  refs.filtersToggle?.addEventListener('click', () => {
    toggleFiltersExpanded();
  });

  refs.addFilterBtn?.addEventListener('click', () => openFilterModal());
  refs.saveFilterBtn?.addEventListener('click', () => saveFilter());
  refs.cancelFilterBtn?.addEventListener('click', () => closeFilterModal());
  refs.filterNameInput?.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      saveFilter();
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

  document.addEventListener('tasks-rendered', () => {
    renderTags();
  });

  document.addEventListener('filter-by-tag', (event) => {
    const detail = (event as CustomEvent<{ tagId: number }>).detail;
    if (detail?.tagId === undefined) return;
    state.selectedTagId = detail.tagId;
    updateTasksTitle();
    renderTags();
    renderTasks();
  });

  refs.tagFilterChip?.addEventListener('click', () => {
    state.selectedTagId = null;
    updateTasksTitle();
    renderTags();
    renderTasks();
  });

  refs.addTaskListPicker?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (refs.addTaskListMenu) {
      refs.addTaskListMenu.style.display = refs.addTaskListMenu.style.display === 'flex' ? 'none' : 'flex';
    }
  });

  refs.addTaskListMenu?.addEventListener('click', (event) => {
    event.stopPropagation();
    const target = event.target as HTMLElement;
    const item = target.closest('.add-task-list-item') as HTMLElement | null;
    if (!item) return;
    const val = item.dataset.value ?? '';
    state.addTaskSelectedListId = val ? Number(val) : null;
    renderListOptions(refs.addTaskListMenu, state.addTaskSelectedListId ?? state.selectedListId, refs.addTaskListLabel);
    if (refs.addTaskListMenu) {
      refs.addTaskListMenu.style.display = 'none';
    }
  });

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
    try {
      const [timeResult, dateResult, themeResult] = await Promise.all([
        window.electronAPI.updateTimeFormat(selected),
        window.electronAPI.updateDateFormat(selectedDateFormat),
        window.electronAPI.updateTheme(selectedTheme),
      ]);
      state.timeFormat = timeResult.timeFormat;
      state.dateFormat = dateResult.dateFormat;
      // no re-render needed: the main process sets nativeTheme.themeSource, which flips
      // prefers-color-scheme and repaints via CSS on its own
      state.theme = themeResult.theme;
      buildTimeOptions();
      updateReminderUI(state.modalReminderDate, state.modalReminderTime);
      renderTasks();
    } catch (error) {
      console.error('Failed to save settings', error);
    }
    refs.settingsOverlay?.classList.remove('open');
  });

  refs.settingsCancel?.addEventListener('click', () => {
    refs.settingsOverlay?.classList.remove('open');
  });

  if (refs.settingsOverlay) {
    const overlay = refs.settingsOverlay;
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        overlay.classList.remove('open');
      }
    });
  }

  window.electronAPI.onOpenTaskEdit((taskId) => {
    openEditModal(taskId);
  });

  window.electronAPI.onOpenSettings(() => {
    if (refs.settingsOverlay) {
      if (state.timeFormat === '24h') {
        if (refs.settingsRadio24) refs.settingsRadio24.checked = true;
      } else if (refs.settingsRadio12) {
        refs.settingsRadio12.checked = true;
      }
      if (refs.dateFormatSelect) {
        refs.dateFormatSelect.value = state.dateFormat;
      }
      seedThemeRadio();
      refs.settingsOverlay.classList.add('open');
    }
  });

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

  document.addEventListener('open-edit-filter-modal', (event) => {
    const detail = (event as CustomEvent<{ filterId: number }>).detail;
    if (detail?.filterId !== undefined) {
      openFilterModal(detail.filterId);
    }
  });

  document.addEventListener('run-saved-filter', (event) => {
    const detail = (event as CustomEvent<{ filterId: number }>).detail;
    if (detail?.filterId !== undefined) {
      runSavedFilter(detail.filterId);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (refs.overlay?.classList.contains('open')) {
      closeEditModal();
    }
    if (refs.repeatOverlay?.classList.contains('open')) {
      refs.repeatOverlay.classList.remove('open');
    }
    if (refs.filterOverlay?.classList.contains('open')) {
      closeFilterModal();
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
    if (state.openFilterMenuId !== null) {
      state.openFilterMenuId = null;
      renderFilters();
    }
    if (refs.priorityMenu) {
      refs.priorityMenu.style.display = 'none';
    }
    if (refs.reminderMenu) {
      refs.reminderMenu.style.display = 'none';
    }
    if (refs.addTaskListMenu) {
      refs.addTaskListMenu.style.display = 'none';
    }
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

const init = async () => {
  setupEvents();
  installModalFocusTrap();
  attachDatePicker(refs.reminderDateInput);
  attachDatePicker(refs.repeatStartDate);
  attachDatePicker(refs.repeatEndDate);
  renderLists();
  renderModalLists();
  renderListOptions(refs.addTaskListMenu, state.addTaskSelectedListId ?? state.selectedListId, refs.addTaskListLabel);
  // Initialize lists chevrons orientation
  refs.listsToggle?.dispatchEvent(new Event('click'));
  refs.listsToggle?.dispatchEvent(new Event('click'));
  refs.tagsToggle?.dispatchEvent(new Event('click'));
  refs.tagsToggle?.dispatchEvent(new Event('click'));
  refs.filtersToggle?.dispatchEvent(new Event('click'));
  refs.filtersToggle?.dispatchEvent(new Event('click'));
  updateTasksTitle();
  updatePriorityUI(state.modalPriority);
  await loadSettings();
  buildTimeOptions();
  updateReminderUI(state.modalReminderDate, state.modalReminderTime);
  updateRepeatUI(state.modalRepeat);
  await loadTags();
  await loadTasks();
  await loadLists();
  await loadFilters();
  window.electronAPI.notifyRendererReady();
};

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  init().catch((err) => console.error('Failed to init renderer', err));
} else {
  document.addEventListener('DOMContentLoaded', () => {
    init().catch((err) => console.error('Failed to init renderer', err));
  });
}
