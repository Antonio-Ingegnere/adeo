// i18n (12-language) acceptance suite.
// Run with: node scripts/i18n-selftest.mjs
//
// Two parts:
//   A. Pure-function checks over dist/renderer/i18n/{locales,dictionaries/*}.js:
//      - matchSupportedLocale maps BCP-47-ish OS locales onto one of the 12 shipped languages
//        and falls back to English for anything unsupported/garbled
//      - every non-English dictionary has exactly the same keyset as the English baseline, so
//        no locale can ever surface an untranslated raw key
//   B. A real ADEO_UI_TEST Electron journey against an isolated userData dir + SQLite file
//      (same safety posture as scripts/window-bounds-selftest.mjs: the real dev
//      database/settings are snapshotted and re-asserted unchanged):
//        1. first launch (no settings.json) auto-detects a supported locale from the real
//           app.getLocale() and persists it -- matching matchSupportedLocale's own mapping
//        2. changing the language in Settings persists it to settings.json AND repaints the
//           UI immediately, with no restart
//        3. relaunch restores the persisted locale without re-detecting
//        4. a corrupted/unsupported persisted locale value falls back to English, never crashes

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright-core';
import {
  createProtectedFilesGuard,
  resolvePythonBin,
  createIsolatedPaths,
  isolatedEnvironment,
  cleanupTempRoot,
} from './lib/isolated-electron.mjs';
import { matchSupportedLocale, isSupportedLocale, SUPPORTED_LOCALES } from '../dist/renderer/i18n/locales.js';
import { en } from '../dist/renderer/i18n/dictionaries/en.js';
import { es } from '../dist/renderer/i18n/dictionaries/es.js';
import { ru } from '../dist/renderer/i18n/dictionaries/ru.js';
import { be } from '../dist/renderer/i18n/dictionaries/be.js';
import { pl } from '../dist/renderer/i18n/dictionaries/pl.js';
import { de } from '../dist/renderer/i18n/dictionaries/de.js';
import { pt } from '../dist/renderer/i18n/dictionaries/pt.js';
import { zh } from '../dist/renderer/i18n/dictionaries/zh.js';
import { ko } from '../dist/renderer/i18n/dictionaries/ko.js';
import { ja } from '../dist/renderer/i18n/dictionaries/ja.js';
import { tr } from '../dist/renderer/i18n/dictionaries/tr.js';
import { ua } from '../dist/renderer/i18n/dictionaries/ua.js';

const require = createRequire(import.meta.url);
const electronExecutable = require('electron');
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

let checks = 0;
const check = (condition, message) => {
  checks += 1;
  if (!condition) throw new Error(message);
};

// ---- Part A: pure helpers ---------------------------------------------------------------
{
  check(SUPPORTED_LOCALES.length === 12, `A: exactly 12 supported locales are shipped (got ${SUPPORTED_LOCALES.length})`);
  for (const code of ['en', 'es', 'ru', 'be', 'pl', 'de', 'pt', 'zh', 'ko', 'ja', 'tr', 'ua']) {
    check(isSupportedLocale(code), `A: ${code} is a recognized supported locale`);
  }

  check(matchSupportedLocale('en-US') === 'en', 'A: en-US maps to en');
  check(matchSupportedLocale('pt-BR') === 'pt', 'A: pt-BR maps to pt');
  check(matchSupportedLocale('zh-Hans-CN') === 'zh', 'A: zh-Hans-CN maps to zh');
  check(matchSupportedLocale('DE-de') === 'de', 'A: case-insensitive DE-de maps to de');
  check(matchSupportedLocale('ru_RU') === 'ru', 'A: underscore-separated ru_RU maps to ru');
  check(matchSupportedLocale('uk-UA') === 'ua', 'A: Ukrainian OS locale uk-UA maps to the ua dictionary');
  check(matchSupportedLocale('uk') === 'ua', 'A: bare uk primary subtag maps to ua');
  check(matchSupportedLocale('nb-NO') === 'en', 'A: an unsupported language (Norwegian) falls back to en');
  check(matchSupportedLocale('') === 'en', 'A: empty string falls back to en');
  check(matchSupportedLocale(null) === 'en', 'A: null falls back to en without throwing');
  check(matchSupportedLocale(undefined) === 'en', 'A: undefined falls back to en without throwing');
  check(matchSupportedLocale(12345) === 'en', 'A: a non-string falls back to en without throwing');
  check(matchSupportedLocale('xx-YY-garbage') === 'en', 'A: a garbled unknown locale falls back to en');

  const baseline = Object.keys(en).sort();
  const dictionaries = { es, ru, be, pl, de, pt, zh, ko, ja, tr, ua };
  for (const [code, dict] of Object.entries(dictionaries)) {
    const keys = Object.keys(dict).sort();
    const missing = baseline.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !baseline.includes(k));
    check(missing.length === 0, `A: ${code} dictionary is missing keys present in en: ${missing.join(', ')}`);
    check(extra.length === 0, `A: ${code} dictionary has extra keys not present in en: ${extra.join(', ')}`);
    for (const key of baseline) {
      check(
        typeof dict[key] === 'string' && dict[key].length > 0,
        `A: ${code} dictionary has a non-empty translation for "${key}"`,
      );
    }
  }
}

// ---- Part B: real Electron journey -----------------------------------------------------
const assertProtectedFilesUnchanged = createProtectedFilesGuard();
const pythonBin = resolvePythonBin(repoRoot);
const { tempRoot, isolatedUserData, isolatedDatabase, bootstrapUserData } = createIsolatedPaths();
const settingsPath = path.join(isolatedUserData, 'settings.json');

const readSettings = () => {
  if (!fs.existsSync(settingsPath)) return null;
  return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
};
const writeLocale = (locale) => {
  const current = fs.existsSync(settingsPath)
    ? JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    : {};
  current.locale = locale;
  fs.writeFileSync(settingsPath, JSON.stringify(current, null, 2));
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
  // ---- Launch 1: first run auto-detects a supported locale from the real OS locale -----
  electronApp = await launch();
  let page = await electronApp.firstWindow();
  await page.locator('#message-input').waitFor({ state: 'visible' });
  // loadSettings() is async (it round-trips getSettings over IPC); give it time to land before
  // reading the DOM, rather than racing it with a fixed sleep.
  await page.waitForFunction(() => window.electronAPI !== undefined, null, { timeout: 5000 });
  await page.waitForTimeout(400);

  const osLocale = await electronApp.evaluate(({ app }) => app.getLocale());
  const expectedDetected = matchSupportedLocale(osLocale);

  const emptyStateText = await page.locator('#empty-state').textContent();
  check(
    emptyStateText === en['tasks.empty'] || Object.values({ es, ru, be, pl, de, pt, zh, ko, ja, tr, ua }).some(
      (dict) => emptyStateText === dict['tasks.empty'],
    ),
    `1: the empty-state text renders one of the 12 shipped translations (got "${emptyStateText}")`,
  );

  await electronApp.close();
  electronApp = null;

  const afterFirstLaunch = readSettings();
  check(afterFirstLaunch && isSupportedLocale(afterFirstLaunch.locale), '1: first launch persists a supported locale');
  check(
    afterFirstLaunch.locale === expectedDetected,
    `1: persisted locale (${afterFirstLaunch?.locale}) matches matchSupportedLocale(app.getLocale()=${osLocale}) = ${expectedDetected}`,
  );

  // ---- 2: changing the language in Settings persists it and repaints immediately -------
  writeLocale('en'); // pin a known starting point regardless of the host OS locale
  electronApp = await launch();
  page = await electronApp.firstWindow();
  await page.locator('#message-input').waitFor({ state: 'visible' });
  await page.waitForFunction(
    (expected) => document.getElementById('empty-state')?.textContent === expected,
    en['tasks.empty'],
    { timeout: 5000 },
  );
  check((await page.locator('#empty-state').textContent()) === en['tasks.empty'], '2: starts in English');

  await page.evaluate(async () => {
    const result = await window.electronAPI.updateLocale('de');
    // eslint-disable-next-line no-undef
    window.__adeoLocaleResult = result;
  });
  // The renderer's own save handler applies setLocale(); this test drives the IPC directly
  // (Settings-select-independent) and then applies the same call the save handler makes.
  await page.evaluate(async () => {
    const mod = await import('./renderer/i18n/index.js');
    mod.setLocale('de');
  });
  await page.waitForTimeout(50);

  const repainted = await page.locator('#empty-state').textContent();
  check(repainted === de['tasks.empty'], `2: UI repaints immediately in German without restart (got "${repainted}")`);

  // Regression for D-007: JS-generated / post-translated composer text must follow the locale
  // too, not just data-i18n-tagged static markup. The add-task placeholder is rewritten by
  // renderShortcutHints() (it appends the keyboard hint), and the reminder date-picker trigger
  // label is generated by datepicker.ts -- both previously stayed in the boot language.
  const addTaskPlaceholder = await page.locator('#message-input').getAttribute('placeholder');
  check(
    typeof addTaskPlaceholder === 'string' && addTaskPlaceholder.startsWith(de['compose.placeholder']),
    `2: the Add Task placeholder localizes (expected to start with "${de['compose.placeholder']}", got "${addTaskPlaceholder}")`,
  );
  const reminderTriggerLabel = await page.evaluate(
    () =>
      document.querySelector('#compose-reminder-date + .date-picker-trigger .date-picker-trigger-label')
        ?.textContent ?? null,
  );
  check(
    reminderTriggerLabel === de['datepicker.selectDate'],
    `2: the reminder date-picker trigger localizes (expected "${de['datepicker.selectDate']}", got "${reminderTriggerLabel}")`,
  );

  await electronApp.close();
  electronApp = null;

  const afterChange = readSettings();
  check(afterChange && afterChange.locale === 'de', '2: the changed locale was persisted to settings.json');

  // ---- Launch 3: the persisted locale is restored on relaunch, no re-detection ----------
  electronApp = await launch();
  page = await electronApp.firstWindow();
  await page.locator('#message-input').waitFor({ state: 'visible' });
  await page.waitForFunction(
    (expected) => document.getElementById('empty-state')?.textContent === expected,
    de['tasks.empty'],
    { timeout: 5000 },
  );
  const restoredText = await page.locator('#empty-state').textContent();
  check(restoredText === de['tasks.empty'], `3: relaunch restores the persisted German locale (got "${restoredText}")`);
  await electronApp.close();
  electronApp = null;

  // ---- Launch 4: a corrupted persisted locale falls back to English, never crashes -----
  writeLocale('not-a-real-locale');
  electronApp = await launch();
  page = await electronApp.firstWindow();
  await page.locator('#message-input').waitFor({ state: 'visible' });
  await page.waitForFunction(
    (expected) => document.getElementById('empty-state')?.textContent === expected,
    en['tasks.empty'],
    { timeout: 5000 },
  );
  const fallbackText = await page.locator('#empty-state').textContent();
  check(fallbackText === en['tasks.empty'], `4: a corrupted locale value falls back to English (got "${fallbackText}")`);
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
  console.error(`i18n self-test failed after ${checks} checks: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`i18n self-test passed (${checks} checks)`);
}
