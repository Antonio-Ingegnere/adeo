// Markdown | WYSIWYG Details editor acceptance suite. Run with: npm run test:markdown-toolbar
// (or directly: node scripts/markdown-toolbar-selftest.mjs -- it builds dist itself first so it
// also works as a standalone feature_check without relying on the npm wrapper having run).
//
// Same isolated-Electron harness as scripts/edit-modal-delete-selftest.mjs: real Electron app,
// isolated userData dir + SQLite file, real dev database/settings snapshotted and re-asserted
// byte-unchanged in the finally block. Narrow smoke of the new Details editor behavior, not a
// viewport/theme matrix.
//
// Markdown mode is a real CodeMirror 6 EditorView (see src/renderer/markdownEditor.ts), not a
// textarea, so it has no .fill()/.inputValue(); setMarkdownValue/getMarkdownValue below drive and
// read it like a real user would (click the editable content, select-all + type to replace it,
// read back rendered text) instead. Every WYSIWYG-side locator/assertion (detailsRich, the mode
// radios, markdownRich.ts's rendering) is unchanged from before this rewrite.
//
// Covers: mode switch preserves the one canonical document; immediate block shortcuts (# / ## /
// - / - [ ] / - [x] ); immediate inline shortcuts (**bold**, *italic*); a lone `*`/`#` not
// transforming anything; toolbar Bold acting on a selection; Markdown -> WYSIWYG -> edit ->
// Markdown round-trip; unsupported syntax (a link) surviving the round-trip unchanged; and that
// an automatic block transformation does not corrupt native Undo.

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
  // #edit-details is now a CodeMirror 6 EditorView mount (see src/renderer/markdownEditor.ts),
  // not a textarea: it has no .fill()/.inputValue(). setMarkdownValue/getMarkdownValue below
  // drive/read it the same way a real user would -- click the editable content, select-all +
  // type to replace it, and read back the rendered text -- while every WYSIWYG-side assertion
  // in this file (detailsRich, mode radios) is untouched.
  const detailsTextarea = page.locator('#edit-details');
  const detailsEditorContent = detailsTextarea.locator('.cm-content');
  const detailsRich = page.locator('#edit-details-rich');
  const modeMarkdown = page.locator('#edit-details-mode-markdown');
  const modeWysiwyg = page.locator('#edit-details-mode-wysiwyg');
  const modeMarkdownLabel = page.locator('label.segmented-option', { has: modeMarkdown });
  const modeWysiwygLabel = page.locator('label.segmented-option', { has: modeWysiwyg });
  const selectAllKey = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';

  const setMarkdownValue = async (text) => {
    await detailsEditorContent.click();
    await page.keyboard.press(selectAllKey);
    await page.keyboard.press('Backspace');
    if (text.length > 0) await page.keyboard.type(text);
  };

  // CodeMirror renders exactly one .cm-line child per document line (its core invariant), so
  // reconstructing the document as each child's textContent joined by '\n' is exact -- unlike
  // Chromium's innerText(), which inserts an extra line break for a line that is itself empty
  // (its lone <br> plus the block boundary both count), corrupting blank lines between blocks.
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
  // 1. Mode switch operates on one canonical document: type Markdown, switch to WYSIWYG,
  //    see it rendered, switch back, get the same Markdown back.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG mode switch ${randomUUID()}`);
    await setMarkdownValue('## Hello\n\nSome **bold** text.');
    await modeWysiwygLabel.click();
    await detailsRich.waitFor({ state: 'visible' });
    check((await detailsRich.locator('h2').innerText()) === 'Hello', '1: heading renders as a real H2, no raw ## markers');
    check((await detailsRich.locator('strong').innerText()) === 'bold', '1: **bold** renders as a real <strong>, no raw ** markers');
    await modeMarkdownLabel.click();
    await detailsTextarea.waitFor({ state: 'visible' });
    check((await getMarkdownValue()) === '## Hello\n\nSome **bold** text.', '1: switching back to Markdown reproduces the original text unchanged');
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 2. Immediate block-level shortcuts: "# " -> H1, "- " -> bullet, "- [ ] " -> task item,
  //    caret stays inside so normal typing continues.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG block shortcuts ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();
    await page.keyboard.type('# ');
    check((await detailsRich.locator('h1').count()) === 1, '2: "# " immediately converts the empty paragraph to H1');
    await page.keyboard.type('Title');
    check((await detailsRich.locator('h1').innerText()) === 'Title', '2: typing after the trigger continues inside the heading, caret intact');

    await page.keyboard.press('Enter');
    await page.keyboard.type('- ');
    check((await detailsRich.locator('ul[data-list-type="bullet"] li').count()) === 1, '2: "- " immediately converts to a bullet list item');
    await page.keyboard.type('one');

    await page.keyboard.press('Enter');
    await page.keyboard.type('- [ ] ');
    check((await detailsRich.locator('ul[data-list-type="task"] li input[type="checkbox"]').count()) === 1, '2: "- [ ] " immediately converts to an unchecked task item');
    await page.keyboard.type('todo');

    await modeMarkdownLabel.click();
    const md = await getMarkdownValue();
    check(md.includes('# Title'), `2: heading round-trips to Markdown, got: ${md}`);
    check(md.includes('- one'), `2: bullet round-trips to Markdown, got: ${md}`);
    check(md.includes('- [ ] todo'), `2: task round-trips to Markdown, got: ${md}`);
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 3. A lone "*" or "#" must not transform anything; only the complete trigger does.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG no premature conversion ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();
    await page.keyboard.type('#word');
    check((await detailsRich.locator('h1, h2, h3').count()) === 0, '3: "#word" (no trailing space) does not convert to a heading');
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('*word');
    check((await detailsRich.locator('em').count()) === 0, '3: a single leading "*" alone does not convert to italic');
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 4. Immediate inline shortcuts: closing "**" converts to bold, closing "*" converts to
  //    italic, right after the marker, no Enter/blur required.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG inline shortcuts ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();
    await page.keyboard.type('**bold**');
    check((await detailsRich.locator('strong').innerText()) === 'bold', '4: "**bold**" converts to <strong> immediately after the closing marker');
    await page.keyboard.type(' and *italic*');
    check((await detailsRich.locator('em').innerText()) === 'italic', '4: "*italic*" converts to <em> immediately after the closing marker');
    await page.keyboard.type(' more');
    const text = await detailsRich.innerText();
    check(!text.includes('*'), `4: no raw asterisk markers remain visible, got: ${text}`);
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 5. Toolbar Bold button wraps the current selection (same transform as the shortcut path).
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG toolbar selection ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();
    await page.keyboard.type('plain text');
    await page.keyboard.down('Shift');
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowLeft');
    await page.keyboard.up('Shift');
    await page.locator('.markdown-toolbar-btn[data-action="bold"]').click();
    check((await detailsRich.locator('strong').innerText()) === 'text', '5: toolbar Bold wraps the current selection in <strong>');
    await modeMarkdownLabel.click();
    check((await getMarkdownValue()) === 'plain **text**', `5: toolbar bold round-trips to Markdown, got: ${await getMarkdownValue()}`);
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 6. Unsupported syntax (a link, which helpers.ts's renderer does not parse) is preserved
  //    verbatim through a WYSIWYG round-trip rather than being dropped or corrupted.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG unsupported syntax preserved ${randomUUID()}`);
    await setMarkdownValue('See [docs](https://example.com) for more.');
    await modeWysiwygLabel.click();
    await modeMarkdownLabel.click();
    check(
      (await getMarkdownValue()) === 'See [docs](https://example.com) for more.',
      '6: unsupported link syntax survives a WYSIWYG round-trip unchanged'
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 7. Existing task details (plain Markdown, never touched by WYSIWYG before) open correctly
  //    in WYSIWYG mode without migration.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG existing details ${randomUUID()}`);
    await setMarkdownValue('- [x] done item\n- [ ] open item');
    await modeWysiwygLabel.click();
    check((await detailsRich.locator('ul[data-list-type="task"] li').count()) === 2, '7: existing task-list Markdown opens correctly in WYSIWYG without migration');
    check(await detailsRich.locator('ul[data-list-type="task"] li input[type="checkbox"]').first().isChecked(), '7: existing checked task state is preserved');
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 8. An automatic block transformation integrates with native Undo without corrupting the
  //    document: Undo after "# " -> H1 does not crash or leave a broken/duplicated block.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG undo after shortcut ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();
    await page.keyboard.type('# ');
    await page.keyboard.type('Heading text');
    check((await detailsRich.locator('h1').innerText()) === 'Heading text', '8: heading created as expected before undo');
    await page.keyboard.press('Control+Z');
    await page.waitForTimeout(150);
    const blockCount = await detailsRich.locator('> *').count();
    check(blockCount >= 1, '8: Undo leaves at least one block behind rather than an empty/broken document');
    check((await detailsRich.locator('h1, h2, h3, h4, h5, h6, p').count()) >= 1, '8: Undo does not corrupt the document into a non-block state');
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 9. A task-list line without a leading "-"/"*" marker (still recognized as a task item by
  //    helpers.ts's canonical renderer) opens as a real task item in WYSIWYG mode and round-trips
  //    back to Markdown without losing its checkbox/task-item structure (regression for D-001:
  //    markdownRich.ts's task regex previously required the leading marker while helpers.ts made
  //    it optional).
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG dash-less task line ${randomUUID()}`);
    await setMarkdownValue('[x] done\n[ ] todo');
    await modeWysiwygLabel.click();
    check(
      (await detailsRich.locator('ul[data-list-type="task"] li').count()) === 2,
      '9: dash-less task-list lines open as real task items in WYSIWYG mode'
    );
    check(
      await detailsRich.locator('ul[data-list-type="task"] li input[type="checkbox"]').first().isChecked(),
      '9: dash-less checked task state is preserved'
    );
    check(
      !(await detailsRich.locator('ul[data-list-type="task"] li input[type="checkbox"]').nth(1).isChecked()),
      '9: dash-less unchecked task state is preserved'
    );
    await modeMarkdownLabel.click();
    const md9 = await getMarkdownValue();
    check(
      md9.includes('[x] done') && md9.includes('[ ] todo'),
      `9: dash-less task lines round-trip back to Markdown with checkbox structure intact, got: ${md9}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 10. Immediate block shortcut for horizontal rule: typing "---" on its own line converts
  //     immediately to an <hr> element in WYSIWYG mode (regression for D-002: previously required
  //     a mode round-trip to render correctly).
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG horizontal rule shortcut ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();
    await page.keyboard.type('---');
    check(
      (await detailsRich.locator('hr').count()) === 1,
      '10: "---" immediately converts to an <hr> element without requiring a mode round-trip'
    );
    await page.keyboard.press('Enter');
    await page.keyboard.type('text after');
    await modeMarkdownLabel.click();
    const md10 = await getMarkdownValue();
    check(md10.includes('---'), `10: horizontal rule round-trips to Markdown as "---", got: ${md10}`);
    check(md10.includes('text after'), `10: content after hr is preserved, got: ${md10}`);
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 11. Bullet-to-task upgrade: typing "- " creates a bullet item; continuing to type "[ ] "
  //     or "[x] " immediately upgrades that same item to a task item without a mode round-trip
  //     (regression for D-003: previously required switching to Markdown mode and back).
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG bullet to task upgrade ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();
    await page.keyboard.type('- ');
    check(
      (await detailsRich.locator('ul[data-list-type="bullet"] li').count()) === 1,
      '11: "- " converts to a bullet list item'
    );
    check(
      (await detailsRich.locator('ul[data-list-type="task"]').count()) === 0,
      '11: initially a bullet item, not a task item'
    );
    await page.keyboard.type('[ ] ');
    check(
      (await detailsRich.locator('ul[data-list-type="task"] li input[type="checkbox"]').count()) === 1,
      '11: typing "[ ] " after "- " upgrades the item to an unchecked task item without showing literal brackets'
    );
    check(
      !(await detailsRich.locator('ul[data-list-type="task"] li input[type="checkbox"]').isChecked()),
      '11: the task item is unchecked'
    );
    await page.keyboard.type('first task');

    await page.keyboard.press('Enter');
    await page.keyboard.type('- ');
    check(
      (await detailsRich.locator('ul[data-list-type="bullet"] li').count()) === 1,
      '11: new "- " creates another bullet item'
    );
    await page.keyboard.type('[x] ');
    check(
      (await detailsRich.locator('ul[data-list-type="task"] li input[type="checkbox"]').count()) === 2,
      '11: typing "[x] " after "- " upgrades the second item to a checked task item'
    );
    check(
      await detailsRich.locator('ul[data-list-type="task"] li input[type="checkbox"]').nth(1).isChecked(),
      '11: the second task item is checked'
    );
    await page.keyboard.type('second task');

    await modeMarkdownLabel.click();
    const md11 = await getMarkdownValue();
    check(
      md11.includes('- [ ] first task'),
      `11: unchecked task round-trips to Markdown correctly, got: ${md11}`
    );
    check(
      md11.includes('- [x] second task'),
      `11: checked task round-trips to Markdown correctly, got: ${md11}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 12. Checkbox/text click separation (regression for D-004): clicking a task item's text
  //     places the caret there without toggling the checkbox; clicking the checkbox does toggle
  //     it. Also verifies the Enter-split task item (from scenario 11) still has a working,
  //     independently-clickable checkbox.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG checkbox click separation ${randomUUID()}`);
    await setMarkdownValue('- [ ] Buy milk today');
    await modeWysiwygLabel.click();
    const taskLi = detailsRich.locator('ul[data-list-type="task"] li').first();
    const checkbox = taskLi.locator('input[type="checkbox"]');
    const textSpan = taskLi.locator('.wysiwyg-task-text');

    check(!(await checkbox.isChecked()), '12: task item starts unchecked');

    // Click on the text (not the checkbox): must place the caret, not toggle the checkbox.
    await textSpan.click();
    check(!(await checkbox.isChecked()), '12: clicking the task text does not toggle the checkbox');
    await page.keyboard.type('X');
    const textAfterClick = await textSpan.innerText();
    check(textAfterClick.includes('X'), `12: clicking the task text places a caret that accepts typing, got: ${textAfterClick}`);

    // Click-drag a selection across the text: must not toggle the checkbox either.
    const box = await textSpan.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + Math.min(box.width, 30), box.y + box.height / 2);
      await page.mouse.up();
    }
    check(!(await checkbox.isChecked()), '12: click-dragging over the task text does not toggle the checkbox');

    // Click directly on the checkbox: must toggle it.
    await checkbox.click();
    check(await checkbox.isChecked(), '12: clicking the checkbox itself toggles it');

    await modeMarkdownLabel.click();
    const md12 = await getMarkdownValue();
    check(md12.startsWith('- [x] '), `12: checkbox toggle serializes to "- [x] " in Markdown, got: ${md12}`);
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 13. Empty task item exit (D-005): pressing Enter on an empty task item should
  //     exit the task list and convert to a paragraph. This is standard list-editor
  //     behavior: Enter on an empty list item removes it and returns to normal paragraph text.
  //     After exiting, typing and shortcuts must work correctly (regression test for the
  //     async-selection-loss bug that required removal of a prior keydown-based handler).
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG empty task item exit ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();

    // Create an empty unchecked task item and press Enter to exit the list
    await page.keyboard.type('- [ ] ');
    check(
      (await detailsRich.locator('ul[data-list-type="task"] li').count()) === 1,
      '13: "- [ ] " creates an unchecked task item'
    );
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    check(
      (await detailsRich.locator('ul[data-list-type="task"] li').count()) === 0,
      '13: Enter on the only (empty) task item removes it entirely (exits the list, no stray checkbox left)'
    );
    check(
      (await detailsRich.locator('p').count()) >= 1,
      '13: Enter on an empty task item converts to a paragraph'
    );

    // Type normal text in the new paragraph to verify selection is stable (no async-selection-loss)
    await page.keyboard.type('normal paragraph');
    const paraText = await detailsRich.locator('p').last().innerText();
    check(
      paraText.includes('normal paragraph'),
      `13: typing after exiting task list works correctly and selection is stable, got: ${paraText}`
    );

    // Test that shortcuts still fire after exit (verifying async-selection-loss doesn't happen)
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('# ');
    check(
      (await detailsRich.locator('h1').count()) === 1,
      '13: heading shortcut fires correctly after task-list exit (selection is stable, no async-selection-loss)'
    );
    await page.keyboard.type('Heading');

    await modeMarkdownLabel.click();
    const md13 = await getMarkdownValue();
    check(
      !md13.match(/- \[ \]\s*(\n|$)/) && md13.includes('normal paragraph') && md13.includes('# Heading'),
      `13: paragraph and heading round-trip correctly to Markdown with no leftover empty checkbox, got: ${md13}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 14. Empty checked task item exit (D-005 regression): pressing Enter on an empty
  //     *checked* task item should also exit the list and convert to a paragraph,
  //     with the same behavior as unchecked items.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG empty checked task exit ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();

    // Create an empty checked task item and press Enter to exit
    await page.keyboard.type('- [x] ');
    check(
      (await detailsRich.locator('ul[data-list-type="task"] li').count()) === 1,
      '14: "- [x] " creates a checked task item'
    );
    const checkbox = detailsRich.locator('ul[data-list-type="task"] li input[type="checkbox"]').first();
    check(
      await checkbox.isChecked(),
      '14: the task item is checked'
    );

    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    check(
      (await detailsRich.locator('ul[data-list-type="task"] li').count()) === 0,
      '14: Enter on the only (empty) checked task item removes it entirely (exits the list, no stray checkbox left)'
    );
    check(
      (await detailsRich.locator('p').count()) >= 1,
      '14: Enter on an empty checked task item converts to a paragraph'
    );

    await page.keyboard.type('text after checked exit');
    const paraText = await detailsRich.locator('p').last().innerText();
    check(
      paraText.includes('text after checked exit'),
      `14: typing after exiting from checked task item works correctly, got: ${paraText}`
    );

    await modeMarkdownLabel.click();
    const md14 = await getMarkdownValue();
    check(
      !md14.match(/- \[x\]\s*(\n|$)/) && md14.includes('text after checked exit'),
      `14: paragraph round-trips correctly to Markdown with no leftover empty checked checkbox, got: ${md14}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 15. Non-empty task item Enter (D-005 regression): pressing Enter on a non-empty
  //     task item should still create a new task item (normal list behavior), not
  //     exit the list. This ensures the fix only targets the empty-item case.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG non-empty task Enter regression ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();

    // Create a non-empty task item
    await page.keyboard.type('- [ ] first task');
    check(
      (await detailsRich.locator('ul[data-list-type="task"] li').count()) === 1,
      '15: created first task item with text'
    );

    // Press Enter (should create a new task item, not exit)
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    check(
      (await detailsRich.locator('ul[data-list-type="task"] li').count()) === 2,
      '15: Enter on non-empty task item creates a new task item (standard list behavior)'
    );

    // Verify the new item is empty (ready for typing)
    const newItemText = await detailsRich.locator('ul[data-list-type="task"] li').last().locator('.wysiwyg-task-text').innerText();
    check(
      newItemText.trim() === '',
      `15: new task item is empty and ready for typing, got text: "${newItemText}"`
    );

    // Type in the new item to verify it works
    await page.keyboard.type('second task');
    const secondText = await detailsRich.locator('ul[data-list-type="task"] li').last().locator('.wysiwyg-task-text').innerText();
    check(
      secondText.includes('second task'),
      `15: typing in the new task item works correctly, got: ${secondText}`
    );

    await modeMarkdownLabel.click();
    const md15 = await getMarkdownValue();
    check(
      md15.includes('- [ ] first task') && md15.includes('- [ ] second task'),
      `15: two task items round-trip correctly to Markdown, got: ${md15}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 16. Non-empty item followed by Enter-created empty item then second Enter (D-006 regression):
  //     Create a non-empty task item, press Enter (creates empty item), press Enter again on
  //     that empty item. This should exit the list AND remove the empty item entirely,
  //     leaving no stray checkbox. The previous fix (D-005) only removed the newly-created
  //     item but left the first empty item behind.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG empty item exit non-empty prior ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();

    // Create a non-empty task item
    await page.keyboard.type('- [ ] First task');
    check(
      (await detailsRich.locator('ul[data-list-type="task"] li').count()) === 1,
      '16: created first task item with text'
    );

    // Press Enter at the end -> creates an empty task item
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    check(
      (await detailsRich.locator('ul[data-list-type="task"] li').count()) === 2,
      '16: Enter on non-empty task item creates a second (empty) task item'
    );

    // Press Enter again on the empty item -> should exit the list and remove the empty item
    await page.keyboard.press('Enter');
    check(
      (await detailsRich.locator('ul[data-list-type="task"] li').count()) === 1,
      '16: Enter on the empty task item removes it (both the empty one and the newly-created one are gone)'
    );
    check(
      (await detailsRich.locator('p').count()) >= 1,
      '16: Enter on empty task item converts to a paragraph'
    );

    // Verify the paragraph has the cursor and typing works
    await page.keyboard.type('paragraph text');
    const paraText = await detailsRich.locator('p').last().innerText();
    check(
      paraText.includes('paragraph text'),
      `16: typing after exiting task list works correctly, got: ${paraText}`
    );

    // Switch to Markdown and verify no orphan "- [ ]" entry exists
    await modeMarkdownLabel.click();
    const md16 = await getMarkdownValue();
    check(
      md16.includes('- [ ] First task') && md16.includes('paragraph text'),
      `16: correct Markdown round-trip with no orphan empty checkbox, got: ${md16}`
    );
    check(
      !md16.match(/- \[ \]\s*\n/),
      `16: no orphan "- [ ]" entry exists in Markdown, got: ${md16}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 17. Toolbar task-list button on empty block (D-007 regression): clicking the Task List
  //     toolbar button on an empty paragraph should leave the caret inside the new task item's
  //     text span (immediately after the checkbox), ready for typing -- no additional click
  //     or navigation needed. Behavior should match typing '- [ ] ' directly (the typed-shortcut path).
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG toolbar task button caret placement ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();

    // Click the toolbar task button on the empty paragraph
    await page.locator('.markdown-toolbar-btn[data-action="task"]').click();
    check(
      (await detailsRich.locator('ul[data-list-type="task"] li input[type="checkbox"]').count()) === 1,
      '17: toolbar task button creates an unchecked task item'
    );

    // Type immediately after clicking the toolbar button: caret should be inside the task-text span,
    // so the text should appear inside the item, not in a separate paragraph after it.
    await page.keyboard.type('test task');
    const taskText = await detailsRich.locator('ul[data-list-type="task"] li .wysiwyg-task-text').innerText();
    check(
      taskText.includes('test task'),
      `17: typing after toolbar task button lands inside the task item's text span, got: "${taskText}"`
    );

    // Verify no separate paragraph was created after the task item (which would indicate wrong caret placement)
    const paraCount = await detailsRich.locator('> p').count();
    check(
      paraCount === 0,
      `17: no separate paragraph after task item created, para count: ${paraCount}`
    );

    // Switch to Markdown to verify the structure round-trips correctly
    await modeMarkdownLabel.click();
    const md17 = await getMarkdownValue();
    check(
      md17.includes('- [ ] test task'),
      `17: toolbar task item round-trips to Markdown correctly, got: ${md17}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 18. Single empty item created via bullet-to-task upgrade, then Enter (D-005 reopen):
  //     the exact manual-QA repro -- type '- ' (bullet) then '[ ] ' (upgrades it to an empty
  //     task item via upgradeBulletItemToTask) with no non-empty item ever preceding it, then
  //     press Enter once. Must exit the list fully (no stray leftover checkbox), unlike the
  //     narrower typed-shortcut path already covered by check 13.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG bullet-upgrade single empty task exit ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();

    await page.keyboard.type('- ');
    await page.keyboard.type('[ ] ');
    check(
      (await detailsRich.locator('ul[data-list-type="task"] li').count()) === 1,
      '18: bullet-to-task upgrade created one empty task item'
    );
    await page.keyboard.press('Enter');
    check(
      (await detailsRich.locator('ul[data-list-type="task"] li').count()) === 0,
      '18: Enter on the single empty upgraded task item removes it entirely (exits the list)'
    );
    check(
      (await detailsRich.locator('> p').count()) === 1,
      '18: Enter on the single empty upgraded task item leaves exactly one paragraph'
    );
    await page.keyboard.type('after upgrade exit');
    const md18Text = await detailsRich.locator('p').last().innerText();
    check(
      md18Text.includes('after upgrade exit'),
      `18: typing after bullet-upgrade task exit works correctly, got: ${md18Text}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 19. Acceptance criterion: non-empty task -> Enter -> empty task -> Enter -> normal paragraph.
  //     Also verifies the D-007 toolbar-caret fix keeps working alongside this fix: a
  //     toolbar-inserted empty task item still gets correct caret placement for typing, but if
  //     Enter is pressed on it immediately with no typing, it still exits like any other empty
  //     task item (no stray checkbox left over).
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG acceptance non-empty-Enter-empty-Enter-paragraph ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();

    await page.keyboard.type('- [ ] non-empty task');
    check(
      (await detailsRich.locator('ul[data-list-type="task"] li').count()) === 1,
      '19: created a non-empty task item'
    );
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    check(
      (await detailsRich.locator('ul[data-list-type="task"] li').count()) === 2,
      '19: Enter on the non-empty task item creates a second (empty) task item'
    );
    await page.keyboard.press('Enter');
    check(
      (await detailsRich.locator('ul[data-list-type="task"] li').count()) === 1,
      '19: Enter on the empty task item exits the list, leaving only the original non-empty item'
    );
    check(
      (await detailsRich.locator('> p').count()) === 1,
      '19: exiting produces exactly one normal paragraph'
    );
    await page.keyboard.type('normal paragraph text');
    const acceptanceParaText = await detailsRich.locator('> p').last().innerText();
    check(
      acceptanceParaText.includes('normal paragraph text'),
      `19: typing in the resulting paragraph works correctly, got: ${acceptanceParaText}`
    );
    await modeMarkdownLabel.click();
    const md19 = await getMarkdownValue();
    check(
      md19.includes('- [ ] non-empty task') &&
        md19.includes('normal paragraph text') &&
        !md19.match(/- \[ \]\s*(\n|$)/),
      `19: Markdown round-trips with the non-empty task kept and no leftover empty checkbox, got: ${md19}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 20. Toolbar-inserted empty task item followed immediately by Enter (no typing) must still
  //     exit like any other empty task item (D-007 caret fix must not reintroduce the D-005 bug).
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG toolbar empty task then Enter exits ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();

    await page.locator('.markdown-toolbar-btn[data-action="task"]').click();
    check(
      (await detailsRich.locator('ul[data-list-type="task"] li').count()) === 1,
      '20: toolbar task button creates one empty task item'
    );
    await page.keyboard.press('Enter');
    check(
      (await detailsRich.locator('ul[data-list-type="task"] li').count()) === 0,
      '20: Enter immediately after toolbar-created empty task item exits the list (no stray checkbox)'
    );
    check(
      (await detailsRich.locator('> p').count()) === 1,
      '20: toolbar-created empty task item Enter-exit leaves exactly one paragraph'
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 21. Toolbar Bold with no selection: clicking Bold button toggles active typing state,
  //     so subsequently typed text appears bold. Clicking Bold again disables it.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG toolbar bold typing state ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();

    // Click the Bold button with no selection (caret only, no text selected)
    const boldBtn = page.locator('.markdown-toolbar-btn[data-action="bold"]');
    await boldBtn.click();
    check(
      await boldBtn.evaluate((el) => el.classList.contains('active')),
      '21: Bold button becomes active after clicking with no selection'
    );

    // Type text: should appear bold
    await page.keyboard.type('bold text');
    const boldEl = detailsRich.locator('strong');
    check(
      (await boldEl.count()) === 1,
      '21: text typed after activating Bold appears inside a <strong> element'
    );
    const boldText = await boldEl.innerText();
    check(
      boldText === 'bold text',
      `21: typed text is wrapped in <strong>, got: ${boldText}`
    );

    // Click Bold again to deactivate
    await boldBtn.click();
    check(
      !(await boldBtn.evaluate((el) => el.classList.contains('active'))),
      '21: Bold button becomes inactive after clicking again'
    );

    // Type more text: should not be bold
    await page.keyboard.type(' plain');
    // Chromium's contenteditable renders an isolated space right at a formatting-element boundary
    // as a non-breaking space (U+00A0) rather than a plain space (see markdownRich.ts's
    // normalizeSpaces/normalizeInlineText) -- normalized here too so this assertion is about
    // word-separation, not that exact byte.
    const allText = (await detailsRich.innerText()).replace(/ /g, ' ');
    check(
      allText.includes('bold text plain'),
      '21: text typed after deactivating Bold appears as plain text'
    );

    await modeMarkdownLabel.click();
    const md21 = await getMarkdownValue();
    check(
      md21 === '**bold text** plain',
      `21: bold typing state round-trips correctly to Markdown, got: ${md21}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 22. Toolbar Bold and Italic simultaneously: clicking both buttons with no selection
  //     creates bold+italic text when subsequently typed.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG toolbar bold and italic together ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();

    // Click both Bold and Italic buttons with no selection
    const boldBtn = page.locator('.markdown-toolbar-btn[data-action="bold"]');
    const italicBtn = page.locator('.markdown-toolbar-btn[data-action="italic"]');
    await boldBtn.click();
    await italicBtn.click();

    check(
      await boldBtn.evaluate((el) => el.classList.contains('active')),
      '22: Bold button is active'
    );
    check(
      await italicBtn.evaluate((el) => el.classList.contains('active')),
      '22: Italic button is active'
    );

    // Type text: should appear bold+italic
    await page.keyboard.type('bold italic text');
    const strongEl = detailsRich.locator('strong');
    const emEl = detailsRich.locator('em');

    check(
      (await strongEl.count()) >= 1,
      '22: typed text appears in a <strong> element'
    );
    check(
      (await emEl.count()) >= 1,
      '22: typed text appears in an <em> element'
    );

    await modeMarkdownLabel.click();
    const md22 = await getMarkdownValue();
    check(
      md22.includes('***bold italic text***') || md22.includes('**_bold italic text_**'),
      `22: bold+italic typing state round-trips correctly to Markdown, got: ${md22}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 23. Toolbar reflects active state when caret moves into existing bold/italic text:
  //     place caret inside a <strong> element, verify Bold button shows as active.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG toolbar reflects caret position ${randomUUID()}`);
    await setMarkdownValue('This is **bold** text');
    await modeWysiwygLabel.click();

    // Verify bold text was rendered
    const strongEl = detailsRich.locator('strong');
    check(
      (await strongEl.count()) === 1,
      '23: bold text is rendered as <strong>'
    );

    // Click inside the bold text to place the caret there. `selectionchange` (which drives the
    // toolbar's active-state update) fires on its own browser task after the click, not
    // synchronously with it, so give it a beat before asserting.
    await strongEl.click();
    await page.waitForTimeout(50);

    const boldBtn = page.locator('.markdown-toolbar-btn[data-action="bold"]');
    check(
      await boldBtn.evaluate((el) => el.classList.contains('active')),
      '23: Bold button becomes active when caret is inside existing <strong> text'
    );

    // Click outside the bold text
    const emptyArea = detailsRich.locator('p').first();
    await emptyArea.click();
    await page.keyboard.press('End');
    await page.waitForTimeout(50);

    check(
      !(await boldBtn.evaluate((el) => el.classList.contains('active'))),
      '23: Bold button becomes inactive when caret moves outside <strong> text'
    );

    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 24. Toolbar reflects caret position for italic text as well.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG toolbar reflects italic caret ${randomUUID()}`);
    await setMarkdownValue('Some *italic* text');
    await modeWysiwygLabel.click();

    // Click inside the italic text
    const emEl = detailsRich.locator('em');
    check(
      (await emEl.count()) === 1,
      '24: italic text is rendered as <em>'
    );
    await emEl.click();
    await page.waitForTimeout(50);

    const italicBtn = page.locator('.markdown-toolbar-btn[data-action="italic"]');
    check(
      await italicBtn.evaluate((el) => el.classList.contains('active')),
      '24: Italic button becomes active when caret is inside existing <em> text'
    );

    // Click outside
    const p = detailsRich.locator('p').first();
    await p.click();
    await page.keyboard.press('End');
    await page.waitForTimeout(50);

    check(
      !(await italicBtn.evaluate((el) => el.classList.contains('active'))),
      '24: Italic button becomes inactive when caret moves outside <em> text'
    );

    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 25. No empty formatting elements corrupting round-trip: create bold typing state,
  //     click away without typing, switch to Markdown and back, verify no empty ****.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG no empty formatting corruption ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();

    // Click Bold to activate typing state (no text yet)
    const boldBtn = page.locator('.markdown-toolbar-btn[data-action="bold"]');
    await boldBtn.click();

    // Type some regular text and then click Bold again to deactivate (without typing in bold)
    await page.keyboard.type('plain ');
    await boldBtn.click();
    await page.keyboard.type('also plain');

    // Switch to Markdown and back to trigger serialization
    await modeMarkdownLabel.click();
    const md25 = await getMarkdownValue();
    check(
      !md25.includes('****'),
      `25: no empty or malformed ****, got: ${md25}`
    );
    check(
      !md25.match(/\*\*\s*\*\*/),
      `25: no empty bold markers, got: ${md25}`
    );

    await modeWysiwygLabel.click();
    const textAfter = (await detailsRich.innerText()).replace(/ /g, ' ');
    check(
      textAfter.includes('plain also plain'),
      `25: text round-trips correctly, got: ${textAfter}`
    );

    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 26. Aggressive toggle sequence 1: plain -> bold -> bold+italic -> italic -> plain
  //     (D-012 regression: malformed Markdown markers from overlapping formatting).
  //     Verify serialization produces valid, correctly-marked Markdown with no unmatched
  //     asterisks, and that round-tripping back produces identical Markdown.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG aggressive toggle 1: plain-bold-both-italic-plain ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();

    // Start with plain text
    await page.keyboard.type('text');

    // Toggle bold ON
    const boldBtn = page.locator('.markdown-toolbar-btn[data-action="bold"]');
    await boldBtn.click();

    // Type more text (now bold)
    await page.keyboard.type(' bold');

    // Toggle italic ON (now bold+italic)
    const italicBtn = page.locator('.markdown-toolbar-btn[data-action="italic"]');
    await italicBtn.click();

    // Type more text (now bold+italic)
    await page.keyboard.type(' both');

    // Toggle bold OFF (now italic only)
    await boldBtn.click();

    // Type more text (now italic only)
    await page.keyboard.type(' italic');

    // Toggle italic OFF (back to plain)
    await italicBtn.click();

    // Type final plain text
    await page.keyboard.type(' plain');

    // Switch to Markdown and verify markers are valid
    await modeMarkdownLabel.click();
    const md26 = await getMarkdownValue();

    // Check for unmatched asterisks (most critical: count must be even)
    const asteriskCount = (md26.match(/\*/g) || []).length;
    check(
      asteriskCount % 2 === 0,
      `26: no unmatched asterisks in Markdown output (even count), got: ${md26}`
    );
    // Also verify no 4+ asterisks in a row (which would indicate doubled markers)
    check(
      !md26.match(/\*{4,}/),
      `26: no quadruple asterisks or worse indicating doubled markers, got: ${md26}`
    );

    // Round-trip: WYSIWYG -> Markdown -> WYSIWYG -> Markdown and verify stability
    await modeWysiwygLabel.click();
    await modeMarkdownLabel.click();
    const md26after = await getMarkdownValue();
    check(
      md26 === md26after,
      `26: round-trip produces identical Markdown (stable), first: ${md26}, after: ${md26after}`
    );

    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 27. Aggressive toggle sequence 2: italic -> bold+italic -> bold -> plain
  //     (D-012 regression: different ordering of the toggle sequence).
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG aggressive toggle 2: italic-both-bold-plain ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();

    // Start with plain text
    await page.keyboard.type('text');

    // Toggle italic ON
    const italicBtn = page.locator('.markdown-toolbar-btn[data-action="italic"]');
    await italicBtn.click();

    // Type text (italic)
    await page.keyboard.type(' italic');

    // Toggle bold ON (now bold+italic)
    const boldBtn = page.locator('.markdown-toolbar-btn[data-action="bold"]');
    await boldBtn.click();

    // Type text (bold+italic)
    await page.keyboard.type(' both');

    // Toggle italic OFF (now bold only)
    await italicBtn.click();

    // Type text (bold)
    await page.keyboard.type(' bold');

    // Toggle bold OFF (plain)
    await boldBtn.click();

    // Type final text (plain)
    await page.keyboard.type(' plain');

    // Verify Markdown validity
    await modeMarkdownLabel.click();
    const md27 = await getMarkdownValue();

    const asteriskCount27 = (md27.match(/\*/g) || []).length;
    check(
      asteriskCount27 % 2 === 0,
      `27: no unmatched asterisks in Markdown output (even count), got: ${md27}`
    );
    check(
      !md27.match(/\*{4,}/),
      `27: no quadruple asterisks or doubled markers, got: ${md27}`
    );

    // Round-trip stability
    await modeWysiwygLabel.click();
    await modeMarkdownLabel.click();
    const md27after = await getMarkdownValue();
    check(
      md27 === md27after,
      `27: round-trip produces identical Markdown (stable), first: ${md27}, after: ${md27after}`
    );

    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 28. Toggle bold/italic multiple times inside the same word (D-012 regression).
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG aggressive toggle 3: toggle within word ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();

    // Type a word, then toggle formatting multiple times within it
    await page.keyboard.type('wo');
    const boldBtn = page.locator('.markdown-toolbar-btn[data-action="bold"]');
    await boldBtn.click();
    await page.keyboard.type('rd');
    await boldBtn.click();
    const italicBtn = page.locator('.markdown-toolbar-btn[data-action="italic"]');
    await italicBtn.click();
    await page.keyboard.type('test');
    await italicBtn.click();

    await modeMarkdownLabel.click();
    const md28 = await getMarkdownValue();

    // Verify valid markers (no unmatched asterisks, no malformed markers)
    const asteriskCount28 = (md28.match(/\*/g) || []).length;
    check(
      asteriskCount28 % 2 === 0,
      `28: no unmatched asterisks (even count), got: ${md28}`
    );
    check(
      !md28.match(/\*{4,}/),
      `28: no quadruple asterisks or doubled markers, got: ${md28}`
    );

    // Round-trip stability
    await modeWysiwygLabel.click();
    await modeMarkdownLabel.click();
    const md28after = await getMarkdownValue();
    check(
      md28 === md28after,
      `28: round-trip produces identical Markdown (stable), first: ${md28}, after: ${md28after}`
    );

    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 29. Overlapping bold+italic (D-013 regression): typing bold+italic text via the toolbar
  //     produces genuinely nested <strong>/<em> DOM (one wraps the other around the same text),
  //     not two disjoint elements, and this survives a Markdown round-trip using the nesting-aware
  //     encoding (bold as **, italic as _ so a close/reopen sequence is never ambiguous).
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG nested bold+italic structure ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();
    const boldBtn = page.locator('.markdown-toolbar-btn[data-action="bold"]');
    const italicBtn = page.locator('.markdown-toolbar-btn[data-action="italic"]');
    await boldBtn.click();
    await italicBtn.click();
    await page.keyboard.type('both');
    const nestedCount = await detailsRich.evaluate((el) => {
      const strongInEm = el.querySelectorAll('em > strong, em strong').length;
      const emInStrong = el.querySelectorAll('strong > em, strong em').length;
      return strongInEm + emInStrong;
    });
    check(nestedCount >= 1, '29: bold+italic produces genuinely nested <strong>/<em> DOM, not disjoint elements');

    await modeMarkdownLabel.click();
    const md29 = await getMarkdownValue();
    check(
      /\*\*_both_\*\*|_\*\*both\*\*_/.test(md29),
      `29: bold+italic serializes using distinct delimiters for each mark (** for bold, _ for italic), got: ${md29}`
    );
    await modeWysiwygLabel.click();
    const strongText = await detailsRich.locator('strong').innerText();
    const emText = await detailsRich.locator('em').innerText();
    check(strongText === 'both' && emText === 'both', `29: round-trip preserves both marks on the same text, strong="${strongText}" em="${emText}"`);
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 30. Toggling one mark off inside an existing bold+italic *selection* (the originally reported
  //     bug): select part of an existing bold+italic range and click Bold -- the selected part
  //     must lose bold but keep italic; the untouched part of the original range must keep both.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG toggle mark off inside overlap selection ${randomUUID()}`);
    await setMarkdownValue('**_bold italic text_**');
    await modeWysiwygLabel.click();
    check((await detailsRich.locator('strong em, em strong').count()) >= 1, '30: initial bold+italic text renders as nested <strong>/<em>');

    // Select the word "italic" inside the bold+italic text and toggle Bold off on just that word.
    const emText = detailsRich.locator('strong em, em strong').first();
    await emText.click();
    await page.keyboard.press('Home');
    for (let i = 0; i < 'bold '.length; i += 1) await page.keyboard.press('ArrowRight');
    await page.keyboard.down('Shift');
    for (let i = 0; i < 'italic'.length; i += 1) await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Shift');
    await page.locator('.markdown-toolbar-btn[data-action="bold"]').click();

    // Verify via re-rendered WYSIWYG DOM structure rather than raw Markdown string matching --
    // there is more than one valid way to encode the same marks (e.g. how the surrounding
    // still-both-marked segments regroup their <strong>/<em> wrapping), so what matters is the
    // actual mark set applied to each word, not one specific literal marker arrangement.
    await modeMarkdownLabel.click();
    const md30 = await getMarkdownValue();
    await modeWysiwygLabel.click();
    const markState = await detailsRich.evaluate((el) => {
      const hasAncestor = (node, tag) => {
        let n = node;
        while (n) {
          if (n.nodeType === 1 && n.tagName.toLowerCase() === tag) return true;
          n = n.parentNode;
        }
        return false;
      };
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const words = { bold: null, italic: null, text: null };
      let node;
      while ((node = walker.nextNode())) {
        const t = node.textContent.trim();
        if (t === 'bold') words.bold = { strong: hasAncestor(node, 'strong'), em: hasAncestor(node, 'em') };
        else if (t === 'italic') words.italic = { strong: hasAncestor(node, 'strong'), em: hasAncestor(node, 'em') };
        else if (t === 'text') words.text = { strong: hasAncestor(node, 'strong'), em: hasAncestor(node, 'em') };
      }
      return words;
    });
    check(
      markState.bold?.strong === true && markState.bold?.em === true,
      `30: the untouched leading word keeps both bold and italic, got: ${JSON.stringify(markState.bold)}, markdown: ${md30}`
    );
    check(
      markState.italic?.strong === false && markState.italic?.em === true,
      `30: toggling Bold off on the selected word keeps italic and removes only bold, got: ${JSON.stringify(markState.italic)}, markdown: ${md30}`
    );
    check(
      markState.text?.strong === true && markState.text?.em === true,
      `30: the untouched trailing word keeps both bold and italic, got: ${JSON.stringify(markState.text)}, markdown: ${md30}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 31. Read-only task-card preview renders the same nested bold+italic formatting as the
  //     WYSIWYG editor's initial Rich-mode render, for Markdown containing genuine overlap.
  // ---------------------------------------------------------------------------
  {
    const title = `Task-card preview nested formatting ${randomUUID()}`;
    await addTask(title);
    await rowFor(title).locator('.task-text').click();
    await overlay.waitFor({ state: 'visible' });
    await setMarkdownValue('**_bold and italic_** plain *legacy italic*');
    await page.locator('#save-edit').click();
    await overlay.waitFor({ state: 'hidden' });

    const row = rowFor(title);
    await row.locator('.expand-btn').click();
    const details = row.locator('.task-details');
    await details.waitFor({ state: 'visible' });
    const nestedInPreview = await details.evaluate((el) => el.querySelectorAll('strong em, em strong').length);
    check(nestedInPreview >= 1, '31: task-card preview renders bold+italic overlap as nested <strong>/<em>, matching the editor');
    const legacyEm = await details.locator('em').last().innerText();
    check(legacyEm === 'legacy italic', `31: legacy single-star italic still renders correctly in the preview, got: ${legacyEm}`);
  }

  // ---------------------------------------------------------------------------
  // 32. Markdown-mode toolbar: the same shared toolbar (`.markdown-toolbar-btn`) now also drives
  //     CodeMirror transactions in Markdown mode (src/renderer/markdownEditorCommands.ts), never
  //     DOM manipulation of the CodeMirror content. Covers the acceptance scenarios from the task
  //     spec: bold selection toggle, bold at an empty caret, heading switch/removal, multiline
  //     bullet/todo toggle, and undo/redo as a single transaction per click.
  // ---------------------------------------------------------------------------
  {
    const boldBtn = page.locator('.markdown-toolbar-btn[data-action="bold"]');

    await openTask(`Markdown toolbar bold selection toggle ${randomUUID()}`);
    await modeMarkdownLabel.click();
    await setMarkdownValue('foo');
    await detailsEditorContent.click();
    await page.keyboard.press(selectAllKey);
    await boldBtn.click();
    check((await getMarkdownValue()) === '**foo**', `32: Markdown toolbar Bold wraps a selection, got: ${await getMarkdownValue()}`);
    await page.keyboard.press(selectAllKey);
    await boldBtn.click();
    check((await getMarkdownValue()) === 'foo', `32: Markdown toolbar Bold unwraps an already-bold selection, got: ${await getMarkdownValue()}`);
    await closeModal();
  }

  {
    const boldBtn = page.locator('.markdown-toolbar-btn[data-action="bold"]');
    await openTask(`Markdown toolbar bold empty caret ${randomUUID()}`);
    await modeMarkdownLabel.click();
    await setMarkdownValue('');
    await detailsEditorContent.click();
    await boldBtn.click();
    check((await getMarkdownValue()) === '****', `32: Markdown toolbar Bold at an empty caret inserts marker pair, got: ${await getMarkdownValue()}`);
    await page.keyboard.type('hello');
    check((await getMarkdownValue()) === '**hello**', `32: typing after empty-caret Bold lands between the markers, got: ${await getMarkdownValue()}`);
    await closeModal();
  }

  {
    const h1Btn = page.locator('.markdown-toolbar-btn[data-action="h1"]');
    const h2Btn = page.locator('.markdown-toolbar-btn[data-action="h2"]');
    await openTask(`Markdown toolbar heading switch ${randomUUID()}`);
    await modeMarkdownLabel.click();
    await setMarkdownValue('Hello world');
    await detailsEditorContent.click();
    await h1Btn.click();
    check((await getMarkdownValue()) === '# Hello world', `32: Markdown toolbar H1 prefixes the line, got: ${await getMarkdownValue()}`);
    await h2Btn.click();
    check((await getMarkdownValue()) === '## Hello world', `32: Markdown toolbar H2 replaces H1's prefix (never stacks), got: ${await getMarkdownValue()}`);
    await h2Btn.click();
    check((await getMarkdownValue()) === 'Hello world', `32: clicking the active heading level again removes it, got: ${await getMarkdownValue()}`);
    await closeModal();
  }

  {
    const bulletBtn = page.locator('.markdown-toolbar-btn[data-action="bullet"]');
    await openTask(`Markdown toolbar multiline bullet toggle ${randomUUID()}`);
    await modeMarkdownLabel.click();
    await setMarkdownValue('foo\nbar\nbaz');
    await detailsEditorContent.click();
    await page.keyboard.press(selectAllKey);
    await bulletBtn.click();
    check(
      (await getMarkdownValue()) === '- foo\n- bar\n- baz',
      `32: Markdown toolbar bullet prefixes every selected line, got: ${await getMarkdownValue()}`
    );
    await page.keyboard.press(selectAllKey);
    await bulletBtn.click();
    check(
      (await getMarkdownValue()) === 'foo\nbar\nbaz',
      `32: Markdown toolbar bullet toggles off when every selected line is already a bullet, got: ${await getMarkdownValue()}`
    );
    await closeModal();
  }

  {
    const taskBtn = page.locator('.markdown-toolbar-btn[data-action="task"]');
    await openTask(`Markdown toolbar multiline todo ${randomUUID()}`);
    await modeMarkdownLabel.click();
    await setMarkdownValue('foo\nbar');
    await detailsEditorContent.click();
    await page.keyboard.press(selectAllKey);
    await taskBtn.click();
    check(
      (await getMarkdownValue()) === '- [ ] foo\n- [ ] bar',
      `32: Markdown toolbar Todo prefixes every selected line, got: ${await getMarkdownValue()}`
    );
    await closeModal();
  }

  {
    const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
    const redoKey = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y';
    const boldBtn = page.locator('.markdown-toolbar-btn[data-action="bold"]');
    await openTask(`Markdown toolbar undo redo single step ${randomUUID()}`);
    await modeMarkdownLabel.click();
    await setMarkdownValue('foo');
    await detailsEditorContent.click();
    await page.keyboard.press(selectAllKey);
    await boldBtn.click();
    check((await getMarkdownValue()) === '**foo**', `32: pre-undo state is bold, got: ${await getMarkdownValue()}`);
    await page.keyboard.press(undoKey);
    check((await getMarkdownValue()) === 'foo', `32: a single Undo fully reverts the toolbar Bold click, got: ${await getMarkdownValue()}`);
    await page.keyboard.press(redoKey);
    check((await getMarkdownValue()) === '**foo**', `32: Redo restores the toolbar Bold click, got: ${await getMarkdownValue()}`);
    await closeModal();
  }

  {
    const boldBtn = page.locator('.markdown-toolbar-btn[data-action="bold"]');
    await openTask(`Markdown toolbar mode switch round-trip ${randomUUID()}`);
    await modeMarkdownLabel.click();
    await setMarkdownValue('foo');
    await detailsEditorContent.click();
    await page.keyboard.press(selectAllKey);
    await boldBtn.click();
    check((await getMarkdownValue()) === '**foo**', `32: formatted via Markdown toolbar before mode switch, got: ${await getMarkdownValue()}`);
    await modeWysiwygLabel.click();
    await detailsRich.waitFor({ state: 'visible' });
    check((await detailsRich.locator('strong').innerText()) === 'foo', '32: WYSIWYG renders the Markdown-toolbar-produced bold text');
    await modeMarkdownLabel.click();
    await detailsTextarea.waitFor({ state: 'visible' });
    check(
      (await getMarkdownValue()) === '**foo**',
      `32: switching back to Markdown preserves the CodeMirror source unchanged, got: ${await getMarkdownValue()}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 33. Markdown-mode toolbar Inline Code: wraps/unwraps a selection in single backticks, and
  //     inserts an empty backtick pair with the caret between them at an empty caret (distinct
  //     from Code Block's triple-backtick fence -- see 34).
  // ---------------------------------------------------------------------------
  {
    const codeBtn = page.locator('.markdown-toolbar-btn[data-action="code"]');
    await openTask(`Markdown toolbar inline code selection toggle ${randomUUID()}`);
    await modeMarkdownLabel.click();
    await setMarkdownValue('foo');
    await detailsEditorContent.click();
    await page.keyboard.press(selectAllKey);
    await codeBtn.click();
    check((await getMarkdownValue()) === '`foo`', `33: Markdown toolbar Inline Code wraps a selection, got: ${await getMarkdownValue()}`);
    await page.keyboard.press(selectAllKey);
    await codeBtn.click();
    check((await getMarkdownValue()) === 'foo', `33: Markdown toolbar Inline Code unwraps an already-coded selection, got: ${await getMarkdownValue()}`);
    await closeModal();
  }

  {
    const codeBtn = page.locator('.markdown-toolbar-btn[data-action="code"]');
    await openTask(`Markdown toolbar inline code empty caret ${randomUUID()}`);
    await modeMarkdownLabel.click();
    await setMarkdownValue('');
    await detailsEditorContent.click();
    await codeBtn.click();
    check((await getMarkdownValue()) === '``', `33: Markdown toolbar Inline Code at an empty caret inserts a backtick pair, got: ${await getMarkdownValue()}`);
    await page.keyboard.type('x');
    check((await getMarkdownValue()) === '`x`', `33: typing after empty-caret Inline Code lands between the backticks, got: ${await getMarkdownValue()}`);
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 34. Markdown-mode toolbar Code Block: fences the current line(s) in triple backticks and
  //     unfences on a second click -- a distinct command from Inline Code (33), never reusing its
  //     single-backtick marker.
  // ---------------------------------------------------------------------------
  {
    const codeBlockBtn = page.locator('.markdown-toolbar-btn[data-action="codeblock"]');
    await openTask(`Markdown toolbar code block toggle ${randomUUID()}`);
    await modeMarkdownLabel.click();
    await setMarkdownValue('foo');
    await detailsEditorContent.click();
    await codeBlockBtn.click();
    check(
      (await getMarkdownValue()) === '```\nfoo\n```',
      `34: Markdown toolbar Code Block fences the current line in triple backticks, got: ${await getMarkdownValue()}`
    );
    await codeBlockBtn.click();
    check((await getMarkdownValue()) === 'foo', `34: Markdown toolbar Code Block un-fences on a second click, got: ${await getMarkdownValue()}`);
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 35. Markdown-mode toolbar Blockquote: prefixes every selected line with "> " and toggles off,
  //     a distinct block-level command from Code Block (34).
  // ---------------------------------------------------------------------------
  {
    const blockquoteBtn = page.locator('.markdown-toolbar-btn[data-action="blockquote"]');
    await openTask(`Markdown toolbar blockquote toggle ${randomUUID()}`);
    await modeMarkdownLabel.click();
    await setMarkdownValue('foo\nbar');
    await detailsEditorContent.click();
    await page.keyboard.press(selectAllKey);
    await blockquoteBtn.click();
    check(
      (await getMarkdownValue()) === '> foo\n> bar',
      `35: Markdown toolbar Blockquote prefixes every selected line with "> ", got: ${await getMarkdownValue()}`
    );
    await page.keyboard.press(selectAllKey);
    await blockquoteBtn.click();
    check(
      (await getMarkdownValue()) === 'foo\nbar',
      `35: Markdown toolbar Blockquote toggles off when every selected line is already quoted, got: ${await getMarkdownValue()}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 36. WYSIWYG Inline Code: toolbar wraps a selection in a real inline <code> element (monospace,
  //     inline, not a block), independent of Bold -- applying both marks nests them rather than
  //     one clobbering the other -- and never produces a Code Block <pre>.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG inline code selection ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();
    await page.keyboard.type('plain text');
    await page.keyboard.down('Shift');
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowLeft');
    await page.keyboard.up('Shift');
    await page.locator('.markdown-toolbar-btn[data-action="code"]').click();
    check((await detailsRich.locator('code').innerText()) === 'text', '36: toolbar Inline Code wraps the current selection in <code>');
    check((await detailsRich.locator('pre').count()) === 0, '36: Inline Code never produces a Code Block <pre>');
    await modeMarkdownLabel.click();
    check((await getMarkdownValue()) === 'plain `text`', `36: toolbar Inline Code round-trips to Markdown, got: ${await getMarkdownValue()}`);
    await closeModal();
  }

  {
    // Inline Code and Bold are independent *commands* (clicking one never secretly toggles or
    // clobbers the other's own selection/state) -- not that a single run of text can carry both
    // marks at once, which Markdown itself doesn't support (a code span's content is always raw,
    // verbatim text, so this app's serializer correctly treats <code> as a terminal leaf that
    // never recurses into/emits nested <strong>/<em>).
    await openTask(`WYSIWYG inline code independent of bold ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();
    await page.keyboard.type('alpha beta');
    await page.keyboard.press('Home');
    await page.keyboard.down('Shift');
    for (let i = 0; i < 'alpha'.length; i += 1) await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Shift');
    await page.locator('.markdown-toolbar-btn[data-action="bold"]').click();
    check((await detailsRich.locator('strong').innerText()) === 'alpha', '36: Bold applies to its own selection');
    check((await detailsRich.locator('code').count()) === 0, '36: clicking Bold does not also apply Inline Code');

    await page.keyboard.press('End');
    await page.keyboard.down('Shift');
    for (let i = 0; i < 'beta'.length; i += 1) await page.keyboard.press('ArrowLeft');
    await page.keyboard.up('Shift');
    await page.locator('.markdown-toolbar-btn[data-action="code"]').click();
    check((await detailsRich.locator('code').innerText()) === 'beta', '36: Inline Code applies to its own selection');
    check((await detailsRich.locator('strong').innerText()) === 'alpha', '36: applying Inline Code elsewhere leaves the existing Bold mark untouched');
    check((await detailsRich.locator('pre').count()) === 0, '36: Inline Code never accidentally produces a Code Block');

    await modeMarkdownLabel.click();
    const md36 = await getMarkdownValue();
    check(md36 === '**alpha** `beta`', `36: independent Bold and Inline Code marks both round-trip correctly, got: ${md36}`);
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 37. WYSIWYG Code Block: toolbar converts the current paragraph into a <pre><code> block,
  //     Enter inside it inserts another line in the same block (never splits into a new
  //     paragraph/second block), and it round-trips to a fenced Markdown block.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG code block toolbar ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();
    await page.keyboard.type('line one');
    await page.locator('.markdown-toolbar-btn[data-action="codeblock"]').click();
    check((await detailsRich.locator('pre code').innerText()) === 'line one', '37: toolbar Code Block converts the paragraph into <pre><code>');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('line two');
    check((await detailsRich.locator('pre').count()) === 1, '37: Enter inside a Code Block stays inside the same <pre> (no second block)');
    const codeText = await detailsRich.locator('pre code').innerText();
    check(codeText.includes('line one') && codeText.includes('line two'), `37: Enter inside Code Block adds another line, got: ${codeText}`);
    await modeMarkdownLabel.click();
    const md37 = await getMarkdownValue();
    check(
      md37 === '```\nline one\nline two\n```',
      `37: Code Block round-trips to a fenced Markdown block preserving both lines, got: ${md37}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 38. WYSIWYG Blockquote: toolbar converts the current paragraph into a <blockquote>, a
  //     distinct block-level command from Code Block (37), and round-trips to "> text".
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG blockquote toolbar ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();
    await page.keyboard.type('quoted text');
    await page.locator('.markdown-toolbar-btn[data-action="blockquote"]').click();
    check((await detailsRich.locator('blockquote p').innerText()) === 'quoted text', '38: toolbar Blockquote converts the paragraph into <blockquote>');
    check((await detailsRich.locator('pre').count()) === 0, '38: Blockquote never produces a Code Block <pre>');
    await modeMarkdownLabel.click();
    const md38 = await getMarkdownValue();
    check(md38 === '> quoted text', `38: Blockquote round-trips to Markdown as "> quoted text", got: ${md38}`);
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 39. Mixed-document round-trip: a document combining heading, bold, italic, inline code,
  //     blockquote, fenced code block, bullet list and todo list must round-trip through
  //     Markdown -> WYSIWYG -> Markdown byte-for-byte, without regressing any existing formatting.
  // ---------------------------------------------------------------------------
  {
    const mixedLines = [
      '# Heading',
      'Some **bold** and _italic_ and `code` text.',
      '',
      '> A quote',
      '',
      '```',
      'fenced code',
      'line two',
      '```',
      '',
      '- bullet item',
      '- [ ] todo item',
    ];
    const mixedMd = mixedLines.join('\n');

    await openTask(`Mixed document round-trip ${randomUUID()}`);
    // page.keyboard.insertText (unlike setMarkdownValue's character-by-character .type()) inserts
    // the whole string as one bulk input without dispatching per-character keydown events, so
    // CodeMirror's markdown-mode Enter keymap (which auto-continues blockquote/list prefixes onto
    // the next line as a convenience while *typing*) never fires and can't mutate this literal
    // fixture text -- only real user keystrokes are meant to get that continuation behavior.
    await detailsEditorContent.click();
    await page.keyboard.press(selectAllKey);
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(mixedMd);
    await modeWysiwygLabel.click();
    await detailsRich.waitFor({ state: 'visible' });

    check((await detailsRich.locator('h1').innerText()) === 'Heading', '39: heading renders correctly in the mixed document');
    check((await detailsRich.locator('strong').innerText()) === 'bold', '39: bold renders correctly in the mixed document');
    check((await detailsRich.locator('em').innerText()) === 'italic', '39: italic renders correctly in the mixed document');
    check((await detailsRich.locator('p code').innerText()) === 'code', '39: inline code renders correctly in the mixed document');
    check((await detailsRich.locator('blockquote p').innerText()) === 'A quote', '39: blockquote renders correctly in the mixed document');
    const mixedCodeBlockText = await detailsRich.locator('pre code').innerText();
    check(
      mixedCodeBlockText.includes('fenced code') && mixedCodeBlockText.includes('line two'),
      `39: fenced code block renders correctly in the mixed document, got: ${mixedCodeBlockText}`
    );
    check((await detailsRich.locator('ul[data-list-type="bullet"] li').innerText()) === 'bullet item', '39: bullet list renders correctly in the mixed document');
    check((await detailsRich.locator('ul[data-list-type="task"] li').innerText()).includes('todo item'), '39: todo list renders correctly in the mixed document');

    await modeMarkdownLabel.click();
    await detailsTextarea.waitFor({ state: 'visible' });
    const md39 = await getMarkdownValue();
    check(md39 === mixedMd, `39: mixed document round-trips through WYSIWYG byte-for-byte, got: ${md39}`);
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 40. D-001 Regression: Fenced code block round-trip must not lose content.
  //     Input: "```\nfoo\n```" -> WYSIWYG -> Markdown should produce identical output.
  // ---------------------------------------------------------------------------
  {
    await openTask(`D-001: Fenced code block round-trip ${randomUUID()}`);
    await setMarkdownValue('```\nfoo\n```');
    await modeWysiwygLabel.click();
    await detailsRich.waitFor({ state: 'visible' });
    check(
      (await detailsRich.locator('pre code').count()) === 1,
      '40: fenced code block parses correctly in WYSIWYG'
    );
    const codeContent = await detailsRich.locator('pre code').innerText();
    check(
      codeContent === 'foo',
      `40: fenced code content is correct, got: ${codeContent}`
    );
    await modeMarkdownLabel.click();
    const md40 = await getMarkdownValue();
    check(
      md40 === '```\nfoo\n```',
      `40: fenced code block round-trips correctly without losing content, got: ${md40}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 41. D-002 Regression: Code Block toolbar produces properly separated multiline structure.
  //     Selecting text and clicking Code Block should wrap it as:
  //     ```
  //     selected text
  //     ```
  //     (not collapsed into a single line like ```selected text```)
  // ---------------------------------------------------------------------------
  {
    await openTask(`D-002: Code Block toolbar multiline structure ${randomUUID()}`);
    await modeMarkdownLabel.click();
    await setMarkdownValue('foo bar');
    await detailsEditorContent.click();
    await page.keyboard.press(selectAllKey);
    const codeBlockBtn = page.locator('.markdown-toolbar-btn[data-action="codeblock"]');
    await codeBlockBtn.click();
    const md41 = await getMarkdownValue();
    check(
      md41 === '```\nfoo bar\n```',
      `41: Code Block toolbar produces multiline structure with proper fences, got: ${md41}`
    );
    // Verify round-trip through WYSIWYG
    await modeWysiwygLabel.click();
    check(
      (await detailsRich.locator('pre code').innerText()) === 'foo bar',
      '41: multiline fenced block round-trips through WYSIWYG correctly'
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 42. D-003/D-004 Regression: Single-line triple-backtick input (```foo```) must not lose text.
  //     This is now correctly recognized as valid inline code with 3-backtick delimiters
  //     (not a fenced code block, which requires newlines). Content must round-trip
  //     without loss, using either the original delimiter form or a safe equivalent.
  // ---------------------------------------------------------------------------
  {
    await openTask(`D-003: Single-line backtick now valid inline code ${randomUUID()}`);
    await setMarkdownValue('```foo```');
    await modeWysiwygLabel.click();
    // Since "```foo```" is valid inline code (not a fenced block which requires newlines),
    // it should render as <code>, not <pre>.
    const codeBlockCount = await detailsRich.locator('pre').count();
    const inlineCodeCount = await detailsRich.locator('code').count();
    check(
      codeBlockCount === 0,
      '42: single-line triple-backtick is not parsed as a code block (pre), count: ' + codeBlockCount
    );
    check(
      inlineCodeCount === 1,
      '42: single-line triple-backtick is recognized as inline code (code element), count: ' + inlineCodeCount
    );
    // The content should be preserved as inline code
    const codeText = await detailsRich.locator('code').innerText();
    check(
      codeText === 'foo',
      `42: inline code content "foo" is preserved correctly, got: "${codeText}"`
    );
    await modeMarkdownLabel.click();
    const md42 = await getMarkdownValue();
    // Content must round-trip without loss; inline code can use 1 or more backticks
    // as long as opening/closing counts match (either ```foo``` or `foo` is valid)
    check(
      (md42 === '```foo```' || md42 === '`foo`'),
      '42: inline code round-trips using valid delimiter form (backtick or original), got: ' + md42
    );
    check(
      md42.includes('foo'),
      '42: inline code content is not lost, got: ' + md42
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 43. D-003 Regression (inline code): Verify that inline code (`foo`) is NOT regressed
  //     by the fixes to fence detection -- inline backticks remain distinct from fenced blocks.
  // ---------------------------------------------------------------------------
  {
    await openTask(`D-003: Inline code distinct from fenced blocks ${randomUUID()}`);
    await setMarkdownValue('Text with `inline code` and a paragraph.');
    await modeWysiwygLabel.click();
    const inlineCodeCount = await detailsRich.locator('code').count();
    const preBlockCount = await detailsRich.locator('pre').count();
    check(
      inlineCodeCount === 1 && preBlockCount === 0,
      `43: inline code renders as <code>, not as a code block <pre>, inline count: ${inlineCodeCount}, pre count: ${preBlockCount}`
    );
    const codeText = await detailsRich.locator('code').innerText();
    check(
      codeText === 'inline code',
      `43: inline code content is correct, got: ${codeText}`
    );
    await modeMarkdownLabel.click();
    const md43 = await getMarkdownValue();
    check(
      md43 === 'Text with `inline code` and a paragraph.',
      `43: inline code round-trips correctly, got: ${md43}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 44. D-004/D-005 Regression: Multi-backtick inline code -- single-line spans with
  //     2 or 3 matching backtick delimiters (``foo`` or ```foo```) must be recognized as
  //     inline code, not misclassified as malformed fences or treated as literal text.
  // ---------------------------------------------------------------------------
  {
    await openTask(`D-004/D-005: Double-backtick inline code ${randomUUID()}`);
    await setMarkdownValue('Text with ``double backtick code`` and more.');
    await modeWysiwygLabel.click();
    const codeCount = await detailsRich.locator('code').count();
    const preCount = await detailsRich.locator('pre').count();
    check(
      codeCount === 1 && preCount === 0,
      `44: double-backtick inline code renders as <code>, not <pre>, code count: ${codeCount}, pre count: ${preCount}`
    );
    const codeText = await detailsRich.locator('code').innerText();
    check(
      codeText === 'double backtick code',
      `44: double-backtick inline code content is correct, got: "${codeText}"`
    );
    await modeMarkdownLabel.click();
    const md44 = await getMarkdownValue();
    // Inline code can use 1 or more backticks; serializer uses canonical form (1 backtick)
    check(
      md44 === 'Text with `double backtick code` and more.',
      `44: double-backtick inline code round-trips as canonical form, got: ${md44}`
    );
    check(
      md44.includes('double backtick code'),
      `44: double-backtick content is preserved, got: ${md44}`
    );
    await closeModal();
  }

  {
    await openTask(`D-004/D-005: Triple-backtick inline code ${randomUUID()}`);
    await setMarkdownValue('Text with ```triple backtick code``` and more.');
    await modeWysiwygLabel.click();
    const codeCount = await detailsRich.locator('code').count();
    const preCount = await detailsRich.locator('pre').count();
    check(
      codeCount === 1 && preCount === 0,
      `44b: triple-backtick inline code renders as <code>, not <pre>, code count: ${codeCount}, pre count: ${preCount}`
    );
    const codeText = await detailsRich.locator('code').innerText();
    check(
      codeText === 'triple backtick code',
      `44b: triple-backtick inline code content is correct, got: "${codeText}"`
    );
    await modeMarkdownLabel.click();
    const md44b = await getMarkdownValue();
    // Inline code serializes as canonical form (1 backtick)
    check(
      md44b === 'Text with `triple backtick code` and more.',
      `44b: triple-backtick inline code round-trips as canonical form, got: ${md44b}`
    );
    check(
      md44b.includes('triple backtick code'),
      `44b: triple-backtick content is preserved, got: ${md44b}`
    );
    await closeModal();
  }

  {
    await openTask(`D-004/D-005: Mixed inline codes in one line ${randomUUID()}`);
    await setMarkdownValue('Single `code` double ``code`` triple ```code``` all inline.');
    await modeWysiwygLabel.click();
    const codeCount = await detailsRich.locator('code').count();
    check(
      codeCount === 3,
      `44c: mixed backtick lengths all render as <code>, count: ${codeCount}`
    );
    const codePieces = await detailsRich.locator('code').allTextContents();
    check(
      codePieces.length === 3 && codePieces[0] === 'code' && codePieces[1] === 'code' && codePieces[2] === 'code',
      `44c: all inline code pieces are correctly parsed, got: ${JSON.stringify(codePieces)}`
    );
    await modeMarkdownLabel.click();
    const md44c = await getMarkdownValue();
    // All inline codes serialize as canonical form (single backtick)
    check(
      md44c === 'Single `code` double `code` triple `code` all inline.',
      `44c: mixed inline codes round-trip with canonical delimiters, got: ${md44c}`
    );
    check(
      (md44c.match(/`code`/g) || []).length === 3,
      `44c: all three code pieces are preserved, got: ${md44c}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 45. D-004/D-005 Regression: Verify fenced code blocks still work correctly
  //     (with newlines separating fence from content) and are not confused with
  //     single-line triple-backtick inline code.
  // ---------------------------------------------------------------------------
  {
    await openTask(`D-004/D-005: Fenced blocks not confused with inline triple-backticks ${randomUUID()}`);
    await setMarkdownValue('```\nmultiline\ncode\n```');
    await modeWysiwygLabel.click();
    const preCount = await detailsRich.locator('pre').count();
    const codeCount = await detailsRich.locator('p code').count();
    check(
      preCount === 1 && codeCount === 0,
      `45: fenced code block (with newlines) renders as <pre>, not as inline <code>, pre count: ${preCount}, inline count: ${codeCount}`
    );
    const blockText = await detailsRich.locator('pre code').innerText();
    check(
      blockText.includes('multiline') && blockText.includes('code'),
      `45: fenced code block content is correct, got: "${blockText}"`
    );
    await modeMarkdownLabel.click();
    const md45 = await getMarkdownValue();
    check(
      md45 === '```\nmultiline\ncode\n```',
      `45: fenced code block round-trips correctly, got: ${md45}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 46. D-006 Regression: Markdown-mode toolbar Blockquote cursor placement.
  //     After clicking blockquote on an empty editor, cursor should be AFTER the
  //     inserted `> ` (e.g., `> |` with cursor after the space), not before it (`|>`).
  //     Subsequent typing should continue after the blockquote prefix.
  // ---------------------------------------------------------------------------
  {
    await openTask(`D-006: Markdown blockquote empty editor cursor placement ${randomUUID()}`);
    await modeMarkdownLabel.click();
    // Clear any existing content
    await setMarkdownValue('');
    await detailsEditorContent.click();
    // Click blockquote button with empty editor
    await page.locator('.markdown-toolbar-btn[data-action="blockquote"]').click();
    // Type text to verify cursor is after the prefix
    await page.keyboard.type('text');
    const md46 = await getMarkdownValue();
    check(
      md46 === '> text',
      `46: blockquote on empty editor places cursor after prefix, text appears after "> ", got: ${md46}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 47. D-006 Regression: Markdown-mode toolbar Blockquote with text mid-line.
  //     Cursor mid-text, click blockquote. The line should be prefixed with "> ",
  //     and the cursor should be positioned after the prefix (making subsequent typing
  //     continue the blockquote).
  // ---------------------------------------------------------------------------
  {
    await openTask(`D-006: Markdown blockquote cursor mid-text ${randomUUID()}`);
    await modeMarkdownLabel.click();
    await setMarkdownValue('existing text');
    // Click in the middle of the text
    const line = detailsEditorContent.locator('.cm-line').first();
    const box = await line.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    // Click blockquote
    await page.locator('.markdown-toolbar-btn[data-action="blockquote"]').click();
    const md47 = await getMarkdownValue();
    check(
      md47 === '> existing text',
      `47: blockquote prefixes the line with "> ", got: ${md47}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 48. D-006 Regression: Markdown-mode toolbar Heading cursor placement (similar pattern).
  //     On an empty line, click Heading 1. Cursor should be AFTER the "# " prefix,
  //     not before it.
  // ---------------------------------------------------------------------------
  {
    await openTask(`D-006: Markdown heading empty editor cursor placement ${randomUUID()}`);
    await modeMarkdownLabel.click();
    await setMarkdownValue('');
    await detailsEditorContent.click();
    // Click heading 1 button
    await page.locator('.markdown-toolbar-btn[data-action="h1"]').click();
    // Type text
    await page.keyboard.type('Title');
    const md48 = await getMarkdownValue();
    check(
      md48 === '# Title',
      `48: heading on empty editor places cursor after prefix, text appears after "# ", got: ${md48}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 49. D-006 Regression: Markdown-mode toolbar Bullet List cursor placement.
  //     On an empty line, click Bullet List. Cursor should be AFTER the "- " prefix.
  // ---------------------------------------------------------------------------
  {
    await openTask(`D-006: Markdown bullet empty editor cursor placement ${randomUUID()}`);
    await modeMarkdownLabel.click();
    await setMarkdownValue('');
    await detailsEditorContent.click();
    // Click bullet list button
    await page.locator('.markdown-toolbar-btn[data-action="bullet"]').click();
    // Type text
    await page.keyboard.type('item');
    const md49 = await getMarkdownValue();
    check(
      md49 === '- item',
      `49: bullet list on empty editor places cursor after prefix, text appears after "- ", got: ${md49}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 50. D-006 Regression: Markdown-mode toolbar Todo List cursor placement.
  //     On an empty line, click Todo List. Cursor should be AFTER the "- [ ] " prefix.
  // ---------------------------------------------------------------------------
  {
    await openTask(`D-006: Markdown todo empty editor cursor placement ${randomUUID()}`);
    await modeMarkdownLabel.click();
    await setMarkdownValue('');
    await detailsEditorContent.click();
    // Click todo list button
    await page.locator('.markdown-toolbar-btn[data-action="task"]').click();
    // Type text
    await page.keyboard.type('task');
    const md50 = await getMarkdownValue();
    check(
      md50 === '- [ ] task',
      `50: todo list on empty editor places cursor after prefix, text appears after "- [ ] ", got: ${md50}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 51. D-006 Regression: Mode switch preserves cursor behavior.
  //     In Markdown mode, create blockquote, switch to WYSIWYG, switch back.
  //     The blockquote content should be preserved, and toggling off should work correctly.
  // ---------------------------------------------------------------------------
  {
    await openTask(`D-006: Blockquote mode switch preserves content ${randomUUID()}`);
    await modeMarkdownLabel.click();
    await setMarkdownValue('> quoted text');
    await modeWysiwygLabel.click();
    check(
      (await detailsRich.locator('blockquote').count()) === 1,
      '51: blockquote renders as <blockquote> in WYSIWYG'
    );
    await modeMarkdownLabel.click();
    const md51 = await getMarkdownValue();
    check(
      md51 === '> quoted text',
      `51: blockquote round-trips through WYSIWYG mode unchanged, got: ${md51}`
    );
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 52. Blockquote Enter exit (D-007 regression): pressing Enter on an empty blockquote
  //     paragraph should exit the blockquote and create a normal paragraph after it.
  //     Enter on a non-empty blockquote paragraph should create another paragraph inside
  //     the same blockquote (quote continues).
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG blockquote Enter exit ${randomUUID()}`);
    await setMarkdownValue('> Some quoted text');
    await modeWysiwygLabel.click();
    check(
      (await detailsRich.locator('blockquote').count()) === 1,
      '52: blockquote renders as <blockquote> in WYSIWYG'
    );

    // Place caret at the end of the quote and press Enter (creates a new empty line inside the quote)
    const quoteP = detailsRich.locator('blockquote p').first();
    await quoteP.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    // After first Enter: we should still be inside the blockquote (now with 2 paragraphs)
    check(
      (await detailsRich.locator('blockquote p').count()) === 2,
      '52: Enter on non-empty quote paragraph creates another paragraph inside the same blockquote'
    );

    // Press Enter again on the empty paragraph -> should exit the blockquote
    await page.keyboard.press('Enter');
    check(
      (await detailsRich.locator('blockquote').count()) === 1,
      '52: blockquote still exists after first empty-paragraph Enter'
    );
    check(
      (await detailsRich.locator('blockquote p').count()) === 1,
      '52: blockquote now contains only one paragraph (the new empty one was removed)'
    );
    check(
      (await detailsRich.locator('> p').count()) >= 1,
      '52: a normal paragraph exists outside the blockquote after exit'
    );

    // Type in the normal paragraph to verify we exited
    await page.keyboard.type('normal paragraph');
    const normalParaText = await detailsRich.locator('> p:not(blockquote p)').last().innerText();
    check(
      normalParaText.includes('normal paragraph'),
      `52: typing after blockquote exit works correctly and produces normal text, got: ${normalParaText}`
    );

    // Verify Markdown round-trip: blockquote stays quoted, new paragraph has no '>' prefix
    await modeMarkdownLabel.click();
    const md52 = await getMarkdownValue();
    check(
      md52.includes('> Some quoted text') && md52.includes('normal paragraph'),
      `52: blockquote and normal paragraph both present in Markdown, got: ${md52}`
    );
    check(
      !md52.match(/>\s*(\n|$)/) || md52.match(/> Some quoted text/),
      `52: no stray ">" prefix on the normal paragraph, got: ${md52}`
    );

    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 53. Blockquote Enter mid-text (D-007 regression): pressing Enter in the middle of
  //     quote text should split the quote content without exiting (remain inside the blockquote).
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG blockquote Enter mid-text ${randomUUID()}`);
    // Create a blockquote via Markdown mode with multi-line quote
    await setMarkdownValue('> First line of quote\n> Second line');
    await modeWysiwygLabel.click();
    check(
      (await detailsRich.locator('blockquote p').count()) === 2,
      '53: blockquote with two paragraphs created from Markdown'
    );

    // Move caret to middle of the first paragraph's text: "First | line of quote"
    const firstQuoteP = detailsRich.locator('blockquote p').first();
    await firstQuoteP.click();
    await page.keyboard.press('Home');
    for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowRight'); // Position after "First "

    // Press Enter to split inside the quote at mid-text
    await page.keyboard.press('Enter');

    // Verify we now have three paragraphs inside the same blockquote (split created a new one)
    check(
      (await detailsRich.locator('blockquote').count()) === 1,
      '53: still inside one blockquote after mid-text Enter'
    );
    check(
      (await detailsRich.locator('blockquote p').count()) === 3,
      '53: blockquote now has three paragraphs (mid-text split created a new paragraph inside)'
    );

    // Verify the text split correctly
    const firstQuoteLine = await detailsRich.locator('blockquote p').first().innerText();
    const middleQuoteLine = await detailsRich.locator('blockquote p').nth(1).innerText();
    check(
      firstQuoteLine.includes('First'),
      `53: first quote paragraph has "First", got: ${firstQuoteLine}`
    );
    check(
      middleQuoteLine.includes('line of quote'),
      `53: middle quote paragraph has "line of quote" (from split), got: ${middleQuoteLine}`
    );

    // Switch to Markdown and verify all lines have '>' prefix
    await modeMarkdownLabel.click();
    const md53 = await getMarkdownValue();
    const quoteLines = md53.split('\n').filter((l) => l.startsWith('>'));
    check(
      quoteLines.length === 3,
      `53: Markdown has three blockquote lines after mid-text split, got: ${md53}`
    );

    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 54. Single empty blockquote paragraph via toolbar Blockquote button, then Enter
  //     (D-007 regression): clicking Blockquote on empty paragraph creates a <blockquote>
  //     with one empty <p> inside; pressing Enter immediately should exit the blockquote.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG toolbar blockquote empty then Enter ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();

    // Click the toolbar Blockquote button to create an empty blockquote
    await page.locator('.markdown-toolbar-btn[data-action="blockquote"]').click();
    check(
      (await detailsRich.locator('blockquote p').count()) === 1,
      '54: toolbar blockquote creates one empty paragraph inside a blockquote'
    );

    // Press Enter immediately (no typing) -> should exit the blockquote
    await page.keyboard.press('Enter');
    check(
      (await detailsRich.locator('blockquote').count()) === 0,
      '54: Enter on empty toolbar-created blockquote paragraph exits the blockquote'
    );
    check(
      (await detailsRich.locator('> p').count()) >= 1,
      '54: normal paragraph created after blockquote exit'
    );

    // Type and verify we're in normal mode
    await page.keyboard.type('normal text');
    const paraText = await detailsRich.locator('> p').last().innerText();
    check(
      paraText.includes('normal text'),
      `54: typing after toolbar blockquote exit creates normal text, got: ${paraText}`
    );

    await modeMarkdownLabel.click();
    const md54 = await getMarkdownValue();
    check(
      !md54.startsWith('>') && md54.includes('normal text'),
      `54: Markdown contains normal text without blockquote prefix, got: ${md54}`
    );

    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 55. D-008 Regression: Markdown-mode blockquote Enter-exit on empty line.
  //     Type "> Some quoted text", press Enter (creates "> |" empty blockquote line),
  //     press Enter again on the empty line -> should exit blockquote immediately with no
  //     stray ">" line. The blockquote line should be removed and a new normal line created.
  // ---------------------------------------------------------------------------
  {
    await openTask(`D-008: Markdown blockquote Enter exit single quote ${randomUUID()}`);
    await modeMarkdownLabel.click();
    await setMarkdownValue('');
    await detailsEditorContent.click();

    // Type blockquote text
    await page.keyboard.type('> Some quoted text');
    let md55a = await getMarkdownValue();
    check(
      md55a === '> Some quoted text',
      `55: initial blockquote text, got: ${md55a}`
    );

    // Press Enter to continue the quote (creates empty "> " line)
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    let md55b = await getMarkdownValue();
    check(
      md55b === '> Some quoted text\n> ',
      `55: Enter on non-empty quote line continues with empty "> " line, got: ${md55b}`
    );

    // Press Enter again on the empty blockquote line -> should exit
    await page.keyboard.press('Enter');
    const md55c = await getMarkdownValue();
    check(
      md55c === '> Some quoted text\n\n',
      `55: Enter on empty blockquote line exits immediately with no stray ">", got: ${md55c}`
    );
    check(
      !md55c.includes('> \n'),
      `55: no stray empty blockquote line ("> ") left behind, got: ${md55c}`
    );

    // Type text to verify we're now in normal mode
    await page.keyboard.type('normal text');
    const md55d = await getMarkdownValue();
    check(
      md55d === '> Some quoted text\n\nnormal text',
      `55: text after blockquote exit is normal (no ">" prefix), got: ${md55d}`
    );

    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 56. D-008 Regression: Markdown-mode blockquote Enter-exit with multiline quote.
  //     Create a two-line quote, press Enter at the end of the second line (creates empty
  //     quote line), press Enter again -> should exit, leaving both quote lines intact and
  //     creating a normal line after.
  // ---------------------------------------------------------------------------
  {
    await openTask(`D-008: Markdown blockquote Enter exit multiline ${randomUUID()}`);
    await modeMarkdownLabel.click();
    await setMarkdownValue('');
    await detailsEditorContent.click();

    // Build the two-line quote by typing + real Enter presses (rather than embedding a second
    // literal "> " in a setMarkdownValue string), since Enter on the non-empty first quote line
    // already auto-continues with its own "> " marker -- embedding a second literal one would
    // double it up.
    await page.keyboard.type('> First line');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second line');

    let md56pre = await getMarkdownValue();
    check(
      md56pre === '> First line\n> Second line',
      `56: two-line quote built via typing + Enter continuation, got: ${md56pre}`
    );

    // Press Enter at end of the (non-empty) second line -> continues the quote with an empty
    // "> " marker line, same as the single-line case.
    await page.keyboard.press('Enter');

    let md56a = await getMarkdownValue();
    check(
      md56a === '> First line\n> Second line\n> ',
      `56: Enter at end of second quote line creates empty quote line, got: ${md56a}`
    );

    // Press Enter again on the empty line -> should exit
    await page.keyboard.press('Enter');
    const md56b = await getMarkdownValue();
    check(
      md56b === '> First line\n> Second line\n\n',
      `56: Enter on empty line exits blockquote, preserving both quote lines, got: ${md56b}`
    );
    check(
      (md56b.match(/^> /gm) || []).length === 2,
      `56: exactly two blockquote lines remain, got: ${md56b}`
    );

    // Type normal text after exit
    await page.keyboard.type('after quote');
    const md56c = await getMarkdownValue();
    check(
      md56c.includes('after quote') && !md56c.includes('after quote\n> '),
      `56: text after exit is normal (not in blockquote), got: ${md56c}`
    );

    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 57. D-008 Regression: Markdown-mode blockquote Enter behavior with only-whitespace line.
  //     A line with only "> " or ">   " (blockquote marker plus whitespace) must be treated
  //     as empty for exit purposes. Pressing Enter on such a line should exit immediately.
  // ---------------------------------------------------------------------------
  {
    await openTask(`D-008: Markdown blockquote Enter exit whitespace-only ${randomUUID()}`);
    await modeMarkdownLabel.click();
    await setMarkdownValue('> text');
    await detailsEditorContent.click();

    // Navigate to end and press Enter (creates empty quote line with just "> ")
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    // Verify we have the empty blockquote line
    let md57a = await getMarkdownValue();
    const hasEmptyQuoteLine = md57a.includes('> \n') || md57a.endsWith('> ');
    check(
      hasEmptyQuoteLine,
      `57: empty blockquote line created ("> " or similar), got: ${md57a}`
    );

    // Press Enter again -> should exit immediately
    await page.keyboard.press('Enter');
    const md57b = await getMarkdownValue();

    check(
      md57b === '> text\n\n',
      `57: Enter on empty blockquote line exits immediately, no stray ">", got: ${md57b}`
    );
    check(
      !md57b.includes('> \n') && !md57b.match(/>\s*\n\s*$/),
      `57: no empty blockquote line with only whitespace left behind, got: ${md57b}`
    );

    // A quote line with EXTRA trailing whitespace after the marker (">   ", not just "> ") must
    // also count as empty and exit cleanly, with no leftover whitespace-only line.
    await page.keyboard.type('> more text');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter'); // continues quote with "> "
    await page.keyboard.type('  '); // now "> " + two extra spaces = whitespace-only quote line
    const md57c = await getMarkdownValue();
    check(
      md57c.endsWith('>   '),
      `57: whitespace-only quote line has extra trailing spaces before exit, got: ${md57c}`
    );
    await page.keyboard.press('Enter'); // should exit immediately, no stray whitespace/">"
    const md57d = await getMarkdownValue();
    check(
      md57d === '> text\n\n> more text\n\n',
      `57: Enter on ">   " (marker + extra whitespace) exits immediately with no leftover, got: ${md57d}`
    );

    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 58. D-011 Regression: WYSIWYG blockquote `> ` shortcut trigger at start of empty paragraph.
  //     Typing `> ` (blockquote marker + space) at the start of an otherwise-empty paragraph
  //     should immediately transform it into a blockquote, removing the trigger text, with caret
  //     positioned inside the new blockquote so typing continues as quote content.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG blockquote > space shortcut ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();

    // Test 58a: `> ` at start of empty paragraph creates blockquote
    await page.keyboard.type('> ');
    check(
      (await detailsRich.locator('blockquote').count()) === 1,
      '58a: "> " immediately converts empty paragraph to blockquote'
    );
    check(
      (await detailsRich.locator('blockquote p').count()) === 1,
      '58a: blockquote contains one paragraph'
    );

    // Test 58b: Typing after trigger continues inside blockquote
    await page.keyboard.type('Hello');
    check(
      (await detailsRich.locator('blockquote p').innerText()) === 'Hello',
      '58b: typing after trigger continues inside the blockquote'
    );

    // Test 58c: Round-trip to Markdown produces correct format
    await modeMarkdownLabel.click();
    let md58c = await getMarkdownValue();
    check(
      md58c === '> Hello',
      `58c: blockquote round-trips to Markdown as "> Hello", got: ${md58c}`
    );

    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 58b. D-011 Regression: shortcut does NOT trigger for `foo > bar` or `text> `.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG blockquote > NOT middle/suffix ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();

    // Test 58b-i: `foo > bar` does NOT trigger shortcut
    await page.keyboard.type('foo > bar');
    check(
      (await detailsRich.locator('blockquote').count()) === 0,
      '58b-i: "> " in middle of text does not trigger blockquote'
    );

    // Clean up and test again
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');

    // Test 58b-ii: `text> ` does NOT trigger shortcut (no space before)
    await page.keyboard.type('text> ');
    check(
      (await detailsRich.locator('blockquote').count()) === 0,
      '58b-ii: "> " at end (not at start) does not trigger blockquote'
    );

    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 58c. D-011 Regression: blockquote created via shortcut supports Enter to continue/exit.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG blockquote > Enter behavior ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();

    // Create blockquote via shortcut
    await page.keyboard.type('> ');
    await page.keyboard.type('First line');
    check(
      (await detailsRich.locator('blockquote p').count()) === 1,
      '58c: blockquote created with one paragraph containing "First line"'
    );

    // Test 58c-i: Enter on non-empty blockquote paragraph creates another paragraph inside
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second line');
    check(
      (await detailsRich.locator('blockquote p').count()) === 2,
      '58c-i: Enter on non-empty blockquote paragraph creates another paragraph inside'
    );

    // Verify both lines are inside the same blockquote
    const bqP1 = detailsRich.locator('blockquote p').nth(0);
    const bqP2 = detailsRich.locator('blockquote p').nth(1);
    check(
      (await bqP1.innerText()) === 'First line',
      `58c-i: first paragraph has "First line", got: ${await bqP1.innerText()}`
    );
    check(
      (await bqP2.innerText()) === 'Second line',
      `58c-i: second paragraph has "Second line", got: ${await bqP2.innerText()}`
    );

    // Test 58c-ii: Round-trip to Markdown shows both lines as blockquote
    await modeMarkdownLabel.click();
    let md58c = await getMarkdownValue();
    check(
      md58c.includes('> First line') && md58c.includes('> Second line'),
      `58c-ii: both blockquote lines present in Markdown, got: ${md58c}`
    );

    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 58d. D-011 Regression: shortcut blockquote and toolbar blockquote produce identical results.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG blockquote shortcut vs toolbar ${randomUUID()}`);
    await modeWysiwygLabel.click();
    await detailsRich.click();

    // Create blockquote via shortcut
    await page.keyboard.type('> ');
    await page.keyboard.type('Shortcut blockquote');

    // Exit the blockquote: press End, Enter to create empty <p>, Enter again to exit
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');  // Creates new <p> inside blockquote
    await page.keyboard.press('Enter');  // Exits blockquote because new <p> is empty

    // Create another blockquote via toolbar
    await page.keyboard.type('Toolbar test');
    await page.locator('.markdown-toolbar-btn[data-action="blockquote"]').click();

    check(
      (await detailsRich.locator('blockquote').count()) === 2,
      '58d: two blockquote elements exist (one from shortcut, one from toolbar)'
    );

    // Verify both blockquotes have the same DOM structure (<blockquote> with <p> inside)
    const bq1 = detailsRich.locator('blockquote').nth(0);
    const bq2 = detailsRich.locator('blockquote').nth(1);
    check(
      (await bq1.locator('p').count()) === 1,
      '58d: first blockquote wraps one paragraph'
    );
    check(
      (await bq2.locator('p').count()) === 1,
      '58d: second blockquote wraps one paragraph'
    );

    // Verify both serialize correctly to Markdown with "> " prefix
    await modeMarkdownLabel.click();
    let md = await getMarkdownValue();
    check(
      md.includes('> Shortcut blockquote') && md.includes('> Toolbar test'),
      `58d: both shortcut and toolbar blockquotes serialize with "> " prefix, got: ${md}`
    );

    await closeModal();
  }

  console.log(`Markdown toolbar self-test: ${checks} scenario checks passed before teardown`);
} catch (error) {
  failure = error;
} finally {
  if (electronApp) {
    try {
      await electronApp.close();
    } catch (closeError) {
      failure ??= closeError;
    }
  }

  try {
    assertProtectedFilesUnchanged(check);
  } catch (protectedError) {
    failure ??= protectedError;
  }

  try {
    cleanupTempRoot(tempRoot);
  } catch (cleanupError) {
    failure ??= cleanupError;
  }
}

if (failure) {
  console.error(`Markdown toolbar self-test failed after ${checks} checks: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`Markdown toolbar self-test passed (${checks} checks)`);
}
