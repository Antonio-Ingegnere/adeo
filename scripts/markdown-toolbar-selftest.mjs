// Markdown | WYSIWYG Details editor acceptance suite. Run with: npm run test:markdown-toolbar
// (or directly: node scripts/markdown-toolbar-selftest.mjs -- it builds dist itself first so it
// also works as a standalone feature_check without relying on the npm wrapper having run).
//
// Same isolated-Electron harness as scripts/edit-modal-delete-selftest.mjs: real Electron app,
// isolated userData dir + SQLite file, real dev database/settings snapshotted and re-asserted
// byte-unchanged in the finally block. Narrow smoke of the new Details editor behavior, not a
// viewport/theme matrix.
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
  const detailsTextarea = page.locator('#edit-details');
  const detailsRich = page.locator('#edit-details-rich');
  const modeMarkdown = page.locator('#edit-details-mode-markdown');
  const modeWysiwyg = page.locator('#edit-details-mode-wysiwyg');
  const modeMarkdownLabel = page.locator('label.segmented-option', { has: modeMarkdown });
  const modeWysiwygLabel = page.locator('label.segmented-option', { has: modeWysiwyg });

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
    await detailsTextarea.fill('## Hello\n\nSome **bold** text.');
    await modeWysiwygLabel.click();
    await detailsRich.waitFor({ state: 'visible' });
    check((await detailsRich.locator('h2').innerText()) === 'Hello', '1: heading renders as a real H2, no raw ## markers');
    check((await detailsRich.locator('strong').innerText()) === 'bold', '1: **bold** renders as a real <strong>, no raw ** markers');
    await modeMarkdownLabel.click();
    await detailsTextarea.waitFor({ state: 'visible' });
    check((await detailsTextarea.inputValue()) === '## Hello\n\nSome **bold** text.', '1: switching back to Markdown reproduces the original text unchanged');
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
    const md = await detailsTextarea.inputValue();
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
    check((await detailsTextarea.inputValue()) === 'plain **text**', `5: toolbar bold round-trips to Markdown, got: ${await detailsTextarea.inputValue()}`);
    await closeModal();
  }

  // ---------------------------------------------------------------------------
  // 6. Unsupported syntax (a link, which helpers.ts's renderer does not parse) is preserved
  //    verbatim through a WYSIWYG round-trip rather than being dropped or corrupted.
  // ---------------------------------------------------------------------------
  {
    await openTask(`WYSIWYG unsupported syntax preserved ${randomUUID()}`);
    await detailsTextarea.fill('See [docs](https://example.com) for more.');
    await modeWysiwygLabel.click();
    await modeMarkdownLabel.click();
    check(
      (await detailsTextarea.inputValue()) === 'See [docs](https://example.com) for more.',
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
    await detailsTextarea.fill('- [x] done item\n- [ ] open item');
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
    await detailsTextarea.fill('[x] done\n[ ] todo');
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
    const md9 = await detailsTextarea.inputValue();
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
    const md10 = await detailsTextarea.inputValue();
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
    const md11 = await detailsTextarea.inputValue();
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
    await detailsTextarea.fill('- [ ] Buy milk today');
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
    const md12 = await detailsTextarea.inputValue();
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
      (await detailsRich.locator('ul[data-list-type="task"] li').count()) === 1,
      '13: Enter on an empty unchecked task item removes the second item (exits the list)'
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
    const md13 = await detailsTextarea.inputValue();
    check(
      md13.includes('- [ ] ') && md13.includes('normal paragraph') && md13.includes('# Heading'),
      `13: mixed task-list, paragraph, and heading round-trip correctly to Markdown, got: ${md13}`
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
      (await detailsRich.locator('ul[data-list-type="task"] li').count()) === 1,
      '14: Enter on an empty checked task item removes the second item (exits the list)'
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
    const md14 = await detailsTextarea.inputValue();
    check(
      md14.includes('- [x] ') && md14.includes('text after checked exit'),
      `14: checked task-list exit and paragraph round-trip correctly to Markdown, got: ${md14}`
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
    const md15 = await detailsTextarea.inputValue();
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
    const md16 = await detailsTextarea.inputValue();
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
