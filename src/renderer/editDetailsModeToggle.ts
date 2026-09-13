/**
 * Markdown | WYSIWYG mode toggle for the Edit Task Details field.
 *
 * Single canonical document: the Markdown string. The plain `#edit-details` textarea (Markdown
 * mode) and a contenteditable `#edit-details-rich` view (WYSIWYG mode, built by markdownRich.ts
 * from the scoped Markdown subset src/renderer/helpers.ts already renders) are two views of that
 * one string -- never edited independently. Switching modes always serializes the mode being
 * left and re-renders the mode being entered from that same string, so edits made in one mode are
 * visible, in Markdown form, in the other (spec section 2).
 */
import {
  applyInlineTrigger,
  closestBlock,
  convertBlock,
  ensureTaskItemCheckbox,
  markdownToRichFragment,
  matchBlockTrigger,
  matchInlineTrigger,
  matchTaskMarkerInBulletItem,
  richFragmentToMarkdown,
  upgradeBulletItemToTask,
} from './markdownRich.js';
import { buildMarkdownToolbar, type MarkdownToolbar } from './markdownToolbar.js';

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
 * Wires the toggle. `textarea` is the existing `#edit-details`; `rich` and `switchInputs` are new
 * elements added alongside it in index.html (see dom.ts's editDetailsRich/editDetailsMode*).
 */
export const initEditDetailsModeToggle = (
  textarea: HTMLTextAreaElement,
  rich: HTMLDivElement,
  switchInputs: { markdown: HTMLInputElement; wysiwyg: HTMLInputElement }
): EditDetailsController => {
  let mode: EditDetailsMode = 'markdown';

  const toolbarHandle: MarkdownToolbar = buildMarkdownToolbar(() => rich);

  const renderRich = (markdown: string) => {
    rich.innerHTML = '';
    rich.appendChild(markdownToRichFragment(markdown));
  };

  const applyMode = () => {
    if (mode === 'markdown') {
      textarea.style.display = '';
      rich.style.display = 'none';
      toolbarHandle.root.style.display = 'none';
      toolbarHandle.setEnabled(false);
    } else {
      textarea.style.display = 'none';
      rich.style.display = '';
      toolbarHandle.root.style.display = '';
      toolbarHandle.setEnabled(true);
    }
  };

  const setMarkdown = (markdown: string) => {
    mode = 'markdown';
    textarea.value = markdown;
    renderRich(markdown);
    switchInputs.markdown.checked = true;
    switchInputs.wysiwyg.checked = false;
    applyMode();
  };

  const getMarkdown = (): string => (mode === 'wysiwyg' ? richFragmentToMarkdown(rich) : textarea.value);

  const switchTo = (next: EditDetailsMode) => {
    if (next === mode) return;
    if (next === 'wysiwyg') {
      renderRich(textarea.value);
    } else {
      textarea.value = richFragmentToMarkdown(rich);
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
    const offset = range.startOffset;

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

        // D-005/D-006: Handle Enter on an empty task item -> exit the list.
        // If both this item and the previous sibling are empty task items, it means the user
        // pressed Enter on an empty item. Exit the list by removing the newly-created empty item
        // and any preceding consecutive empty items (but only if there's a non-empty item before them),
        // then creating a paragraph after the list.
        const textSpan = block.querySelector('.wysiwyg-task-text') as HTMLElement | null;
        if (textSpan && isEmptyTaskText(textSpan)) {
          const prevSibling = block.previousElementSibling as HTMLElement | null;
          if (prevSibling && prevSibling.tagName === 'LI') {
            const prevTextSpan = prevSibling.querySelector('.wysiwyg-task-text') as HTMLElement | null;
            if (prevTextSpan && isEmptyTaskText(prevTextSpan)) {
              // Both current and previous items are empty -> exit the list.
              // Walk backward from the previous sibling through all consecutive empty task items,
              // but only remove them if there's a non-empty item before the chain.
              const ul = block.parentElement as HTMLElement | null;
              if (ul && ul.parentElement) {
                const p = document.createElement('p');
                p.appendChild(document.createElement('br'));

                // Collect all consecutive empty task items walking backward from prevSibling.
                const emptyItemsToRemove: HTMLElement[] = [];
                let currentCheck = prevSibling as HTMLElement | null;
                let foundNonEmpty = false;

                // Walk backward from prevSibling through all consecutive empty items
                while (currentCheck && currentCheck.tagName === 'LI') {
                  const checkTextSpan = currentCheck.querySelector('.wysiwyg-task-text') as HTMLElement | null;
                  if (checkTextSpan && isEmptyTaskText(checkTextSpan)) {
                    emptyItemsToRemove.unshift(currentCheck); // Add to front to maintain order
                    currentCheck = currentCheck.previousElementSibling as HTMLElement | null;
                  } else {
                    // Found a non-empty item, stop walking backward
                    foundNonEmpty = true;
                    break;
                  }
                }

                // If we reached the start of the list (currentCheck is null after walking all empties),
                // it means all items before the current one are empty, so don't remove them
                // (they're manually-created, like "- [ ] " with no text). Only remove them if
                // there's a non-empty item before them.
                if (!foundNonEmpty) {
                  // currentCheck is null, meaning we're at the start -> clear the removal list
                  emptyItemsToRemove.length = 0;
                }

                // Remove the newly-created empty item
                block.remove();

                // Remove all the consecutive empty items we found (only if there's a non-empty item before them)
                for (const item of emptyItemsToRemove) {
                  item.remove();
                }

                // Insert paragraph after the ul
                ul.parentElement.insertBefore(p, ul.nextSibling);
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

  applyMode();

  return { toolbar: toolbarHandle.root, setMarkdown, getMarkdown };
};
