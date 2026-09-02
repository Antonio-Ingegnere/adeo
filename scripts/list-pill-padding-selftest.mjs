// Sidebar .list-pill padding regression smoke -- keeps list / smart-list / board / tag rows at
// a reasonable, consistent row height after the "very big padding" reduction.
// Run with: npm run test:list-pill
//
// Same safety posture as scripts/quick-add-selftest.mjs: a full ADEO_UI_TEST launch against an
// isolated userData dir + SQLite file, with the real dev database/settings snapshotted before
// and re-asserted byte-for-byte unchanged in the finally block.

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

  // One of every sidebar item that renders a .list-pill: a plain list, a smart list, a board
  // and a tag -- created through the same IPC the app uses, then a reload so each panel renders.
  const listName = `PP List ${randomUUID().slice(0, 8)}`;
  const smartName = `PP Smart ${randomUUID().slice(0, 8)}`;
  const boardName = `PP Board ${randomUUID().slice(0, 8)}`;
  const tagName = `pp${randomUUID().slice(0, 6)}`;
  await page.evaluate(
    async (f) => {
      await window.electronAPI.addList(f.listName);
      await window.electronAPI.addSmartList(f.smartName, 'priority:high');
      await window.electronAPI.addBoard(f.boardName);
      await window.electronAPI.addTag(f.tagName);
    },
    { listName, smartName, boardName, tagName },
  );
  await page.reload();
  await input.waitFor({ state: 'visible' });

  const variants = [
    ['list', '.list-pill:not(.smart-list-pill):not(.board-pill):not(.tag-pill)'],
    ['smart list', '.list-pill.smart-list-pill'],
    ['board', '.list-pill.board-pill'],
    ['tag', '.list-pill.tag-pill'],
  ];

  const metrics = [];
  for (const [label, selector] of variants) {
    const el = page.locator(selector).first();
    await el.waitFor({ state: 'visible' });
    const box = await el.evaluate((node) => {
      const cs = getComputedStyle(node);
      return {
        paddingTop: parseFloat(cs.paddingTop),
        paddingBottom: parseFloat(cs.paddingBottom),
        paddingLeft: parseFloat(cs.paddingLeft),
        height: node.getBoundingClientRect().height,
      };
    });
    metrics.push({ label, ...box });

    check(
      box.paddingTop === box.paddingBottom,
      `${label} pill: vertical padding is symmetric (got ${box.paddingTop}/${box.paddingBottom})`,
    );
    check(
      box.paddingTop > 0 && box.paddingTop <= 6,
      `${label} pill: vertical padding reduced to a reasonable size (got ${box.paddingTop}px, want 0 < p <= 6)`,
    );
    check(
      box.height >= 20,
      `${label} pill: row stays comfortably clickable (height ${box.height}px, want >= 20)`,
    );
  }

  const first = metrics[0];
  for (const m of metrics.slice(1)) {
    check(
      m.paddingTop === first.paddingTop && m.paddingLeft === first.paddingLeft,
      `${m.label} pill padding matches the list pill (${m.paddingTop}/${m.paddingLeft} vs ${first.paddingTop}/${first.paddingLeft})`,
    );
  }

  check(
    first.paddingLeft >= 8,
    `list pill keeps its horizontal inset for text alignment (got ${first.paddingLeft}px)`,
  );

  // D-003 (reopen of D-002): the hover kebab (.list-menu-btn) is 26px tall and
  // only visibility:hidden, so while it stayed in the flex flow it forced every
  // .list-pill that carries it (real lists, smart lists, boards, tags) to 34px,
  // 12px taller than a label-only row. All four variants must now measure 22px,
  // and no sidebar chrome row (panel header, +/new-board buttons, toggles) may
  // exceed a list-pill row.
  const totalBox = (node) => {
    const cs = getComputedStyle(node);
    return (
      node.getBoundingClientRect().height +
      parseFloat(cs.marginTop) +
      parseFloat(cs.marginBottom)
    );
  };

  const rowHeights = {};
  for (const [label, selector] of [
    ['list', '.list-pill:not(.smart-list-pill):not(.board-pill):not(.tag-pill)'],
    ['smart list', '.list-pill.smart-list-pill'],
    ['board', '.list-pill.board-pill'],
    ['tag', '.list-pill.tag-pill'],
  ]) {
    const h = await page.locator(selector).first().evaluate(totalBox);
    rowHeights[label] = h;
    check(
      Math.abs(h - 22) <= 0.5,
      `${label} pill total box height is 22px (got ${h}px)`,
    );
  }

  // The kebab must not drive row height: hovering a pill (which reveals the
  // 26px button) must leave the row at 22px.
  const hoveredPill = page.locator('.list-pill.smart-list-pill').first();
  await hoveredPill.hover();
  const hoveredHeight = await hoveredPill.evaluate(totalBox);
  check(
    Math.abs(hoveredHeight - 22) <= 0.5,
    `smart-list pill stays 22px with its hover kebab visible (got ${hoveredHeight}px)`,
  );

  for (const [label, selector] of [
    ['lists header', '.lists-panel .lists-header'],
    ['lists title', '.lists-panel .lists-header .lists-title'],
    ['add-list button', '#add-list-button'],
    ['lists toggle button', '#lists-toggle'],
    ['boards header', '#boards-panel .lists-header'],
    ['new-board button', '#add-board-button'],
  ]) {
    const el = page.locator(selector).first();
    await el.waitFor({ state: 'attached' });
    const h = await el.evaluate(totalBox);
    rowHeights[label] = h;
    check(
      h <= 22.5,
      `${label}: total box height does not exceed a list-pill row (got ${h}px)`,
    );
  }

  console.log('sidebar row heights:', JSON.stringify(rowHeights, null, 2));
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
  console.error(`list-pill padding self-test failed after ${checks} checks: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`list-pill padding self-test passed (${checks} checks)`);
}
