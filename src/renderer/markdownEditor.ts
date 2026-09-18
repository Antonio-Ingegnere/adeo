/**
 * CodeMirror 6 lifecycle + external-state sync for the Details Markdown source editor.
 *
 * Owns rendering/caret/selection/keyboard/mouse/undo entirely through a real `EditorView` --
 * no textarea/backdrop mirror layer and no contenteditable hand-rolled editing (an earlier
 * attempt at this exact feature used that architecture; it was reverted because the visual
 * text and the real caret diverged once font metrics changed). The document is the single
 * Markdown string also held by the surrounding task/editor state: `setValue` only touches the
 * CodeMirror document when the incoming string actually differs from the current one, and
 * suppresses the change callback while doing so, so external syncs never loop back into
 * `onChange` and never fight the user's own typing.
 *
 * One `EditorView` is created per call to `createMarkdownEditor` and reused for the life of the
 * host element (the Edit Task dialog builds it once, lazily, on first use -- see
 * editDetailsModeToggle.ts); it is never recreated per keystroke or per mode switch.
 */
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExtension } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting } from '@codemirror/language';
import { markdownEditorTheme } from './markdownEditorTheme.js';
import { markdownHighlightStyle } from './markdownEditorHighlighting.js';
import {
  toggleBlockquote,
  toggleCodeBlock,
  toggleHeading,
  toggleInlineWrap,
  toggleListLines,
} from './markdownEditorCommands.js';

export type MarkdownEditorHandle = Readonly<{
  getValue: () => string;
  setValue: (value: string) => void;
  setPlaceholder: (text: string) => void;
  focus: () => void;
  destroy: () => void;
  /** Toolbar-driven formatting commands; see markdownEditorCommands.ts for their contract. */
  toggleBold: () => void;
  toggleItalic: () => void;
  toggleInlineCode: () => void;
  toggleHeading: (level: 1 | 2) => void;
  toggleBlockquote: () => void;
  toggleCodeBlock: () => void;
  toggleBulletList: () => void;
  toggleTodoList: () => void;
}>;

export type MarkdownEditorOptions = Readonly<{
  initialValue: string;
  placeholder?: string;
  onChange?: (value: string) => void;
}>;

export const createMarkdownEditor = (
  container: HTMLElement,
  options: MarkdownEditorOptions
): MarkdownEditorHandle => {
  let suppressOnChange = false;
  const placeholderCompartment = new Compartment();

  const view = new EditorView({
    doc: options.initialValue,
    parent: container,
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(markdownHighlightStyle),
      markdownEditorTheme,
      EditorView.lineWrapping,
      placeholderCompartment.of(placeholderExtension(options.placeholder ?? '')),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !suppressOnChange) {
          options.onChange?.(update.state.doc.toString());
        }
      }),
    ],
  });

  return {
    getValue: () => view.state.doc.toString(),
    setValue: (value: string) => {
      if (view.state.doc.toString() === value) return;
      suppressOnChange = true;
      try {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: value },
        });
      } finally {
        suppressOnChange = false;
      }
    },
    setPlaceholder: (text: string) => {
      view.dispatch({ effects: placeholderCompartment.reconfigure(placeholderExtension(text)) });
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
    toggleBold: () => toggleInlineWrap(view, '**'),
    toggleItalic: () => toggleInlineWrap(view, '*'),
    toggleInlineCode: () => toggleInlineWrap(view, '`'),
    toggleHeading: (level: 1 | 2) => toggleHeading(view, level),
    toggleBlockquote: () => toggleBlockquote(view),
    toggleCodeBlock: () => toggleCodeBlock(view),
    toggleBulletList: () => toggleListLines(view, 'bullet'),
    toggleTodoList: () => toggleListLines(view, 'todo'),
  };
};

// Re-exported so callers can type-check against the same EditorState/EditorView shapes without
// importing @codemirror/* directly (keeps CodeMirror an implementation detail of this module).
export type { EditorState, EditorView };
