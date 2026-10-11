/**
 * Markdown | WYSIWYG mode toggle for the Edit Task Details field.
 *
 * Single canonical document: the Markdown string. A CodeMirror 6 source editor mounted into
 * `#edit-details` (Markdown mode, see markdownEditor.ts) and a TipTap/ProseMirror editor mounted
 * into `#edit-details-rich` (WYSIWYG mode, see richEditor.ts) are two views of that one string --
 * never edited independently. Switching modes always serializes the mode being left and
 * re-renders the mode being entered from that same string, via `getMarkdown`/`setMarkdown` called
 * exactly once at the switch boundary -- never on every keystroke, so TipTap's own update events
 * never loop back into `setMarkdown` -- so edits made in one mode are visible, in Markdown form, in
 * the other (spec section 2). TipTap's document is UI state only and is never persisted as JSON;
 * only the Markdown string round-tripped through richEditor.ts's getMarkdown/setMarkdown is.
 */
import { createMarkdownEditor, type MarkdownEditorHandle } from './markdownEditor.js';
import { onLocaleChange, t } from './i18n/index.js';
import { createRichEditor, type RichEditorHandle } from './richEditor.js';
import { buildMarkdownToolbar, type EditorToolbarCommands, type MarkdownToolbar } from './markdownToolbar.js';

export type EditDetailsMode = 'markdown' | 'wysiwyg';

export type EditDetailsController = Readonly<{
  toolbar: HTMLDivElement;
  setMarkdown: (markdown: string) => void;
  getMarkdown: () => string;
  /** Inserts an attachment reference at the remembered selection/caret of whichever mode is
   *  active, as one undoable edit -- see markdownEditorCommands.ts's insertLink / richEditor.ts's
   *  insertAttachmentLink. */
  insertAttachmentReference: (attachmentId: string, label: string) => void;
}>;

/**
 * Wires the toggle. `markdownHost` is `#edit-details` (a CodeMirror 6 mount point); `rich` is
 * `#edit-details-rich` (a TipTap mount point -- see dom.ts's editDetailsRich/editDetailsMode*).
 * `onOpenAttachment` fires when the user activates an `attachment:<id>` reference in either mode
 * (Ctrl/Cmd-click in Markdown, a plain click on the rendered link in WYSIWYG).
 */
export const initEditDetailsModeToggle = (
  markdownHost: HTMLDivElement,
  rich: HTMLDivElement,
  switchInputs: { markdown: HTMLInputElement; wysiwyg: HTMLInputElement },
  onOpenAttachment?: (attachmentId: string) => void
): EditDetailsController => {
  let mode: EditDetailsMode = 'markdown';

  const editor: MarkdownEditorHandle = createMarkdownEditor(markdownHost, {
    initialValue: '',
    placeholder: t('editModal.detailsPlaceholder'),
    onOpenAttachment,
  });
  const stopLocaleListener = onLocaleChange(() => {
    editor.setPlaceholder(t('editModal.detailsPlaceholder'));
  });
  // Never torn down today (the dialog's editor instances live for the app's lifetime), but kept
  // so a future dialog-teardown path has something to call.
  void stopLocaleListener;

  // One TipTap Editor instance for the life of the host element, matching the CodeMirror handle's
  // lifecycle -- never recreated per keystroke or per mode switch.
  const richEditor: RichEditorHandle = createRichEditor(rich, {
    onUpdate: () => toolbarHandle.refreshActiveState(),
    onOpenAttachment,
  });

  // WYSIWYG's semantic commands: thin bindings onto richEditor's TipTap chain commands and
  // editor.isActive(...)-backed probes (semantic state, not DOM inspection) -- everything else
  // (input rules, Enter/Backspace block semantics, undo/redo, caret/selection repair, nested-mark
  // bookkeeping) is owned by TipTap itself now.
  const wysiwygCommands: EditorToolbarCommands = {
    onBold: () => richEditor.toggleBold(),
    onItalic: () => richEditor.toggleItalic(),
    onInlineCode: () => richEditor.toggleInlineCode(),
    onHeading1: () => richEditor.toggleHeading(1),
    onHeading2: () => richEditor.toggleHeading(2),
    onBlockquote: () => richEditor.toggleBlockquote(),
    onCodeBlock: () => richEditor.toggleCodeBlock(),
    onBulletList: () => richEditor.toggleBulletList(),
    onTodoList: () => richEditor.toggleTodoList(),
    isBoldActive: () => richEditor.isBoldActive(),
    isItalicActive: () => richEditor.isItalicActive(),
    isInlineCodeActive: () => richEditor.isInlineCodeActive(),
    isBlockquoteActive: () => richEditor.isBlockquoteActive(),
    isCodeBlockActive: () => richEditor.isCodeBlockActive(),
  };

  // Markdown's semantic commands: CodeMirror transactions only (markdownEditorCommands.ts via the
  // editor handle) -- never DOM manipulation of the CodeMirror content, never manual caret math.
  const markdownCommands: EditorToolbarCommands = {
    onBold: () => editor.toggleBold(),
    onItalic: () => editor.toggleItalic(),
    onInlineCode: () => editor.toggleInlineCode(),
    onHeading1: () => editor.toggleHeading(1),
    onHeading2: () => editor.toggleHeading(2),
    onBlockquote: () => editor.toggleBlockquote(),
    onCodeBlock: () => editor.toggleCodeBlock(),
    onBulletList: () => editor.toggleBulletList(),
    onTodoList: () => editor.toggleTodoList(),
  };

  const toolbarHandle: MarkdownToolbar = buildMarkdownToolbar(markdownCommands);

  // The toolbar is one shared instance/row in both modes (spec: no layout shift on mode switch);
  // only which command set it's bound to changes.
  const applyMode = () => {
    if (mode === 'markdown') {
      markdownHost.style.display = '';
      rich.style.display = 'none';
      toolbarHandle.setCommands(markdownCommands);
    } else {
      markdownHost.style.display = 'none';
      rich.style.display = '';
      toolbarHandle.setCommands(wysiwygCommands);
    }
    toolbarHandle.setEnabled(true);
  };

  const setMarkdown = (markdown: string) => {
    mode = 'markdown';
    editor.setValue(markdown);
    richEditor.setMarkdown(markdown);
    switchInputs.markdown.checked = true;
    switchInputs.wysiwyg.checked = false;
    applyMode();
  };

  const getMarkdown = (): string => (mode === 'wysiwyg' ? richEditor.getMarkdown() : editor.getValue());

  const switchTo = (next: EditDetailsMode) => {
    if (next === mode) return;
    if (next === 'wysiwyg') {
      // Parse the Markdown mode's current string into the TipTap document exactly once, at the
      // switch boundary (never on every keystroke -- see this file's header comment).
      richEditor.setMarkdown(editor.getValue());
    } else {
      editor.setValue(richEditor.getMarkdown());
    }
    mode = next;
    applyMode();
  };

  switchInputs.markdown.addEventListener('change', () => {
    if (switchInputs.markdown.checked) switchTo('markdown');
  });
  switchInputs.wysiwyg.addEventListener('change', () => {
    if (switchInputs.wysiwyg.checked) switchTo('wysiwyg');
  });

  applyMode();

  const insertAttachmentReference = (attachmentId: string, label: string): void => {
    const href = `attachment:${attachmentId}`;
    if (mode === 'wysiwyg') {
      richEditor.insertAttachmentLink(label, href);
    } else {
      editor.insertLink(label, href);
    }
  };

  return { toolbar: toolbarHandle.root, setMarkdown, getMarkdown, insertAttachmentReference };
};
