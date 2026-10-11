/**
 * TipTap-backed WYSIWYG engine for the Edit Task Details field, replacing the former
 * contenteditable + hand-rolled DOM engine (markdownRich.ts, deleted by this migration).
 *
 * Bundled standalone via esbuild (see package.json's `build` script), exactly mirroring
 * markdownEditor.ts's CodeMirror bundling: this file (and everything it imports) is the only
 * place in the renderer allowed to `import` bare `@tiptap/*`/`tiptap-markdown`/`prosemirror-*`
 * package specifiers. editDetailsModeToggle.ts only ever imports the compiled/bundled
 * `./richEditor.js`, never a `@tiptap/*` package directly, so tsc's plain (non-bundled) output
 * for every other renderer file never needs those bare specifiers to resolve at runtime.
 *
 * Markdown remains the single persisted document format (spec invariant): TipTap's ProseMirror
 * document is UI/editor state only, converted to/from Markdown exactly at the mode-switch
 * boundary (setMarkdown/getMarkdown below), never persisted as JSON.
 *
 * Markdown<->document conversion is delegated to `tiptap-markdown` (MIT, OSS, the de facto
 * standard Markdown extension for TipTap -- installed as a dependency of this feature), not a
 * hand-adapted port of the old DOM-based markdownRich.ts converter. That was the default plan
 * (see the Change Model's recorded decision), but adapting the old converter to independent
 * (non-nested) bold/italic marks turned out to fail the very regression this migration exists to
 * fix: representing `***bold italic***` (and toggling one of the two off mid-range) requires
 * correctly handling CommonMark's delimiter-run / flanking rules for interleaved `**`/`*`
 * emphasis, which the old converter deliberately avoided altogether by using a *different*
 * delimiter character per mark (`**` bold / `_` italic -- see markdownInline.ts's header
 * comment). The task brief's required mapping explicitly calls for single-`*`/triple-`*`
 * Markdown (`*italic*`, `***bold italic***`), which reintroduces exactly the ambiguity that
 * design was built to sidestep. Reimplementing a correct, ambiguity-free CommonMark emphasis
 * scanner from scratch was judged unclean/high-risk for a migration whose whole point is to stop
 * maintaining bespoke rich-text mechanics; `tiptap-markdown` wraps the battle-tested
 * `markdown-it` (parse) and `prosemirror-markdown` (serialize) libraries, which already implement
 * that algorithm correctly, so it is used for 100% of Markdown<->document conversion (headings,
 * bold, italic, inline code incl. multi-backtick, blockquote, fenced code block, bullet list, task
 * list via `markdown-it-task-lists`, horizontal rule).
 */
import { Editor, Extension, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Paragraph } from '@tiptap/extension-paragraph';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Markdown } from 'tiptap-markdown';

// @tiptap/extension-blockquote already demotes Backspace-at-start to a paragraph natively (see
// its `handleBackspace` keyboard shortcut) but, by its own doc comment, only for a *non-first*
// paragraph inside a multi-paragraph blockquote (it explicitly bails -- `index === 0` -- for the
// leading/only paragraph, i.e. exactly the common single-paragraph-blockquote case), and
// @tiptap/extension-heading has no Backspace handling at all (only Mod-Alt-<level> and its own
// input rule -- confirmed by reading both extensions' source). This small extension adds the two
// missing semantic demotions the task brief requires: heading -> paragraph, and a blockquote's
// leading paragraph -> a plain paragraph (lifted out, preserving its text), both consuming no
// literal "#"/">" markers, on Backspace at the very start of the block's text.
const BackspaceBlockDemotion = Extension.create({
  name: 'backspaceBlockDemotion',
  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { selection } = this.editor.state;
        const { $from, empty } = selection;
        if (!empty || $from.parentOffset !== 0) return false;
        if ($from.parent.type.name === 'heading') return this.editor.commands.setParagraph();
        if ($from.parent.type.name === 'paragraph' && $from.depth > 0 && $from.node($from.depth - 1).type.name === 'blockquote') {
          return this.editor.commands.lift('blockquote');
        }
        return false;
      },
    };
  },
});

// Markdown-it's default hardbreak renderer outputs '\n' (a soft line break in HTML), not '<br>'.
// tiptap-markdown wraps the renderer with withoutNewLine, which preserves '\n' but strips trailing
// newlines from other rules, causing hardbreak tokens to be treated as soft line breaks and
// flattened to spaces during Markdown -> WYSIWYG conversion. This extension patches the
// markdown-it hardbreak renderer during MarkdownParser initialization to output '<br>' instead,
// allowing the hardBreak extension's parseHTML rule to properly create hardBreak nodes.
const HardBreakRenderer = Extension.create({
  name: 'hardBreakRenderer',
  addStorage() {
    return {
      markdown: {
        parse: {
          setup(md: any) {
            // Override the hardbreak renderer to output '<br>' instead of '\n',
            // so markdown-it-generated hardbreak tokens become <br> elements
            // that the hardBreak extension's parseHTML rule can recognize.
            md.renderer.rules.hardbreak = () => '<br>';
          },
        },
      },
    };
  },
});

// Empty paragraphs between semantic blocks (especially taskItems) must be preserved through
// Markdown round-trips (D-007): they represent real, caret-addressable semantic positions in the
// document, not just CSS spacing. This is a two-sided fix, both required (a serializer-only or
// parser-only change cannot round-trip on its own -- see each half's comment below):
//
// 1. Serialize side (TipTapEmptyParagraphMarkdownSerializer below, this node): prosemirror-
//    markdown's default paragraph serializer (`state.renderInline(node); state.closeBlock(node)`)
//    writes nothing for an empty paragraph -- it just marks a block boundary as "pending", and
//    that pending marker collapses into the same single default blank-line separator every two
//    adjacent blocks already get, indistinguishably from zero empty paragraphs. N consecutive
//    empty paragraphs must instead produce N distinguishable blank lines, one dedicated to each.
// 2. Parse side (TaskListGapParagraphs below): markdown-it's list tokenizer *consumes* blank
//    lines between sibling list items into the preceding item's own line-range without emitting
//    any token for them (confirmed by inspecting markdown-it's token stream directly), so there
//    is nothing for a serializer to reconstruct from on the way back -- see that extension's
//    comment for the token-stream-level fix.
//
// Registered on the real `paragraph` node (via `Paragraph.extend`, matching StarterKit's own node
// name) rather than a separate `Extension.create` bystander, because tiptap-markdown's serializer
// only consults per-node-type extension storage keyed by `extension.name` for `type === 'node'`
// extensions (see tiptap-markdown's `MarkdownSerializer.nodes`); a same-named plain `Extension`'s
// `storage.markdown.serialize` is never read for node output at all.
const EmptyParagraphMarkdownParagraph = Paragraph.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          if (node.content.size > 0) {
            state.renderInline(node);
            state.closeBlock(node);
            return;
          }
          // Every empty paragraph after the first one in a consecutive run needs its own
          // explicitly-flushed blank line: the *first* empty paragraph in a run is already
          // indistinguishable from the single blank-line separator every pair of adjacent blocks
          // gets by default (so it needs no extra output -- the default separator already
          // accounts for it), but each additional one would otherwise collapse into that same
          // single default separator, losing its distinct position. Flushing now, one paragraph
          // at a time, gives each such position its own dedicated blank line.
          const previousWasEmptyParagraph =
            state.closed && state.closed.type?.name === 'paragraph' && state.closed.content.size === 0;
          if (previousWasEmptyParagraph) {
            state.flushClose(2);
          }
          state.closeBlock(node);
        },
      },
    };
  },
});

// tiptap-markdown's built-in `MarkdownTightLists` extension (which sets a `tight` attribute,
// driving whether prosemirror-markdown's list serializer puts a blank line between items) only
// covers `bulletList`/`orderedList`, not `taskList` -- so `taskList` nodes fall back to
// prosemirror-markdown's serializer-state default of `tightLists: false` and would otherwise
// always render one blank line between every pair of task items, on every round-trip, regardless
// of whether the original Markdown had one (a D-007 regression: the no-gap case, #4, requires
// adjacent task items to stay adjacent with nothing artificially introduced between them).
// TaskListGapParagraphs above guarantees any *real* gap between task items is represented as a
// document-level split into two sibling `taskList` nodes with real paragraph(s) in between, never
// as spacing internal to one `taskList` node -- so a single `taskList` node always represents a
// run of items with no gap between them, and can simply always be forced to serialize tight.
const TightTaskList = TaskList.extend({
  addAttributes() {
    return { tight: { default: true, rendered: false } };
  },
});

// markdown-it's list tokenizer swallows blank lines between sibling list items (and between a
// list and an adjacent block) into surrounding line-range bookkeeping without emitting any token
// for them at all (verified directly against markdown-it's token stream: parsing
// "- [ ] a\n\n\n- [ ] b" produces exactly two list_item tokens with no intervening
// paragraph/blank-line token whatsoever -- the two blank lines are absorbed into the first
// list_item's own `.map` range). A serializer alone cannot fix D-007: there is nothing on the
// parse side to serialize from, since the empty paragraphs never get created when Markdown is
// parsed back into the TipTap document (this is why a prior serializer-only attempt at this
// defect could not converge).
//
// This markdown-it core rule runs once after `block` tokenization (before `inline`, so still
// operating on the raw per-line source, matching the `block` rule's own line-range bookkeeping)
// and, for each blank-line gap immediately touching a task-list item -- between two sibling task
// items in the same list, or between a task list and an adjacent top-level paragraph -- inserts
// one synthetic, real, empty `paragraph_open`/`inline`/`paragraph_close` token triple per blank
// line. TaskList/TaskItem's content model is `taskItem+` (no paragraph child allowed), so a gap
// between two sibling task items additionally splits the single list into two sibling `taskList`
// nodes with the synthetic paragraph(s) placed between them at the top level, mirroring exactly
// what a human editing in WYSIWYG mode produced in the first place (a real top-level empty
// paragraph separating two todo items). Adjacent items with no blank line between them (the tight
// case) are untouched, so they stay adjacent with no artificial paragraph introduced.
const TaskListGapParagraphs = Extension.create({
  name: 'taskListGapParagraphs',
  addStorage() {
    return {
      markdown: {
        parse: {
          setup(md: any) {
            // `parse.setup` re-runs on every Markdown -> WYSIWYG conversion against the same
            // long-lived markdown-it instance (constructed once per editor); guard against
            // registering the core rule more than once, since markdown-it's Ruler has no
            // built-in de-duplication by name and would otherwise run the rule N times after N
            // mode switches.
            if (md.__taskListGapParagraphsInstalled) return;
            md.__taskListGapParagraphsInstalled = true;

            md.core.ruler.after('block', 'taskListGapParagraphs', (state: any) => {
              const srcLines: string[] = state.src.split('\n');
              const taskLinePattern = /^\s*[-+*]\s+\[[ xX]\]\s+/;
              const isTaskLine = (line: number | null | undefined): boolean =>
                typeof line === 'number' && typeof srcLines[line] === 'string' && taskLinePattern.test(srcLines[line]);

              const makeEmptyParagraph = (level: number): any[] => {
                const open = new state.Token('paragraph_open', 'p', 1);
                open.level = level;
                const inline = new state.Token('inline', '', 0);
                inline.level = level + 1;
                inline.content = '';
                inline.children = [];
                const close = new state.Token('paragraph_close', 'p', -1);
                close.level = level;
                return [open, inline, close];
              };

              const tokens = state.tokens;
              const out: any[] = [];
              const lastMapEndBefore = (limit: number): number | null => {
                for (let k = limit; k >= 0; k--) {
                  if (out[k].map) return out[k].map[1];
                }
                return null;
              };

              for (let i = 0; i < tokens.length; i++) {
                const tok = tokens[i];
                out.push(tok);
                const next = tokens[i + 1];
                if (!next) continue;

                // Case A: two sibling task-list items in the same list, separated by a blank-line
                // gap. Requires splitting the enclosing list (see header comment).
                if (tok.type === 'list_item_close' && next.type === 'list_item_open' && tok.level === next.level) {
                  let openIdx = -1;
                  let depth = 0;
                  for (let k = i; k >= 0; k--) {
                    if (tokens[k].level !== tok.level) continue;
                    if (tokens[k].type === 'list_item_close') depth++;
                    else if (tokens[k].type === 'list_item_open') {
                      depth--;
                      if (depth === 0) {
                        openIdx = k;
                        break;
                      }
                    }
                  }
                  if (openIdx === -1) continue;
                  if (!isTaskLine(tokens[openIdx].map?.[0]) || !isTaskLine(next.map?.[0])) continue;

                  // Deliberately excludes tokens[openIdx] itself: a `list_item_open`'s own
                  // `.map` already absorbs any trailing blank-line gap into its own range (that
                  // is precisely the swallowing behavior this rule works around), so including it
                  // here would make the gap invisible again. Only the item's *inner content*
                  // tokens (its paragraph, etc.) reflect where the real text actually ends.
                  let contentEnd = tokens[openIdx].map ? tokens[openIdx].map[0] + 1 : 0;
                  for (let k = openIdx + 1; k <= i; k++) {
                    if (tokens[k].map) contentEnd = Math.max(contentEnd, tokens[k].map[1]);
                  }
                  const gapEnd = next.map ? next.map[0] : contentEnd;
                  const blankLines = Math.max(0, gapEnd - contentEnd);
                  if (blankLines <= 0) continue;

                  let listOpenIdx = -1;
                  for (let k = out.length - 1; k >= 0; k--) {
                    if (out[k].level === tok.level - 1 && (out[k].type === 'bullet_list_open' || out[k].type === 'ordered_list_open')) {
                      listOpenIdx = k;
                      break;
                    }
                  }
                  if (listOpenIdx === -1) continue;
                  const listOpenTok = out[listOpenIdx];

                  const listClose = new state.Token(listOpenTok.type.replace('_open', '_close'), listOpenTok.tag, -1);
                  listClose.level = listOpenTok.level;
                  out.push(listClose);

                  for (let b = 0; b < blankLines; b++) out.push(...makeEmptyParagraph(listOpenTok.level));

                  const listReopen = new state.Token(listOpenTok.type, listOpenTok.tag, 1);
                  listReopen.level = listOpenTok.level;
                  listReopen.attrs = listOpenTok.attrs ? listOpenTok.attrs.map((a: string[]) => a.slice()) : null;
                  listReopen.map = [gapEnd, listOpenTok.map ? listOpenTok.map[1] : gapEnd];
                  out.push(listReopen);
                  continue;
                }

                // Case B: a top-level task list directly adjacent to a plain paragraph (in either
                // order), separated by a blank-line gap. Both sides are already top-level
                // siblings, so no split is needed -- just insert the synthetic paragraph(s).
                if (
                  tok.level === 0 &&
                  next.level === 0 &&
                  ((tok.type === 'paragraph_close' && next.type === 'bullet_list_open') ||
                    (tok.type === 'bullet_list_close' && next.type === 'paragraph_open'))
                ) {
                  const listOpenTok = next.type === 'bullet_list_open' ? next : out.slice().reverse().find((t) => t.type === 'bullet_list_open' && t.level === 0);
                  if (!listOpenTok || !isTaskLine(listOpenTok.map?.[0])) continue;

                  const gapStart = lastMapEndBefore(out.length - 1);
                  const gapEnd = next.map ? next.map[0] : null;
                  if (gapStart === null || gapEnd === null) continue;
                  const blankLines = Math.max(0, gapEnd - gapStart);
                  if (blankLines <= 0) continue;

                  for (let b = 0; b < blankLines; b++) out.push(...makeEmptyParagraph(0));
                }
              }

              state.tokens = out;
            });
          },
        },
      },
    };
  },
});

// CommonMark distinguishes a plain soft line break (one source newline inside a paragraph, e.g.
// two quoted lines with no blank line between them -- `> some text\n> other text`) from a hard
// break (trailing double-space or backslash before the newline, handled by HardBreakRenderer
// above). markdown-it always tokenizes a lone internal newline as a 'softbreak' token and its
// default renderer emits a literal '\n' character straight into the rendered HTML text; when that
// HTML is parsed into DOM/ProseMirror, ordinary HTML whitespace rules collapse a bare '\n' to a
// space (same class of loss HardBreakRenderer's comment documents for hardbreak), so the line
// break is silently dropped and `> some text\n> other text` flattens to one joined line on
// Markdown -> WYSIWYG -> Markdown round-trip. This extension gives a plain soft break its own
// real, addressable ProseMirror node -- deliberately a *different* node type from `hardBreak` (not
// reusing/conflating with the double-space/backslash mechanism) -- rendered as its own tagged
// `<br>` so it round-trips through HTML parsing intact, and serialized back to a single '\n' (no
// backslash, no trailing spaces), preserving the original quoted-line structure exactly.
const SoftBreak = Node.create({
  name: 'softBreak',
  inline: true,
  group: 'inline',
  selectable: false,
  parseHTML() {
    // Higher priority than hardBreak's generic `br` parseDOM rule so a tagged soft-break `<br>`
    // is never misparsed as a hardBreak node.
    return [{ tag: 'br[data-soft-break]', priority: 60 }];
  },
  renderHTML() {
    return ['br', { 'data-soft-break': '' }];
  },
  renderText() {
    return '\n';
  },
  addStorage() {
    return {
      markdown: {
        parse: {
          setup(md: any) {
            md.renderer.rules.softbreak = () => '<br data-soft-break>';
          },
        },
        serialize(state: any) {
          state.write('\n');
        },
      },
    };
  },
});

export type RichEditorHandle = Readonly<{
  getMarkdown: () => string;
  setMarkdown: (markdown: string) => void;
  focus: () => void;
  destroy: () => void;
  // Toolbar-driven formatting commands; shape matches markdownEditor.ts's CodeMirror commands so
  // editDetailsModeToggle.ts can bind both to the same EditorToolbarCommands surface uniformly.
  toggleBold: () => void;
  toggleItalic: () => void;
  toggleInlineCode: () => void;
  toggleHeading: (level: 1 | 2) => void;
  toggleBlockquote: () => void;
  toggleCodeBlock: () => void;
  toggleBulletList: () => void;
  toggleTodoList: () => void;
  isBoldActive: () => boolean;
  isItalicActive: () => boolean;
  isInlineCodeActive: () => boolean;
  isBlockquoteActive: () => boolean;
  isCodeBlockActive: () => boolean;
  /** Inserts `label` as a link to `href` at the current selection/caret (one undo step). */
  insertAttachmentLink: (label: string, href: string) => void;
}>;

export type RichEditorOptions = Readonly<{
  /** Fired on every selection/document transaction, so the shared toolbar can refresh its
   *  isXActive-driven highlighting live (semantic `editor.isActive(...)` state), not just on click. */
  onUpdate?: () => void;
  /**
   * Fired when the user clicks a rendered `attachment:<id>` link (the Link mark's `href` is
   * parsed straight out of `attachment:<id>` -- see insertAttachmentLink below). Link's own
   * `openOnClick: false` leaves every link otherwise inert, so this is the only way such a link
   * is ever actionable in WYSIWYG mode.
   */
  onOpenAttachment?: (attachmentId: string) => void;
}>;

/**
 * Mounts one TipTap `Editor` into `element` (expected empty going in -- TipTap owns its DOM from
 * here on, matching how markdownEditor.ts owns `markdownHost`'s DOM once created) and returns a
 * handle. One `Editor` instance is created per call and reused for the life of the host element,
 * never recreated per keystroke or per mode switch (`setMarkdown` mutates its existing document).
 */
export const createRichEditor = (element: HTMLElement, options: RichEditorOptions = {}): RichEditorHandle => {
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({
        // Only H1/H2 are exposed by the shared toolbar (markdownToolbar.ts); StarterKit defaults
        // to h1-h6, narrowed here so typing "### " (a level the toolbar/spec don't expose) is left
        // as literal text rather than silently producing a heading level nothing else supports.
        heading: { levels: [1, 2] },
        // Reuse the old engine's exact class-based visual treatment (styles.css) by attaching the
        // same class names to TipTap's rendered node DOM, rather than redesigning or relying on
        // TipTap's own (unstyled) demo look.
        blockquote: { HTMLAttributes: { class: 'wysiwyg-blockquote' } },
        codeBlock: { HTMLAttributes: { class: 'wysiwyg-code-block' } },
        bulletList: { HTMLAttributes: { class: 'wysiwyg-list wysiwyg-list--bullet' } },
        // StarterKit v3 bundles Link by default (no separate `@tiptap/extension-link` dependency
        // needed). Not exposed by the toolbar (no new link feature is being added -- see the task
        // brief's non-goals) but left enabled so pre-existing `[text](url)` Markdown already
        // present in a task's `details` parses into a real (inert) mark instead of an unrecognized
        // token, which is what keeps such content lossless through a Markdown -> WYSIWYG ->
        // Markdown round-trip (the data-loss rule) instead of risking the parser dropping/
        // mis-consuming it.
        // `protocols: ['attachment']` extends the extension's default scheme allowlist (http(s),
        // mailto, etc. -- see @tiptap/extension-link's isAllowedUri) to include attachment:<id>
        // hrefs; without it, isAllowedUri rejects the scheme and renderHTML blanks the rendered
        // <a>'s href to "" on every render, leaving every attachment reference unclickable (its
        // mark attrs/Markdown serialization are unaffected either way -- only the rendered DOM).
        link: { openOnClick: false, autolink: false, protocols: ['attachment'] },
        // Disabled here so the explicit `EmptyParagraphMarkdownParagraph` below (same node name,
        // `@tiptap/extension-paragraph` directly) is the one actually registered -- needed to
        // attach the D-007 empty-paragraph markdown storage (see its comment).
        paragraph: false,
      }),
      EmptyParagraphMarkdownParagraph,
      TightTaskList.configure({ HTMLAttributes: { class: 'wysiwyg-list wysiwyg-list--task' } }),
      // `nested: false` matches the old engine's flat task-list model (one level, no sub-items --
      // never exposed by the toolbar or the Markdown mapping spec).
      TaskItem.configure({ nested: false, HTMLAttributes: { class: 'wysiwyg-task-item' } }),
      BackspaceBlockDemotion,
      SoftBreak,
      Markdown.configure({
        html: false,
        linkify: false,
        breaks: false,
        transformPastedText: false,
        transformCopiedText: false,
      }),
      HardBreakRenderer,
      TaskListGapParagraphs,
    ],
    content: '',
    autofocus: false,
    onSelectionUpdate: () => options.onUpdate?.(),
    onTransaction: () => options.onUpdate?.(),
  });

  // Link's `openOnClick: false` above leaves every rendered <a> inert by default (see that
  // option's comment); this re-enables exactly one specific case, a click on an attachment
  // reference, by reading the id straight back out of its href rather than navigating anywhere.
  element.addEventListener('click', (event) => {
    const anchor = (event.target as HTMLElement | null)?.closest?.('a[href^="attachment:"]');
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute('href') ?? '';
    const attachmentId = href.slice('attachment:'.length);
    if (attachmentId) options.onOpenAttachment?.(attachmentId);
  });

  // tiptap-markdown's `setContent` override already parses a plain Markdown string into the
  // document (see its `addCommands`), so no separate JSON conversion step is needed here.
  const setMarkdown = (markdown: string): void => {
    editor.commands.setContent(markdown, { emitUpdate: false });
  };

  // `editor.storage.markdown` is populated at runtime by the `Markdown` extension above
  // (tiptap-markdown's `onBeforeCreate`); `Storage` is deliberately an empty interface upstream
  // (meant for per-consumer module augmentation tiptap-markdown's own .d.ts doesn't provide), so
  // it's read through an explicit local type here instead.
  const getMarkdown = (): string => (editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();

  return {
    getMarkdown,
    setMarkdown,
    focus: () => editor.chain().focus().run(),
    destroy: () => editor.destroy(),
    toggleBold: () => editor.chain().focus().toggleBold().run(),
    toggleItalic: () => editor.chain().focus().toggleItalic().run(),
    toggleInlineCode: () => editor.chain().focus().toggleCode().run(),
    toggleHeading: (level: 1 | 2) => editor.chain().focus().toggleHeading({ level }).run(),
    toggleBlockquote: () => editor.chain().focus().toggleBlockquote().run(),
    toggleCodeBlock: () => editor.chain().focus().toggleCodeBlock().run(),
    toggleBulletList: () => editor.chain().focus().toggleBulletList().run(),
    toggleTodoList: () => editor.chain().focus().toggleTaskList().run(),
    isBoldActive: () => editor.isActive('bold'),
    isItalicActive: () => editor.isActive('italic'),
    isInlineCodeActive: () => editor.isActive('code'),
    isBlockquoteActive: () => editor.isActive('blockquote'),
    isCodeBlockActive: () => editor.isActive('codeBlock'),
    insertAttachmentLink: (label: string, href: string) =>
      editor
        .chain()
        .focus()
        .insertContent({ type: 'text', text: label, marks: [{ type: 'link', attrs: { href } }] })
        .run(),
  };
};
