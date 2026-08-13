import type { Task } from '../types.js';
import { state } from './state.js';

/**
 * The format defaults to the user's setting, which is how every caller but one uses it. The
 * Settings dialog passes an explicit pattern to show what each option produces — the map here
 * stays the only place the patterns are spelled out.
 */
export const formatDate = (date: string | null, format: string = state.dateFormat): string => {
  if (!date) return '';
  const [y, m, d] = date.split('-');
  const map: Record<string, string> = {
    'YYYY-MM-DD': `${y}-${m}-${d}`,
    'DD/MM/YYYY': `${d}/${m}/${y}`,
    'MM/DD/YYYY': `${m}/${d}/${y}`,
    'DD.MM.YYYY': `${d}.${m}.${y}`,
    'YYYY/MM/DD': `${y}/${m}/${d}`,
    'MM-DD-YYYY': `${m}-${d}-${y}`,
    'DD-MM-YYYY': `${d}-${m}-${y}`,
    'MMM DD, YYYY': new Date(`${y}-${m}-${d}T00:00:00`).toLocaleDateString(undefined, {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
    }),
    'DD MMM YYYY': new Date(`${y}-${m}-${d}T00:00:00`).toLocaleDateString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }),
    'YYYY.MM.DD': `${y}.${m}.${d}`,
  };
  return map[format] ?? `${y}-${m}-${d}`;
};

const scrollParent = (el: HTMLElement): HTMLElement | null => {
  let node = el.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
};

/**
 * Brings a just-opened menu fully into view. The sidebar is its own scroller, so a menu on the
 * last pill hangs past the rail's bottom edge and would otherwise sit there clipped until the
 * user thought to scroll.
 *
 * The arithmetic is done by hand rather than with scrollIntoView({block:'nearest'}), which left
 * the menu 4px short: an absolutely positioned descendant's contribution to scrollable overflow
 * ignores the container's bottom padding, so the two disagree about where the end is. Pushing
 * scrollTop past the end just clamps.
 */
const REVEAL_GAP = 8;
export const revealInScroller = (el: HTMLElement) => {
  const nudge = () => {
    const scroller = scrollParent(el);
    if (!scroller) return;
    const box = el.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    if (box.bottom + REVEAL_GAP > view.bottom) {
      scroller.scrollTop += box.bottom + REVEAL_GAP - view.bottom;
    } else if (box.top - REVEAL_GAP < view.top) {
      scroller.scrollTop -= view.top - box.top + REVEAL_GAP;
    }
  };
  // twice: the first pass is clamped by a scrollHeight that does not yet account for the menu
  // it is trying to reveal, so it can land a few pixels short
  requestAnimationFrame(() => {
    nudge();
    requestAnimationFrame(nudge);
  });
};

export const positionDropdown = (menu: HTMLElement, trigger: HTMLElement) => {
  menu.style.top = '';
  menu.style.bottom = '';
  menu.style.maxHeight = '';
  menu.style.overflowY = '';
  menu.style.visibility = 'hidden';
  menu.style.display = 'flex';

  const menuRect = menu.getBoundingClientRect();
  const triggerRect = trigger.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const spaceBelow = viewportHeight - triggerRect.bottom;
  const spaceAbove = triggerRect.top;

  if (spaceBelow < menuRect.height && spaceAbove > spaceBelow) {
    menu.style.top = 'auto';
    menu.style.bottom = 'calc(100% + 4px)';
    if (spaceAbove < menuRect.height) {
      menu.style.maxHeight = `${Math.max(spaceAbove - 8, 80)}px`;
      menu.style.overflowY = 'auto';
    }
  } else {
    menu.style.top = 'calc(100% + 4px)';
    menu.style.bottom = 'auto';
    if (spaceBelow < menuRect.height) {
      menu.style.maxHeight = `${Math.max(spaceBelow - 8, 80)}px`;
      menu.style.overflowY = 'auto';
    }
  }

  menu.style.visibility = 'visible';
};

/**
 * Puts a sidebar pill into the tab order and makes Enter/Space activate it.
 *
 * The pills stay <div>s rather than becoming <button>s: each one contains its own kebab
 * <button>, and a button inside a button is invalid HTML that browsers reparent. role +
 * tabindex gets the same keyboard behaviour without the nesting. Activation is delegated
 * to el.click() so there is exactly one copy of the selection logic, in the click handler.
 */
export const makePillActivatable = (el: HTMLElement, selected: boolean) => {
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  el.setAttribute('aria-pressed', selected ? 'true' : 'false');
  el.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault(); // Space would otherwise scroll the rail
    el.click();
  });
};

/**
 * Keeps a combobox input's live ARIA in sync with its listbox. Without this a screen
 * reader announces nothing at all when the suggestion list opens or the active item moves,
 * because the focus never actually leaves the text input.
 */
export const syncComboboxAria = (
  input: HTMLElement | null,
  open: boolean,
  activeOptionId: string | null
) => {
  if (!input) return;
  input.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open && activeOptionId) {
    input.setAttribute('aria-activedescendant', activeOptionId);
  } else {
    input.removeAttribute('aria-activedescendant');
  }
};

export const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const renderInline = (text: string): string =>
  text.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');

export const createDetailsElement = (
  task: Task,
  updateDetails: (taskId: number, details: string) => Promise<void>,
  rerender: () => void
): HTMLElement => {
  const container = document.createElement('div');
  container.className = 'task-details';
  const lines = (task.details || '').split(/\r?\n/);
  let currentList: HTMLUListElement | null = null;
  const closeList = () => {
    if (currentList) {
      container.appendChild(currentList);
      currentList = null;
    }
  };

  const updateCheckboxLine = async (lineIndex: number, checked: boolean) => {
    const original = lines[lineIndex] || '';
    const updated = original.replace(/^\s*(?:-|\*)?\s*\[\s?[xX ]\s?\]/, checked ? '- [x]' : '- [ ]');
    lines[lineIndex] = updated;
    const newDetails = lines.join('\n');
    task.details = newDetails;
    try {
      await updateDetails(task.id, newDetails);
      rerender();
    } catch (error) {
      console.error('Failed to update task detail checkbox', error);
    }
  };

  lines.forEach((line, index) => {
    const hrMatch = line.match(/^\s*-{3,}\s*$/);
    if (hrMatch) {
      closeList();
      const hr = document.createElement('hr');
      hr.className = 'md-hr';
      container.appendChild(hr);
      return;
    }

    const headerMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headerMatch) {
      closeList();
      const level = Math.min(headerMatch[1].length, 6);
      const h = document.createElement(`h${level}`);
      h.innerHTML = renderInline(escapeHtml(headerMatch[2]));
      container.appendChild(h);
      return;
    }

    const taskMatch = line.match(/^\s*(?:-|\*)?\s*\[\s?([xX ])\s?\]\s+(.*)/);
    if (taskMatch) {
      if (currentList?.dataset.type !== 'task') {
        closeList();
        currentList = document.createElement('ul');
        currentList.className = 'task-list';
        currentList.dataset.type = 'task';
      }
      const li = document.createElement('li');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = taskMatch[1].toLowerCase() === 'x';
      checkbox.addEventListener('change', (event) => {
        updateCheckboxLine(index, (event.target as HTMLInputElement).checked);
      });
      const span = document.createElement('span');
      span.innerHTML = renderInline(escapeHtml(taskMatch[2]));
      li.appendChild(checkbox);
      li.appendChild(span);
      currentList.appendChild(li);
      return;
    }

    const listMatch = line.match(/^\s*[-*]\s+(.*)/);
    if (listMatch) {
      if (currentList?.dataset.type !== 'bullet') {
        closeList();
        currentList = document.createElement('ul');
        currentList.dataset.type = 'bullet';
      }
      const li = document.createElement('li');
      li.innerHTML = renderInline(escapeHtml(listMatch[1]));
      currentList.appendChild(li);
      return;
    }

    if (line.trim() === '') {
      closeList();
      container.appendChild(document.createElement('br'));
      return;
    }

    closeList();
    const p = document.createElement('p');
    p.innerHTML = renderInline(escapeHtml(line));
    container.appendChild(p);
  });

  closeList();
  return container;
};
