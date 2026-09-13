/**
 * Shared Markdown <-> rich-DOM model for the Edit Task Details field's WYSIWYG mode.
 *
 * Scoped strictly to the Markdown subset src/renderer/helpers.ts's renderInline()/
 * createDetailsElement() already renders elsewhere in the app (the collapsed task-card Details
 * preview): bold (**), italic (*), inline code (`), headings (#-######), a hr (---), bullet
 * lists (-), and task lists (- [ ] / - [x]). Deliberately no blockquote, link, strikethrough,
 * ordered list, fenced code or table support -- helpers.ts's renderer does not understand those,
 * so exposing shortcuts or toolbar buttons for them would let a user produce Markdown the rest of
 * the app cannot render, violating "don't expose functionality the editor can't persist
 * correctly as Markdown". Any such syntax that already exists in a task's `details` is left as
 * literal paragraph text by this module (see `blockToMarkdown`'s default case) rather than being
 * parsed, mutated or dropped, which is what keeps round-tripping lossless for content this mode
 * doesn't understand (spec section 15).
 *
 * Toolbar clicks (markdownToolbar.ts) and typed-shortcut detection (editDetailsModeToggle.ts)
 * both call the exact same functions below -- `convertBlock`, `toggleInlineOnSelection`,
 * `applyHeadingTrigger`, `applyInlineTrigger` -- so there is exactly one implementation of each
 * document transformation (spec section 7).
 */

export type ListKind = 'bullet' | 'task';

const escapeForTextNode = (text: string): Text => document.createTextNode(text);

/** Turns one line's inline Markdown into a fragment of text/<strong>/<em>/<code> nodes. */
export const inlineMarkdownToFragment = (text: string): DocumentFragment => {
  const frag = document.createDocumentFragment();
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) frag.appendChild(escapeForTextNode(text.slice(last, match.index)));
    if (match[1] !== undefined) {
      const code = document.createElement('code');
      code.textContent = match[1];
      frag.appendChild(code);
    } else if (match[2] !== undefined) {
      const strong = document.createElement('strong');
      strong.textContent = match[2];
      frag.appendChild(strong);
    } else if (match[3] !== undefined) {
      const em = document.createElement('em');
      em.textContent = match[3];
      frag.appendChild(em);
    }
    last = re.lastIndex;
  }
  if (last < text.length) frag.appendChild(escapeForTextNode(text.slice(last)));
  return frag;
};

/** Inverse of inlineMarkdownToFragment: walks a node's inline children back into Markdown text. */
export const inlineNodeToMarkdown = (node: Node): string => {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent ?? '';
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const el = child as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') return; // only used as an empty-block caret placeholder
    if (tag === 'strong' || tag === 'b') {
      out += `**${inlineNodeToMarkdown(el)}**`;
    } else if (tag === 'em' || tag === 'i') {
      out += `*${inlineNodeToMarkdown(el)}*`;
    } else if (tag === 'code') {
      out += `\`${el.textContent ?? ''}\``;
    } else {
      out += inlineNodeToMarkdown(el);
    }
  });
  return out;
};

const makeParagraph = (inline: string): HTMLParagraphElement => {
  const p = document.createElement('p');
  if (inline === '') {
    p.appendChild(document.createElement('br'));
  } else {
    p.appendChild(inlineMarkdownToFragment(inline));
  }
  return p;
};

const makeHeading = (level: number, inline: string): HTMLHeadingElement => {
  const h = document.createElement(`h${Math.min(Math.max(level, 1), 6)}`) as HTMLHeadingElement;
  h.appendChild(inlineMarkdownToFragment(inline));
  return h;
};

const appendListItem = (
  root: HTMLElement,
  currentList: { el: HTMLUListElement; kind: ListKind } | null,
  kind: ListKind,
  inline: string,
  checked: boolean
): { el: HTMLUListElement; kind: ListKind } => {
  let list = currentList;
  if (!list || list.kind !== kind) {
    const ul = document.createElement('ul');
    ul.className = kind === 'task' ? 'wysiwyg-list wysiwyg-list--task' : 'wysiwyg-list wysiwyg-list--bullet';
    ul.dataset.listType = kind;
    root.appendChild(ul);
    list = { el: ul, kind };
  }
  const li = document.createElement('li');
  if (kind === 'task') {
    const label = document.createElement('label');
    label.className = 'wysiwyg-task';
    label.contentEditable = 'false';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = checked;
    checkbox.contentEditable = 'false';
    label.appendChild(checkbox);
    const span = document.createElement('span');
    span.className = 'wysiwyg-task-text';
    span.contentEditable = 'true';
    span.appendChild(inline === '' ? document.createElement('br') : inlineMarkdownToFragment(inline));
    li.append(label, span);
  } else {
    li.appendChild(inline === '' ? document.createElement('br') : inlineMarkdownToFragment(inline));
  }
  list.el.appendChild(li);
  return list;
};

/** Builds the WYSIWYG DOM for an entire Markdown string. Mirrors helpers.ts's line-by-line scan. */
export const markdownToRichFragment = (markdown: string): DocumentFragment => {
  const frag = document.createDocumentFragment();
  const lines = markdown.split(/\r?\n/);
  let currentList: { el: HTMLUListElement; kind: ListKind } | null = null;
  const root = document.createElement('div');

  lines.forEach((line) => {
    if (/^\s*-{3,}\s*$/.test(line)) {
      currentList = null;
      root.appendChild(document.createElement('hr'));
      return;
    }
    const headerMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headerMatch) {
      currentList = null;
      root.appendChild(makeHeading(headerMatch[1].length, headerMatch[2]));
      return;
    }
    const taskMatch = line.match(/^\s*(?:-|\*)?\s*\[\s?([xX ])\s?\]\s+(.*)/);
    if (taskMatch) {
      currentList = appendListItem(root, currentList, 'task', taskMatch[2], taskMatch[1].toLowerCase() === 'x');
      return;
    }
    const listMatch = line.match(/^\s*[-*]\s+(.*)/);
    if (listMatch) {
      currentList = appendListItem(root, currentList, 'bullet', listMatch[1], false);
      return;
    }
    currentList = null;
    root.appendChild(makeParagraph(line));
  });

  if (root.children.length === 0) root.appendChild(makeParagraph(''));
  while (root.firstChild) frag.appendChild(root.firstChild);
  return frag;
};

const blockToMarkdown = (el: Element): string[] => {
  const tag = el.tagName.toLowerCase();
  if (tag === 'hr') return ['---'];
  const headingMatch = tag.match(/^h([1-6])$/);
  if (headingMatch) return [`${'#'.repeat(Number(headingMatch[1]))} ${inlineNodeToMarkdown(el)}`];
  if (tag === 'ul') {
    const kind = (el as HTMLElement).dataset.listType === 'task' ? 'task' : 'bullet';
    return Array.from(el.children).map((li) => {
      if (kind === 'task') {
        const checkbox = li.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        const textEl = li.querySelector('.wysiwyg-task-text');
        const marker = checkbox?.checked ? '- [x] ' : '- [ ] ';
        return marker + (textEl ? inlineNodeToMarkdown(textEl) : '');
      }
      return `- ${inlineNodeToMarkdown(li)}`;
    });
  }
  // Paragraph (or any other block, e.g. one this module didn't itself create): round-trips its
  // inline content verbatim, which is exactly what preserves Markdown syntax this mode doesn't
  // understand (blockquotes, links, etc.) unchanged rather than corrupting or dropping it.
  return [inlineNodeToMarkdown(el)];
};

/** Serializes the live WYSIWYG DOM back into the same Markdown string helpers.ts renders. */
export const richFragmentToMarkdown = (root: HTMLElement): string => {
  const lines: string[] = [];
  Array.from(root.children).forEach((child) => {
    lines.push(...blockToMarkdown(child));
  });
  return lines.join('\n');
};

// ---------------------------------------------------------------------------------------------
// Shared transforms -- called identically by the toolbar and by the typed-shortcut detector.
// ---------------------------------------------------------------------------------------------

const placeCaretAtEnd = (el: Node) => {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
};

const placeCaretAtStart = (el: Node) => {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
};

const makeEmptyListItem = (kind: 'bullet' | 'task', checked: boolean): { li: HTMLLIElement; caretTarget: HTMLElement } => {
  const li = document.createElement('li');
  if (kind !== 'task') {
    li.appendChild(document.createElement('br'));
    return { li, caretTarget: li };
  }
  const label = document.createElement('label');
  label.className = 'wysiwyg-task';
  label.contentEditable = 'false';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = checked;
  checkbox.contentEditable = 'false';
  label.appendChild(checkbox);
  const span = document.createElement('span');
  span.className = 'wysiwyg-task-text';
  span.contentEditable = 'true';
  span.appendChild(document.createElement('br'));
  li.append(label, span);
  return { li, caretTarget: span };
};

const makeListWrapper = (kind: ListKind, items: HTMLLIElement[]): HTMLUListElement => {
  const ul = document.createElement('ul');
  ul.className = kind === 'task' ? 'wysiwyg-list wysiwyg-list--task' : 'wysiwyg-list wysiwyg-list--bullet';
  ul.dataset.listType = kind;
  items.forEach((item) => ul.appendChild(item));
  return ul;
};

/**
 * Re-types `li` (an existing, otherwise-empty list item -- e.g. one Chromium just created via
 * Enter) as the other list kind, consuming the trigger text. Splits its `<ul>` around it so the
 * rest of the original list is untouched: `<ul>a</ul><ul kind>b</ul><ul>c</ul>` rather than one
 * `<ul>` mixing bullet and task items, which the block model (one `data-list-type` per `<ul>`)
 * does not represent.
 */
const convertListItem = (li: HTMLLIElement, kind: 'bullet' | 'task', checked: boolean): HTMLElement => {
  const ul = li.parentElement as HTMLUListElement | null;
  const originalKind: ListKind = ul?.dataset.listType === 'task' ? 'task' : 'bullet';
  if (kind === originalKind) {
    // Re-typed "- " inside an already-bullet item (or "- [ ] "/"- [x] " typed as a prefix of
    // itself is not this case -- see below): genuinely nothing to convert. Left as literal text
    // so, in particular, typing "- " followed by "[ ] " inside a *bullet* item's first two
    // characters is not prematurely "completed" as a no-op bullet conversion that would eat the
    // "- " before the rest of the task marker is typed -- the fuller `- [ ] ` pattern is checked
    // on every keystroke and still matches once the whole marker is present (spec section 6).
    return li;
  }
  const { li: newLi, caretTarget } = makeEmptyListItem(kind, checked);
  if (!ul || !ul.parentElement) {
    li.replaceWith(newLi);
    placeCaretAtEnd(caretTarget);
    return caretTarget;
  }
  const parent = ul.parentElement;
  const items = Array.from(ul.children) as HTMLLIElement[];
  const idx = items.indexOf(li);
  const before = items.slice(0, idx);
  const after = items.slice(idx + 1);
  if (before.length) parent.insertBefore(makeListWrapper(originalKind, before), ul);
  parent.insertBefore(makeListWrapper(kind, [newLi]), ul);
  if (after.length) parent.insertBefore(makeListWrapper(originalKind, after), ul);
  parent.removeChild(ul);
  placeCaretAtEnd(caretTarget);
  return caretTarget;
};

/** Converts an empty paragraph/div/list-item to a heading/bullet-item/task-item/hr, consuming the trigger text. */
export const convertBlock = (
  block: HTMLElement,
  kind: 'heading' | 'bullet' | 'task' | 'hr',
  level: number,
  checked: boolean
): HTMLElement => {
  if (kind === 'hr') {
    const hr = document.createElement('hr');
    block.replaceWith(hr);
    // After converting to hr, move caret to the next block or create an empty paragraph after
    const next = hr.nextElementSibling as HTMLElement | null;
    if (next) {
      placeCaretAtEnd(next);
      return next;
    }
    // If no next element, create a new paragraph and place caret there
    const p = makeParagraph('');
    hr.parentElement?.appendChild(p);
    placeCaretAtEnd(p);
    return p;
  }

  if (block.tagName === 'LI' && kind !== 'heading') {
    return convertListItem(block as HTMLLIElement, kind, checked);
  }
  if (kind === 'heading') {
    const heading = makeHeading(level, '');
    // An empty block element offers no valid caret position in Chromium's contenteditable --
    // typing right after would land before the element instead of inside it. A trailing <br>
    // (as makeParagraph('') already does for empty paragraphs) gives it one; typing replaces it.
    heading.appendChild(document.createElement('br'));
    block.replaceWith(heading);
    placeCaretAtEnd(heading);
    return heading;
  }

  const prev = block.previousElementSibling as HTMLUListElement | null;
  const { li, caretTarget } = makeEmptyListItem(kind, checked);
  if (prev && prev.tagName === 'UL' && prev.dataset.listType === kind) {
    prev.appendChild(li);
    block.remove();
  } else {
    block.replaceWith(makeListWrapper(kind, [li]));
  }
  placeCaretAtEnd(caretTarget);
  return caretTarget;
};

/** Replaces a `**text**`/`*text*` run ending at the caret with the equivalent inline element. */
export const applyInlineTrigger = (textNode: Text, matchStart: number, matchEnd: number, tag: 'strong' | 'em'): void => {
  const full = textNode.textContent ?? '';
  const inner = full.slice(matchStart + (tag === 'strong' ? 2 : 1), matchEnd - (tag === 'strong' ? 2 : 1));
  const before = full.slice(0, matchStart);
  const after = full.slice(matchEnd);
  const el = document.createElement(tag);
  el.textContent = inner;
  const parent = textNode.parentNode;
  if (!parent) return;
  const beforeNode = document.createTextNode(before);
  const afterNode = document.createTextNode(after);
  parent.replaceChild(afterNode, textNode);
  parent.insertBefore(el, afterNode);
  parent.insertBefore(beforeNode, el);
  placeCaretAtEnd(el);
};

/** Wraps (or unwraps) the current selection in a bold/italic/code element. No-op with no selection. */
export const toggleInlineOnSelection = (tag: 'strong' | 'em' | 'code'): boolean => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  const existing = (() => {
    let node: Node | null = range.commonAncestorContainer;
    while (node) {
      if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName.toLowerCase() === tag) {
        return node as HTMLElement;
      }
      node = node.parentNode;
    }
    return null;
  })();
  if (existing) {
    const parent = existing.parentNode;
    if (!parent) return false;
    while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
    parent.removeChild(existing);
    return true;
  }
  const contents = range.extractContents();
  const wrapper = document.createElement(tag);
  wrapper.appendChild(contents);
  range.insertNode(wrapper);
  placeCaretAtEnd(wrapper);
  return true;
};

/** Converts the current block (paragraph or list item) to a heading, via the toolbar. */
export const applyHeadingToBlock = (block: HTMLElement, level: number): void => {
  const heading = makeHeading(level, '');
  heading.innerHTML = block.innerHTML;
  block.replaceWith(heading);
  placeCaretAtEnd(heading);
};

/** Converts the current block to a bullet/task list item, via the toolbar. */
export const applyListToBlock = (block: HTMLElement, kind: ListKind): void => {
  const markdown = inlineNodeToMarkdown(block);
  const ul = document.createElement('ul');
  ul.className = kind === 'task' ? 'wysiwyg-list wysiwyg-list--task' : 'wysiwyg-list wysiwyg-list--bullet';
  ul.dataset.listType = kind;
  const li = document.createElement('li');
  if (kind === 'task') {
    const label = document.createElement('label');
    label.className = 'wysiwyg-task';
    label.contentEditable = 'false';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.contentEditable = 'false';
    label.appendChild(checkbox);
    const span = document.createElement('span');
    span.className = 'wysiwyg-task-text';
    span.contentEditable = 'true';
    // Add inline content, or a <br> placeholder if empty (matching convertBlock's behavior).
    const fragment = inlineMarkdownToFragment(markdown);
    span.appendChild(fragment.childNodes.length > 0 ? fragment : document.createElement('br'));
    li.append(label, span);
    ul.appendChild(li);
    block.replaceWith(ul);
    placeCaretAtEnd(span);
    return;
  }
  li.appendChild(markdown === '' ? document.createElement('br') : inlineMarkdownToFragment(markdown));
  ul.appendChild(li);
  block.replaceWith(ul);
  placeCaretAtEnd(li);
};

/** Finds the nearest ancestor block element (p/h1-6/li) containing `node`, within `root`. */
export const closestBlock = (root: HTMLElement, node: Node | null): HTMLElement | null => {
  let el: Node | null = node;
  while (el && el !== root) {
    if (el.nodeType === Node.ELEMENT_NODE) {
      const tag = (el as HTMLElement).tagName.toLowerCase();
      // Chromium's contenteditable creates a plain <div> (not <p>) for a new block on Enter in
      // some contexts (e.g. splitting out of a heading); treated identically to <p> here.
      if (tag === 'p' || tag === 'div' || /^h[1-6]$/.test(tag) || tag === 'li') return el as HTMLElement;
    }
    el = el.parentNode;
  }
  return null;
};

// Chromium's contenteditable inserts U+00A0 (non-breaking space) instead of a plain space for a
// single trailing/isolated space keystroke, so trigger text is normalized before matching.
const normalizeSpaces = (text: string): string => text.replace(/ /g, ' ');

export const matchBlockTrigger = (
  rawText: string
): { kind: 'heading'; level: number } | { kind: 'bullet' } | { kind: 'task'; checked: boolean } | { kind: 'hr' } | null => {
  const text = normalizeSpaces(rawText);
  const headingMatch = text.match(/^(#{1,6}) $/);
  if (headingMatch && headingMatch[0] === text) return { kind: 'heading', level: headingMatch[1].length };
  const taskMatch = text.match(/^[-*] \[( |x|X)\] $/);
  if (taskMatch && taskMatch[0] === text) return { kind: 'task', checked: taskMatch[1].toLowerCase() === 'x' };
  const bulletMatch = text.match(/^[-*] $/);
  if (bulletMatch && bulletMatch[0] === text) return { kind: 'bullet' };
  const hrMatch = text.match(/^-{3}$/);
  if (hrMatch && hrMatch[0] === text) return { kind: 'hr' };
  return null;
};

/**
 * Detects if the text at the start of a list item (without the initial "- " prefix) is a task
 * marker "[ ] " or "[x] ". Used to upgrade a bullet item to a task item when the user types the
 * marker after the bullet has already been created.
 */
export const matchTaskMarkerInBulletItem = (
  rawText: string
): { checked: boolean } | null => {
  const text = normalizeSpaces(rawText);
  const taskMatch = text.match(/^\[( |x|X)\] /);
  if (taskMatch && taskMatch[0] === text) {
    return { checked: taskMatch[1].toLowerCase() === 'x' };
  }
  return null;
};

/**
 * Upgrades a bullet list item `<li>` (in a non-task `<ul>`) to a task item by:
 * 1. Extracting and consuming the "[ ] " or "[x] " marker from the start of the item's text
 * 2. Reconstructing the `<li>` with a checkbox and the remaining text
 * 3. Splitting its `<ul>` to preserve the list structure (no mixed bullet/task items)
 * 4. Placing the caret in the task-text span
 */
export const upgradeBulletItemToTask = (
  li: HTMLLIElement,
  checked: boolean
): HTMLElement => {
  // Extract text and remove the "[ ] " or "[x] " marker to get the remaining text
  const currentText = normalizeSpaces(inlineNodeToMarkdown(li));
  const remainingText = currentText.replace(/^\[( |x|X)\] /, '');

  // Create the new task item structure directly to avoid modifying the old item before conversion
  const newLabel = document.createElement('label');
  newLabel.className = 'wysiwyg-task';
  newLabel.contentEditable = 'false';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = checked;
  checkbox.contentEditable = 'false';

  newLabel.appendChild(checkbox);

  const span = document.createElement('span');
  span.className = 'wysiwyg-task-text';
  span.contentEditable = 'true';
  span.appendChild(remainingText === '' ? document.createElement('br') : inlineMarkdownToFragment(remainingText));

  const newLi = document.createElement('li');
  newLi.append(newLabel, span);

  // Replace the bullet item with the task item, then handle list-structure changes
  const ul = li.parentElement as HTMLUListElement | null;
  if (!ul || !ul.parentElement) {
    // Fallback: just replace if list structure is missing
    li.replaceWith(newLi);
    placeCaretAtEnd(span);
    return span;
  }

  const originalKind: ListKind = ul.dataset.listType === 'task' ? 'task' : 'bullet';
  const parent = ul.parentElement;
  const items = Array.from(ul.children) as HTMLLIElement[];
  const idx = items.indexOf(li);
  const before = items.slice(0, idx);
  const after = items.slice(idx + 1);

  // Split the list: keep bullet items before and after, create a new task list for the converted item
  if (before.length) parent.insertBefore(makeListWrapper(originalKind, before), ul);
  parent.insertBefore(makeListWrapper('task', [newLi]), ul);
  if (after.length) parent.insertBefore(makeListWrapper(originalKind, after), ul);
  parent.removeChild(ul);

  placeCaretAtEnd(span);
  return span;
};

/**
 * Ensures a task-list `<li>` has its checkbox `<label>` as its first child, inserting a fresh
 * unchecked one if missing. Needed because the task item's checkbox+label and text span are
 * *siblings* of each other under `<li>` (not label-wraps-text), which is what stops a click on the
 * text from also toggling the checkbox (D-004) -- but it means when Chromium's native Enter splits
 * a task `<li>` into a new sibling `<li>` (which it does correctly on its own: nothing here blocks
 * native list-splitting since the label no longer wraps the whole item), only the text span that
 * was after the caret carries over into the new `<li>`; the label+checkbox, which lived before the
 * caret in the original item, are left behind and must be re-attached to the new item. Called from
 * editDetailsModeToggle.ts's 'input' handler after every keystroke/Enter inside a task list item
 * -- a no-op once the `<li>` already has its label, so it never disturbs an already-correct item
 * or the caret Chromium already placed.
 */
export const ensureTaskItemCheckbox = (li: HTMLLIElement, checked: boolean): void => {
  if (li.querySelector(':scope > label.wysiwyg-task')) return;
  const label = document.createElement('label');
  label.className = 'wysiwyg-task';
  label.contentEditable = 'false';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = checked;
  checkbox.contentEditable = 'false';
  label.appendChild(checkbox);
  li.insertBefore(label, li.firstChild);
};

/** Bold must be checked before italic: `**x**` also contains a valid-looking trailing `*x*`. */
export const matchInlineTrigger = (
  textBeforeCaret: string
): { tag: 'strong' | 'em'; start: number; end: number } | null => {
  const bold = /\*\*([^*\s][^*]*?)\*\*$/.exec(textBeforeCaret);
  if (bold) return { tag: 'strong', start: bold.index, end: bold.index + bold[0].length };
  const italic = /(?<!\*)\*([^*\s][^*]*?)\*$/.exec(textBeforeCaret);
  if (italic) return { tag: 'em', start: italic.index, end: italic.index + italic[0].length };
  return null;
};
