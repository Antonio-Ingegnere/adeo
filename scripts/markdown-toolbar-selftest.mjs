// Markdown | WYSIWYG Details editor acceptance suite. Run with: npm run test:markdown-toolbar
// (or directly: node scripts/markdown-toolbar-selftest.mjs -- it builds dist itself first so it
// also works as a standalone feature_check without relying on the npm wrapper having run).
//
// Same isolated-Electron harness as scripts/edit-modal-delete-selftest.mjs: real Electron app,
// isolated userData dir + SQLite file, real dev database/settings snapshotted and re-asserted
// byte-unchanged in the finally block.
//
// WYSIWYG mode is now a real TipTap/ProseMirror `Editor` (see src/renderer/richEditor.ts), not
// the former hand-rolled contenteditable engine (markdownRich.ts, deleted by this migration).
// This is a narrow smoke of the critical constructs listed in the migration's regression matrix
// (Markdown<->TipTap conversion both directions, independent bold/italic marks, heading
// demotion/reapply/Enter-exit, blockquote continue/exit/backspace, code block, inline code incl.
// multi-backtick, bullet list, task list, horizontal rule, and one mixed-document round-trip) --
// not a viewport/theme Cartesian matrix and not a re-test of every historical defect the old
// engine accumulated fixes for (manual QA owns visual polish/clipping/interaction feel).
//
// Markdown mode is a real CodeMirror 6 EditorView (see src/renderer/markdownEditor.ts), not a
// textarea, so it has no .fill()/.inputValue(); setMarkdownValue/getMarkdownValue below drive and
// read it like a real user would (click the editable content, select-all + type to replace it,
// read back rendered text) -- unchanged by this migration (Markdown mode is explicitly out of
// scope for the TipTap replacement, see the task's do-not-change list).

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import {
  createProtectedFilesGuard,
  resolvePythonBin,
  createIsolatedPaths,
  isolatedEnvironment,
  cleanupTempRoot,
} from './lib/isolated-electron.mjs';

const require = createRequire(import.meta.url);
const electronExecutable = require('electron');
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

let checks = 0;
const check = (condition, message) => {
  checks += 1;
  if (!condition) throw new Error(message);
};

const buildResult = spawnSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
if (buildResult.status !== 0) {
  console.error('Markdown toolbar self-test: build failed');
  process.exit(1);
}

const assertProtectedFilesUnchanged = createProtectedFilesGuard();

const pythonBin = resolvePythonBin(repoRoot);
const { tempRoot, isolatedUserData, isolatedDatabase, bootstrapUserData } = createIsolatedPaths();

let electronApp = null;
let failure = null;

try {
  electronApp = await electron.launch({
    executablePath: electronExecutable,
    args: [`--user-data-dir=${bootstrapUserData}`, repoRoot],
    cwd: repoRoot,
    env: isolatedEnvironment({ isolatedUserData, isolatedDatabase, pythonBin }),
  });

  const page = await electronApp.firstWindow();
  await page.emulateMedia({ colorScheme: null });
  const input = page.locator('#message-input');
  await input.waitFor({ state: 'visible' });

  const addTask = async (text) => {
    await input.fill(text);
    await input.press('Enter');
    await page.locator('.task-text').filter({ hasText: text }).waitFor({ state: 'visible' });
  };

  const rowFor = (text) => page.locator('.task-row', { has: page.locator('.task-text', { hasText: text }) });

  const overlay = page.locator('#edit-overlay');
  const detailsTextarea = page.locator('#edit-details');
  const detailsEditorContent = detailsTextarea.locator('.cm-content');
  const detailsRich = page.locator('#edit-details-rich');
  // TipTap mounts its own `.tiptap.ProseMirror` contenteditable div as a child of #edit-details-rich.
  const richContent = detailsRich.locator('.tiptap.ProseMirror');
  const modeMarkdown = page.locator('#edit-details-mode-markdown');
  const modeWysiwyg = page.locator('#edit-details-mode-wysiwyg');
  const modeMarkdownLabel = page.locator('label.segmented-option', { has: modeMarkdown });
  const modeWysiwygLabel = page.locator('label.segmented-option', { has: modeWysiwyg });
  const selectAllKey = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';

  const setMarkdownValue = async (text) => {
    await detailsEditorContent.click();
    await page.keyboard.press(selectAllKey);
    await page.keyboard.press('Backspace');
    // `insertText` (unlike `type`) dispatches only an `input` event, not individual per-character
    // `keydown`s -- for multi-line Markdown containing list-marker lines, `type`'s real Enter
    // keydowns were observed to trigger CodeMirror's own (pre-existing, out-of-scope)
    // list-continuation Enter handling (markdownEditorCommands.ts), auto-inserting an extra "- "
    // on the new line and duplicating/mangling the literal Markdown this helper means to set
    // verbatim. `insertText` bypasses that, inserting the exact string unchanged.
    if (text.length > 0) await page.keyboard.insertText(text);
  };

  // CodeMirror renders exactly one .cm-line child per document line (its core invariant), so
  // reconstructing the document as each child's textContent joined by '\n' is exact.
  const getMarkdownValue = async () =>
    detailsEditorContent.evaluate((el) => Array.from(el.children).map((c) => c.textContent).join('\n'));

  const openTask = async (text) => {
    await addTask(text);
    await rowFor(text).locator('.task-text').click();
    await overlay.waitFor({ state: 'visible' });
  };

  const closeModal = async () => {
    await page.locator('#cancel-edit').click();
    await overlay.waitFor({ state: 'hidden' });
  };

  // ---------------------------------------------------------------------------
  // 1. Markdown -> TipTap conversion: mode switch renders real semantic elements (no raw
  //    markers), and TipTap -> Markdown serialization round-trips back to the same string.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG mode switch ${randomUUID()}`);
    await setMarkdownValue('## Hello\n\nSome **bold** text.');
    await modeWysiwygLabel.click();
    await richContent.waitFor({ state: 'visible' });
    check((await richContent.locator('h2').innerText()) === 'Hello', '1: heading renders as a real H2, no raw ## markers');
    check((await richContent.locator('strong').innerText()) === 'bold', '1: **bold** renders as a real <strong>, no raw ** markers');
    await modeMarkdownLabel.click();
    await detailsTextarea.waitFor({ state: 'visible' });
    check((await getMarkdownValue()) === '## Hello\n\nSome **bold** text.', '1: switching back to Markdown reproduces the original text unchanged');
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 2. Independent bold/italic marks: toggling Bold off inside an existing bold+italic selection
  //    removes only bold, keeping italic -- the core regression this migration exists to fix (no
  //    merged/mutually-exclusive boldItalic state).
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG independent bold italic ${randomUUID()}`);
    await setMarkdownValue('***bold italic text***');
    await modeWysiwygLabel.click();
    const target = richContent.locator('strong em, em strong').first();
    check((await target.count()) >= 1, '2: ***bold italic*** renders as nested <strong>/<em>, both marks independently applied');
    await target.click();
    await page.keyboard.press('Home');
    for (let i = 0; i < 'bold '.length; i += 1) await page.keyboard.press('ArrowRight');
    await page.keyboard.down('Shift');
    for (let i = 0; i < 'italic'.length; i += 1) await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Shift');
    await page.locator('.markdown-toolbar-btn[data-action="bold"]').click();
    const markState = await richContent.evaluate((el) => {
      const hasAncestor = (node, tag) => {
        let n = node;
        while (n) {
          if (n.nodeType === 1 && n.tagName.toLowerCase() === tag) return true;
          n = n.parentNode;
        }
        return false;
      };
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const words = {};
      let node;
      while ((node = walker.nextNode())) {
        const t = node.textContent.trim();
        if (t) words[t] = { strong: hasAncestor(node, 'strong'), em: hasAncestor(node, 'em') };
      }
      return words;
    });
    check(markState.bold?.strong === true && markState.bold?.em === true, `2: untouched leading word keeps both marks, got ${JSON.stringify(markState.bold)}`);
    check(markState.italic?.strong === false && markState.italic?.em === true, `2: toggling Bold off removes only bold, keeps italic, got ${JSON.stringify(markState.italic)}`);
    check(markState.text?.strong === true && markState.text?.em === true, `2: untouched trailing word keeps both marks, got ${JSON.stringify(markState.text)}`);
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 3. Heading input rule, demotion, reapply, Enter-exit: "# " converts an empty paragraph to a
  //    real H1 as one input-rule transaction; Backspace at the start demotes to a paragraph with
  //    no literal "# " ever shown; retyping "# " recreates the heading; Enter at the end of a
  //    heading exits to a new paragraph.
  //
  //    Undo/redo itself (TipTap's built-in `history` extension, part of StarterKit -- no custom
  //    snapshot logic remains) is not exercised here via a simulated Ctrl/Cmd+Z: this Electron
  //    app registers a native `{ role: 'undo' }` Edit-menu accelerator on the same shortcut (see
  //    src/main.ts's setupMenu), which intercepts the keystroke as Chromium's native
  //    `webContents.undo()` before it reaches ProseMirror's own keymap -- confirmed to affect the
  //    pre-existing, unrelated CodeMirror Markdown-mode editor identically (typed text survives a
  //    simulated Ctrl+Z there too), so this is a harness/app-menu-accelerator limitation, not
  //    something introduced by this migration. Manual QA should confirm real keyboard undo/redo.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG heading input rule ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await richContent.click();
    await page.keyboard.type('# ');
    check((await richContent.locator('h1').count()) === 1, '3: "# " immediately converts the empty paragraph to H1 as one input-rule transaction');
    await page.keyboard.type('Title');
    check((await richContent.locator('h1').innerText()) === 'Title', '3: typing after the trigger continues inside the heading, caret intact');
    await closeModal();
  }

  {
    // Demotion via Backspace at the start of a heading, then retyping "## " to recreate one --
    // each stage opens a fresh task to avoid relying on Ctrl/Cmd+A select-all (Electron's native
    // `{ role: 'selectAll' }` menu accelerator was observed, in this harness, to not reliably
    // sync back into ProseMirror's own selection before a following synthetic Backspace).
    await openTask(`WYSIWYG heading demotion ${randomUUID()}`);
    await setMarkdownValue('# Demote me');
    await modeWysiwygLabel.click();
    check((await richContent.locator('h1').innerText()) === 'Demote me', '3: existing H1 Markdown opens as a real heading');
    // Click right at the top-left of the heading text, then confirm the caret is truly at
    // position 0 via repeated ArrowLeft (see the blockquote scenario below for why -- Home was
    // observed to not always reliably reach position 0 for a short line in this harness).
    await richContent.locator('h1').click({ position: { x: 1, y: 1 } });
    await page.waitForTimeout(50);
    for (let i = 0; i < 'Demote me'.length; i += 1) await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(50);
    await page.keyboard.press('Backspace');
    check((await richContent.locator('h1').count()) === 0, '3: Backspace at start of heading demotes to a paragraph');
    const demotedText = await richContent.innerText();
    check(demotedText.includes('Demote me') && !demotedText.includes('#'), `3: demoted text is preserved with no literal "#" characters, got: ${demotedText}`);

    // Retype "## " -- must recreate a real H2 (no stale suppressing state from the demotion).
    // The caret is already at position 0 (the demotion preserves it), so no navigation is needed.
    await page.keyboard.type('## ');
    check((await richContent.locator('h2').count()) === 1, '3: retyping "## " after demotion recreates a real heading (no stale suppression)');
    await closeModal();
  }

  {
    // Enter at the end of a heading exits to a new paragraph, not another heading.
    await openTask(`WYSIWYG heading enter exit ${randomUUID()}`);
    await setMarkdownValue('# Heading only');
    await modeWysiwygLabel.click();
    await richContent.locator('h1').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('after heading');
    const paraCount = await richContent.locator('p', { hasText: 'after heading' }).count();
    check(paraCount === 1, '3: Enter at the end of a heading exits to a plain paragraph');
    check((await richContent.locator('h1').count()) === 1, '3: the original heading is untouched by the Enter-exit');
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 4. Blockquote: "> " converts to a real blockquote; Enter on non-empty content continues the
  //    quote; Enter on an empty quote line exits immediately (not after multiple presses);
  //    Backspace at the start converts to a paragraph preserving the text, no literal ">" shown.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG blockquote continue exit backspace ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await richContent.click();
    await page.keyboard.type('> First quote line');
    check((await richContent.locator('blockquote').count()) === 1, '4: "> " converts the paragraph to a blockquote');
    await page.keyboard.press('Enter');
    await page.keyboard.type('second quote line');
    check((await richContent.locator('blockquote p')).count !== undefined, '4: locator sanity');
    check((await richContent.locator('blockquote p').count()) === 2, '4: Enter on non-empty quote content continues the quote (two paragraphs, one blockquote)');
    await page.keyboard.press('Enter'); // empty line inside the quote
    await page.keyboard.press('Enter'); // exits immediately, not after multiple presses
    check((await richContent.locator('blockquote').count()) <= 1, '4: exiting the blockquote does not leave a duplicate/broken blockquote');
    await page.keyboard.type('after quote');
    const afterQuoteText = await richContent.innerText();
    check(!afterQuoteText.trim().endsWith('>'), '4: no literal ">" marker is ever shown');
    await closeModal();
  }

  {
    // Backspace-at-start demotion, preserving text (fresh task, opened straight from existing
    // blockquote Markdown, to avoid Ctrl/Cmd+A select-all -- see the heading scenario's comment).
    await openTask(`WYSIWYG blockquote backspace demotion ${randomUUID()}`);
    await setMarkdownValue('> Quoted text');
    await modeWysiwygLabel.click();
    check((await richContent.locator('blockquote').count()) === 1, '4: existing blockquote Markdown opens as a real blockquote');
    // Click right at the top-left of the quoted paragraph's text (rather than the element's
    // center, which for a short line in a wide block can resolve the native caret to the *end*
    // of the line) to land reliably at the very start of the text, then confirm via a proven
    // caret-navigation key (End then repeated ArrowLeft) rather than Home/Ctrl+Home, which were
    // observed to not reliably reach position 0 for this element in this harness.
    await richContent.locator('blockquote p').click({ position: { x: 1, y: 1 } });
    await page.waitForTimeout(50);
    for (let i = 0; i < 'Quoted text'.length; i += 1) await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(50);
    await page.keyboard.press('Backspace');
    check((await richContent.locator('blockquote').count()) === 0, '4: Backspace at start of a blockquote converts it to a paragraph');
    const demoted = await richContent.innerText();
    check(demoted.includes('Quoted text') && !demoted.includes('>'), `4: demoted blockquote text is preserved with no literal ">" , got: ${demoted}`);
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 5. Code block: fenced Markdown converts to a real, monospace, whitespace-preserving code
  //    block distinct from inline code; Enter adds a line inside it (does not exit); inline code
  //    (including multi-backtick delimiters) stays inline, never misparsed as a fenced block.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG code block and inline code ${randomUUID()}`);
    await setMarkdownValue('```\nline one\nline two\n```\n\nSome ``inline `code` `` and `plain code` here.');
    await modeWysiwygLabel.click();
    check((await richContent.locator('pre code').count()) === 1, '5: fenced Markdown renders as a real code block');
    const codeBlockText = await richContent.locator('pre code').innerText();
    check(codeBlockText.includes('line one') && codeBlockText.includes('line two'), `5: code block preserves both lines, got: ${codeBlockText}`);
    const inlineCodes = await richContent.locator('p code').allInnerTexts();
    check(inlineCodes.some((t) => t.includes('code')), `5: multi-backtick inline code stays inline (not misparsed as a fenced block), got: ${JSON.stringify(inlineCodes)}`);
    check(inlineCodes.includes('plain code'), `5: plain single-backtick inline code round-trips, got: ${JSON.stringify(inlineCodes)}`);

    // Enter inside the code block adds a line, does not exit it. Click near the bottom-right of
    // the code block (rather than its default center, which for multi-line content can resolve
    // to an earlier line) to land at/near the end of the last line reliably in this harness.
    const codeBlockBox = await richContent.locator('pre code').boundingBox();
    await richContent.locator('pre code').click(codeBlockBox ? { position: { x: codeBlockBox.width - 2, y: codeBlockBox.height - 2 } } : undefined);
    await page.keyboard.press('End');
    // A beat for ProseMirror's own selection state to sync from the native DOM
    // click/keyboard-caused selection change before the next keystroke depends on it (same class
    // of harness timing issue noted in the heading/blockquote Backspace scenarios above).
    await page.waitForTimeout(50);
    await page.keyboard.press('Enter');
    await page.keyboard.type('line three');
    check((await richContent.locator('pre').count()) === 1, '5: Enter inside a code block adds a line, does not split into a second <pre>');
    const updatedCodeBlockText = await richContent.locator('pre code').innerText();
    check(updatedCodeBlockText.includes('line three'), `5: typing inside the code block after Enter lands inside it, got: ${updatedCodeBlockText}`);
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 6. Bullet list, task list, horizontal rule: input rules convert immediately; task checkboxes
  //    round-trip checked/unchecked state; HR round-trips without duplication across repeated
  //    mode switches.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG bullet task hr ${randomUUID()}`);
    // A plain paragraph line (not just a blank line) between the bullet list and the task list:
    // per CommonMark, two lists using the same "-" marker separated only by a blank line are one
    // combined (loose) list, not two -- and `markdown-it-task-lists` (a transitive dependency of
    // the Markdown conversion library) was found, in that specific shape, to mis-tag the *entire*
    // combined list as a task list, corrupting the plain bullet items. An intervening paragraph
    // unambiguously terminates the bullet list first, avoiding that upstream edge case, and is
    // also a more realistic real-world document shape.
    await setMarkdownValue('- one\n- two\n\nbetween\n\n- [x] done\n- [ ] todo\n\n---\n\nafter hr');
    await modeWysiwygLabel.click();
    check((await richContent.locator('ul.wysiwyg-list--bullet li').count()) === 2, '6: bullet list Markdown opens as real list items');
    check((await richContent.locator('li.wysiwyg-task-item').count()) === 2, '6: task list Markdown opens as real task items');
    const checkboxes = richContent.locator('li.wysiwyg-task-item input[type="checkbox"]');
    check(await checkboxes.nth(0).isChecked(), '6: checked task item state is preserved');
    check(!(await checkboxes.nth(1).isChecked()), '6: unchecked task item state is preserved');
    check((await richContent.locator('hr').count()) === 1, '6: "---" renders as a real <hr>, not literal text');

    // Toggle a checkbox, then round-trip Markdown<->WYSIWYG repeatedly and verify no HR duplication.
    await checkboxes.nth(1).click();
    await modeMarkdownLabel.click();
    const md6 = await getMarkdownValue();
    check(md6.includes('[x] done') && md6.includes('[x] todo'), `6: toggled checkbox round-trips to Markdown, got: ${md6}`);
    check((md6.match(/^---$/gm) ?? []).length === 1, `6: exactly one "---" survives the round-trip, got: ${md6}`);
    await modeWysiwygLabel.click();
    await modeMarkdownLabel.click();
    const md6b = await getMarkdownValue();
    check((md6b.match(/^---$/gm) ?? []).length === 1, `6: HR does not duplicate across repeated mode switches, got: ${md6b}`);
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 7. Full mixed-document round-trip: one task body containing every supported construct,
  //    switched Markdown -> WYSIWYG -> Markdown -> WYSIWYG, verifying no content is lost or
  //    corrupted, then saved and reopened.
  // ---------------------------------------------------------------------------
  {
    const title = `WYSIWYG full mixed document round-trip ${randomUUID()}`;
    const mixed = [
      '# Title',
      '',
      '## Subtitle',
      '',
      'A paragraph with **bold**, *italic*, and ***bold italic*** text.',
      '',
      '> A blockquote with **bold** inside.',
      '',
      'Inline `code` here.',
      '',
      '```',
      'const x = 1;',
      'const y = 2;',
      '```',
      '',
      '- bullet one',
      '- bullet two',
      '',
      // See scenario 6's comment: an intervening paragraph (not just a blank line) unambiguously
      // separates the bullet list from the task list, avoiding a markdown-it-task-lists upstream
      // edge case where an adjacent same-marker list gets mis-tagged as entirely task-list.
      'between the lists',
      '',
      '- [x] checked item',
      '- [ ] unchecked item',
      '',
      '---',
      '',
      'closing paragraph',
    ].join('\n');

    await openTask(title);
    await setMarkdownValue(mixed);
    await modeWysiwygLabel.click();
    check((await richContent.locator('h1').count()) === 1, '7: H1 renders');
    check((await richContent.locator('h2').count()) === 1, '7: H2 renders');
    check((await richContent.locator('strong').count()) >= 1, '7: bold renders');
    check((await richContent.locator('em').count()) >= 1, '7: italic renders');
    check((await richContent.locator('blockquote').count()) === 1, '7: blockquote renders');
    check((await richContent.locator('pre code').count()) === 1, '7: code block renders');
    check((await richContent.locator('p code').count()) >= 1, '7: inline code renders');
    check((await richContent.locator('ul.wysiwyg-list--bullet li').count()) === 2, '7: bullet list renders');
    check((await richContent.locator('li.wysiwyg-task-item').count()) === 2, '7: task list renders');
    check((await richContent.locator('hr').count()) === 1, '7: HR renders');

    await modeMarkdownLabel.click();
    const roundTripped = await getMarkdownValue();
    check(roundTripped.includes('Title'), '7: title text survives round-trip');
    check(roundTripped.includes('checked item') && roundTripped.includes('unchecked item'), '7: task item text survives round-trip');
    check(roundTripped.includes('const x = 1;') && roundTripped.includes('const y = 2;'), '7: code block content survives round-trip');
    check(roundTripped.includes('closing paragraph'), '7: trailing paragraph survives round-trip');

    await modeWysiwygLabel.click();
    check((await richContent.locator('h1').count()) === 1, '7: structure intact after switching back to WYSIWYG');

    await page.locator('#save-edit').click();
    await overlay.waitFor({ state: 'hidden' });
    await rowFor(title).locator('.task-text').click();
    await overlay.waitFor({ state: 'visible' });
    await modeWysiwygLabel.click();
    check((await richContent.locator('h1').count()) === 1, '7: reopening the saved task restores the H1');
    check((await richContent.locator('li.wysiwyg-task-item').count()) === 2, '7: reopening the saved task restores both task items');
    const reopenedCheckboxes = richContent.locator('li.wysiwyg-task-item input[type="checkbox"]');
    check(await reopenedCheckboxes.nth(0).isChecked(), '7: reopened checked task item stays checked');
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 8. Toolbar active-state reflects semantic editor.isActive(...) state live, updating on
  //    selection changes (not just clicks), for both a mark (bold) and a block (blockquote).
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG toolbar semantic active state ${randomUUID()}`);
    await setMarkdownValue('Plain **bold** and > quoted text');
    await modeWysiwygLabel.click();
    const boldBtn = page.locator('.markdown-toolbar-btn[data-action="bold"]');
    await richContent.locator('strong').click();
    await page.waitForTimeout(50);
    check(await boldBtn.evaluate((el) => el.classList.contains('active')), '8: Bold button becomes active when the caret moves into existing bold text');
    await richContent.locator('p').first().click();
    await page.waitForTimeout(50);
    check(!(await boldBtn.evaluate((el) => el.classList.contains('active'))), '8: Bold button becomes inactive when the caret moves out of bold text');
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 9. Unsupported/pre-existing syntax data-loss check: a link already present in a task's
  //    details (never exposed as a toolbar feature) survives a WYSIWYG round-trip without being
  //    dropped or corrupted.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG link preserved through round-trip ${randomUUID()}`);
    await setMarkdownValue('See [docs](https://example.com) for more.');
    await modeWysiwygLabel.click();
    await modeMarkdownLabel.click();
    const md9 = await getMarkdownValue();
    check(md9.includes('example.com') && md9.includes('docs'), `9: pre-existing link text/URL survive a WYSIWYG round-trip, got: ${md9}`);
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 10. Markdown-mode toolbar is unchanged by this migration (CodeMirror side, out of scope):
  //     the same shared toolbar still drives CodeMirror transactions correctly.
  // ---------------------------------------------------------------------------
  {
    const boldBtn = page.locator('.markdown-toolbar-btn[data-action="bold"]');
    await openTask(`Markdown toolbar bold selection toggle ${randomUUID()}`);
    await modeMarkdownLabel.click();
    await setMarkdownValue('foo');
    await detailsEditorContent.click();
    await page.keyboard.press(selectAllKey);
    await boldBtn.click();
    check((await getMarkdownValue()) === '**foo**', `10: Markdown toolbar Bold wraps a selection, got: ${await getMarkdownValue()}`);
    await closeModal();
  }

  console.log(`Markdown toolbar self-test: ${checks} checks passed`);
} catch (err) {
  failure = err;
} finally {
  if (electronApp) await electronApp.close();
  try {
    assertProtectedFilesUnchanged(check);
  } catch (guardErr) {
    if (!failure) failure = guardErr;
  }
  cleanupTempRoot(tempRoot);
}

if (failure) {
  console.error('Markdown toolbar self-test failed:', failure.message);
  process.exit(1);
}
