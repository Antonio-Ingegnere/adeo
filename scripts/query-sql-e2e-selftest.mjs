// SQL-like query syntax, end to end (TQL-001 / issue #34).
// Run with: npm run test:query-sql
//
// Unlike query-selftest.mjs (parser/evaluator on the compiled modules), this types each query into
// the real Query field of the running app and asserts which task rows are on screen, so it covers
// the wiring: mode toggle -> applySearchQuery -> parseQuery -> compilePredicate -> rendered list.
// Same isolated-launch posture as quick-add-selftest.mjs.

import { createRequire } from 'node:module';
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
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let checks = 0;
const check = (condition, message) => {
  checks += 1;
  if (!condition) throw new Error(message);
};

const assertProtectedFilesUnchanged = createProtectedFilesGuard();
const pythonBin = resolvePythonBin(repoRoot);
const { tempRoot, isolatedUserData, isolatedDatabase, bootstrapUserData } = createIsolatedPaths();

const iso = (offsetDays) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  await page.locator('#message-input').waitFor({ state: 'visible' });

  // Fixtures through the app's own IPC. Names are unique-per-fixture so a row is identified by text.
  const fixtures = {
    'inv-high': { text: 'Pay invoice 1', seed: { priority: 'high' }, tags: ['work'], due: iso(-1) },
    'inv-low': { text: 'Invoice archive', seed: { priority: 'low' }, tags: ['home'], due: null },
    'urgent-med': { text: 'Call client', seed: { priority: 'medium' }, tags: ['urgent'], due: iso(0) },
    'done-high': { text: 'Ship release', seed: { priority: 'high', done: true }, tags: ['work'], due: iso(5) },
    'plain': { text: 'Water plants', seed: {}, tags: [], due: null },
  };
  await page.evaluate(
    async ({ fixtures }) => {
      const tagIds = {};
      for (const name of ['work', 'home', 'urgent']) tagIds[name] = (await window.electronAPI.addTag(name)).id;
      for (const f of Object.values(fixtures)) {
        const seed = { ...f.seed };
        if (f.due) seed.reminderDate = f.due;
        const r = await window.electronAPI.addTask(
          f.text,
          null,
          f.tags.map((t) => tagIds[t]),
          seed,
        );
        if (r.error) throw new Error(r.error);
      }
    },
    { fixtures },
  );
  await page.reload();
  await page.locator('#message-input').waitFor({ state: 'visible' });

  const search = page.locator('#lists-search-input');
  const visibleTexts = async () =>
    (await page.locator('.task-row .task-text').allTextContents()).map((s) => s.trim()).sort();
  const names = (...keys) => keys.map((k) => fixtures[k].text).sort();

  // The feature lives in Query mode; Simple mode is plain text search (and says so).
  await page.locator('label.segmented-option', { hasText: 'Query' }).click();

  const settle = () => page.waitForTimeout(450);
  const runQuery = async (q) => {
    await search.fill('');
    await search.fill(q);
    await settle();
    return visibleTexts();
  };
  const expectRows = async (q, ...keys) => {
    const got = await runQuery(q);
    const want = names(...keys);
    check(JSON.stringify(got) === JSON.stringify(want), `"${q}": expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    const status = await page.locator('#search-status-line').isVisible();
    check(!status, `"${q}": no error shown for a valid query`);
  };
  const expectEquivalent = async (sql, shorthand) => {
    const a = await runQuery(sql);
    const b = await runQuery(shorthand);
    check(JSON.stringify(a) === JSON.stringify(b), `"${sql}" and "${shorthand}" differ: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  };
  const expectError = async (q, pattern) => {
    await runQuery(q);
    // the verdict line yields to the suggestion popover; Escape would clear the query, so blur
    await search.evaluate((el) => el.blur());
    await settle();
    const shown = await page.locator('#search-status-line').isVisible();
    const text = shown ? (await page.locator('#search-status-line').textContent()) ?? '' : '';
    check(shown && pattern.test(text), `"${q}": expected an error matching ${pattern}, got ${shown ? JSON.stringify(text) : 'none shown'}`);
  };

  // ---- SQL-like forms from issue #34, evaluated by the running app ----
  await expectRows('priority = high', 'inv-high', 'done-high');
  await expectRows('done = false', 'inv-high', 'inv-low', 'urgent-med', 'plain');
  await expectRows('due <= today', 'inv-high', 'urgent-med');
  await expectRows('text CONTAINS "invoice"', 'inv-high', 'inv-low');
  await expectRows('tag IN ("work","urgent")', 'inv-high', 'urgent-med', 'done-high');
  await expectRows('due IS NULL', 'inv-low', 'plain');
  await expectRows('due IS NOT NULL', 'inv-high', 'urgent-med', 'done-high');
  await expectRows(`due BETWEEN ${iso(-1)} AND ${iso(0)}`, 'inv-high', 'urgent-med');
  await expectRows('priority = high AND done = false', 'inv-high');

  // ---- shorthand unchanged, and equivalent to the SQL-like spelling ----
  await expectRows('priority:high', 'inv-high', 'done-high');
  await expectRows('text~invoice', 'inv-high', 'inv-low');
  await expectEquivalent('priority = high', 'priority:high');
  await expectEquivalent('done = false', 'done:false');
  await expectEquivalent('due <= today', 'due<=today');
  await expectEquivalent('text CONTAINS "invoice"', 'text~invoice');
  await expectEquivalent('tag IN ("work","urgent")', '(tag:work OR tag:urgent)');
  await expectEquivalent('due IS NULL', 'due:none');
  await expectEquivalent('due IS NOT NULL', 'due!=none');
  await expectEquivalent(`due BETWEEN ${iso(-1)} AND ${iso(0)}`, `due>=${iso(-1)} AND due<=${iso(0)}`);

  // ---- invalid input is reported, not silently treated as text ----
  // a bad value at the very end of the field is still "being typed", so errors follow a complete term
  await expectError('colour = red', /Unknown field "colour"/);
  await expectError('priority = urgent AND done = false', /priority must be/);
  await expectError('priority LIKE high', /LIKE is not supported for priority/);
  await expectError('priority <> high', /"<>" is not supported/);
  await expectError('priority CONTAINS high', /CONTAINS is not valid for priority/);
  await expectError('done BETWEEN 1 AND 2', /BETWEEN is only supported for due/);
  await expectError('priority IS NULL', /IS NULL is only supported for due/);

  assertProtectedFilesUnchanged(check);
  console.log(`All ${checks} query SQL end-to-end checks passed`);
} catch (error) {
  failure = error;
} finally {
  if (electronApp) await electronApp.close().catch(() => {});
  try {
    cleanupTempRoot(tempRoot);
  } catch (cleanupError) {
    failure ??= cleanupError;
  }
}

if (failure) {
  console.error(failure.message);
  process.exitCode = 1;
}
