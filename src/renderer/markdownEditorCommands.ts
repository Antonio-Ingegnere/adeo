/**
 * Toolbar-driven formatting commands for the Markdown source editor (CodeMirror 6). Every
 * function here operates exclusively through `EditorView.dispatch`/`EditorState.changeByRange` --
 * never direct DOM manipulation, manual caret repositioning, or document rebuilding -- so
 * CodeMirror remains the single owner of document updates, selection/caret mapping and undo/redo
 * history (each exported function below produces exactly one transaction = one undo step).
 *
 * These are the Markdown-mode counterpart to markdownRich.ts's WYSIWYG DOM transforms: same
 * semantic actions (bold/italic/inline-code/heading/bullet/todo), different implementation,
 * wired together by the shared toolbar in markdownToolbar.ts.
 */
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/** Bold/italic/inline-code marker used to wrap/unwrap a selection or an empty caret. */
export type InlineMarker = '**' | '*' | '`';

/**
 * Toggle-wraps every selection range in `marker`. Non-empty selection: wraps `foo` -> `**foo**`
 * with the original text kept selected inside the markers; if the selection is already exactly
 * `marker`-wrapped (either the markers sit just outside the selection, or the selection includes
 * them), unwraps instead. Empty selection (caret only): inserts `marker+marker` and places the
 * caret between them (e.g. Bold -> `**|**`), or removes an immediately-surrounding marker pair if
 * the caret already sits inside one (second click undoes the first).
 */
export const toggleInlineWrap = (view: EditorView, marker: InlineMarker): void => {
  const markerLen = marker.length;
  const { doc } = view.state;

  const transaction = view.state.changeByRange((range) => {
    const { from, to } = range;

    if (from === to) {
      const before = doc.sliceString(Math.max(0, from - markerLen), from);
      const after = doc.sliceString(to, Math.min(doc.length, to + markerLen));
      if (before === marker && after === marker) {
        return {
          changes: [
            { from: from - markerLen, to: from },
            { from: to, to: to + markerLen },
          ],
          range: EditorSelection.cursor(from - markerLen),
        };
      }
      return {
        changes: { from, insert: marker + marker },
        range: EditorSelection.cursor(from + markerLen),
      };
    }

    const text = doc.sliceString(from, to);
    const outsideBefore = doc.sliceString(Math.max(0, from - markerLen), from);
    const outsideAfter = doc.sliceString(to, Math.min(doc.length, to + markerLen));

    if (outsideBefore === marker && outsideAfter === marker) {
      return {
        changes: [
          { from: from - markerLen, to: from },
          { from: to, to: to + markerLen },
        ],
        range: EditorSelection.range(from - markerLen, to - markerLen),
      };
    }

    if (text.length >= markerLen * 2 && text.startsWith(marker) && text.endsWith(marker)) {
      const inner = text.slice(markerLen, text.length - markerLen);
      return {
        changes: { from, to, insert: inner },
        range: EditorSelection.range(from, from + inner.length),
      };
    }

    return {
      changes: { from, to, insert: marker + text + marker },
      range: EditorSelection.range(from + markerLen, to + markerLen),
    };
  });

  view.dispatch(transaction);
  view.focus();
};

const HEADING_RE = /^(#{1,6})\s+/;

/**
 * Toggles a `#`/`##` heading prefix on the line containing the caret. Clicking the already-active
 * level removes the prefix; clicking a different level replaces the existing prefix (never
 * stacks, e.g. `# Hello` -> H2 click -> `## Hello`, not `## # Hello`). Cursor is placed after
 * the heading prefix insertion.
 */
export const toggleHeading = (view: EditorView, level: 1 | 2): void => {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const match = HEADING_RE.exec(line.text);
  const prefix = `${'#'.repeat(level)} `;

  const change =
    match && match[1].length === level
      ? { from: line.from, to: line.from + match[0].length, insert: '' }
      : match
        ? { from: line.from, to: line.from + match[0].length, insert: prefix }
        : { from: line.from, to: line.from, insert: prefix };

  let newCursorPos: number;
  if (match && match[1].length === level) {
    // Removing the existing prefix: cursor moves back by the prefix length
    newCursorPos = state.selection.main.head - match[0].length;
  } else {
    // Adding a new prefix (or replacing): cursor moves after the new prefix
    newCursorPos = line.from + prefix.length;
  }

  view.dispatch({ changes: change, selection: { anchor: newCursorPos } });
  view.focus();
};

export type LineListKind = 'bullet' | 'todo';

const LIST_MATCHERS: Record<LineListKind, { re: RegExp; prefix: string }> = {
  // Negative lookahead excludes todo-list lines ("- [ ] "/"- [x] ") from matching as plain bullets.
  bullet: { re: /^(\s*)- (?!\[[ xX]\]\s)/, prefix: '- ' },
  todo: { re: /^(\s*)- \[[ xX]\] /, prefix: '- [ ] ' },
};

/** Shared by toggleListLines and toggleBlockquote: toggles a fixed line prefix across every line
 *  touched by the current selection (a single line for a collapsed caret). If every touched line
 *  already has the prefix, removes it from all of them; otherwise adds it to whichever touched
 *  lines don't already have it. Leading indentation and any other line content is left untouched.
 *  One dispatch = one undo step for the whole multiline toggle. Cursor is placed after the prefix
 *  insertion on the line containing the cursor/selection. */
const toggleLinePrefix = (view: EditorView, re: RegExp, prefix: string): void => {
  const { state } = view;
  const range = state.selection.main;
  const startLine = state.doc.lineAt(range.from);
  const endLine = state.doc.lineAt(range.to);
  const mainLine = state.doc.lineAt(range.head);

  const lines = [];
  for (let n = startLine.number; n <= endLine.number; n += 1) lines.push(state.doc.line(n));

  const allPrefixed = lines.every((line) => re.test(line.text));

  const changes: Array<{ from: number; to: number; insert: string }> = [];
  for (const line of lines) {
    const match = re.exec(line.text);
    if (allPrefixed && match) {
      changes.push({ from: line.from + match[1].length, to: line.from + match[0].length, insert: '' });
    } else if (!allPrefixed && !match) {
      const indent = /^\s*/.exec(line.text)?.[0] ?? '';
      changes.push({ from: line.from + indent.length, to: line.from + indent.length, insert: prefix });
    }
  }

  if (changes.length === 0) return;

  // Calculate new cursor position for proper placement after the operation
  const transaction: Record<string, unknown> = { changes };

  if (range.from === range.to) {
    // Collapsed caret: place cursor after the prefix on the main line
    const mainLineMatch = re.exec(mainLine.text);
    const indent = /^\s*/.exec(mainLine.text)?.[0] ?? '';
    const insertPos = mainLine.from + indent.length;

    if (allPrefixed && mainLineMatch) {
      // Removing prefix: cursor moves back by the removed prefix length
      const removalLen = mainLineMatch[0].length;
      transaction.selection = { anchor: range.head - removalLen };
    } else if (!allPrefixed && !mainLineMatch) {
      // Adding prefix: cursor moves after the prefix
      transaction.selection = { anchor: insertPos + prefix.length };
    } else {
      // Line already has prefix and not all lines have it (mixed case): keep cursor position
      transaction.selection = { anchor: range.head };
    }
  }
  // For selections, let CodeMirror handle automatic mapping

  view.dispatch(transaction as Parameters<typeof view.dispatch>[0]);
  view.focus();
};

/**
 * Toggles a `- ` (bullet) or `- [ ] ` (todo) prefix across every line touched by the current
 * selection (a single line for a collapsed caret). Never duplicates a prefix on a line that
 * already has one.
 */
export const toggleListLines = (view: EditorView, kind: LineListKind): void => {
  const { re, prefix } = LIST_MATCHERS[kind];
  toggleLinePrefix(view, re, prefix);
};

const BLOCKQUOTE_RE = /^(\s*)> ?/;

/** Toggles a `> ` blockquote prefix across every line touched by the current selection, exactly
 *  like toggleListLines but for Blockquote -- a distinct block-level command from Code Block. */
export const toggleBlockquote = (view: EditorView): void => {
  toggleLinePrefix(view, BLOCKQUOTE_RE, '> ');
};

// Matches a valid fence line: 3+ backticks followed by whitespace or end-of-line (not content).
// Must be consistent with FENCE_RE in markdownRich.ts to correctly detect unwrap boundaries.
const isFenceLine = (text: string): boolean => /^\s*```+(?:\s|$)/.test(text);

/**
 * Toggles a fenced ``` code block around the lines touched by the current selection (a single
 * line for a collapsed caret). If the line immediately before the touched range and the line
 * immediately after it are both fence lines, the fences are removed (unwrap); otherwise fence
 * lines are inserted immediately before and after the touched range (wrap). A collapsed caret on
 * an empty line wraps into an empty fenced block with the caret left on the blank line inside it.
 * One dispatch = one undo step, and Code Block never reuses Inline Code's single-backtick marker
 * (see toggleInlineWrap) -- fenced blocks always use triple backticks.
 */
export const toggleCodeBlock = (view: EditorView): void => {
  const { state } = view;
  const range = state.selection.main;
  const startLine = state.doc.lineAt(range.from);
  const endLine = state.doc.lineAt(range.to);

  const prevLine = startLine.number > 1 ? state.doc.line(startLine.number - 1) : null;
  const nextLine = endLine.number < state.doc.lines ? state.doc.line(endLine.number + 1) : null;

  if (prevLine && isFenceLine(prevLine.text) && nextLine && isFenceLine(nextLine.text)) {
    view.dispatch({
      changes: [
        // Removes the newline between the content and the closing fence, plus the fence itself
        // (covers the last-line case too, where the closing fence has no trailing newline).
        { from: endLine.to, to: nextLine.to, insert: '' },
        { from: prevLine.from, to: startLine.from, insert: '' },
      ],
    });
    view.focus();
    return;
  }

  const openFenceLen = '```\n'.length;
  view.dispatch({
    changes: [
      { from: endLine.to, insert: '\n```' },
      { from: startLine.from, insert: '```\n' },
    ],
    // Caret lands right after the (now fence-wrapped) content, in new-document coordinates: the
    // opening fence insertion shifts everything from startLine.from onward by its own length.
    selection: { anchor: endLine.to + openFenceLen },
  });
  view.focus();
};

/**
 * Handles the Enter key inside a blockquote line in Markdown mode. If the current line is a
 * blockquote line (starts with `>`) and contains only the blockquote marker plus optional
 * whitespace (i.e., is "empty"), pressing Enter exits the blockquote by replacing the blockquote
 * marker with a newline, creating a normal (non-quoted) line after. For non-empty blockquote
 * lines or non-blockquote lines, returns false to use default Enter behavior.
 */
export const handleBlockquoteEnter = (view: EditorView): boolean => {
  const { state } = view;
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const match = BLOCKQUOTE_RE.exec(line.text);

  // Not a blockquote line, use default Enter
  if (!match) {
    return false;
  }

  // Get the text after the blockquote marker (>) and any trailing spaces
  const textAfterMarker = line.text.slice(match[0].length);

  // If the line has content after the marker, use default Enter (continue the blockquote normally)
  if (textAfterMarker.trim().length > 0) {
    return false;
  }

  // Empty blockquote line (marker plus only whitespace, e.g. '>', '> ', '>   '): exit by
  // replacing the *entire* line -- marker and any trailing whitespace -- with a single newline.
  // This removes the empty '>' marker line outright and creates a normal (non-quoted) empty line
  // after it, with the caret on that new line.
  const insertText = '\n';

  view.dispatch({
    changes: { from: line.from, to: line.to, insert: insertText },
    selection: { anchor: line.from + insertText.length },
  });

  view.focus();
  return true;
};
