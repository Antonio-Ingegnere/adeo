import { formatDate } from './helpers.js';

const MONTH_NAMES = [
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
];
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export type DateParts = { year: number; month: number; day: number };

export type DatePickerOptions = {
  accessibleName?: string;
  formatValue?: (value: string) => string;
  popoverParent?: HTMLElement;
  today?: DateParts;
};

export type DatePickerController = {
  trigger: HTMLButtonElement;
  popover: HTMLDivElement;
  open: () => void;
  close: () => void;
  destroy: () => void;
  isOpen: () => boolean;
};

const pad2 = (value: number) => String(value).padStart(2, '0');
const toIso = (year: number, month: number, day: number) =>
  `${year}-${pad2(month + 1)}-${pad2(day)}`;

const parseIso = (value: string): DateParts | null => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
};

const systemTodayParts = (): DateParts => {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
};

// JS Date#getDay(): Sun=0..Sat=6. This app treats weeks as Monday-first everywhere else.
const mondayIndex = (jsDay: number) => (jsDay + 6) % 7;

const moveDate = (parts: DateParts, days: number): DateParts => {
  const date = new Date(parts.year, parts.month, parts.day + days);
  return { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() };
};

const moveMonth = (parts: DateParts, months: number): DateParts => {
  const targetMonth = parts.month + months;
  const targetYear = parts.year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(targetYear, normalizedMonth + 1, 0).getDate();
  return { year: targetYear, month: normalizedMonth, day: Math.min(parts.day, lastDay) };
};

// A date popover is not an .overlay, so activeOverlay() can't see it, and its own Escape
// handler registers only while it's open — i.e. *after* the shortcut dispatcher's. The
// dispatcher therefore has to ask. Counted rather than boolean: three pickers are attached
// (reminder date, repeat start, repeat end) and each owns its own isOpen.
let openPickerCount = 0;
let pickerSequence = 0;
export const isDatePickerOpen = (): boolean => openPickerCount > 0;

export const attachDatePicker = (
  input: HTMLInputElement | null | undefined,
  options: DatePickerOptions = {},
): DatePickerController | null => {
  if (!input || input.dataset.datePickerAttached === 'true') return null;
  input.dataset.datePickerAttached = 'true';
  const originalDisplay = input.style.display;
  input.style.display = 'none';

  pickerSequence += 1;
  const pickerId = `date-picker-${pickerSequence}`;
  const monthLabelId = `${pickerId}-month`;
  const getToday = () => options.today ?? systemTodayParts();
  const formatValue = options.formatValue ?? ((value: string) => formatDate(value || null));
  const associatedLabel = Array.from(input.labels ?? [])
    .map((label) => label.textContent?.trim() ?? '')
    .find(Boolean);
  const accessibleName =
    options.accessibleName ?? input.getAttribute('aria-label') ?? associatedLabel ?? 'Date';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = `${input.className} date-picker-trigger`;
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', pickerId);
  trigger.innerHTML = `
    <span class="date-picker-trigger-label"></span>
    <span class="date-picker-trigger-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <rect x="3" y="5" width="18" height="16" rx="2"></rect>
        <path d="M3 9h18M8 3v4M16 3v4"></path>
      </svg>
    </span>
  `;
  const triggerLabel = trigger.querySelector<HTMLSpanElement>('.date-picker-trigger-label')!;
  input.insertAdjacentElement('afterend', trigger);

  const popover = document.createElement('div');
  popover.id = pickerId;
  popover.className = 'date-picker-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', `Choose ${accessibleName}`);
  popover.addEventListener('click', (event) => event.stopPropagation());
  (options.popoverParent ?? document.body).appendChild(popover);

  const nativeDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
  const getRawValue = (): string => nativeDescriptor.get!.call(input) as string;

  const refreshTrigger = () => {
    const rawValue = getRawValue();
    const displayValue = rawValue ? formatValue(rawValue) : 'Select date';
    triggerLabel.textContent = displayValue;
    trigger.setAttribute('aria-label', `${accessibleName}: ${displayValue}`);
  };

  Object.defineProperty(input, 'value', {
    configurable: true,
    enumerable: true,
    get(this: HTMLInputElement) {
      return nativeDescriptor.get!.call(this);
    },
    set(this: HTMLInputElement, next: string) {
      nativeDescriptor.set!.call(this, next);
      refreshTrigger();
    },
  });

  let viewYear = 0;
  let viewMonth = 0;
  let focusedDate = '';
  let isOpen = false;

  const closePopover = (restoreFocus: boolean) => {
    if (!isOpen) return;
    isOpen = false;
    openPickerCount -= 1;
    popover.style.display = 'none';
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', handleOutsideClick, true);
    document.removeEventListener('keydown', handleDocumentKeydown, true);
    if (restoreFocus) trigger.focus();
  };

  const handleOutsideClick = (event: MouseEvent) => {
    const target = event.target as Node;
    if (popover.contains(target) || target === trigger) return;
    closePopover(false);
  };

  const handleDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closePopover(true);
  };

  const selectDate = (year: number, month: number, day: number) => {
    input.value = toIso(year, month, day);
    refreshTrigger();
    input.dispatchEvent(new Event('change', { bubbles: true }));
    closePopover(true);
  };

  const renderCalendar = (focusTarget: 'day' | 'previous' | 'next' | null = null) => {
    popover.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'date-picker-header';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'date-picker-nav-btn';
    prevBtn.textContent = '‹';
    prevBtn.setAttribute('aria-label', 'Previous month');
    prevBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      viewMonth -= 1;
      if (viewMonth < 0) {
        viewMonth = 11;
        viewYear -= 1;
      }
      renderCalendar('previous');
    });

    const label = document.createElement('span');
    label.id = monthLabelId;
    label.className = 'date-picker-month-label';
    label.setAttribute('aria-live', 'polite');
    label.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'date-picker-nav-btn';
    nextBtn.textContent = '›';
    nextBtn.setAttribute('aria-label', 'Next month');
    nextBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      viewMonth += 1;
      if (viewMonth > 11) {
        viewMonth = 0;
        viewYear += 1;
      }
      renderCalendar('next');
    });

    header.append(prevBtn, label, nextBtn);
    popover.appendChild(header);

    const weekdaysRow = document.createElement('div');
    weekdaysRow.className = 'date-picker-weekdays';
    weekdaysRow.setAttribute('role', 'row');
    WEEKDAY_LABELS.forEach((day) => {
      const span = document.createElement('span');
      span.setAttribute('role', 'columnheader');
      span.textContent = day;
      weekdaysRow.appendChild(span);
    });
    const grid = document.createElement('div');
    grid.className = 'date-picker-grid';
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-labelledby', monthLabelId);
    grid.appendChild(weekdaysRow);

    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();
    const leadingBlanks = mondayIndex(new Date(viewYear, viewMonth, 1).getDay());
    const selected = parseIso(getRawValue() || '');
    const today = getToday();
    const totalCells = Math.ceil((leadingBlanks + daysInMonth) / 7) * 7;
    const cells: DateParts[] = [];

    for (let index = 0; index < totalCells; index += 1) {
      let cellYear = viewYear;
      let cellMonth = viewMonth;
      let cellDay: number;

      if (index < leadingBlanks) {
        cellDay = prevMonthDays - (leadingBlanks - 1 - index);
        cellMonth -= 1;
        if (cellMonth < 0) {
          cellMonth = 11;
          cellYear -= 1;
        }
      } else if (index >= leadingBlanks + daysInMonth) {
        cellDay = index - (leadingBlanks + daysInMonth) + 1;
        cellMonth += 1;
        if (cellMonth > 11) {
          cellMonth = 0;
          cellYear += 1;
        }
      } else {
        cellDay = index - leadingBlanks + 1;
      }
      cells.push({ year: cellYear, month: cellMonth, day: cellDay });
    }

    const cellIsoValues = new Set(cells.map(({ year, month, day }) => toIso(year, month, day)));
    const selectedIso = selected ? toIso(selected.year, selected.month, selected.day) : '';
    const todayIso = toIso(today.year, today.month, today.day);
    if (!focusedDate || !cellIsoValues.has(focusedDate)) {
      focusedDate = cellIsoValues.has(selectedIso)
        ? selectedIso
        : cellIsoValues.has(todayIso)
          ? todayIso
          : toIso(viewYear, viewMonth, 1);
    }

    cells.forEach((cellParts, index) => {
      if (index % 7 === 0) {
        const week = document.createElement('div');
        week.className = 'date-picker-week';
        week.setAttribute('role', 'row');
        grid.appendChild(week);
      }
      const week = grid.lastElementChild as HTMLDivElement;
      const cell = document.createElement('div');
      cell.className = 'date-picker-cell';
      cell.setAttribute('role', 'gridcell');

      const dayBtn = document.createElement('button');
      dayBtn.type = 'button';
      dayBtn.className = 'date-picker-day';
      const cellIso = toIso(cellParts.year, cellParts.month, cellParts.day);
      dayBtn.dataset.date = cellIso;
      dayBtn.textContent = String(cellParts.day);
      dayBtn.setAttribute(
        'aria-label',
        `${MONTH_NAMES[cellParts.month]} ${cellParts.day}, ${cellParts.year}`,
      );
      dayBtn.tabIndex = cellIso === focusedDate ? 0 : -1;

      if (cellParts.month !== viewMonth) dayBtn.classList.add('other-month');
      const isSelected = cellIso === selectedIso;
      cell.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      if (isSelected) dayBtn.classList.add('selected');
      if (cellIso === todayIso) {
        dayBtn.classList.add('today');
        dayBtn.setAttribute('aria-current', 'date');
      }

      dayBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        selectDate(cellParts.year, cellParts.month, cellParts.day);
      });
      dayBtn.addEventListener('keydown', (event) => {
        let target: DateParts | null = null;
        if (event.key === 'ArrowLeft') target = moveDate(cellParts, -1);
        if (event.key === 'ArrowRight') target = moveDate(cellParts, 1);
        if (event.key === 'ArrowUp') target = moveDate(cellParts, -7);
        if (event.key === 'ArrowDown') target = moveDate(cellParts, 7);
        if (event.key === 'Home') {
          target = moveDate(
            cellParts,
            -mondayIndex(new Date(cellParts.year, cellParts.month, cellParts.day).getDay()),
          );
        }
        if (event.key === 'End') {
          target = moveDate(
            cellParts,
            6 - mondayIndex(new Date(cellParts.year, cellParts.month, cellParts.day).getDay()),
          );
        }
        if (event.key === 'PageUp') target = moveMonth(cellParts, -1);
        if (event.key === 'PageDown') target = moveMonth(cellParts, 1);
        if (!target) return;
        event.preventDefault();
        focusedDate = toIso(target.year, target.month, target.day);
        viewYear = target.year;
        viewMonth = target.month;
        renderCalendar('day');
      });

      cell.appendChild(dayBtn);
      week.appendChild(cell);
    });
    popover.appendChild(grid);

    const footer = document.createElement('div');
    footer.className = 'date-picker-footer';

    const todayBtn = document.createElement('button');
    todayBtn.type = 'button';
    todayBtn.className = 'date-picker-footer-btn';
    todayBtn.textContent = 'Today';
    todayBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const todayParts = getToday();
      selectDate(todayParts.year, todayParts.month, todayParts.day);
    });

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'date-picker-footer-btn';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      input.value = '';
      refreshTrigger();
      input.dispatchEvent(new Event('change', { bubbles: true }));
      closePopover(true);
    });

    footer.append(todayBtn, clearBtn);
    popover.appendChild(footer);

    if (focusTarget) {
      requestAnimationFrame(() => {
        if (focusTarget === 'previous') prevBtn.focus();
        if (focusTarget === 'next') nextBtn.focus();
        if (focusTarget === 'day') {
          popover.querySelector<HTMLButtonElement>(`[data-date="${focusedDate}"]`)?.focus();
        }
      });
    }
  };

  const positionPopover = () => {
    popover.style.visibility = 'hidden';
    popover.style.display = 'flex';

    const triggerRect = trigger.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const spaceBelow = viewportHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;

    const top =
      spaceBelow < popoverRect.height && spaceAbove > spaceBelow
        ? Math.max(triggerRect.top - popoverRect.height - 4, 8)
        : triggerRect.bottom + 4;

    let left = triggerRect.left;
    if (left + popoverRect.width > viewportWidth - 8) {
      left = Math.max(viewportWidth - popoverRect.width - 8, 8);
    }

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
    popover.style.visibility = 'visible';
  };

  const openPopover = () => {
    if (isOpen) return;
    const current = parseIso(getRawValue() || '');
    const base = current ?? getToday();
    viewYear = base.year;
    viewMonth = base.month;
    focusedDate = toIso(base.year, base.month, base.day);
    renderCalendar();
    positionPopover();
    isOpen = true;
    openPickerCount += 1;
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', handleOutsideClick, true);
    document.addEventListener('keydown', handleDocumentKeydown, true);
    requestAnimationFrame(() => {
      popover.querySelector<HTMLButtonElement>(`[data-date="${focusedDate}"]`)?.focus();
    });
  };

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (isOpen) closePopover(false);
    else openPopover();
  });

  popover.style.display = 'none';
  refreshTrigger();

  return {
    trigger,
    popover,
    open: openPopover,
    close: () => closePopover(true),
    destroy: () => {
      closePopover(false);
      trigger.remove();
      popover.remove();
      input.style.display = originalDisplay;
      delete input.dataset.datePickerAttached;
      Reflect.deleteProperty(input, 'value');
    },
    isOpen: () => isOpen,
  };
};
