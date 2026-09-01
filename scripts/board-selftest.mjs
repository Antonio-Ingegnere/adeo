// Multi-column board acceptance suite (isolated playwright-core Electron).
// Run with: npm run test:board
//
// Same safety posture as scripts/test-isolation-selftest.mjs / quick-add-selftest.mjs: a full
// ADEO_UI_TEST launch against an isolated userData dir + SQLite file, with the real dev
// database/settings snapshotted before and re-asserted byte-for-byte unchanged afterwards.
//
// Covers: create a board, add a List column + a Smart list column, reorder + remove a column,
// List->List move (listId write + Undo restores the snapshot), move into a priority:high
// column (priority write + the card appears in the destination), best-effort (preview +
// "Move anyway"), blocked (aria-disabled + reason), failed write (full rollback). Asserts the
// boards / board_columns rows exist in the isolated DB, and that initialize_db() creates them
// idempotently (run twice).

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

const sqlScalar = (sql, ...args) => {
  const script = [
    'import sqlite3, sys',
    'conn = sqlite3.connect(sys.argv[1])',
    'row = conn.execute(sys.argv[2], tuple(sys.argv[3:])).fetchone()',
    'conn.close()',
    'print("" if row is None else row[0])',
  ].join('; ');
  const result = spawnSync(pythonBin, ['-c', script, isolatedDatabase, sql, ...args.map(String)], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  check(result.status === 0, `sql query failed (${sql}): ${result.stderr}`);
  return result.stdout.trim();
};

const listIdByName = (name) => {
  const out = sqlScalar('SELECT id FROM lists WHERE name = ?', name);
  return out === '' ? null : Number(out);
};
const taskListId = (text) => {
  const out = sqlScalar('SELECT list_id FROM tasks WHERE text = ?', text);
  return out === '' ? null : Number(out);
};
const taskPriority = (text) => sqlScalar('SELECT priority FROM tasks WHERE text = ?', text);
const tableCount = (table) => Number(sqlScalar(`SELECT COUNT(*) FROM ${table}`));

// ---- initialize_db() idempotency (its own throwaway DB, run twice) --------------------------
{
  const probeDb = path.join(tempRoot, 'idempotency-probe.db');
  const script = [
    'import os, sys, sqlite3',
    `os.environ['ADEO_DB_PATH'] = ${JSON.stringify(probeDb)}`,
    `sys.path.insert(0, ${JSON.stringify(path.join(repoRoot, 'server'))})`,
    'from app import initialize_db',
    'initialize_db()',
    'initialize_db()',
    "conn = sqlite3.connect(os.environ['ADEO_DB_PATH'])",
    "names = {r[0] for r in conn.execute(\"SELECT name FROM sqlite_master WHERE type='table'\").fetchall()}",
    'conn.close()',
    "print('boards' in names and 'board_columns' in names)",
  ].join('\n');
  const result = spawnSync(pythonBin, ['-c', script], { cwd: repoRoot, encoding: 'utf8' });
  check(
    result.status === 0,
    `initialize_db() idempotency probe crashed: ${result.stderr || result.stdout}`,
  );
  check(
    result.stdout.trim() === 'True',
    `initialize_db() (run twice) did not create boards + board_columns (${result.stdout.trim()})`,
  );
}

let electronApp = null;
let failure = null;
let faultDirMode = null;
let faultDbMode = null;

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

  const listA = `Board A ${randomUUID().slice(0, 8)}`;
  const listB = `Board B ${randomUUID().slice(0, 8)}`;
  const tagName = `bt${randomUUID().slice(0, 6)}`;
  const smartHi = `HiPri ${randomUUID().slice(0, 6)}`;
  const smartBest = `BestEffort ${randomUUID().slice(0, 6)}`;
  const smartBlocked = `Blocked ${randomUUID().slice(0, 6)}`;

  await page.evaluate(
    async (f) => {
      await window.electronAPI.addList(f.listA);
      await window.electronAPI.addList(f.listB);
      await window.electronAPI.addTag(f.tagName);
      await window.electronAPI.addSmartList(f.smartHi, 'priority:high');
      await window.electronAPI.addSmartList(f.smartBest, `#${f.tagName} AND due<=2999-12-31`);
      await window.electronAPI.addSmartList(f.smartBlocked, 'text~zzznomatch');
    },
    { listA, listB, tagName, smartHi, smartBest, smartBlocked },
  );
  await page.reload();
  await input.waitFor({ state: 'visible' });

  const idA = listIdByName(listA);
  const idB = listIdByName(listB);
  check(Number.isInteger(idA) && Number.isInteger(idB), 'setup: both lists persisted');

  const t1 = `Board move alpha ${randomUUID()}`;
  const t2 = `Board move beta ${randomUUID()}`;
  const t3 = `Board move gamma ${randomUUID()}`;
  await page.evaluate(
    async (f) => {
      await window.electronAPI.addTask(f.t1, f.idA);
      await window.electronAPI.addTask(f.t2, f.idA);
      await window.electronAPI.addTask(f.t3, f.idA);
    },
    { t1, t2, t3, idA },
  );
  await page.reload();
  await input.waitFor({ state: 'visible' });

  // ---- helpers over the board DOM -------------------------------------------------------
  const region = page.locator('#board-region');
  const columns = page.locator('#board-region .board-column');
  const columnByName = (name) =>
    columns.filter({ has: page.locator('.view-picker', { hasText: name }) });
  const addColumn = async (name) => {
    await page.locator('.board-add-column').click();
    await page.locator('.board-source-menu').waitFor({ state: 'visible' });
    await page.locator('.board-source-menu .view-menu-item', { hasText: name }).first().click();
    await page.waitForTimeout(150);
  };
  const cardIn = (columnName, taskText) =>
    columnByName(columnName).locator('.board-card').filter({
      has: page.locator('.task-text', { hasText: taskText }),
    });
  const openMoveMenu = async (columnName, taskText) => {
    await cardIn(columnName, taskText).locator('.board-card__move').click();
    await page.locator('.board-move-menu').waitFor({ state: 'visible' });
  };
  const columnByNameAll = async () =>
    (await page.locator('#board-region .board-column .view-picker').allTextContents()).map((t) =>
      t.replace('▾', '').trim(),
    );

  // ---- 1. enter board view, add a List column + a Smart list column --------------------
  await page.locator('#add-board-button').click();
  await region.waitFor({ state: 'visible' });
  check(!(await region.isHidden()), '1: board region is shown after entering board view');
  // the seeded column is "No list" (previous view was All lists)
  await page.waitForTimeout(150);
  check((await columns.count()) === 1, '1: one seeded column');

  await addColumn(listA);
  await addColumn(smartHi);
  check((await columns.count()) === 3, '1: List + Smart list columns added (3 total)');
  check(
    (await page.locator('#board-region [role="group"]').count()) >= 3,
    '1: each column is a role="group"',
  );

  // ---- 2. reorder a column (keyboard-operable header menu) -----------------------------
  {
    const before = await columnByNameAll();
    await columns.nth(0).locator('.board-column__menu-btn').click();
    await page.locator('.board-column__menu').waitFor({ state: 'visible' });
    await page.locator('.board-column__menu .list-menu-item', { hasText: 'Move column right' }).click();
    await page.waitForTimeout(150);
    const after = await columnByNameAll();
    check(
      before[0] === after[1] && before[1] === after[0],
      `2: "Move column right" swapped columns 0 and 1 (${before} -> ${after})`,
    );
  }

  // ---- 3. remove a column (never deletes the List / Smart list) -----------------------
  {
    const target = columnByName('No list');
    await target.locator('.board-column__menu-btn').click();
    await page.locator('.board-column__menu').waitFor({ state: 'visible' });
    await page.locator('.board-column__menu .list-menu-item', { hasText: 'Remove column' }).click();
    await page.waitForTimeout(200);
    check((await columns.count()) === 2, '3: the column was removed');
    check(listIdByName(listA) === idA, '3: removing a column did not delete the List');
    check(
      Number(sqlScalar('SELECT COUNT(*) FROM smart_lists WHERE name = ?', smartHi)) === 1,
      '3: removing a column did not delete the Smart list',
    );
  }

  await addColumn(listB); // now: [listA, smartHi, listB]

  // ---- 4. List -> List move: listId write + Undo restores the snapshot ---------------
  {
    await openMoveMenu(listA, t1);
    await page
      .locator('.board-move-menu .list-menu-item', { hasText: `Move to "${listB}"` })
      .click();
    await page.locator('#board-toast:not([hidden])').waitFor({ state: 'visible' });
    check(
      /Moved/.test((await page.locator('#board-toast .board-toast__text').textContent()) || ''),
      '4: a "Moved" toast is shown',
    );
    await page.waitForTimeout(400);
    check(taskListId(t1) === idB, `4: listId was written to List B (got ${taskListId(t1)})`);

    await page.locator('#board-toast .board-toast__action', { hasText: 'Undo' }).click();
    await page.waitForTimeout(400);
    check(taskListId(t1) === idA, `4: Undo restored listId to List A (got ${taskListId(t1)})`);
    check(
      /undone/i.test((await page.locator('#board-live').textContent()) || ''),
      '4: the live region announces the undo',
    );
  }

  // ---- 5. Move into a priority:high column: priority write + card in destination ------
  {
    await openMoveMenu(listA, t2);
    await page
      .locator('.board-move-menu .list-menu-item', { hasText: `Move to "${smartHi}"` })
      .click();
    await page.locator('#board-toast:not([hidden])').waitFor({ state: 'visible' });
    await page.waitForTimeout(300);
    check(taskPriority(t2) === 'high', `5: priority was written to high (got ${taskPriority(t2)})`);
    check(
      (await cardIn(smartHi, t2).count()) === 1,
      '5: the moved card now appears in the priority:high column',
    );
    await page.locator('#board-toast .board-toast__action', { hasText: 'Dismiss' }).click();
  }

  // ---- 6. Best-effort: modal dialog + message + buttons --------------------------------
  {
    await addColumn(smartBest); // #tag AND due<=2999-12-31 -> range is skipped
    await openMoveMenu(listA, t3);
    await page
      .locator('.board-move-menu .list-menu-item', { hasText: `Move to "${smartBest}"` })
      .click();
    await page.locator('#board-move-overlay.open').waitFor({ state: 'visible' });
    check(
      /may not stay in/i.test(
        (await page.locator('#board-move-message').textContent()) || '',
      ),
      '6: the dialog message mentions "may not stay in"',
    );
    check(
      (await page.locator('#board-move-confirm').count()) === 1,
      '6: "Move task anyway" button exists',
    );
    check(
      (await page.locator('#board-move-open').count()) === 1,
      '6: "Open task" button exists',
    );
    check(
      (await page.locator('#board-move-cancel').count()) === 1,
      '6: "Cancel" button exists',
    );
    check(
      (await page.locator('#board-move-confirm').textContent()) === 'Move task anyway',
      '6: confirm button has correct text',
    );
    check(
      (await page.locator('#board-move-open').textContent()) === 'Open task',
      '6: open button has correct text',
    );
    check(
      (await page.locator('#board-move-cancel').textContent()) === 'Cancel',
      '6: cancel button has correct text',
    );
    await page.locator('#board-move-cancel').click();
    check(
      !(await page.locator('#board-move-overlay').evaluate((el) => el.classList.contains('open'))),
      '6: Cancel dismisses the dialog',
    );
    check(
      (await page.locator(`.board-column:has-text("${smartBest}") .task-row .task-text`, { hasText: t3 }).count()) === 0,
      '6: task did not move (still in original column)',
    );
  }

  // ---- 7. Blocked: destination is aria-disabled with a reason ------------------------
  {
    await addColumn(smartBlocked); // text~zzznomatch -> nothing invertible
    await openMoveMenu(listA, t3);
    const blockedItem = page
      .locator('.board-move-menu .list-menu-item')
      .filter({ hasText: smartBlocked });
    check(
      (await blockedItem.getAttribute('aria-disabled')) === 'true',
      '7: the blocked destination is aria-disabled',
    );
    check(
      /can't move here/i.test((await blockedItem.textContent()) || ''),
      '7: the blocked item states why',
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
  }

  // ---- 8. Failed write: full rollback, task left in its source -----------------------
  {
    const dbDir = path.dirname(isolatedDatabase);
    let faultInjected = false;
    try {
      if (fs.existsSync(isolatedDatabase)) {
        faultDbMode = fs.statSync(isolatedDatabase).mode;
        fs.chmodSync(isolatedDatabase, 0o444);
      }
      faultDirMode = fs.statSync(dbDir).mode;
      fs.chmodSync(dbDir, 0o555);
      faultInjected = true;
    } catch (permissionError) {
      console.log(`8: could not induce a read-only fault (${permissionError.message}); skipping.`);
    }

    if (faultInjected) {
      await openMoveMenu(listA, t1);
      await page
        .locator('.board-move-menu .list-menu-item', { hasText: `Move to "${listB}"` })
        .click();
      await page.waitForTimeout(1500);
      const toast = (await page.locator('#board-toast .board-toast__text').textContent()) || '';
      check(/couldn.?t move/i.test(toast), `8: an error toast is shown (got "${toast}")`);

      fs.chmodSync(dbDir, faultDirMode);
      if (faultDbMode !== null) fs.chmodSync(isolatedDatabase, faultDbMode);
      faultDirMode = null;
      faultDbMode = null;

      check(taskListId(t1) === idA, `8: the failed move left the task in List A (got ${taskListId(t1)})`);
    }
  }

  // ---- 9. boards / board_columns rows exist in the isolated DB ----------------------
  check(tableCount('boards') >= 1, '9: a board row was persisted');
  check(tableCount('board_columns') >= 1, '9: board_columns rows were persisted');
} catch (error) {
  failure = error;
} finally {
  if (faultDirMode !== null) {
    try {
      fs.chmodSync(path.dirname(isolatedDatabase), faultDirMode);
    } catch {
      /* best effort */
    }
  }
  if (faultDbMode !== null) {
    try {
      fs.chmodSync(isolatedDatabase, faultDbMode);
    } catch {
      /* best effort */
    }
  }

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
    fs.chmodSync(path.dirname(isolatedDatabase), 0o755);
  } catch {
    /* best effort */
  }

  try {
    cleanupTempRoot(tempRoot);
  } catch (cleanupError) {
    failure ??= cleanupError;
  }
}

if (failure) {
  console.error(`Board self-test failed after ${checks} checks: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`Board self-test passed (${checks} checks)`);
}
