/**
 * Markdown | WYSIWYG mode toggle for the Edit Task Details field.
 *
 * Single canonical document: the Markdown string. A CodeMirror 6 source editor mounted into
 * `#edit-details` (Markdown mode, see markdownEditor.ts) and a contenteditable `#edit-details-rich`
 * view (WYSIWYG mode, built by markdownRich.ts from the scoped Markdown subset
 * src/renderer/helpers.ts already renders) are two views of that one string -- never edited
 * independently. Switching modes always serializes the mode being left and re-renders the mode
 * being entered from that same string, so edits made in one mode are visible, in Markdown form,
 * in the other (spec section 2).
 */
import { createMarkdownEditor, type MarkdownEditorHandle } from './markdownEditor.js';
import { onLocaleChange, t } from './i18n/index.js';
import {
  applyBlockquoteToBlock,
  applyCodeBlockToBlock,
  applyHeadingToBlock,
  applyInlineTrigger,
  applyListToBlock,
  applyPendingFormatToTypedText,
  closestBlock,
  convertBlock,
  ensureTaskItemCheckbox,
  exitFormatAtCaret,
  isCaretInsideTag,
  markdownToRichFragment,
  matchBlockTrigger,
  matchInlineTrigger,
  matchTaskMarkerInBulletItem,
  richFragmentToMarkdown,
  toggleInlineOnSelection,
  upgradeBulletItemToTask,
} from './markdownRich.js';
import { buildMarkdownToolbar, type EditorToolbarCommands, type MarkdownToolbar } from './markdownToolbar.js';

/**
 * Checks if a task-text span is empty (contains only a <br> placeholder or is truly empty).
 * Used to detect when the user pressed Enter on an empty task item to exit the list (D-005).
 */
const isEmptyTaskText = (span: HTMLElement): boolean => {
  // Empty if it has only a <br> child and no other content
  if (span.children.length === 1 && span.children[0].tagName === 'BR' && span.textContent === '') {
    return true;
  }
  // Also consider completely empty (no children)
  if (span.children.length === 0 && (span.textContent === '' || span.textContent === ' ')) {
    return true;
  }
  return false;
};

export type EditDetailsMode = 'markdown' | 'wysiwyg';

export type EditDetailsController = Readonly<{
  toolbar: HTMLDivElement;
  setMarkdown: (markdown: string) => void;
  getMarkdown: () => string;
}>;

/**
 * Wires the toggle. `markdownHost` is `#edit-details` (now a CodeMirror 6 mount point, not a
 * textarea); `rich` and `switchInputs` are the WYSIWYG view and the radio pair (see dom.ts's
 * editDetailsRich/editDetailsMode*).
 */
export const initEditDetailsModeToggle = (
  markdownHost: HTMLDivElement,
  rich: HTMLDivElement,
  switchInputs: { markdown: HTMLInputElement; wysiwyg: HTMLInputElement }
): EditDetailsController => {
  let mode: EditDetailsMode = 'markdown';

  const editor: MarkdownEditorHandle = createMarkdownEditor(markdownHost, {
    initialValue: '',
    placeholder: t('editModal.detailsPlaceholder'),
  });
  const stopLocaleListener = onLocaleChange(() => {
    editor.setPlaceholder(t('editModal.detailsPlaceholder'));
  });
  // Never torn down today (the dialog's editor instance lives for the app's lifetime, matching
  // markdownRich's rich div), but kept so a future dialog-teardown path has something to call.
  void stopLocaleListener;

  // Pending caret typing-format state (bold/italic toggled via the toolbar with no selection --
  // see markdownRich.ts's applyPendingFormatToTypedText/exitFormatAtCaret). Reset whenever a new
  // document is loaded or the mode is switched, so it never leaks across dialogs/re-renders.
  // Purely a WYSIWYG-mode concern; Markdown mode has no equivalent caret-typing-state notion
  // (CodeMirror commands always act on the current selection/caret synchronously).
  const pendingFormat: { strong: boolean; em: boolean } = { strong: false, em: false };
  const resetPendingFormat = () => {
    pendingFormat.strong = false;
    pendingFormat.em = false;
  };

  const toggleInlineOrCaretFormat = (tag: 'strong' | 'em'): void => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      toggleInlineOnSelection(tag);
      return;
    }
    const active = pendingFormat[tag] || isCaretInsideTag(tag);
    if (active) {
      exitFormatAtCaret(tag);
      pendingFormat[tag] = false;
    } else {
      pendingFormat[tag] = true;
    }
  };

  const withBlockAtCaret = (fn: (block: HTMLElement) => void) => {
    const block = closestBlock(rich, window.getSelection()?.anchorNode ?? null);
    if (block) fn(block);
  };

  // WYSIWYG's semantic commands: identical transforms to before this refactor (markdownRich.ts's
  // DOM helpers), just now expressed as the shared toolbar's EditorToolbarCommands shape instead
  // of the toolbar reaching into WYSIWYG internals itself. Each command still ends by dispatching
  // a synthetic 'input' event on `rich`, matching the previous behavior the surrounding 'input'
  // listener (below) relies on for caret-marker cleanup.
  const runWysiwygCommand = (fn: () => void) => {
    fn();
    rich.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const wysiwygCommands: EditorToolbarCommands = {
    onBold: () => runWysiwygCommand(() => toggleInlineOrCaretFormat('strong')),
    onItalic: () => runWysiwygCommand(() => toggleInlineOrCaretFormat('em')),
    onInlineCode: () => runWysiwygCommand(() => toggleInlineOnSelection('code')),
    onHeading1: () => runWysiwygCommand(() => withBlockAtCaret((block) => applyHeadingToBlock(block, 1))),
    onHeading2: () => runWysiwygCommand(() => withBlockAtCaret((block) => applyHeadingToBlock(block, 2))),
    onBlockquote: () => runWysiwygCommand(() => withBlockAtCaret((block) => applyBlockquoteToBlock(block))),
    onCodeBlock: () => runWysiwygCommand(() => withBlockAtCaret((block) => applyCodeBlockToBlock(block))),
    onBulletList: () => runWysiwygCommand(() => withBlockAtCaret((block) => applyListToBlock(block, 'bullet'))),
    onTodoList: () => runWysiwygCommand(() => withBlockAtCaret((block) => applyListToBlock(block, 'task'))),
    isBoldActive: () => pendingFormat.strong || isCaretInsideTag('strong'),
    isItalicActive: () => pendingFormat.em || isCaretInsideTag('em'),
    // Inline Code's <code> and Code Block's <pre><code> both use the tag 'code' at the caret --
    // excluding the <pre> case here keeps the two buttons' active states mutually exclusive, so
    // Inline Code never lights up while the caret is actually inside a Code Block.
    isInlineCodeActive: () => isCaretInsideTag('code') && !isCaretInsideTag('pre'),
    isBlockquoteActive: () => isCaretInsideTag('blockquote'),
    isCodeBlockActive: () => isCaretInsideTag('pre'),
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

  const renderRich = (markdown: string) => {
    rich.innerHTML = '';
    rich.appendChild(markdownToRichFragment(markdown));
  };

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
    renderRich(markdown);
    resetPendingFormat();
    switchInputs.markdown.checked = true;
    switchInputs.wysiwyg.checked = false;
    applyMode();
  };

  const getMarkdown = (): string => (mode === 'wysiwyg' ? richFragmentToMarkdown(rich) : editor.getValue());

  const switchTo = (next: EditDetailsMode) => {
    if (next === mode) return;
    if (next === 'wysiwyg') {
      renderRich(editor.getValue());
    } else {
      editor.setValue(richFragmentToMarkdown(rich));
    }
    resetPendingFormat();
    mode = next;
    applyMode();
  };

  switchInputs.markdown.addEventListener('change', () => {
    if (switchInputs.markdown.checked) switchTo('markdown');
  });
  switchInputs.wysiwyg.addEventListener('change', () => {
    if (switchInputs.wysiwyg.checked) switchTo('wysiwyg');
  });

  // Immediate block-level shortcut conversion: `# `, `## `, `- `, `- [ ] `, `- [x] `, `---`.
  // Immediate inline conversion: closing `**text**`, `*text*`.
  // Only reacts to real typing -- paste fires 'insertFromPaste'/'insertFromDrop' input events,
  // which are skipped so pasted Markdown is never auto-transformed character by character
  // (spec section 13).
  rich.addEventListener('input', (event) => {
    const inputType = (event as InputEvent).inputType;
    if (inputType === 'insertFromPaste' || inputType === 'insertFromDrop') return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    let offset = range.startOffset;

    // Code Block content is always verbatim text: never run block/inline shortcut detection
    // (heading/list/bold/italic/inline-code triggers) while typing inside one, so its own literal
    // characters (e.g. "**", "- ", "` `") can never be misread as formatting markers. Still strips
    // the zero-width-space caret-anchor marker the Enter handler below leaves right after a
    // newline it inserts (a trailing "\n" as the very last character was observed to have
    // ambiguous Chromium caret-affinity -- the ZWS gives the caret an unambiguous non-final home)
    // -- but only on a genuine subsequent keystroke (inputType 'insertText' with real data), never
    // on the synthetic 'input' event the Enter handler itself dispatches right after creating the
    // marker, which would otherwise immediately undo the fix before the user types anything.
    if (isCaretInsideTag('pre')) {
      const typedText = (event as InputEvent).data;
      if (inputType === 'insertText' && typeof typedText === 'string' && typedText.length > 0 && node.nodeType === Node.TEXT_NODE) {
        const textNode = node as Text;
        if (textNode.data.includes('​')) {
          const zwsBeforeCaret = (textNode.data.slice(0, offset).match(/​/g) ?? []).length;
          textNode.data = textNode.data.replace(/​/g, '');
          const newOffset = Math.max(0, offset - zwsBeforeCaret);
          const cleanRange = document.createRange();
          cleanRange.setStart(textNode, newOffset);
          cleanRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(cleanRange);
        }
      }
      return;
    }

    // Strip the plain (unformatted) zero-width-space caret-anchor marker `exitFormatAtCaret`
    // leaves behind when a pending typing-format is turned off (see markdownRich.ts), but only
    // once real content has landed next to it -- leaving the marker as *only* a zero-width space
    // (e.g. right after the toolbar click, before any real typing) would turn it back into an
    // empty text node, undoing the very fix it exists for (an empty text node at that boundary is
    // exactly the ambiguous anchor Chromium's caret affinity resolves by re-entering the adjacent
    // formatting element). Safe to strip once non-marker content is present: this marker only
    // ever appears in a plain, non-formatted text node (never nested inside a <strong>/<em> the
    // way the old caret-placeholder approach did), so removing it can't straddle a
    // formatting-element boundary or corrupt sibling content.
    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      if (textNode.data.includes('​') && textNode.data.replace(/​/g, '').length > 0) {
        const zwsBeforeCaret = (textNode.data.slice(0, offset).match(/​/g) ?? []).length;
        textNode.data = textNode.data.replace(/​/g, '');
        offset = Math.max(0, offset - zwsBeforeCaret);
        const cleanRange = document.createRange();
        cleanRange.setStart(textNode, offset);
        cleanRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(cleanRange);
      }
    }

    // A pending caret typing-format is active (toolbar Bold/Italic toggled with no selection):
    // wrap the character(s) Chromium just inserted as plain text in the missing formatting
    // element(s) instead of running block/inline shortcut detection against them.
    if (pendingFormat.strong || pendingFormat.em) {
      const typedText = (event as InputEvent).data;
      if (inputType === 'insertText' && typeof typedText === 'string' && typedText.length > 0) {
        const tags: Array<'strong' | 'em'> = [];
        if (pendingFormat.em) tags.push('em');
        if (pendingFormat.strong) tags.push('strong');
        applyPendingFormatToTypedText(typedText, tags);
        return;
      }
    }

    const block = closestBlock(rich, node);

    // Chromium's native Enter correctly splits a task `<li>` into a sibling `<li>` in the same
    // `<ul>` (the label+checkbox are siblings of the text span, not an ancestor of it, so nothing
    // blocks native list-splitting) -- but the new sibling only carries over the split text span,
    // not the label+checkbox (those lived before the caret in the original item, so Chromium's
    // split naturally leaves them behind). Re-attach a fresh unchecked checkbox to any task-list
    // `<li>` that's missing one, without touching the caret/selection Chromium already placed.
    if (block && block.tagName === 'LI') {
      const parentList = block.parentElement as HTMLUListElement | null;
      if (parentList && parentList.tagName === 'UL' && parentList.dataset.listType === 'task') {
        ensureTaskItemCheckbox(block as HTMLLIElement, false);

        // D-005/D-006/D-005-reopen: Handle Enter on an empty task item -> exit the list.
        // If both this item and the previous sibling are empty task items, it means the user
        // pressed Enter on an empty item. Exit the list unconditionally: remove the newly-created
        // empty item and every preceding consecutive empty item, all the way to the start of the
        // list if every item turns out to be empty (a single empty task item, with no non-empty
        // item ever preceding it, must still fully exit on Enter -- there is no product requirement
        // to preserve empty checkboxes as content just because a non-empty item wasn't found first;
        // an earlier version of this walk-back gated removal on finding a non-empty item, which left
        // a stray empty checkbox behind whenever the *entire* list was empty items, this is what the
        // regression reproduced), then creating a paragraph after (or in place of) the list.
        const textSpan = block.querySelector('.wysiwyg-task-text') as HTMLElement | null;
        if (textSpan && isEmptyTaskText(textSpan)) {
          const prevSibling = block.previousElementSibling as HTMLElement | null;
          if (prevSibling && prevSibling.tagName === 'LI') {
            const prevTextSpan = prevSibling.querySelector('.wysiwyg-task-text') as HTMLElement | null;
            if (prevTextSpan && isEmptyTaskText(prevTextSpan)) {
              // Both current and previous items are empty -> exit the list.
              const ul = block.parentElement as HTMLElement | null;
              const listParent = ul?.parentElement ?? null;
              if (ul && listParent) {
                const p = document.createElement('p');
                p.appendChild(document.createElement('br'));

                // Collect all consecutive empty task items walking backward from prevSibling,
                // regardless of whether the walk reaches the start of the list.
                const emptyItemsToRemove: HTMLElement[] = [];
                let currentCheck = prevSibling as HTMLElement | null;
                while (currentCheck && currentCheck.tagName === 'LI') {
                  const checkTextSpan = currentCheck.querySelector('.wysiwyg-task-text') as HTMLElement | null;
                  if (checkTextSpan && isEmptyTaskText(checkTextSpan)) {
                    emptyItemsToRemove.unshift(currentCheck); // Add to front to maintain order
                    currentCheck = currentCheck.previousElementSibling as HTMLElement | null;
                  } else {
                    // Found a non-empty item, stop walking backward
                    break;
                  }
                }

                // Remove the newly-created empty item and every empty item found above.
                block.remove();
                for (const item of emptyItemsToRemove) {
                  item.remove();
                }

                // If that emptied the whole list, replace the now-empty <ul> with the paragraph
                // instead of leaving a stray empty list element behind; otherwise insert after it.
                if (ul.children.length === 0) {
                  listParent.replaceChild(p, ul);
                } else {
                  listParent.insertBefore(p, ul.nextSibling);
                }
                // Explicitly place caret at the start of the paragraph before the br
                const sel = window.getSelection();
                if (sel) {
                  const range = document.createRange();
                  range.setStart(p, 0);
                  range.collapse(true);
                  sel.removeAllRanges();
                  sel.addRange(range);
                }
              }
              return;
            }
          }
        }
      }
    }

    // A plain <div> is Chromium's own new-block element in some contexts (e.g. Enter out of a
    // heading); an <li> is what Enter produces inside an existing bullet/task list. Both are
    // treated identically to <p> for shortcut purposes -- heading conversion only applies to
    // p/div (a heading cannot be a list item).
    if (block && (block.tagName === 'P' || block.tagName === 'DIV' || block.tagName === 'LI')) {
      const trigger = matchBlockTrigger(block.textContent ?? '');
      if (trigger) {
        if (trigger.kind === 'heading') {
          if (block.tagName !== 'LI') convertBlock(block, 'heading', trigger.level, false);
        } else if (trigger.kind === 'bullet') {
          convertBlock(block, 'bullet', 0, false);
        } else if (trigger.kind === 'task') {
          convertBlock(block, 'task', 0, trigger.checked);
        } else if (trigger.kind === 'blockquote') {
          // Clear the block content (remove the trigger text "> ") and apply blockquote
          block.innerHTML = '';
          block.appendChild(document.createElement('br'));
          applyBlockquoteToBlock(block);
        } else if (trigger.kind === 'hr') {
          convertBlock(block, 'hr', 0, false);
        }
        return;
      }

      // Special case: if we're in a bullet list item, check if the user is typing a task marker
      // ([ ] or [x]) at the start, which should upgrade the item to a task item.
      if (block.tagName === 'LI') {
        const ul = block.parentElement as HTMLUListElement | null;
        if (ul && ul.tagName === 'UL' && ul.dataset.listType === 'bullet') {
          const taskMarker = matchTaskMarkerInBulletItem(block.textContent ?? '');
          if (taskMarker) {
            upgradeBulletItemToTask(block as HTMLLIElement, taskMarker.checked);
            return;
          }
        }
      }
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      const match = matchInlineTrigger(text.slice(0, offset));
      if (match) applyInlineTrigger(node as Text, match.start, match.end, match.tag);
    }
  });

  // Plain-text-only paste in WYSIWYG mode (spec section 13); textarea already pastes plain text.
  rich.addEventListener('paste', (event) => {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, text);
  });

  // Code Block preserves whitespace/line breaks and Enter must create another line *inside* the
  // same block (never split it into a new paragraph/second <pre>, which is Chromium's default
  // contenteditable Enter behavior for most block elements). Intercepted via 'beforeinput' (the
  // editing-pipeline-sanctioned point for cancelling/replacing a native text edit) with a manual
  // textContent splice at the caret's plain-text offset inside `<code>`, so the result is
  // deterministic regardless of Chromium's own line-break/block-split heuristics. The 'input'
  // handler above's pre-block early-return still applies to the native 'input' event this
  // produces, like any other keystroke inside the block.
  rich.addEventListener('beforeinput', (event) => {
    const inputEvent = event as InputEvent;
    if (inputEvent.inputType !== 'insertParagraph' && inputEvent.inputType !== 'insertLineBreak') return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    let node: Node | null = range.startContainer;
    let pre: HTMLElement | null = null;
    let blockquote: HTMLElement | null = null;

    // Walk up to find either <pre> (Code Block) or <blockquote>
    while (node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = (node as HTMLElement).tagName;
        if (tag === 'PRE') {
          pre = node as HTMLElement;
          break;
        }
        if (tag === 'BLOCKQUOTE') {
          blockquote = node as HTMLElement;
          break;
        }
      }
      node = node.parentNode;
    }

    // Handle Code Block: preserve whitespace/line breaks, insert newline inside the block
    if (pre) {
      const code = pre.querySelector('code');
      if (!code) return;
      event.preventDefault();

      const preRange = document.createRange();
      preRange.selectNodeContents(code);
      preRange.setEnd(range.startContainer, range.startOffset);
      const offset = preRange.toString().length;

      // Mutate the existing Text node's data in place (never replace it with a new Text object via
      // `code.textContent = ...`) -- keeping the same node identity is what keeps Chromium's own
      // internal editing/caret state in sync with the DOM Selection set below for the *next*
      // keystroke (the same class of caret-affinity quirk exitFormatAtCaret above works around).
      code.normalize();
      let textNode = code.firstChild as Text | null;
      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
        textNode = document.createTextNode('');
        code.appendChild(textNode);
      }
      // A trailing "\n" as the very last character of the text node was observed to have ambiguous
      // Chromium caret affinity: a Selection placed right after it (i.e. at the true end) still let
      // the *next* typed character land before the "\n" instead of after it. A zero-width-space
      // placed right after the "\n" gives the caret an unambiguous, non-final home (the same fix
      // exitFormatAtCaret above uses for its own caret-affinity boundary); the 'input' handler above
      // strips this ZWS again once real content lands next to it, and blockToMarkdown's Code Block
      // serialization strips any that's still there defensively.
      const isAtEnd = offset >= textNode.data.length;
      const insert = isAtEnd ? '\n​' : '\n';
      textNode.data = textNode.data.slice(0, offset) + insert + textNode.data.slice(offset);

      const newRange = document.createRange();
      newRange.setStart(textNode, offset + 1);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);
      rich.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    // Handle Blockquote: if the current blockquote paragraph is empty, exit the blockquote.
    // If it's non-empty, allow normal Enter behavior (which creates another paragraph inside).
    if (blockquote) {
      const block = closestBlock(rich, range.startContainer);
      if (!block || block.tagName !== 'P') return;

      // Check if this paragraph is empty (only contains a <br> or whitespace)
      const isEmptyPara = block.textContent?.trim() === '';

      if (isEmptyPara) {
        event.preventDefault();

        // Create a new normal paragraph
        const p = document.createElement('p');
        p.appendChild(document.createElement('br'));

        const blockquoteParent = blockquote.parentElement;
        if (!blockquoteParent) return;

        // Insert the new paragraph after the blockquote
        blockquoteParent.insertBefore(p, blockquote.nextSibling);

        // Remove the empty paragraph from the blockquote
        block.remove();

        // If the blockquote is now empty, remove it too
        if (blockquote.children.length === 0) {
          blockquoteParent.removeChild(blockquote);
        }

        // Place the caret at the start of the new paragraph
        const sel = window.getSelection();
        if (sel) {
          const caretRange = document.createRange();
          caretRange.setStart(p, 0);
          caretRange.collapse(true);
          sel.removeAllRanges();
          sel.addRange(caretRange);
        }

        rich.dispatchEvent(new Event('input', { bubbles: true }));
      }
      // If not empty, allow default behavior (Chromium will create a new <p> inside the blockquote)
      return;
    }
  });

  applyMode();

  return { toolbar: toolbarHandle.root, setMarkdown, getMarkdown };
};
