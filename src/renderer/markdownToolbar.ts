/**
 * Shared formatting toolbar (EditorToolbar) for the Edit Task Details field, reused by both the
 * WYSIWYG editor and the Markdown (CodeMirror) editor -- one DOM instance, one CSS surface,
 * never duplicated between modes (editDetailsModeToggle.ts just shows/hides the same instance).
 *
 * The toolbar itself never manipulates editor DOM/state directly: it only exposes semantic
 * actions (onBold/onItalic/onInlineCode/onHeading1/onHeading2/onBulletList/onTodoList) and calls
 * whichever command set the current mode has bound via `setCommands`. WYSIWYG's commands run the
 * exact same DOM transforms markdownRich.ts's typed-shortcut detector uses (unchanged from
 * before); Markdown's commands run CodeMirror transactions (see markdownEditorCommands.ts). This
 * keeps the two formatting implementations fully independent while sharing one presentation.
 *
 * Only exposes buttons for constructs helpers.ts's renderer actually supports (see
 * markdownRich.ts's header comment for the audit) -- no link/strikethrough/ordered list buttons.
 * Inline Code, Code Block and Blockquote are three separate buttons/commands, never one shared
 * "code" action, so the toolbar can't conflate an inline mark with a block-level construct.
 */

export type EditorToolbarCommands = Readonly<{
  onBold: () => void;
  onItalic: () => void;
  onInlineCode: () => void;
  onHeading1: () => void;
  onHeading2: () => void;
  onBlockquote: () => void;
  onCodeBlock: () => void;
  onBulletList: () => void;
  onTodoList: () => void;
  /** Optional active-state probes; a mode that can't answer cheaply/reliably may omit one. */
  isBoldActive?: () => boolean;
  isItalicActive?: () => boolean;
  isInlineCodeActive?: () => boolean;
  isBlockquoteActive?: () => boolean;
  isCodeBlockActive?: () => boolean;
}>;

export type MarkdownToolbar = Readonly<{
  root: HTMLDivElement;
  setEnabled: (enabled: boolean) => void;
  /** Switches which mode's semantic command set toolbar clicks are routed to. */
  setCommands: (commands: EditorToolbarCommands) => void;
  /** Re-reads the active command set's isXActive probes and updates button highlighting. */
  refreshActiveState: () => void;
}>;

type ButtonSpec = {
  id: string;
  title: string;
  svg: string;
  action: keyof Pick<
    EditorToolbarCommands,
    | 'onBold'
    | 'onItalic'
    | 'onInlineCode'
    | 'onHeading1'
    | 'onHeading2'
    | 'onBlockquote'
    | 'onCodeBlock'
    | 'onBulletList'
    | 'onTodoList'
  >;
  isActive?: keyof Pick<
    EditorToolbarCommands,
    'isBoldActive' | 'isItalicActive' | 'isInlineCodeActive' | 'isBlockquoteActive' | 'isCodeBlockActive'
  >;
};

const BUTTONS: ButtonSpec[] = [
  {
    id: 'bold',
    title: 'Bold',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8" /></svg>',
    action: 'onBold',
    isActive: 'isBoldActive',
  },
  {
    id: 'italic',
    title: 'Italic',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" x2="10" y1="4" y2="4" /><line x1="14" x2="5" y1="20" y2="20" /><line x1="15" x2="9" y1="4" y2="20" /></svg>',
    action: 'onItalic',
    isActive: 'isItalicActive',
  },
  {
    id: 'code',
    title: 'Inline code',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 16 4-4-4-4" /><path d="m6 8-4 4 4 4" /><path d="m14.5 4-5 16" /></svg>',
    action: 'onInlineCode',
    isActive: 'isInlineCodeActive',
  },
  {
    id: 'h1',
    title: 'Heading 1',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h8" /><path d="M4 18V6" /><path d="M12 18V6" /><path d="m17 12 3-2v8" /></svg>',
    action: 'onHeading1',
  },
  {
    id: 'h2',
    title: 'Heading 2',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h8" /><path d="M4 18V6" /><path d="M12 18V6" /><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1" /></svg>',
    action: 'onHeading2',
  },
  {
    id: 'blockquote',
    title: 'Blockquote',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1 2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" /><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1 2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" /></svg>',
    action: 'onBlockquote',
    isActive: 'isBlockquoteActive',
  },
  {
    id: 'codeblock',
    title: 'Code block',
    // Distinct from Inline Code's glyph (no border) -- a bordered "terminal" icon so Code Block
    // (a block-level, whitespace-preserving fenced construct) is never visually confused with
    // Inline Code (an inline mark).
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" ry="2" /><polyline points="8 9 11 12 8 15" /><line x1="13" y1="15" x2="16" y2="15" /></svg>',
    action: 'onCodeBlock',
    isActive: 'isCodeBlockActive',
  },
  {
    id: 'bullet',
    title: 'Bullet list',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h.01" /><path d="M3 12h.01" /><path d="M3 19h.01" /><path d="M8 5h13" /><path d="M8 12h13" /><path d="M8 19h13" /></svg>',
    action: 'onBulletList',
  },
  {
    id: 'task',
    title: 'Task list',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 5h8" /><path d="M13 12h8" /><path d="M13 19h8" /><path d="m3 17 2 2 4-4" /><rect x="3" y="4" width="6" height="6" rx="1" /></svg>',
    action: 'onTodoList',
  },
];

/** Builds the shared toolbar. `initialCommands` is the command set for whichever mode is active
 *  first; `setCommands` lets editDetailsModeToggle.ts rebind it on every mode switch. */
export const buildMarkdownToolbar = (initialCommands: EditorToolbarCommands): MarkdownToolbar => {
  const root = document.createElement('div');
  root.className = 'markdown-toolbar';
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', 'Formatting');

  let commands = initialCommands;
  const buttonsByAction: Map<string, HTMLButtonElement> = new Map();

  const setActive = (button: HTMLButtonElement | undefined, active: boolean) => {
    if (!button) return;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  };

  const refreshActiveState = () => {
    for (const spec of BUTTONS) {
      if (!spec.isActive) continue;
      const probe = commands[spec.isActive];
      setActive(buttonsByAction.get(spec.id), typeof probe === 'function' ? probe() : false);
    }
  };

  BUTTONS.forEach((spec) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'markdown-toolbar-btn';
    button.dataset.action = spec.id;
    button.title = spec.title;
    button.setAttribute('aria-label', spec.title);
    button.innerHTML = spec.svg;
    // mousedown (not click) so the underlying editor's selection survives the button taking focus.
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      if (button.disabled) return;
      commands[spec.action]();
      refreshActiveState();
    });
    buttonsByAction.set(spec.id, button);
    root.appendChild(button);
  });

  const setEnabled = (enabled: boolean) => {
    root.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.disabled = !enabled;
    });
    if (enabled) {
      if (!root.dataset.selectionListenerAttached) {
        document.addEventListener('selectionchange', refreshActiveState);
        root.dataset.selectionListenerAttached = 'true';
      }
      refreshActiveState();
    }
  };

  const setCommands = (next: EditorToolbarCommands) => {
    commands = next;
    refreshActiveState();
  };

  return { root, setEnabled, setCommands, refreshActiveState };
};
