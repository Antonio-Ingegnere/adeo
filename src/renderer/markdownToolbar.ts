/**
 * WYSIWYG-mode formatting toolbar for the Edit Task Details field. Buttons call the exact same
 * transform functions markdownRich.ts's typed-shortcut detector uses (editDetailsModeToggle.ts),
 * so toolbar clicks and typed Markdown shortcuts converge on one implementation per spec section
 * 7. Enabled only while the field is in WYSIWYG mode: in Markdown mode the field is a plain
 * textarea with no rich selection concept to act on, so there is no second/duplicate "act on a
 * markdown-mode selection" code path to keep in sync.
 *
 * Only exposes buttons for constructs helpers.ts's renderer actually supports (see
 * markdownRich.ts's header comment for the audit) -- no blockquote/link/strikethrough/ordered
 * list/fenced code buttons.
 */
import { applyHeadingToBlock, applyListToBlock, closestBlock, toggleInlineOnSelection } from './markdownRich.js';

export type MarkdownToolbar = Readonly<{
  root: HTMLDivElement;
  setEnabled: (enabled: boolean) => void;
}>;

type ButtonSpec = {
  id: string;
  label: string;
  title: string;
  run: (surface: HTMLElement) => void;
};

const BUTTONS: ButtonSpec[] = [
  { id: 'bold', label: 'B', title: 'Bold', run: () => toggleInlineOnSelection('strong') },
  { id: 'italic', label: 'I', title: 'Italic', run: () => toggleInlineOnSelection('em') },
  { id: 'code', label: '</>', title: 'Inline code', run: () => toggleInlineOnSelection('code') },
  {
    id: 'h1',
    label: 'H1',
    title: 'Heading 1',
    run: (surface) => {
      const block = closestBlock(surface, window.getSelection()?.anchorNode ?? null);
      if (block) applyHeadingToBlock(block, 1);
    },
  },
  {
    id: 'h2',
    label: 'H2',
    title: 'Heading 2',
    run: (surface) => {
      const block = closestBlock(surface, window.getSelection()?.anchorNode ?? null);
      if (block) applyHeadingToBlock(block, 2);
    },
  },
  {
    id: 'bullet',
    label: '•',
    title: 'Bullet list',
    run: (surface) => {
      const block = closestBlock(surface, window.getSelection()?.anchorNode ?? null);
      if (block) applyListToBlock(block, 'bullet');
    },
  },
  {
    id: 'task',
    label: '☑',
    title: 'Task list',
    run: (surface) => {
      const block = closestBlock(surface, window.getSelection()?.anchorNode ?? null);
      if (block) applyListToBlock(block, 'task');
    },
  },
];

/** Builds the toolbar. `getSurface` returns the live contenteditable WYSIWYG element to act on. */
export const buildMarkdownToolbar = (getSurface: () => HTMLElement | null): MarkdownToolbar => {
  const root = document.createElement('div');
  root.className = 'markdown-toolbar';
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', 'Formatting');

  BUTTONS.forEach((spec) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'markdown-toolbar-btn';
    button.dataset.action = spec.id;
    button.title = spec.title;
    button.setAttribute('aria-label', spec.title);
    button.textContent = spec.label;
    // mousedown (not click) so the contenteditable selection survives the button taking focus.
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const surface = getSurface();
      if (!surface || button.disabled) return;
      spec.run(surface);
      surface.dispatchEvent(new Event('input', { bubbles: true }));
    });
    root.appendChild(button);
  });

  const setEnabled = (enabled: boolean) => {
    root.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.disabled = !enabled;
    });
  };
  setEnabled(false);

  return { root, setEnabled };
};
