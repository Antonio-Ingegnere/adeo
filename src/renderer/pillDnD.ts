// Drag-to-reorder for the sidebar's pills. Lists and smart lists are different things but the
// same gesture, so the wiring lives here once rather than twice.
//
// The in-flight drag is module-local: it is interaction state, not app state, and only one
// drag can exist at a time. `kind` is what keeps the two panels apart -- a dragover whose kind
// does not match the pill under the pointer never calls preventDefault, so the browser refuses
// the drop and no indicator appears.
import { listDropIndicator } from './dom.js';

export type PillKind = 'list' | 'smart-list';

type Drag = { kind: PillKind; from: number; to: number | null };

let drag: Drag | null = null;

const removeIndicator = () => {
  listDropIndicator.parentNode?.removeChild(listDropIndicator);
};

/** The ☰ both panels show on hover. Swallows clicks so grabbing it never activates the pill. */
export const makeDragHandle = (): HTMLSpanElement => {
  const handle = document.createElement('span');
  handle.className = 'list-drag-handle';
  handle.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z" />
      </svg>
    `;
  handle.addEventListener('click', (event) => event.stopPropagation());
  return handle;
};

export const attachPillDnD = (opts: {
  kind: PillKind;
  item: HTMLElement;
  index: number;
  /** Splice the collection, persist the new order, repaint. Never called for a no-op move. */
  reorder: (from: number, to: number) => void;
}) => {
  const { kind, item, index, reorder } = opts;
  item.setAttribute('draggable', 'true');
  item.dataset.index = String(index);

  item.addEventListener('dragstart', (event) => {
    drag = { kind, from: index, to: null };
    item.classList.add('dragging');
    const dt = event.dataTransfer;
    if (!dt) return;
    dt.setData('text/plain', String(index));
    dt.effectAllowed = 'move';
    // an off-screen clone, so the drag image is the pill itself rather than whatever the
    // browser would have grabbed out of a scrolled container
    const dragImage = item.cloneNode(true) as HTMLElement;
    const rect = item.getBoundingClientRect();
    dragImage.style.position = 'absolute';
    dragImage.style.top = '-9999px';
    dragImage.style.left = '-9999px';
    dragImage.style.width = `${rect.width}px`;
    dragImage.style.boxSizing = 'border-box';
    dragImage.classList.add('dragging');
    document.body.appendChild(dragImage);
    // clamped so the grab point never sits on the very edge of the image
    const offsetX = Math.min(Math.max(event.clientX - rect.left, 12), rect.width - 12);
    const offsetY = Math.min(Math.max(event.clientY - rect.top, 12), rect.height - 12);
    dt.setDragImage(dragImage, offsetX, offsetY);
    requestAnimationFrame(() => dragImage.remove());
  });

  item.addEventListener('dragend', () => {
    drag = null;
    item.classList.remove('dragging');
    removeIndicator();
  });

  item.addEventListener('dragover', (event) => {
    // a pill from the other panel: no preventDefault, so this is not a drop target
    if (!drag || drag.kind !== kind) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    const isBefore = event.clientY < item.getBoundingClientRect().top + item.offsetHeight / 2;
    const next = isBefore ? index : index + 1;
    if (drag.to === next) return;
    drag.to = next;
    removeIndicator();
    item.parentNode?.insertBefore(listDropIndicator, isBefore ? item : item.nextSibling);
  });

  item.addEventListener('drop', (event) => {
    if (!drag || drag.kind !== kind) return;
    event.preventDefault();
    removeIndicator();
    const { from, to } = drag;
    drag = null;
    if (to === null) return;
    // dropping either side of where it already sits moves nothing
    if (from === to || from + 1 === to) return;
    reorder(from, to);
  });
};

/** The splice both callers need: `to` is a gap index, so it shifts when moving downwards. */
export const moveItem = <T>(items: T[], from: number, to: number) => {
  const [moved] = items.splice(from, 1);
  items.splice(from < to ? to - 1 : to, 0, moved);
};
