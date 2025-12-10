import type { Task } from '../types.js';

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
