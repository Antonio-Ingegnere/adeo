/**
 * CodeMirror 6 theme for the Markdown source editor (`#edit-details`, see markdownEditor.ts).
 *
 * `.markdown-cm-host` (styles.css) deliberately zeroes its own padding and hands inset/scrolling
 * off to CodeMirror's `.cm-content`/`.cm-scroller` so there is exactly one inset and one scroll
 * container, not two -- this theme is what supplies that inset, plus the surface/text colors and
 * font that `.details-textarea` used to provide directly to the old <textarea>.
 */
import { EditorView } from '@codemirror/view';

export const markdownEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
    fontSize: 'var(--font-l)',
  },
  '.cm-content': {
    padding: '10px 12px',
    fontFamily: 'var(--font-mono)',
    caretColor: 'var(--text-strong)',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'var(--font-mono)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--text-strong)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--surface-selected)',
  },
  '.cm-placeholder': {
    color: 'var(--text-placeholder)',
    fontFamily: 'var(--font-mono)',
  },
  '.cm-gutters': {
    display: 'none',
  },
});
