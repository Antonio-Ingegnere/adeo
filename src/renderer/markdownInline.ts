/**
 * Shared, DOM-free, nesting-aware inline Markdown emphasis parser.
 *
 * Bold and italic are modelled as two independent boolean marks (not a strict nesting grammar),
 * so a run of text can be bold-only, italic-only, both, or neither, and the marks can be toggled
 * on/off anywhere -- including turning just one of the two off in the middle of a bold+italic
 * range. To represent that on the wire as plain, readable Markdown without ambiguity, bold and
 * italic use two different delimiter characters: `**` for bold, `_` for italic. (A lone `*` is
 * also accepted as italic when parsing, for backward compatibility with existing task data and
 * hand-typed Markdown written before this module existed -- but this module never *emits* a lone
 * `*` for italic, only `_`, which is what avoids the ambiguity.)
 *
 * Why two characters matter: representing an overlap sometimes requires closing an *outer* mark
 * while an *inner* one stays open (e.g. bold+italic -> italic only, where bold was opened before
 * italic). That requires closing both and reopening the inner one, three delimiter tokens back to
 * back. If bold and italic shared a delimiter character, e.g. all using `*`, those three tokens
 * would collide into one indistinguishable run (`*****`), which no parser -- regex or otherwise --
 * can losslessly split back apart. Using an unrelated character for each mark keeps every such
 * boundary unambiguous regardless of how many times marks are toggled or in what order.
 *
 * Parsing strategy: a small explicit-stack recursive-descent-style scan (not a giant regex or a
 * general CommonMark implementation -- this app's Markdown subset has exactly two toggleable
 * inline marks plus non-nesting inline code). Encountering an opening delimiter for a mark with no
 * currently-open frame of that type pushes a new frame; encountering that mark's delimiter again
 * closes the *nearest* open frame of that type, force-closing (and re-opening, as separate
 * sibling/parent nodes) any other frames that happen to be nested inside it -- exactly mirroring
 * how the serializer in markdownRich.ts emits transitions, so the two are always inverses of each
 * other. An opening delimiter that's never closed degrades to literal text (its children, if any
 * closed validly inside it, are unwrapped rather than dropped).
 */

export type InlineNode =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; children: InlineNode[] }
  | { kind: 'em'; children: InlineNode[] };

type MarkType = 'strong' | 'em';

type Frame = {
  type: MarkType | 'root';
  children: InlineNode[];
};

const pushText = (frame: Frame, text: string): void => {
  if (text === '') return;
  const last = frame.children[frame.children.length - 1];
  if (last && last.kind === 'text') {
    last.text += text;
  } else {
    frame.children.push({ kind: 'text', text });
  }
};

/** Finalizes `frame` into the InlineNode it represents (only called for strong/em frames). */
const closeFrame = (frame: Frame): InlineNode => {
  if (frame.type === 'strong') return { kind: 'strong', children: frame.children };
  if (frame.type === 'em') return { kind: 'em', children: frame.children };
  throw new Error('closeFrame called on root frame');
};

/** Parses the scoped Markdown inline subset (bold `**`, italic `_`/legacy `*`, inline code
 *  `` ` ``) into a tree of InlineNode, correctly handling overlapping/interleaved bold+italic. */
export const parseInlineMarkdown = (text: string): InlineNode[] => {
  const root: Frame = { type: 'root', children: [] };
  const stack: Frame[] = [root];
  let i = 0;
  const n = text.length;

  const topFrame = (): Frame => stack[stack.length - 1];

  // Closes the delimiter only if it matches the *current top* of the stack -- standard properly-
  // nested bracket matching, exactly like HTML/XML tags. A delimiter is never allowed to reach
  // down and force-close a non-topmost frame: markdownRich.ts's serializeWithStateTransitions
  // never requires that either, since it always closes a contiguous *suffix* of the active-format
  // stack starting from the top before reopening anything, so every closing delimiter it emits
  // always corresponds to whatever is topmost at that point. (An earlier version of this parser
  // searched the whole stack for a same-type frame and force-closed everything above it, which
  // misparsed inputs like `**_both_` -- the `_` right after an unrelated `**` was wrongly read as
  // closing an outer, already-far-away `_` instead of opening a fresh nested one, because *some*
  // em frame happened to still be open lower in the stack.)
  const closeNearest = (type: MarkType): boolean => {
    if (topFrame().type !== type) return false;
    const frame = stack.pop() as Frame;
    const node = closeFrame(frame);
    topFrame().children.push(node);
    return true;
  };

  while (i < n) {
    const ch = text[i];

    if (ch === '`') {
      // Count opening backticks
      let backtickCount = 0;
      let j = i;
      while (j < n && text[j] === '`') {
        backtickCount += 1;
        j += 1;
      }

      // Look for closing backticks of the same count
      let searchPos = j;
      let found = false;
      while (searchPos < n) {
        if (text[searchPos] === '`') {
          let closeCount = 0;
          let closePos = searchPos;
          while (closePos < n && text[closePos] === '`') {
            closeCount += 1;
            closePos += 1;
          }
          if (closeCount === backtickCount) {
            // Found matching closing backticks
            const codeText = text.slice(j, searchPos);
            topFrame().children.push({ kind: 'code', text: codeText });
            i = closePos;
            found = true;
            break;
          }
          searchPos = closePos;
        } else {
          searchPos += 1;
        }
      }

      if (!found) {
        // No matching closing backticks found: treat opening backtick as literal text
        pushText(topFrame(), ch);
        i += 1;
      }
      continue;
    }

    if (ch === '*' && text[i + 1] === '*') {
      if (!closeNearest('strong')) stack.push({ type: 'strong', children: [] });
      i += 2;
      continue;
    }

    if (ch === '*' || ch === '_') {
      if (!closeNearest('em')) stack.push({ type: 'em', children: [] });
      i += 1;
      continue;
    }

    pushText(topFrame(), ch);
    i += 1;
  }

  // Any frames still open at end-of-string never found a matching close: degrade to literal text,
  // unwrapping (not dropping) whatever validly-closed content they contain.
  while (stack.length > 1) {
    const frame = stack.pop() as Frame;
    const marker = frame.type === 'strong' ? '**' : '_';
    const parent = topFrame();
    pushText(parent, marker);
    parent.children.push(...frame.children);
  }

  return root.children;
};
