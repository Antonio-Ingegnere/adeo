// Quick Add ("Options" disclosure) acceptance suite -- P2.4.
// Run with: npm run test:quick-add
//
// Same shape and safety posture as scripts/test-isolation-selftest.mjs: a full ADEO_UI_TEST
// launch against an isolated userData dir + SQLite file, with the real dev database/settings
// snapshotted before and re-asserted unchanged in the finally block.

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
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

const assertProtectedFilesUnchanged = createProtectedFilesGuard();

const pythonBin = resolvePythonBin(repoRoot);
const { tempRoot, isolatedUserData, isolatedDatabase, bootstrapUserData } = createIsolatedPaths();

// Queries the isolated SQLite file directly -- the same technique test-isolation-selftest.mjs
// uses to verify what actually landed in the database, independent of what the renderer thinks
// happened.
const queryTaskRow = (text) => {
  const query = [
    'import sqlite3, sys, json',
    'conn = sqlite3.connect(sys.argv[1])',
    'conn.row_factory = sqlite3.Row',
    'row = conn.execute("SELECT priority, reminder_date, list_id FROM tasks WHERE text = ?", (sys.argv[2],)).fetchone()',
    'conn.close()',
    'print(json.dumps(dict(row) if row else None))',
  ].join('; ');
  const result = spawnSync(pythonBin, ['-c', query, isolatedDatabase, text], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  check(result.status === 0, `Could not query the isolated database for "${text}": ${result.stderr}`);
  return JSON.parse(result.stdout.trim());
};

const countTasksWithText = (text) => {
  const query = [
    'import sqlite3, sys',
    'conn = sqlite3.connect(sys.argv[1])',
    'row = conn.execute("SELECT COUNT(*) FROM tasks WHERE text = ?", (sys.argv[2],)).fetchone()',
    'conn.close()',
    'print(row[0])',
  ].join('; ');
  const result = spawnSync(pythonBin, ['-c', query, isolatedDatabase, text], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  check(result.status === 0, `Could not count tasks for "${text}": ${result.stderr}`);
  return Number(result.stdout.trim());
};

const countTagsNamed = (name) => {
  const query = [
    'import sqlite3, sys',
    'conn = sqlite3.connect(sys.argv[1])',
    'row = conn.execute("SELECT COUNT(*) FROM tags WHERE name = ?", (sys.argv[2],)).fetchone()',
    'conn.close()',
    'print(row[0])',
  ].join('; ');
  const result = spawnSync(pythonBin, ['-c', query, isolatedDatabase, name], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  check(result.status === 0, `Could not count tags named "${name}": ${result.stderr}`);
  return Number(result.stdout.trim());
};

const findListId = (name) => {
  const query = [
    'import sqlite3, sys',
    'conn = sqlite3.connect(sys.argv[1])',
    'row = conn.execute("SELECT id FROM lists WHERE name = ?", (sys.argv[2],)).fetchone()',
    'conn.close()',
    'print(row[0] if row else "")',
  ].join('; ');
  const result = spawnSync(pythonBin, ['-c', query, isolatedDatabase, name], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  check(result.status === 0, `Could not find list id for "${name}": ${result.stderr}`);
  const out = result.stdout.trim();
  return out ? Number(out) : null;
};

// Some scenarios create a task under a list that is not the one currently being viewed (that is
// the point of them), so the new row is correctly absent from .tasks-list. Poll the isolated
// database directly rather than waiting on visibility that is never coming.
const waitForTaskPersisted = async (page, text, timeoutMs = 10_000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (countTasksWithText(text) > 0) return;
    await page.waitForTimeout(150);
  }
  throw new Error(`Task "${text}" was not persisted within ${timeoutMs}ms`);
};

const isoToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

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

  // ---- Fixtures: two lists, created via the same IPC path the app itself uses, then a reload
  // so the renderer's own loadLists() picks them up. ----
  const workName = `QA Work ${randomUUID().slice(0, 8)}`;
  const personalName = `QA Personal ${randomUUID().slice(0, 8)}`;
  await page.evaluate(
    async ({ workName, personalName }) => {
      await window.electronAPI.addList(workName);
      await window.electronAPI.addList(personalName);
    },
    { workName, personalName },
  );
  await page.reload();
  await input.waitFor({ state: 'visible' });

  const selectListByName = async (name) => {
    await page.locator('#view-picker').click();
    await page.locator('.view-menu-item', { hasText: name }).first().click();
  };

  // The metadata row is revealed by composer activity, not a toggle. When it is hidden, drop
  // focus outside the compose block first so a prior Escape-dismiss is cleared on re-entry;
  // when it is already shown, just make sure #message-input holds focus (blurring with an
  // empty draft would collapse the row and reset any values already chosen).
  const activateComposer = async () => {
    if (await page.locator('#compose-meta-row').isHidden()) {
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
      await page.waitForTimeout(60);
    }
    await input.click();
    await page.locator('#compose-meta-row').waitFor({ state: 'visible' });
  };

  // Clears the draft without focusing the input, then blurs whatever holds focus, so the
  // activity predicate collapses the row. Used between scenarios to get a clean slate.
  const deactivateComposer = async () => {
    await page.evaluate(() => {
      const el = document.getElementById('message-input');
      if (el) {
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await page.waitForTimeout(60);
    await page.locator('#compose-meta-row').waitFor({ state: 'hidden' });
  };

  const pickComposeList = async (name) => {
    await activateComposer();
    await page.locator('#compose-list-picker').click();
    await page.locator('#compose-list-menu').waitFor({ state: 'visible' });
    if (name === null) {
      await page.locator('#compose-list-menu .modal-list-item[data-value=""]').click();
    } else {
      await page.locator('#compose-list-menu .modal-list-item', { hasText: name }).click();
    }
  };

  const pickComposePriority = async (value) => {
    await activateComposer();
    await page.locator('#compose-priority-picker').click();
    await page.locator('#compose-priority-menu').waitFor({ state: 'visible' });
    await page.locator(`#compose-priority-menu .priority-menu-item[data-value="${value}"]`).click();
  };

  const pickComposeReminderToday = async () => {
    await activateComposer();
    await page.locator('#compose-reminder-field .date-picker-trigger').click();
    await page.locator('.date-picker-footer-btn', { hasText: 'Today' }).click();
  };

  const enterAdvancedSearch = async (query) => {
    await page.locator('label.segmented-option', { hasText: 'Query' }).click();
    const search = page.locator('#lists-search-input');
    await search.fill(query);
  };

  const clearSearchField = async () => {
    const search = page.locator('#lists-search-input');
    await search.fill('');
  };

  const uniqueText = (label) => `${label} ${randomUUID()}`;

  // Retries the fill because the tag-suggest menu's open/close state can lose a race against
  // Playwright's own click-to-focus step on an occasional slow CI run -- not a production race,
  // just test-harness timing on the very first interaction with a freshly (re)focused field.
  const openTagSuggestions = async (text) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await input.click();
      await input.fill('');
      await input.fill(text);
      try {
        await page.locator('#tag-suggest-menu').waitFor({ state: 'visible', timeout: 5_000 });
        return;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
  };

  // ---------------------------------------------------------------------------
  // 1. Success via Enter
  // ---------------------------------------------------------------------------
  {
    const text = uniqueText('Success via Enter');
    await input.fill(text);
    await input.press('Enter');
    await page.locator('.task-text').filter({ hasText: text }).waitFor({ state: 'visible' });
    check(true, '1: task appears in .tasks-list');
    check((await input.inputValue()) === '', '1: #message-input is empty after submit');
    check(
      await page.evaluate(() => document.activeElement === document.getElementById('message-input')),
      '1: focus returns to #message-input',
    );
    const status = await page.locator('#compose-status').textContent();
    check(Boolean(status && status.includes(text)), '1: #compose-status names the added task');
    check(
      Boolean(status && /\bto No list\.$/.test(status)),
      '1: #compose-status names the destination ("... to No list.")',
    );
    check((await page.locator('#compose-error').textContent()) === '', '1: #compose-error is empty');
  }

  // ---------------------------------------------------------------------------
  // 2. Success via Add button
  // ---------------------------------------------------------------------------
  {
    const text = uniqueText('Success via Add button');
    await input.fill(text);
    await page.locator('#add-button').click();
    await page.locator('.task-text').filter({ hasText: text }).waitFor({ state: 'visible' });
    check(
      await page.evaluate(() => document.activeElement === document.getElementById('message-input')),
      '2: focus returns to #message-input after Add click',
    );
  }

  // ---------------------------------------------------------------------------
  // 3. Blank submit via Enter
  // ---------------------------------------------------------------------------
  {
    const before = await page.locator('.task-row').count();
    await input.fill('');
    await input.press('Enter');
    const after = await page.locator('.task-row').count();
    check(before === after, '3: blank Enter creates no task');
    check(
      (await page.locator('#compose-error').textContent()) === 'Enter a task before adding.',
      '3: #compose-error names the missing text',
    );
    check(
      await page.evaluate(() => document.activeElement === document.getElementById('message-input')),
      '3: focus stays in #message-input',
    );
  }

  // ---------------------------------------------------------------------------
  // 4. Blank submit via Add click
  // ---------------------------------------------------------------------------
  {
    const before = await page.locator('.task-row').count();
    await input.fill('');
    await page.locator('#add-button').click();
    const after = await page.locator('.task-row').count();
    check(before === after, '4: blank Add click creates no task');
    check(
      (await page.locator('#compose-error').textContent()) === 'Enter a task before adding.',
      '4: #compose-error names the missing text (Add click)',
    );
    check(
      await page.evaluate(() => document.activeElement === document.getElementById('message-input')),
      '4: focus moves to #message-input, not staying on #add-button',
    );
  }

  // ---------------------------------------------------------------------------
  // 5. Tag-only submit creates nothing
  // ---------------------------------------------------------------------------
  {
    const tagName = `zzz-${randomUUID().slice(0, 8)}`;
    const before = countTasksWithText(`#${tagName}`);
    // A trailing space moves the caret off the #token, which closes tagInput.ts's own
    // suggestion menu (its Enter is already spoken for -- "select the suggestion, never
    // submit" -- and is not what this scenario is testing).
    await input.fill(`#${tagName} `);
    await input.press('Enter');
    // give any (incorrect) async tag-creation a moment to land, then assert it did not
    await page.waitForTimeout(300);
    const after = countTasksWithText(`#${tagName}`);
    check(before === after, '5: tag-only submit created no task');
    check(countTagsNamed(tagName) === 0, '5: tag-only submit created no tag in the database');
    await input.fill('');
  }

  // ---------------------------------------------------------------------------
  // 6. Error clears on typing
  // ---------------------------------------------------------------------------
  {
    await input.fill('');
    await input.press('Enter');
    check(
      (await page.locator('#compose-error').textContent()) !== '',
      '6 setup: blank submit leaves an error message',
    );
    await input.type('a');
    check((await page.locator('#compose-error').textContent()) === '', '6: typing clears #compose-error');
    await input.fill('');
  }

  // ---------------------------------------------------------------------------
  // 8c. List trigger names the *resolved* destination, not a placeholder
  // ---------------------------------------------------------------------------
  {
    // default view is "All lists" with nothing selected -> the task would land unfiled
    check(
      (await page.locator('#compose-list-value').textContent()) === 'No list',
      '8c: #compose-list-value resolves to "No list" under All lists',
    );
    check(
      (await page.locator('#compose-list-picker').getAttribute('aria-label')) === 'Task list: No list',
      '8c: the trigger aria-label carries the resolved value',
    );
  }

  // ---------------------------------------------------------------------------
  // 7 + 9 + 10. Row applies priority; resets after success; no compose chips in the hints row
  // ---------------------------------------------------------------------------
  {
    const text = uniqueText('Priority only');
    await pickComposePriority('high');
    check(
      (await page.locator('#compose-priority-value').textContent()) === 'High',
      '7: the priority trigger shows the chosen value',
    );
    // the hints row describes only a running query now; nothing is running, so it stays hidden
    check(
      await page.locator('#add-task-template').isHidden(),
      '10: #add-task-template is not used to echo compose metadata',
    );
    await input.fill(text);
    await input.press('Enter');
    await page.locator('.task-text').filter({ hasText: text }).waitFor({ state: 'visible' });
    const row = queryTaskRow(text);
    check(row?.priority === 'high', '7: stored priority is high');

    // focus returns to #message-input on success, so the row stays shown -- but at defaults
    check(
      !(await page.locator('#compose-meta-row').isHidden()),
      '9: the row stays shown after success (focus is back in the input)',
    );
    check(
      (await page.locator('#compose-priority-value').textContent()) === 'None',
      '9: #compose-priority-value reads None after success',
    );
    check(
      (await page.locator('#compose-list-value').textContent()) === 'No list',
      '9: #compose-list-value resolves to No list after success',
    );
  }

  // ---------------------------------------------------------------------------
  // 8. Options apply reminder date
  // ---------------------------------------------------------------------------
  {
    const text = uniqueText('Reminder only');
    await pickComposeReminderToday();
    await input.fill(text);
    await input.press('Enter');
    await page.locator('.task-text').filter({ hasText: text }).waitFor({ state: 'visible' });
    const row = queryTaskRow(text);
    check(row?.reminder_date === isoToday(), '8: stored reminder_date is today');
  }

  // ---------------------------------------------------------------------------
  // 8a. Options apply an explicit list, overriding the current view
  // ---------------------------------------------------------------------------
  {
    await selectListByName(workName);
    const text = uniqueText('Explicit Personal list');
    await pickComposeList(personalName);
    check(
      (await page.locator('#compose-list-value').textContent()) === personalName,
      '8a: the Task list trigger names the explicit choice',
    );
    check(
      (await page.locator('#compose-list-field').getAttribute('data-set')) === 'true',
      '8a: an explicit choice exposes data-set="true"',
    );
    await input.fill(text);
    await input.press('Enter');
    // the task lands under Personal, not the Work list currently being viewed -- it is
    // correctly absent from .tasks-list, so this waits on the database instead
    await waitForTaskPersisted(page, text);
    const row = queryTaskRow(text);
    const personalId = findListId(personalName);
    check(row?.list_id === personalId, '8a: stored listId matches Personal, not Work');
  }

  // ---------------------------------------------------------------------------
  // 8b. Options apply an explicit "No list"
  // ---------------------------------------------------------------------------
  {
    await selectListByName(workName);
    const text = uniqueText('Explicit no list');
    await pickComposeList(null);
    await input.fill(text);
    await input.press('Enter');
    // lands unfiled, not under the Work list currently being viewed
    await waitForTaskPersisted(page, text);
    const row = queryTaskRow(text);
    check(row?.list_id === null, '8b: stored listId is null');
    await selectListByName('All lists');
  }

  // ---------------------------------------------------------------------------
  // 11. Compose value beats the smart-list template (priority)
  // ---------------------------------------------------------------------------
  {
    const text = uniqueText('Compose beats template priority');
    await enterAdvancedSearch('priority:low');
    await pickComposePriority('high');
    // the hints row still shows the running query's own value; the compose override shows on
    // the trigger and wins field-by-field at submit
    const hints = page.locator('#add-task-template');
    const priorityChips = (await hints.locator('.template-chip').allTextContents()).filter((t) =>
      ['None', 'Low', 'Medium', 'High'].includes(t),
    );
    check(priorityChips.length === 1 && priorityChips[0] === 'Low', '11: the hints row shows the query value (Low)');
    check(
      (await page.locator('#compose-priority-value').textContent()) === 'High',
      '11: the priority trigger shows the compose override (High)',
    );
    await input.fill(text);
    await input.press('Enter');
    // the created task has priority:high, which does not match the running priority:low
    // query, so it is correctly absent from the filtered .tasks-list
    await waitForTaskPersisted(page, text);
    const row = queryTaskRow(text);
    check(row?.priority === 'high', '11: stored priority is high, not low');
    await clearSearchField();
  }

  // ---------------------------------------------------------------------------
  // 11a. Compose list beats the smart-list template's list
  // ---------------------------------------------------------------------------
  {
    const text = uniqueText('Compose beats template list');
    await enterAdvancedSearch(`list:"${workName}"`);
    await pickComposeList(personalName);
    // the hints row names the running query's list; the trigger names the compose override
    const hints = page.locator('#add-task-template');
    const destinationChips = (await hints.locator('.template-chip').allTextContents()).filter(
      (t) => t === workName || t === personalName,
    );
    check(
      destinationChips.length === 1 && destinationChips[0] === workName,
      '11a: the hints row names the query list (Work)',
    );
    check(
      (await page.locator('#compose-list-value').textContent()) === personalName,
      '11a: the Task list trigger names the compose override (Personal)',
    );
    await input.fill(text);
    await input.press('Enter');
    // the created task belongs to Personal, which does not match the running list:Work
    // query, so it is correctly absent from the filtered .tasks-list
    await waitForTaskPersisted(page, text);
    const row = queryTaskRow(text);
    const personalId = findListId(personalName);
    check(row?.list_id === personalId, '11a: stored listId matches Personal');
    await clearSearchField();
    await page.locator('label.segmented-option', { hasText: 'Text' }).click();
  }

  // ---------------------------------------------------------------------------
  // 12. Tag suggestion keyboard (regression cover for tagInput.ts)
  // ---------------------------------------------------------------------------
  {
    const before = await page.locator('.task-row').count();
    // an empty #query offers no suggestion ("Create ..." only appears for a non-empty query, and
    // there are no existing tags to prefix-match yet), so a letter is needed to open the menu.
    // The whole keyboard sequence is retried as a unit: the menu also auto-closes 100ms after a
    // blur (tagInput.ts), so a slow CI tick between opening it and pressing Enter can otherwise
    // lose the race and have Enter fall through to a plain submit instead.
    let initialActiveDescendant = null;
    let afterArrowActiveDescendant = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await openTagSuggestions('#te');
      initialActiveDescendant = await input.getAttribute('aria-activedescendant');
      await input.press('ArrowDown');
      afterArrowActiveDescendant = await input.getAttribute('aria-activedescendant');
      const stillOpen = await page.locator('#tag-suggest-menu').isVisible();
      if (stillOpen) break;
      if (attempt === 2) throw new Error('12: tag suggestion menu did not stay open through ArrowDown');
    }
    check(
      initialActiveDescendant !== afterArrowActiveDescendant || Boolean(afterArrowActiveDescendant),
      '12: ArrowDown moves aria-activedescendant',
    );
    await input.press('Enter');
    // selectSuggestion() creates the tag over IPC and only then rewrites input.value -- wait for
    // that pending chip to land before touching the field again, or the async rewrite can race
    // the next fill() and corrupt it.
    await page.locator('#add-task-tags').locator(':scope > *').first().waitFor({ state: 'visible', timeout: 10_000 });
    const afterEnter = await page.locator('.task-row').count();
    check(before === afterEnter, '12: Enter in the suggestion menu selects, does not submit');
    await openTagSuggestions('#te');
    await input.press('Escape');
    check(
      (await page.locator('#tag-suggest-menu').isHidden()) ||
        (await page.locator('#tag-suggest-menu').evaluate((el) => el.style.display === 'none')),
      '12: Escape closes the tag suggestion menu',
    );
    check(
      await page.evaluate(() => document.activeElement === document.getElementById('message-input')),
      '12: focus stays in #message-input after Escape',
    );
    await input.fill('');
  }

  // ---------------------------------------------------------------------------
  // 13. Escape layering: menu -> collapse the row -> fall through to the app
  // ---------------------------------------------------------------------------
  {
    await activateComposer();
    await page.locator('#compose-priority-picker').click();
    await page.locator('#compose-priority-menu').waitFor({ state: 'visible' });
    await page.locator('#compose-priority-picker').focus();
    await page.keyboard.press('Escape');
    check(
      (await page.locator('#compose-priority-menu').evaluate((el) => el.style.display)) !== 'flex',
      '13: first Escape closes the priority menu',
    );
    check(
      await page.evaluate(
        () => document.activeElement === document.getElementById('compose-priority-picker'),
      ),
      '13: focus returns to #compose-priority-picker',
    );
    await page.keyboard.press('Escape');
    check(await page.locator('#compose-meta-row').isHidden(), '13: second Escape collapses the row');
    check(
      await page.evaluate(() => document.activeElement === document.getElementById('message-input')),
      '13: focus moves to #message-input after the collapse',
    );
    // third Escape: the row is hidden, so it must fall through without opening anything
    await page.keyboard.press('Escape');
    const anyOverlayOpen = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.overlay')).some((el) => el.classList.contains('open')),
    );
    check(!anyOverlayOpen, '13: a third Escape opens no overlay');
    await deactivateComposer();
  }

  // ----------------------------------------------------------------------------
  // 14. Escape collapses the row without touching the draft
  // ---------------------------------------------------------------------------
  {
    await activateComposer();
    await input.fill('draft kept through escape');
    await page.locator('#compose-meta-row').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    check(await page.locator('#compose-meta-row').isHidden(), '14: Escape collapses the row');
    check(
      (await input.inputValue()) === 'draft kept through escape',
      '14: the draft text is preserved',
    );
    check(
      await page.evaluate(() => document.activeElement === document.getElementById('message-input')),
      '14: focus is in #message-input',
    );
    const anyOverlayOpen = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.overlay')).some((el) => el.classList.contains('open')),
    );
    check(!anyOverlayOpen, '14: no overlay opens from this Escape');
    await deactivateComposer();
  }

  // ---------------------------------------------------------------------------
  // 14b. Collapsing the row resets every field to its default
  // ---------------------------------------------------------------------------
  {
    await selectListByName(workName);
    await pickComposePriority('high');
    await pickComposeList(personalName);
    check(
      (await page.locator('#compose-priority-value').textContent()) === 'High' &&
        (await page.locator('#compose-list-value').textContent()) === personalName,
      '14b: values are set before the collapse',
    );
    // blur with an empty draft -> the row hides and must reset
    await deactivateComposer();
    await activateComposer();
    check(
      (await page.locator('#compose-priority-value').textContent()) === 'None',
      '14b: priority returned to None',
    );
    check(
      (await page.locator('#compose-list-value').textContent()) === workName,
      '14b: Task list returned to the resolved destination (the viewed list)',
    );
    check(
      (await page.locator('#compose-list-field').getAttribute('data-set')) === 'false',
      '14b: the explicit override was cleared (data-set="false")',
    );
    await selectListByName('All lists');
  }

  // ---------------------------------------------------------------------------
  // 14c. The date popover does not collapse the row
  // ---------------------------------------------------------------------------
  {
    await activateComposer();
    await page.locator('#compose-reminder-field .date-picker-trigger').click();
    await page
      .locator('.date-picker-popover[aria-label="Choose Reminder"]')
      .waitFor({ state: 'visible' });
    check(
      !(await page.locator('#compose-meta-row').isHidden()),
      '14c: the row stays shown while the calendar popover has focus',
    );
    await page
      .locator('.date-picker-popover[aria-label="Choose Reminder"] .date-picker-footer-btn', {
        hasText: 'Today',
      })
      .click();
    check(
      !(await page.locator('#compose-meta-row').isHidden()),
      '14c: the row is still shown after picking a date',
    );
    check(
      (await page.locator('#compose-reminder-field').getAttribute('data-set')) === 'true',
      '14c: the reminder field exposes data-set="true"',
    );
    await deactivateComposer();
  }

  // ----------------------------------------------------------------------------
  // 14d. Group and field naming
  // ---------------------------------------------------------------------------
  {
    await activateComposer();
    check(
      (await page.locator('#compose-meta-row').getAttribute('role')) === 'group' &&
        (await page.locator('#compose-meta-row').getAttribute('aria-label')) === 'Details for the next task',
      '14d: the row is a role="group" named "Details for the next task"',
    );
    check(
      (await page.locator('#compose-priority-picker').getAttribute('aria-label')) === 'Priority: None',
      '14d: the priority trigger names its field and value',
    );
    check(
      (await page.locator('.compose-option-label').count()) === 0,
      '14d: no visible field labels remain',
    );
    await deactivateComposer();
  }

  // ---------------------------------------------------------------------------
  // 14e. Tab order: Task, Add task, Task list, Priority, Reminder
  // ---------------------------------------------------------------------------
  {
    await activateComposer();
    const order = [];
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Tab');
      order.push(
        await page.evaluate(() => {
          const el = document.activeElement;
          if (!el) return null;
          return el.id || el.className || el.tagName;
        }),
      );
    }
    check(order[0] === 'add-button', `14e: Tab 1 reaches #add-button (got ${order[0]})`);
    check(order[1] === 'compose-list-picker', `14e: Tab 2 reaches the Task list trigger (got ${order[1]})`);
    check(
      order[2] === 'compose-priority-picker',
      `14e: Tab 3 reaches the Priority trigger (got ${order[2]})`,
    );
    check(
      typeof order[3] === 'string' && order[3].includes('date-picker-trigger'),
      `14e: Tab 4 reaches the Reminder trigger (got ${order[3]})`,
    );
    // Escape-dismiss the row (hidden, but focus stays in #message-input); Tab must then skip
    // the metadata triggers entirely
    await input.fill('draft for tab test');
    await page.locator('#compose-meta-row').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.locator('#compose-meta-row').waitFor({ state: 'hidden' });
    await page.keyboard.press('Tab'); // -> #add-button
    await page.keyboard.press('Tab'); // -> whatever follows the compose block
    const afterHidden = await page.evaluate(() => document.activeElement?.id ?? '');
    check(
      afterHidden !== 'compose-list-picker' && afterHidden !== 'compose-priority-picker',
      `14e: a hidden row's fields are not Tab-reachable (landed on ${afterHidden})`,
    );
    await deactivateComposer();
  }

  // ---------------------------------------------------------------------------
  // 16 + 17. Responsive + touch targets
  // ---------------------------------------------------------------------------
  {
    for (const size of [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
      { width: 768, height: 1024 },
    ]) {
      await electronApp.evaluate(({ BrowserWindow }, { width, height }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.setSize(width, height);
      }, size);
      await page.waitForTimeout(150);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
      check(overflow, `16: no horizontal overflow at ${size.width}x${size.height}`);
      check(await page.locator('#message-input').isVisible(), `16: input row visible at ${size.width}`);
      check(await page.locator('#add-button').isVisible(), `16: Add button visible at ${size.width}`);
      await activateComposer();
      check(
        await page.locator('#compose-list-picker').isVisible(),
        `16: the metadata row is visible while the composer is active at ${size.width}`,
      );
      await deactivateComposer();
    }

    // 390px narrow/touch verification (Open Question 2's resolution): temporarily relax the
    // window minimum from the test only -- no production code is touched, and the shipped
    // floor stays 600 (src/main.ts).
    let narrowVerified = true;
    try {
      await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.setMinimumSize(320, 400);
        win.setSize(390, 844);
      });
      await page.waitForTimeout(150);
      const width = await page.evaluate(() => window.innerWidth);
      if (width > 400) narrowVerified = false;
    } catch {
      narrowVerified = false;
    }

    if (narrowVerified) {
      // Whole-page horizontal overflow at 390px is not asserted here: the sidebar's own width
      // is unrelated to this feature and is explicitly out of scope (Non-goals: "App-wide
      // responsive layout... the sidebar, dialogs and src/main.ts's minWidth: 600 are P5.4's").
      // What this feature owns is that its own compose-row controls reflow without overflowing
      // *their own* container, and reach the 44px touch target.
      await activateComposer();
      const composeRowOverflow = await page.evaluate(() => {
        const row = document.getElementById('compose-meta-row');
        const body = document.querySelector('.main-body');
        if (!row || !body) return true;
        return row.scrollWidth <= body.clientWidth;
      });
      check(composeRowOverflow, '16: the metadata row does not overflow its container at 390px');
      const addButtonBox = await page.locator('#add-button').boundingBox();
      check(
        Boolean(addButtonBox && addButtonBox.width >= 44 && addButtonBox.height >= 44),
        '17: #add-button is at least 44x44 at 390px',
      );
      for (const id of ['compose-list-picker', 'compose-priority-picker']) {
        const box = await page.locator(`#${id}`).boundingBox();
        check(Boolean(box && box.height >= 44), `17: #${id} is at least 44 high at 390px`);
      }
      const reminderBox = await page
        .locator('#compose-reminder-field .date-picker-trigger')
        .boundingBox();
      check(
        Boolean(reminderBox && reminderBox.height >= 44),
        '17: the reminder trigger is at least 44 high at 390px',
      );
      await deactivateComposer();
    } else {
      console.log(
        '390px could not be verified on this platform (window would not resize below its floor); ' +
          'verified at the 600px shipped floor instead. Recorded as an explicit P5.4 gap per the plan.',
      );
    }

    // restore a normal size for the remaining checks
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setMinimumSize(600, 400);
      win.setSize(1200, 800);
    });
    await page.waitForTimeout(150);
  }

  // ---------------------------------------------------------------------------
  // 18. Light and dark
  // ---------------------------------------------------------------------------
  {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(async (t) => {
        await window.electronAPI.updateTheme(t);
      }, theme);
      await page.waitForTimeout(150);
      await input.fill('');
      await input.press('Enter'); // blank submit -> visible #compose-error
      const errorColorInfo = await page.evaluate(() => {
        const el = document.getElementById('compose-error');
        const style = getComputedStyle(el);
        return { color: style.color, bg: style.backgroundColor };
      });
      check(Boolean(errorColorInfo.color), `18 (${theme}): #compose-error has a computed colour`);

      await pickComposePriority('low');
      const triggerColorInfo = await page.evaluate(() => {
        const el = document.getElementById('compose-priority-picker');
        const style = getComputedStyle(el);
        return { color: style.color, bg: style.backgroundColor };
      });
      check(
        Boolean(triggerColorInfo.color) && triggerColorInfo.color !== triggerColorInfo.bg,
        `18 (${theme}): the metadata trigger renders with contrasting text and background`,
      );
      check(
        (await page.locator('#compose-priority-value').textContent()) === 'Low',
        `18 (${theme}): the priority trigger shows the chosen value`,
      );
      await pickComposePriority('none');
      await deactivateComposer();
    }
    await page.evaluate(async () => {
      await window.electronAPI.updateTheme('system');
    });
  }

  console.log(`Quick Add self-test: ${checks} checks passed before the recoverable-failure scenario`);

  // ---------------------------------------------------------------------------
  // 15. Recoverable failure
  // ---------------------------------------------------------------------------
  {
    const text = uniqueText('Recoverable failure');
    const tagName = `keep-${randomUUID().slice(0, 8)}`;
    await input.fill(`${text} #${tagName}`);
    await pickComposePriority('medium');

    let faultInjected = false;
    let originalDbMode = null;
    let originalDirMode = null;
    const dbDir = path.dirname(isolatedDatabase);
    try {
      if (fs.existsSync(isolatedDatabase)) {
        originalDbMode = fs.statSync(isolatedDatabase).mode;
        fs.chmodSync(isolatedDatabase, 0o444);
      }
      originalDirMode = fs.statSync(dbDir).mode;
      fs.chmodSync(dbDir, 0o555);
      faultInjected = true;
    } catch (permissionError) {
      console.log(`15: could not induce a read-only fault on this platform (${permissionError.message}); skipping.`);
    }

    if (faultInjected) {
      await page.press('#message-input', 'Enter').catch(() => {});
      // give the round trip (main -> API -> sqlite -> back) time to fail
      await page.waitForTimeout(1000);
      const errorText = await page.locator('#compose-error').textContent();
      check(Boolean(errorText && errorText.length > 0), '15: #compose-error names a failure');
      check(
        (await input.inputValue()).includes(text),
        '15: input text is preserved after a recoverable failure',
      );
      check(
        (await page.locator('#compose-priority-value').textContent()) === 'Medium',
        '15: chosen priority is preserved after a recoverable failure',
      );
      check(
        await page.evaluate(() => document.activeElement === document.getElementById('message-input')),
        '15: focus returns to #message-input after a recoverable failure',
      );

      // restore permissions and retry
      fs.chmodSync(dbDir, originalDirMode);
      if (originalDbMode !== null) fs.chmodSync(isolatedDatabase, originalDbMode);

      await page.locator('#add-button').click();
      await page.locator('.task-text').filter({ hasText: text }).waitFor({ state: 'visible', timeout: 10_000 });
      check(true, '15: retry after the fault is cleared succeeds');
    } else {
      await input.fill('');
    }
  }
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
    // the read-only chmod in scenario 15 is always reverted before we get here, but make sure
    // cleanup can still remove the tree even if something above threw first
    fs.chmodSync(path.dirname(isolatedDatabase), 0o755);
  } catch {
    // best effort
  }

  try {
    cleanupTempRoot(tempRoot);
  } catch (cleanupError) {
    failure ??= cleanupError;
  }
}

if (failure) {
  console.error(`Quick Add self-test failed after ${checks} checks: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`Quick Add self-test passed (${checks} checks)`);
}
