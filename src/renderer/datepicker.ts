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

type DateParts = { year: number; month: number; day: number };

const pad2 = (value: number) => String(value).padStart(2, '0');
const toIso = (year: number, month: number, day: number) => `${year}-${pad2(month + 1)}-${pad2(day)}`;

const parseIso = (value: string): DateParts | null => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
};

const todayParts = (): DateParts => {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
};

// JS Date#getDay(): Sun=0..Sat=6. This app treats weeks as Monday-first everywhere else.
const mondayIndex = (jsDay: number) => (jsDay + 6) % 7;

export const attachDatePicker = (input: HTMLInputElement | null | undefined): void => {
  if (!input || input.dataset.datePickerAttached === 'true') return;
  input.dataset.datePickerAttached = 'true';
  input.style.display = 'none';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = `${input.className} date-picker-trigger`;
  input.insertAdjacentElement('afterend', trigger);

  const popover = document.createElement('div');
  popover.className = 'date-picker-popover';
  document.body.appendChild(popover);

  const nativeDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
  const getRawValue = (): string => nativeDescriptor.get!.call(input) as string;

  const refreshTrigger = () => {
    trigger.textContent = formatDate(getRawValue() || null) || 'Select date';
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
  let isOpen = false;

  const closePopover = () => {
    if (!isOpen) return;
    isOpen = false;
    popover.style.display = 'none';
    document.removeEventListener('click', handleOutsideClick, true);
    document.removeEventListener('keydown', handleKeydown, true);
  };

  const handleOutsideClick = (event: MouseEvent) => {
    const target = event.target as Node;
    if (popover.contains(target) || target === trigger) return;
    closePopover();
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePopover();
    }
  };

  const selectDate = (year: number, month: number, day: number) => {
    input.value = toIso(year, month, day);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    closePopover();
  };

  const renderCalendar = () => {
    popover.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'date-picker-header';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'date-picker-nav-btn';
    prevBtn.textContent = '‹';
    prevBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      viewMonth -= 1;
      if (viewMonth < 0) {
        viewMonth = 11;
        viewYear -= 1;
      }
      renderCalendar();
    });

    const label = document.createElement('span');
    label.className = 'date-picker-month-label';
    label.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'date-picker-nav-btn';
    nextBtn.textContent = '›';
    nextBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      viewMonth += 1;
      if (viewMonth > 11) {
        viewMonth = 0;
        viewYear += 1;
      }
      renderCalendar();
    });

    header.appendChild(prevBtn);
    header.appendChild(label);
    header.appendChild(nextBtn);
    popover.appendChild(header);

    const weekdaysRow = document.createElement('div');
    weekdaysRow.className = 'date-picker-weekdays';
    WEEKDAY_LABELS.forEach((day) => {
      const span = document.createElement('span');
      span.textContent = day;
      weekdaysRow.appendChild(span);
    });
    popover.appendChild(weekdaysRow);

    const grid = document.createElement('div');
    grid.className = 'date-picker-grid';

    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();
    const leadingBlanks = mondayIndex(new Date(viewYear, viewMonth, 1).getDay());
    const selected = parseIso(getRawValue() || '');
    const today = todayParts();
    const totalCells = Math.ceil((leadingBlanks + daysInMonth) / 7) * 7;

    for (let i = 0; i < totalCells; i += 1) {
      const dayBtn = document.createElement('button');
      dayBtn.type = 'button';
      dayBtn.className = 'date-picker-day';

      let cellYear = viewYear;
      let cellMonth = viewMonth;
      let cellDay: number;

      if (i < leadingBlanks) {
        cellDay = prevMonthDays - (leadingBlanks - 1 - i);
        cellMonth -= 1;
        if (cellMonth < 0) {
          cellMonth = 11;
          cellYear -= 1;
        }
        dayBtn.classList.add('other-month');
      } else if (i >= leadingBlanks + daysInMonth) {
        cellDay = i - (leadingBlanks + daysInMonth) + 1;
        cellMonth += 1;
        if (cellMonth > 11) {
          cellMonth = 0;
          cellYear += 1;
        }
        dayBtn.classList.add('other-month');
      } else {
        cellDay = i - leadingBlanks + 1;
      }

      dayBtn.textContent = String(cellDay);

      if (selected && selected.year === cellYear && selected.month === cellMonth && selected.day === cellDay) {
        dayBtn.classList.add('selected');
      }
      if (today.year === cellYear && today.month === cellMonth && today.day === cellDay) {
        dayBtn.classList.add('today');
      }

      const targetYear = cellYear;
      const targetMonth = cellMonth;
      const targetDay = cellDay;
      dayBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        selectDate(targetYear, targetMonth, targetDay);
      });

      grid.appendChild(dayBtn);
    }
    popover.appendChild(grid);

    const footer = document.createElement('div');
    footer.className = 'date-picker-footer';

    const todayBtn = document.createElement('button');
    todayBtn.type = 'button';
    todayBtn.className = 'date-picker-footer-btn';
    todayBtn.textContent = 'Today';
    todayBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const t = todayParts();
      selectDate(t.year, t.month, t.day);
    });

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'date-picker-footer-btn';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      input.value = '';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      closePopover();
    });

    footer.appendChild(todayBtn);
    footer.appendChild(clearBtn);
    popover.appendChild(footer);
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
    if (isOpen) {
      closePopover();
      return;
    }
    const current = parseIso(getRawValue() || '');
    const base = current ?? todayParts();
    viewYear = base.year;
    viewMonth = base.month;
    renderCalendar();
    positionPopover();
    isOpen = true;
    document.addEventListener('click', handleOutsideClick, true);
    document.addEventListener('keydown', handleKeydown, true);
  };

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    openPopover();
  });

  popover.style.display = 'none';
  refreshTrigger();
};
