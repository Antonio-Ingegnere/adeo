// Phase P0.5 visual-baseline capture for Adeo.
// Run from the repository root after `npm run build`:
//   node ui-ux/ux/baselines/capture-baseline.mjs

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const require = createRequire(import.meta.url);
const electronExecutable = require('electron');
const playwrightVersion = require('playwright-core/package.json').version;
const baselineDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(baselineDir, '../../..');
const requestedOutputDir = process.env.ADEO_BASELINE_OUTPUT_DIR?.trim() || null;
const isCandidateCapture = requestedOutputDir !== null;
const captureRoot = requestedOutputDir ? path.resolve(requestedOutputDir) : baselineDir;
const imagesDir = path.join(captureRoot, 'images');
const manifestPath = path.join(captureRoot, 'manifest.json');
const captureCommand = isCandidateCapture
  ? `ADEO_BASELINE_OUTPUT_DIR=${JSON.stringify(captureRoot)} node ui-ux/ux/baselines/capture-baseline.mjs`
  : 'npm run build && node ui-ux/ux/baselines/capture-baseline.mjs';
const fixedNow = '2026-08-22T10:00:00.000Z';

const themes = ['light', 'dark'];
const windowSizes = [
  { width: 800, height: 600 },
  { width: 1280, height: 800 },
];
const fixtureNames = [
  'empty',
  'populated',
  'valid-query',
  'invalid-query',
  'edit-dialog',
  'settings-general',
  'settings-tasks',
  'settings-shortcuts',
];

const cssSourcePaths = [path.join(repoRoot, 'styles.css')];
const designStylesDir = path.join(repoRoot, 'styles');
if (fs.existsSync(designStylesDir)) {
  cssSourcePaths.push(
    ...fs
      .readdirSync(designStylesDir)
      .filter((name) => name.endsWith('.css'))
      .sort()
      .map((name) => path.join(designStylesDir, name)),
  );
}
const tokenNames = [
  ...new Set(
    cssSourcePaths.flatMap((filePath) =>
      [...fs.readFileSync(filePath, 'utf8').matchAll(/(--[a-z0-9-]+)\s*:/gi)].map(
        (match) => match[1],
      ),
    ),
  ),
].sort();

const git = (args, options = {}) =>
  execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', ...options }).trim();

const sourceCommit = git(['rev-parse', 'HEAD']);
const worktreeStatus = git(['status', '--porcelain']).split('\n').filter(Boolean);
const visualSourceStatus = git([
  'status',
  '--porcelain',
  '--',
  'index.html',
  'styles.css',
  'styles',
  'src/renderer',
])
  .split('\n')
  .filter(Boolean);
const visualSourcesCleanAtCapture = visualSourceStatus.length === 0;
if (!visualSourcesCleanAtCapture && !isCandidateCapture) {
  throw new Error(
    'Visual sources differ from HEAD. Use an OS-temporary ADEO_BASELINE_OUTPUT_DIR for comparison or commit/restore them before regenerating the baseline.',
  );
}
if (!fs.existsSync(path.join(repoRoot, 'dist', 'main.js'))) {
  throw new Error('dist/main.js is missing. Run `npm run build` before capturing the baseline.');
}

if (isCandidateCapture) {
  if (!path.isAbsolute(requestedOutputDir)) {
    throw new Error('ADEO_BASELINE_OUTPUT_DIR must be an absolute path.');
  }
  const tempBase = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (!captureRoot.startsWith(tempBase)) {
    throw new Error('ADEO_BASELINE_OUTPUT_DIR must be a child of os.tmpdir().');
  }
  if (fs.existsSync(captureRoot)) {
    throw new Error('ADEO_BASELINE_OUTPUT_DIR must not already exist.');
  }
  fs.mkdirSync(captureRoot, { recursive: true });
} else if (path.dirname(imagesDir) !== baselineDir) {
  throw new Error('Refusing to regenerate images outside the baseline directory.');
}
fs.rmSync(imagesDir, { recursive: true, force: true });
fs.mkdirSync(imagesDir, { recursive: true });

const pythonBin = fs.existsSync(path.join(repoRoot, '.venv', 'bin', 'python'))
  ? path.join(repoRoot, '.venv', 'bin', 'python')
  : process.platform === 'win32'
    ? 'python'
    : 'python3';

const cleanEnvironment = () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry) => typeof entry[1] === 'string'),
  );
  delete env.ADEO_API_URL;
  return env;
};

const applyFixedRendererTime = async (page) => {
  await page.evaluate((iso) => {
    const RealDate = Date;
    const fixed = new RealDate(iso).getTime();
    class FixedDate extends RealDate {
      constructor(...args) {
        super(...(args.length ? args : [fixed]));
      }
      static now() {
        return fixed;
      }
    }
    window.Date = FixedDate;
  }, fixedNow);
};

const setTheme = async (page, theme) => {
  await page.emulateMedia({ colorScheme: null, reducedMotion: 'reduce' });
  await page.evaluate(async (nextTheme) => {
    await window.electronAPI.updateTheme(nextTheme);
  }, theme);
  await page.waitForFunction(
    (dark) => window.matchMedia('(prefers-color-scheme: dark)').matches === dark,
    theme === 'dark',
  );
};

const setWindowSize = async (electronApp, page, size) => {
  const actual = await electronApp.evaluate(({ BrowserWindow }, requested) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(requested.width, requested.height, false);
    return window.getSize();
  }, size);
  if (actual[0] !== size.width || actual[1] !== size.height) {
    throw new Error(`Electron refused window size ${size.width}x${size.height}`);
  }
  await page.waitForTimeout(120);
};

const resetToPopulatedView = async (page) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const openOverlay = page.locator('.overlay.open');
    if ((await openOverlay.count()) === 0) break;
    await page.keyboard.press('Escape');
  }
  if (!(await page.locator('#search-mode-simple').isChecked())) {
    await page.locator('label:has(#search-mode-simple)').click();
  }
  await page.locator('#lists-search-input').fill('');
  await page.waitForTimeout(220);
};

const seedPopulatedFixture = async (page) => {
  await page.evaluate(async () => {
    const api = window.electronAPI;
    const mustSucceed = (value, label) => {
      if (!value || value.error) throw new Error(`Could not seed ${label}`);
      return value;
    };

    const work = mustSucceed(await api.addList('Work'), 'Work list');
    const personal = mustSucceed(await api.addList('Personal'), 'Personal list');
    const urgent = mustSucceed(await api.addTag('urgent'), 'urgent tag');
    const design = mustSucceed(await api.addTag('design'), 'design tag');

    const roadmap = mustSucceed(
      await api.addTask('Prepare quarterly roadmap', work.id, [urgent.id], {
        priority: 'high',
        reminderDate: '2030-01-15',
        reminderTime: '09:30',
        repeatRule: 'FREQ=WEEKLY;BYDAY=MO',
        repeatStart: '2030-01-15',
      }),
      'roadmap task',
    );
    await api.updateTaskDetails(
      roadmap.id,
      'Align milestones with the design and engineering leads.\n\n- Confirm scope\n- Share draft',
    );

    mustSucceed(
      await api.addTask('Review onboarding copy', work.id, [design.id], {
        priority: 'medium',
      }),
      'onboarding task',
    );
    const dentist = mustSucceed(
      await api.addTask('Book dentist appointment', personal.id, [], { priority: 'low' }),
      'dentist task',
    );
    await api.updateTaskDone(dentist.id, true);
    mustSucceed(await api.addTask('Buy oat milk', null, [urgent.id]), 'shopping task');
  });
};

const openSettings = async (electronApp, page) => {
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('open-settings');
  });
  await page.locator('#settings-overlay.open').waitFor({ state: 'visible' });
};

const entries = [];
const computedTokensByTheme = {};
let electronVersion = null;
const capturedAt = new Date().toISOString();

const capture = async (page, theme, size, fixture) => {
  const sizeName = `${size.width}x${size.height}`;
  const relativePath = path.posix.join('images', theme, sizeName, `${fixture}.png`);
  const absolutePath = path.join(captureRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  // Hover-only affordances otherwise depend on the pointer position left by the preceding
  // interaction (for example a task drag handle or modal picker background). Park it on the
  // inert window corner so repeated candidate captures compare deterministically.
  await page.mouse.move(1, 1);
  await page.waitForTimeout(60);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: absolutePath,
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  });
  const rendererViewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  entries.push({
    file: relativePath,
    sourceCommit,
    visualSourcesCleanAtCapture,
    theme,
    fixture,
    windowSize: size,
    rendererViewport,
    captureCommand,
    capturedAt,
  });
};

for (const theme of themes) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `adeo-baseline-${theme}-`));
  const userData = path.join(tempRoot, 'user data');
  const database = path.join(tempRoot, 'data', 'tasks.db');
  const bootstrap = path.join(tempRoot, 'electron bootstrap');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(path.dirname(database), { recursive: true });
  fs.mkdirSync(bootstrap, { recursive: true });

  let electronApp = null;
  try {
    electronApp = await electron.launch({
      executablePath: electronExecutable,
      args: [`--user-data-dir=${bootstrap}`, repoRoot],
      cwd: repoRoot,
      env: {
        ...cleanEnvironment(),
        ADEO_UI_TEST: '1',
        ADEO_USER_DATA_DIR: userData,
        ADEO_DB_PATH: database,
        ADEO_PYTHON_BIN: pythonBin,
      },
    });
    const page = await electronApp.firstWindow();
    await page.locator('#message-input').waitFor({ state: 'visible' });
    await applyFixedRendererTime(page);
    await setTheme(page, theme);
    electronVersion ??= await electronApp.evaluate(({ app }) => process.versions.electron);

    for (const size of windowSizes) {
      await setWindowSize(electronApp, page, size);
      await capture(page, theme, size, 'empty');
    }

    await seedPopulatedFixture(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.task-row').first().waitFor({ state: 'visible' });
    await applyFixedRendererTime(page);
    await setTheme(page, theme);
    computedTokensByTheme[theme] = await page.evaluate((names) => {
      const computed = getComputedStyle(document.documentElement);
      return Object.fromEntries(names.map((name) => [name, computed.getPropertyValue(name).trim()]));
    }, tokenNames);

    for (const size of windowSizes) {
      await setWindowSize(electronApp, page, size);
      await resetToPopulatedView(page);
      await capture(page, theme, size, 'populated');

      await page.locator('label:has(#search-mode-advanced)').click();
      await page.locator('#search-mode-advanced').waitFor({ state: 'attached' });
      if (!(await page.locator('#search-mode-advanced').isChecked())) {
        throw new Error('The visible Query mode control did not select advanced search.');
      }
      await page.locator('#lists-search-input').fill('priority:high');
      await page.waitForTimeout(220);
      await page.locator('.lists-search-field.is-valid').waitFor({ state: 'visible' });
      await page.locator('#lists-search-input').blur();
      await page.locator('#query-suggest-menu').waitFor({ state: 'hidden' });
      await page.locator('#message-input').focus();
      if ((await page.locator('#lists-search-input').inputValue()) !== 'priority:high') {
        throw new Error('Valid query changed while closing its suggestion menu.');
      }
      await capture(page, theme, size, 'valid-query');

      await page.locator('#lists-search-input').fill('priority~high ');
      await page.waitForTimeout(220);
      await page.locator('.lists-search-field.is-invalid').waitFor({ state: 'visible' });
      await page.locator('#lists-search-input').blur();
      await page.locator('#query-suggest-menu').waitFor({ state: 'hidden' });
      await page.locator('#search-status-line').waitFor({ state: 'visible' });
      await page.locator('#message-input').focus();
      if ((await page.locator('#lists-search-input').inputValue()) !== 'priority~high ') {
        throw new Error('Invalid query changed while closing its suggestion menu.');
      }
      await capture(page, theme, size, 'invalid-query');

      await resetToPopulatedView(page);
      await page.getByText('Prepare quarterly roadmap', { exact: true }).first().click();
      await page.locator('#edit-overlay.open').waitFor({ state: 'visible' });
      await capture(page, theme, size, 'edit-dialog');
      await page.keyboard.press('Escape');

      await openSettings(electronApp, page);
      await capture(page, theme, size, 'settings-general');
      await page.locator('#settings-tab-tasks').click();
      await capture(page, theme, size, 'settings-tasks');
      await page.locator('#settings-tab-shortcuts').click();
      await capture(page, theme, size, 'settings-shortcuts');
      await page.keyboard.press('Escape');
    }
  } finally {
    if (electronApp) await electronApp.close();
    const resolvedTemp = path.resolve(tempRoot);
    const tempBase = `${path.resolve(os.tmpdir())}${path.sep}`;
    if (!resolvedTemp.startsWith(tempBase)) {
      throw new Error('Refusing to clean a baseline temp path outside os.tmpdir().');
    }
    fs.rmSync(resolvedTemp, { recursive: true, force: true });
  }
}

const expectedCount = themes.length * windowSizes.length * fixtureNames.length;
if (entries.length !== expectedCount) {
  throw new Error(`Captured ${entries.length} screenshots; expected ${expectedCount}.`);
}

const manifest = {
  schemaVersion: 1,
  baseline: isCandidateCapture ? 'P0.5 comparison candidate' : 'P0.5 current application',
  sourceCommit,
  visualSourcesCleanAtCapture,
  worktreeDirtyAtCapture: worktreeStatus.length > 0,
  worktreeStatusAtCapture: worktreeStatus,
  captureCommand,
  capturedAt,
  fixedRendererTime: fixedNow,
  computedTokensByTheme,
  runtime: {
    platform: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    node: process.version,
    electron: electronVersion,
    playwrightCore: playwrightVersion,
  },
  expectedScreenshotCount: expectedCount,
  screenshots: entries,
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `Captured ${entries.length} ${isCandidateCapture ? 'candidate' : 'baseline'} screenshots at ${sourceCommit}.`,
);
