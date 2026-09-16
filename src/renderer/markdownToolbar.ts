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
import { applyHeadingToBlock, applyListToBlock, closestBlock, isCaretInsideTag, toggleInlineOnSelection } from './markdownRich.js';

export type MarkdownToolbar = Readonly<{
  root: HTMLDivElement;
  setEnabled: (enabled: boolean) => void;
}>;

/**
 * Owns the "pending caret typing-format" state (bold/italic toggled via the toolbar with no
 * selection -- see editDetailsModeToggle.ts) that the toolbar needs both to read (to reflect an
 * explicitly-toggled state that isn't yet visible in the DOM, e.g. right after activating Bold
 * but before any character has been typed) and to flip (`toggleCaretFormat`, which also exits any
 * enclosing formatting element at the caret when turning a currently-active state off). Lives
 * outside markdownToolbar.ts because it must survive/reset across mode switches and document
 * loads, which only editDetailsModeToggle.ts's controller knows about.
 */
export type CaretFormatState = Readonly<{
  isPending: (tag: 'strong' | 'em') => boolean;
  toggleCaretFormat: (tag: 'strong' | 'em') => void;
}>;

type ButtonSpec = {
  id: string;
  title: string;
  svg: string;
  run: (surface: HTMLElement, formatState: CaretFormatState) => void;
};

const toggleInlineOrCaretFormat = (tag: 'strong' | 'em', formatState: CaretFormatState): void => {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
    toggleInlineOnSelection(tag);
  } else {
    formatState.toggleCaretFormat(tag);
  }
};

const BUTTONS: ButtonSpec[] = [
  {
    id: 'bold',
    title: 'Bold',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8" /></svg>',
    run: (_surface, formatState) => toggleInlineOrCaretFormat('strong', formatState),
  },
  {
    id: 'italic',
    title: 'Italic',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" x2="10" y1="4" y2="4" /><line x1="14" x2="5" y1="20" y2="20" /><line x1="15" x2="9" y1="4" y2="20" /></svg>',
    run: (_surface, formatState) => toggleInlineOrCaretFormat('em', formatState),
  },
  {
    id: 'code',
    title: 'Inline code',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 16 4-4-4-4" /><path d="m6 8-4 4 4 4" /><path d="m14.5 4-5 16" /></svg>',
    // Selection only (no caret-typing-state for code): toggleInlineOnSelection is a no-op when
    // there's no selection.
    run: () => toggleInlineOnSelection('code'),
  },
  {
    id: 'h1',
    title: 'Heading 1',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h8" /><path d="M4 18V6" /><path d="M12 18V6" /><path d="m17 12 3-2v8" /></svg>',
    run: (surface) => {
      const block = closestBlock(surface, window.getSelection()?.anchorNode ?? null);
      if (block) applyHeadingToBlock(block, 1);
    },
  },
  {
    id: 'h2',
    title: 'Heading 2',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h8" /><path d="M4 18V6" /><path d="M12 18V6" /><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1" /></svg>',
    run: (surface) => {
      const block = closestBlock(surface, window.getSelection()?.anchorNode ?? null);
      if (block) applyHeadingToBlock(block, 2);
    },
  },
  {
    id: 'bullet',
    title: 'Bullet list',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h.01" /><path d="M3 12h.01" /><path d="M3 19h.01" /><path d="M8 5h13" /><path d="M8 12h13" /><path d="M8 19h13" /></svg>',
    run: (surface) => {
      const block = closestBlock(surface, window.getSelection()?.anchorNode ?? null);
      if (block) applyListToBlock(block, 'bullet');
    },
  },
  {
    id: 'task',
    title: 'Task list',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 5h8" /><path d="M13 12h8" /><path d="M13 19h8" /><path d="m3 17 2 2 4-4" /><rect x="3" y="4" width="6" height="6" rx="1" /></svg>',
    run: (surface) => {
      const block = closestBlock(surface, window.getSelection()?.anchorNode ?? null);
      if (block) applyListToBlock(block, 'task');
    },
  },
];

/** Builds the toolbar. `getSurface` returns the live contenteditable WYSIWYG element to act on;
 *  `formatState` is the caret typing-format state owned by editDetailsModeToggle.ts. */
export const buildMarkdownToolbar = (
  getSurface: () => HTMLElement | null,
  formatState: CaretFormatState
): MarkdownToolbar => {
  const root = document.createElement('div');
  root.className = 'markdown-toolbar';
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', 'Formatting');

  const buttonsByAction: Map<string, HTMLButtonElement> = new Map();

  BUTTONS.forEach((spec) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'markdown-toolbar-btn';
    button.dataset.action = spec.id;
    button.title = spec.title;
    button.setAttribute('aria-label', spec.title);
    button.innerHTML = spec.svg;
    // mousedown (not click) so the contenteditable selection survives the button taking focus.
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const surface = getSurface();
      if (!surface || button.disabled) return;
      spec.run(surface, formatState);
      surface.dispatchEvent(new Event('input', { bubbles: true }));
      // After running the action, update the toolbar state to reflect the new caret position
      updateActiveState();
    });
    buttonsByAction.set(spec.id, button);
    root.appendChild(button);
  });

  const setActive = (button: HTMLButtonElement | undefined, active: boolean) => {
    if (!button) return;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  };

  const updateActiveState = () => {
    // Active state reflects either an explicitly-toggled pending caret typing-format (which may
    // not be visible in the DOM yet, e.g. right after activating Bold but before typing) or the
    // caret naturally sitting inside existing matching formatting.
    setActive(buttonsByAction.get('bold'), formatState.isPending('strong') || isCaretInsideTag('strong'));
    setActive(buttonsByAction.get('italic'), formatState.isPending('em') || isCaretInsideTag('em'));
    setActive(buttonsByAction.get('code'), isCaretInsideTag('code'));
  };

  const setEnabled = (enabled: boolean) => {
    root.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.disabled = !enabled;
    });
    if (enabled) {
      // When toolbar becomes enabled, set up a selectionchange listener to update active state
      if (!root.dataset.selectionListenerAttached) {
        document.addEventListener('selectionchange', updateActiveState);
        root.dataset.selectionListenerAttached = 'true';
      }
      // Initial update of active state
      updateActiveState();
    }
  };
  setEnabled(false);

  return { root, setEnabled };
};
