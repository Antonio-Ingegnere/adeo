// Edit Task modal header-delete acceptance suite (design variant B: header icon action).
// Run with: npm run test:edit-modal-delete
//
// Same isolated-Electron harness as scripts/task-delete-selftest.mjs: real Electron app,
// isolated userData dir + SQLite file, real dev database/settings snapshotted and re-asserted
// byte-unchanged in the finally block. Narrow smoke, not a viewport/theme matrix.
//
// Covers only the new header trash-icon delete action added to #edit-overlay:
//   - the icon is persistently visible (no hover needed), next to the "Edit task" heading
//   - click -> confirm Delete -> reuses the same confirmDeleteTask/deleteTask IPC as the row
//     kebab -> task removed from DOM and DB, and the edit modal closes
//   - click -> confirm Cancel -> task and modal are unchanged (no-op)

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

const assertProtectedFilesUnchanged = createProtectedFilesGuard();

const pythonBin = resolvePythonBin(repoRoot);
const { tempRoot, isolatedUserData, isolatedDatabase, bootstrapUserData } = createIsolatedPaths();

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

  // response: 1 -> the confirm dialog's "Delete"; 0 -> "Cancel".
  const setConfirmResponse = async (response) => {
    await electronApp.evaluate(({ dialog }, value) => {
      dialog.showMessageBox = async () => ({ response: value });
    }, response);
  };

  const addTask = async (text) => {
    await input.fill(text);
    await input.press('Enter');
    await page.locator('.task-text').filter({ hasText: text }).waitFor({ state: 'visible' });
  };

  const rowFor = (text) =>
    page.locator('.task-row', { has: page.locator('.task-text', { hasText: text }) });

  const overlay = page.locator('#edit-overlay');
  const headerDelete = page.locator('#delete-edit-task');

  // ---------------------------------------------------------------------------
  // 1. Header trash icon is persistently visible in the edit modal (no hover gate)
  // ---------------------------------------------------------------------------
  {
    const text = `Header delete visible ${randomUUID()}`;
    await addTask(text);
    await rowFor(text).locator('.task-text').click();
    await overlay.waitFor({ state: 'visible' });
    check(await headerDelete.isVisible(), '1: the header delete icon is visible without hovering it');
    const svgBox = await headerDelete.locator('svg').boundingBox();
    check(Boolean(svgBox), '1: the header delete icon renders an svg glyph');

    // close without deleting, to isolate this check from the delete flow below
    await page.locator('#cancel-edit').click();
    await overlay.waitFor({ state: 'hidden' });
  }

  // ---------------------------------------------------------------------------
  // 2. Header delete -> confirm Delete -> reuses existing IPC -> row+DB gone, modal closes
  // ---------------------------------------------------------------------------
  {
    const text = `Header delete confirm ${randomUUID()}`;
    await addTask(text);
    check(countTasksWithText(text) === 1, '2: task persisted before delete');

    const row = rowFor(text);
    await row.locator('.task-text').click();
    await overlay.waitFor({ state: 'visible' });

    await setConfirmResponse(1);
    await headerDelete.click();
    await overlay.waitFor({ state: 'hidden' });
    await row.waitFor({ state: 'detached' });
    await page.waitForTimeout(200);
    check(countTasksWithText(text) === 0, '2: task removed from the database via the existing deleteTask IPC');
  }

  // ---------------------------------------------------------------------------
  // 3. Header delete -> confirm Cancel -> no-op, modal stays open, task survives
  // ---------------------------------------------------------------------------
  {
    const text = `Header delete cancel ${randomUUID()}`;
    await addTask(text);
    const row = rowFor(text);
    await row.locator('.task-text').click();
    await overlay.waitFor({ state: 'visible' });

    await setConfirmResponse(0);
    await headerDelete.click();
    await page.waitForTimeout(400);
    check(await overlay.isVisible(), '3: the edit modal stays open after Cancel');
    check(countTasksWithText(text) === 1, '3: the task is still in the database after Cancel');

    await page.locator('#cancel-edit').click();
    await overlay.waitFor({ state: 'hidden' });
    check(await row.count() === 1, '3: the row is still present after Cancel');

    // clean up this fixture row via the existing row kebab path
    await row.hover();
    await row.locator('.task-menu-btn').click();
    const menu = page.locator('.task-context-menu');
    await menu.waitFor({ state: 'visible' });
    await setConfirmResponse(1);
    await menu.locator('.list-menu-item', { hasText: 'Delete' }).click();
    await row.waitFor({ state: 'detached' });
  }

  console.log(`Edit modal delete self-test: ${checks} scenario checks passed before teardown`);
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
  console.error(`Edit modal delete self-test failed after ${checks} checks: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`Edit modal delete self-test passed (${checks} checks)`);
}
