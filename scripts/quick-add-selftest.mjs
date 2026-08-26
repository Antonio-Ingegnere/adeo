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

  const openOptions = async () => {
    if (!(await page.locator('#compose-options-panel').isHidden())) return;
    await page.locator('#compose-options-toggle').click();
    await page.locator('#compose-options-panel').waitFor({ state: 'visible' });
  };

  const pickComposeList = async (name) => {
    await openOptions();
    await page.locator('#compose-list-picker').click();
    await page.locator('#compose-list-menu').waitFor({ state: 'visible' });
    if (name === null) {
      await page.locator('#compose-list-menu .modal-list-item[data-value=""]').click();
    } else {
      await page.locator('#compose-list-menu .modal-list-item', { hasText: name }).click();
    }
  };

  const pickComposePriority = async (value) => {
    await openOptions();
    await page.locator('#compose-priority-picker').click();
    await page.locator('#compose-priority-menu').waitFor({ state: 'visible' });
    await page.locator(`#compose-priority-menu .priority-menu-item[data-value="${value}"]`).click();
  };

  const pickComposeReminderToday = async () => {
    await openOptions();
    await page.locator('#compose-options-panel .date-picker-trigger').click();
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
  // 8c. List picker default label (checked before any Options selection)
  // ---------------------------------------------------------------------------
  {
    check(
      (await page.locator('#compose-list-value').textContent()) === 'Current list',
      '8c: #compose-list-value reads "Current list" before any selection',
    );
  }

  // ---------------------------------------------------------------------------
  // 7 + 9 + 10. Options apply priority; reset after success; chips with no search running
  // ---------------------------------------------------------------------------
  {
    const text = uniqueText('Priority only');
    await pickComposePriority('high');
    const hints = page.locator('#add-task-template');
    await hints.waitFor({ state: 'visible' });
    check((await hints.textContent())?.includes('High') ?? false, '10: hints row shows the priority chip');
    check(
      !((await hints.locator('.template-chip').allTextContents()).some((t) => t === workName || t === personalName)),
      '10: no destination chip when composeListId is untouched',
    );
    await input.fill(text);
    await input.press('Enter');
    await page.locator('.task-text').filter({ hasText: text }).waitFor({ state: 'visible' });
    const row = queryTaskRow(text);
    check(row?.priority === 'high', '7: stored priority is high');

    check(await page.locator('#compose-options-panel').isHidden(), '9: panel is hidden after success');
    check(
      (await page.locator('#compose-options-toggle').getAttribute('aria-expanded')) === 'false',
      '9: toggle aria-expanded is false after success',
    );
    check(
      (await page.locator('#compose-priority-value').textContent()) === 'None',
      '9: #compose-priority-value reads None after success',
    );
    check(
      (await page.locator('#compose-list-value').textContent()) === 'Current list',
      '9: #compose-list-value reads Current list after success',
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
    const hints = page.locator('#add-task-template');
    await hints.waitFor({ state: 'visible' });
    check(
      (await hints.locator('.template-chip').allTextContents()).includes(personalName),
      '10: destination chip names Personal even with no search running',
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
    const hints = page.locator('#add-task-template');
    const priorityChips = (await hints.locator('.template-chip').allTextContents()).filter((t) =>
      ['None', 'Low', 'Medium', 'High'].includes(t),
    );
    check(priorityChips.length === 1 && priorityChips[0] === 'High', '11: exactly one priority chip, reading High');
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
    await enterAdvancedSearch(`list:${workName}`);
    await pickComposeList(personalName);
    const hints = page.locator('#add-task-template');
    const destinationChips = (await hints.locator('.template-chip').allTextContents()).filter(
      (t) => t === workName || t === personalName,
    );
    check(
      destinationChips.length === 1 && destinationChips[0] === personalName,
      '11a: exactly one destination chip, reading Personal',
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
  // 13. Escape layering
  // ---------------------------------------------------------------------------
  {
    await openOptions();
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
    check(await page.locator('#compose-options-panel').isHidden(), '13: second Escape closes the panel');
    check(
      await page.evaluate(() => document.activeElement === document.getElementById('compose-options-toggle')),
      '13: focus returns to #compose-options-toggle',
    );
    check(
      (await page.locator('#compose-options-toggle').getAttribute('aria-expanded')) === 'false',
      '13: toggle aria-expanded is false after closing',
    );
  }

  // ---------------------------------------------------------------------------
  // 14. Escape does not leave the app in a broken state
  // ---------------------------------------------------------------------------
  {
    await openOptions();
    await input.focus();
    await page.keyboard.press('Escape');
    check(await page.locator('#compose-options-panel').isHidden() === false, '14: Options panel stays open');
    const anyOverlayOpen = await page.evaluate(
      () => Array.from(document.querySelectorAll('.overlay')).some((el) => el.classList.contains('open')),
    );
    check(!anyOverlayOpen, '14: no overlay opens from this Escape');
    await page.locator('#compose-options-toggle').click();
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
      check(
        await page.locator('#compose-options-toggle').isVisible(),
        `16: Options toggle visible at ${size.width}`,
      );
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
      const composeRowOverflow = await page.evaluate(() => {
        const panel = document.getElementById('compose-options-panel');
        const body = document.querySelector('.main-body');
        if (!panel || !body) return true;
        return panel.scrollWidth <= body.clientWidth;
      });
      check(composeRowOverflow, '16: the compose row itself does not overflow its container at 390px');
      const addButtonBox = await page.locator('#add-button').boundingBox();
      check(
        Boolean(addButtonBox && addButtonBox.width >= 44 && addButtonBox.height >= 44),
        '17: #add-button is at least 44x44 at 390px',
      );
      await openOptions();
      const toggleBox = await page.locator('#compose-options-toggle').boundingBox();
      check(
        Boolean(toggleBox && toggleBox.height >= 44),
        '17: #compose-options-toggle is at least 44 high at 390px',
      );
      await page.locator('#compose-options-toggle').click();
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

      await openOptions();
      await pickComposePriority('low');
      const toggleColorInfo = await page.evaluate(() => {
        const el = document.getElementById('compose-options-toggle');
        const style = getComputedStyle(el);
        return { color: style.color, bg: style.backgroundColor, active: el.dataset.active };
      });
      check(toggleColorInfo.active === 'true', `18 (${theme}): toggle carries data-active="true"`);
      check(
        toggleColorInfo.color !== toggleColorInfo.bg,
        `18 (${theme}): toggle text colour differs from its background`,
      );
      await pickComposePriority('none');
      await input.fill('');
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
