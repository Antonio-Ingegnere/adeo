// Sidebar UI-state persistence acceptance suite (isolated playwright-core Electron).
// Run with: npm run test:sidebar-state
//
// Same safety posture as scripts/board-selftest.mjs: a full ADEO_UI_TEST launch against an
// isolated userData dir + SQLite file, with the real dev database/settings snapshotted before
// and re-asserted byte-for-byte unchanged afterwards.
//
// Covers, across a real app relaunch (two separate Electron processes sharing one isolated
// userData dir):
//   1. collapse a sidebar section + select a list + apply a tag filter -> settings.json gains
//      a sanitized `sidebarUi` block (section flag false, selection {kind:'list',id}, tagFilterId)
//   2. on relaunch the section stays collapsed, the list is re-selected with its main view
//      (#view-label), and the tag filter chip is restored
//   3. a saved selection pointing at a now-deleted list falls back to "All lists" without error
//   4. a corrupt settings.json boots cleanly to defaults (section expanded, "All lists", no chip)

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
const settingsPath = path.join(isolatedUserData, 'settings.json');

const readSettings = () => {
  if (!fs.existsSync(settingsPath)) return null;
  return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
};

const launch = () =>
  electron.launch({
    executablePath: electronExecutable,
    args: [`--user-data-dir=${bootstrapUserData}`, repoRoot],
    cwd: repoRoot,
    env: isolatedEnvironment({ isolatedUserData, isolatedDatabase, pythonBin }),
  });

let electronApp = null;
let failure = null;

try {
  // ---- Launch 1: mutate sidebar state, expect it persisted ------------------------------
  electronApp = await launch();
  let page = await electronApp.firstWindow();
  await page.emulateMedia({ colorScheme: null });
  let input = page.locator('#message-input');
  await input.waitFor({ state: 'visible' });

  const listName = `SB List ${randomUUID().slice(0, 8)}`;
  const smartName = `SB Smart ${randomUUID().slice(0, 8)}`;
  const tagName = `sbtag${randomUUID().slice(0, 6)}`;

  const seeded = await page.evaluate(
    async (f) => {
      const list = await window.electronAPI.addList(f.listName);
      await window.electronAPI.addSmartList(f.smartName, 'priority:high');
      const tag = await window.electronAPI.addTag(f.tagName);
      return { listId: list && list.id, tagId: tag && tag.id };
    },
    { listName, smartName, tagName },
  );
  check(Number.isInteger(seeded.listId), 'setup: list persisted');
  check(Number.isInteger(seeded.tagId), 'setup: tag persisted');

  await page.reload();
  input = page.locator('#message-input');
  await input.waitFor({ state: 'visible' });

  const smartListContainer = page.locator('#smart-lists-list');
  check(!(await smartListContainer.isHidden()), '1: smart-lists section starts expanded');

  // collapse the smart-lists section
  await page.locator('#smart-lists-toggle').click();
  await page.waitForTimeout(100);
  check(await smartListContainer.isHidden(), '1: smart-lists section collapsed after toggle');

  // select the created list
  await page.locator('#lists-list .list-pill', { hasText: listName }).click();
  await page.waitForTimeout(100);
  check(
    (await page.locator('#view-label').textContent())?.trim() === listName,
    '1: main view label follows the selected list',
  );
  check(
    (await page
      .locator('#lists-list .list-pill.selected .list-pill-label')
      .textContent())?.trim() === listName,
    '1: the list pill is marked selected',
  );

  // apply a tag filter
  await page.locator('#tags-list .list-pill', { hasText: tagName }).click();
  await page.waitForTimeout(100);
  check(
    !(await page.locator('#tag-filter-chip').isHidden()),
    '1: tag filter chip is shown after filtering by tag',
  );

  // wait past the 150ms persist debounce, then close
  await page.waitForTimeout(500);
  const persisted = readSettings();
  check(persisted && persisted.sidebarUi, '1: settings.json gained a sidebarUi block');
  check(
    persisted.sidebarUi.sections.smartLists === false,
    `1: collapsed smart-lists section persisted (got ${JSON.stringify(persisted.sidebarUi.sections)})`,
  );
  check(
    persisted.sidebarUi.selection &&
      persisted.sidebarUi.selection.kind === 'list' &&
      persisted.sidebarUi.selection.id === seeded.listId,
    `1: list selection persisted (got ${JSON.stringify(persisted.sidebarUi.selection)})`,
  );
  check(
    persisted.sidebarUi.tagFilterId === seeded.tagId,
    `1: tag filter persisted (got ${persisted.sidebarUi.tagFilterId})`,
  );

  await electronApp.close();
  electronApp = null;

  // ---- Launch 2: the saved state is restored -------------------------------------------
  electronApp = await launch();
  page = await electronApp.firstWindow();
  await page.emulateMedia({ colorScheme: null });
  input = page.locator('#message-input');
  await input.waitFor({ state: 'visible' });
  await page.waitForTimeout(300);

  check(
    await page.locator('#smart-lists-list').isHidden(),
    '2: collapsed smart-lists section is restored on relaunch',
  );
  check(
    (await page.locator('#view-label').textContent())?.trim() === listName,
    '2: last selected list + its main view are restored on relaunch',
  );
  check(
    (await page
      .locator('#lists-list .list-pill.selected .list-pill-label')
      .textContent())?.trim() === listName,
    '2: the restored list pill is marked selected',
  );
  const chip = page.locator('#tag-filter-chip');
  check(!(await chip.isHidden()), '2: tag filter chip is restored on relaunch');
  check(
    ((await chip.textContent()) || '').includes(tagName),
    '2: the restored tag filter chip names the saved tag',
  );

  await electronApp.close();
  electronApp = null;

  // ---- Launch 3: saved selection points at a deleted list -> fall back to All lists -----
  {
    const s = readSettings();
    s.sidebarUi.selection = { kind: 'list', id: 999999 };
    s.sidebarUi.tagFilterId = 999999;
    s.sidebarUi.sections.smartLists = true;
    fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));
  }
  electronApp = await launch();
  page = await electronApp.firstWindow();
  await page.emulateMedia({ colorScheme: null });
  input = page.locator('#message-input');
  await input.waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
  check(
    (await page.locator('#view-label').textContent())?.trim() === 'All lists',
    '3: a saved selection for a deleted list falls back to "All lists"',
  );
  check(
    await page.locator('#tag-filter-chip').isHidden(),
    '3: a saved tag filter for a deleted tag is dropped',
  );
  await electronApp.close();
  electronApp = null;

  // ---- Launch 4: corrupt settings.json -> clean boot to defaults -----------------------
  fs.writeFileSync(settingsPath, '}{ this is not json');
  electronApp = await launch();
  page = await electronApp.firstWindow();
  await page.emulateMedia({ colorScheme: null });
  input = page.locator('#message-input');
  await input.waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
  check(
    (await page.locator('#view-label').textContent())?.trim() === 'All lists',
    '4: a corrupt settings.json boots to the default "All lists" view',
  );
  check(
    !(await page.locator('#smart-lists-list').isHidden()),
    '4: a corrupt settings.json leaves sidebar sections at their expanded default',
  );
  await electronApp.close();
  electronApp = null;
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
  console.error(`Sidebar-state self-test failed after ${checks} checks: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`Sidebar-state self-test passed (${checks} checks)`);
}
