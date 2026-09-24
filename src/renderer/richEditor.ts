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
}>;

export type RichEditorOptions = Readonly<{
  /** Fired on every selection/document transaction, so the shared toolbar can refresh its
   *  isXActive-driven highlighting live (semantic `editor.isActive(...)` state), not just on click. */
  onUpdate?: () => void;
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
        link: { openOnClick: false, autolink: false },
      }),
      TaskList.configure({ HTMLAttributes: { class: 'wysiwyg-list wysiwyg-list--task' } }),
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
    ],
    content: '',
    autofocus: false,
    onSelectionUpdate: () => options.onUpdate?.(),
    onTransaction: () => options.onUpdate?.(),
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
  };
};
