/**
 * Syntax highlighting for the Markdown source editor (`#edit-details`, see markdownEditor.ts).
 *
 * Styles the tags @lezer/markdown assigns while parsing (via @codemirror/lang-markdown), using
 * the app's existing color tokens (styles/tokens.css) so the source view matches the rest of the
 * UI in both light and dark mode without its own hardcoded palette.
 */
import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

export const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: '700', fontSize: '1.3em', color: 'var(--text-strong)' },
  { tag: tags.heading2, fontWeight: '700', fontSize: '1.15em', color: 'var(--text-strong)' },
  { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], fontWeight: '700', color: 'var(--text-strong)' },
  { tag: tags.strong, fontWeight: '700', color: 'var(--text-strong)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--text-muted)' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)', color: 'var(--accent-text)' },
  { tag: [tags.link, tags.url], color: 'var(--accent-text)', textDecoration: 'underline' },
  { tag: tags.quote, color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: tags.list, color: 'var(--text-body)' },
  { tag: tags.contentSeparator, color: 'var(--border-strong)' },
  { tag: tags.processingInstruction, color: 'var(--text-ghost)' },
  { tag: tags.meta, color: 'var(--text-ghost)' },
]);
