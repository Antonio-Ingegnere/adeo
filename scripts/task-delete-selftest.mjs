// Task delete acceptance suite.
// Run with: npm run test:task-delete
//
// Same shape and safety posture as scripts/quick-add-selftest.mjs: a full ADEO_UI_TEST launch
// against an isolated userData dir + SQLite file, with the real dev database/settings
// snapshotted before and re-asserted byte-unchanged in the finally block.
//
// Covers the two new delete entry points on a .task-row:
//   - the hover-revealed kebab (.task-menu-btn, icon-more at 18px) -> confirm -> DELETE
//   - right-click -> .task-context-menu -> Delete -> confirm -> DELETE
//   - Cancel in the confirm dialog is a no-op (nothing removed from DOM or DB)
//   - right-click then click elsewhere dismisses the menu with no deletion
//   - deleting the last visible task falls back to the empty state
//
// The confirm step is the app-owned client-side confirm dialog (#app-confirm-overlay in
// index.html, src/renderer/confirmDialog.ts) -- no native dialog and no main-process stubbing
// needed. Each scenario waits for the overlay to open, then clicks its Delete or Cancel button.

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

  const confirmOverlay = page.locator('#app-confirm-overlay');
  const confirmConfirmBtn = page.locator('#app-confirm-confirm');
  const confirmCancelBtn = page.locator('#app-confirm-cancel');

  // Waits for the app confirm dialog to open, then clicks Delete (accept=true) or Cancel.
  const respondToConfirm = async (accept) => {
    await confirmOverlay.waitFor({ state: 'visible' });
    await (accept ? confirmConfirmBtn : confirmCancelBtn).click();
    await confirmOverlay.waitFor({ state: 'hidden' });
  };

  const addTask = async (text) => {
    await input.fill(text);
    await input.press('Enter');
    await page.locator('.task-text').filter({ hasText: text }).waitFor({ state: 'visible' });
  };

  const rowFor = (text) =>
    page.locator('.task-row', { has: page.locator('.task-text', { hasText: text }) });

  // ---------------------------------------------------------------------------
  // 1. Kebab -> context menu -> Delete -> confirm Delete -> row gone from DOM and DB
  // ---------------------------------------------------------------------------
  {
    const text = `Kebab delete ${randomUUID()}`;
    await addTask(text);
    check(countTasksWithText(text) === 1, '1: task persisted before delete');

    const row = rowFor(text);
    await row.hover();
    const kebab = row.locator('.task-menu-btn');
    await kebab.waitFor({ state: 'visible' });

    // exact icon + size reuse: same glyph and 18px box as the sidebar .list-menu-btn
    const svgBox = await kebab.locator('svg.icon-more').boundingBox();
    check(Boolean(svgBox), '1: the kebab renders the shared svg.icon-more glyph');
    check(
      svgBox && Math.round(svgBox.width) === 18 && Math.round(svgBox.height) === 18,
      `1: the kebab icon is 18x18 (got ${svgBox && Math.round(svgBox.width)}x${svgBox && Math.round(svgBox.height)})`,
    );

    await kebab.click();
    const menu = page.locator('.task-context-menu');
    await menu.waitFor({ state: 'visible' });
    const deleteItem = menu.locator('.list-menu-item', { hasText: 'Delete' });
    check(await deleteItem.count() === 1, '1: kebab click opens the context menu with a Delete item');

    await deleteItem.click();
    await respondToConfirm(true);
    await row.waitFor({ state: 'detached' });
    await page.waitForTimeout(200);
    check(countTasksWithText(text) === 0, '1: task removed from the database via the existing DELETE path');
  }

  // ---------------------------------------------------------------------------
  // 2. Kebab visibility is hover-gated (matches the .drag-handle idiom)
  // ---------------------------------------------------------------------------
  {
    const text = `Hover gate ${randomUUID()}`;
    await addTask(text);
    const row = rowFor(text);
    const kebab = row.locator('.task-menu-btn');
    check(await kebab.count() === 1, '2: the kebab exists in the row markup');
    // park the pointer well away from the list so no row is under :hover from a prior step
    await page.mouse.move(5, 5);
    await page.waitForTimeout(100);
    check(await kebab.isHidden(), '2: the kebab is hidden until the row is hovered');
    await row.hover();
    await kebab.waitFor({ state: 'visible' });
    check(true, '2: hovering the row reveals the kebab');
    // clean up this fixture row: kebab -> menu -> Delete -> confirm -> detached
    await kebab.click();
    const menu = page.locator('.task-context-menu');
    await menu.waitFor({ state: 'visible' });
    await menu.locator('.list-menu-item', { hasText: 'Delete' }).click();
    await respondToConfirm(true);
    await row.waitFor({ state: 'detached' });
  }

  // ---------------------------------------------------------------------------
  // 3. Right-click -> context menu -> Delete -> row gone from DOM and DB
  // ---------------------------------------------------------------------------
  {
    const text = `Right click delete ${randomUUID()}`;
    await addTask(text);
    const row = rowFor(text);
    await row.click({ button: 'right' });
    const menu = page.locator('.task-context-menu');
    await menu.waitFor({ state: 'visible' });
    const deleteItem = menu.locator('.list-menu-item', { hasText: 'Delete' });
    check(await deleteItem.count() === 1, '3: the context menu offers a single Delete item');

    await deleteItem.click();
    await respondToConfirm(true);
    await row.waitFor({ state: 'detached' });
    await page.waitForTimeout(200);
    check(countTasksWithText(text) === 0, '3: right-click Delete removed the task from the database');
    check(await menu.isHidden(), '3: the context menu is hidden after acting');
  }

  // ---------------------------------------------------------------------------
  // 4. Confirm dialog Cancel is a no-op (kebab path)
  // ---------------------------------------------------------------------------
  {
    const text = `Cancel keeps ${randomUUID()}`;
    await addTask(text);
    const row = rowFor(text);
    await row.hover();
    const kebab = row.locator('.task-menu-btn');
    await kebab.waitFor({ state: 'visible' });

    await kebab.click();
    const menu = page.locator('.task-context-menu');
    await menu.waitFor({ state: 'visible' });
    const deleteItem = menu.locator('.list-menu-item', { hasText: 'Delete' });
    await deleteItem.click();
    await respondToConfirm(false);
    await page.waitForTimeout(400);
    check(await row.count() === 1, '4: the row is still present after Cancel');
    check(countTasksWithText(text) === 1, '4: the task is still in the database after Cancel');

    // and now really delete it so it does not leak into later scenarios
    await row.hover();
    await row.locator('.task-menu-btn').click();
    await menu.waitFor({ state: 'visible' });
    await menu.locator('.list-menu-item', { hasText: 'Delete' }).click();
    await respondToConfirm(true);
    await row.waitFor({ state: 'detached' });
  }

  // ---------------------------------------------------------------------------
  // 5. Right-click then click elsewhere dismisses the menu with no deletion
  // ---------------------------------------------------------------------------
  {
    const text = `Dismiss menu ${randomUUID()}`;
    await addTask(text);
    const row = rowFor(text);
    await row.click({ button: 'right' });
    const menu = page.locator('.task-context-menu');
    await menu.waitFor({ state: 'visible' });
    // click a neutral spot away from the menu
    await page.locator('#message-input').click();
    await page.waitForTimeout(150);
    check(await menu.isHidden(), '5: an outside click hides the context menu');
    check(await row.count() === 1, '5: nothing was deleted by opening and dismissing the menu');
    check(countTasksWithText(text) === 1, '5: the task is still in the database');

    await row.hover();
    await row.locator('.task-menu-btn').click();
    const deleteMenu = page.locator('.task-context-menu');
    await deleteMenu.waitFor({ state: 'visible' });
    await deleteMenu.locator('.list-menu-item', { hasText: 'Delete' }).click();
    await respondToConfirm(true);
    await row.waitFor({ state: 'detached' });
  }

  // ---------------------------------------------------------------------------
  // 6. Deleting the last visible task falls back to the empty state
  // ---------------------------------------------------------------------------
  {
    // clear whatever remains from earlier scenarios, then add exactly one
    const remaining = await page.locator('.task-row').count();
    for (let i = 0; i < remaining; i += 1) {
      const first = page.locator('.task-row').first();
      await first.hover();
      await first.locator('.task-menu-btn').click();
      const clearMenu = page.locator('.task-context-menu');
      await clearMenu.waitFor({ state: 'visible' });
      await clearMenu.locator('.list-menu-item', { hasText: 'Delete' }).click();
      await respondToConfirm(true);
      await first.waitFor({ state: 'detached' });
    }
    check(await page.locator('.task-row').count() === 0, '6 setup: list emptied');

    const text = `Last task ${randomUUID()}`;
    await addTask(text);
    const row = rowFor(text);
    await row.hover();
    await row.locator('.task-menu-btn').click();
    const lastMenu = page.locator('.task-context-menu');
    await lastMenu.waitFor({ state: 'visible' });
    await lastMenu.locator('.list-menu-item', { hasText: 'Delete' }).click();
    await respondToConfirm(true);
    await row.waitFor({ state: 'detached' });
    await page.locator('#empty-state').waitFor({ state: 'visible' });
    check(true, '6: deleting the only task shows the empty state');
    check(countTasksWithText(text) === 0, '6: the last task is gone from the database');
  }

  console.log(`Task delete self-test: ${checks} scenario checks passed before teardown`);
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
  console.error(`Task delete self-test failed after ${checks} checks: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`Task delete self-test passed (${checks} checks)`);
}
