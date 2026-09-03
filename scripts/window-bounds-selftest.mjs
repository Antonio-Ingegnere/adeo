// Main-window bounds persistence acceptance suite.
// Run with: npm run test:window-bounds
//
// Two parts:
//   A. Pure-function checks over dist/window-bounds.js (parse + display clamp),
//      including a simulated multi-monitor "display unplugged" case.
//   B. A real ADEO_UI_TEST Electron journey against an isolated userData dir +
//      SQLite file (same safety posture as scripts/sidebar-state-selftest.mjs:
//      the real dev database/settings are snapshotted and re-asserted unchanged):
//        1. first launch uses the 800x600 default, then the window is moved/resized
//        2. after quit, settings.json gains a sanitized `windowBounds` block
//        3. relaunch restores that size + position (window not maximized)
//        4. a fully off-screen saved origin is clamped back onto a connected display
//        5. a corrupt `windowBounds` value boots to the 800x600 default without error

import { createRequire } from 'node:module';
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
import {
  sanitizeWindowBounds,
  parseWindowBounds,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
} from '../dist/window-bounds.js';

const require = createRequire(import.meta.url);
const electronExecutable = require('electron');
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

let checks = 0;
const check = (condition, message) => {
  checks += 1;
  if (!condition) throw new Error(message);
};
const near = (a, b, tolerance = 12) =>
  typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tolerance;

// ---- Part A: pure helpers ---------------------------------------------------------------
{
  const primary = { x: 0, y: 0, width: 1440, height: 900 };
  const secondary = { x: 1440, y: 0, width: 1920, height: 1080 };

  let r = sanitizeWindowBounds(
    { x: 1600, y: 100, width: 900, height: 700, maximized: false },
    [primary, secondary],
  );
  check(
    r && r.x === 1600 && r.y === 100 && r.width === 900 && r.height === 700,
    `A: a rect sitting on a secondary display is kept as-is (got ${JSON.stringify(r)})`,
  );

  // Same rect, secondary monitor now unplugged -> off every display -> relocated.
  r = sanitizeWindowBounds(
    { x: 1600, y: 100, width: 900, height: 700, maximized: false },
    [primary],
  );
  check(
    r &&
      r.x >= primary.x &&
      r.y >= primary.y &&
      r.x + r.width <= primary.x + primary.width &&
      r.y + r.height <= primary.y + primary.height,
    `A: bounds on an unplugged display are moved onto a connected one (got ${JSON.stringify(r)})`,
  );

  r = sanitizeWindowBounds(
    { x: -5000, y: -5000, width: 800, height: 600, maximized: false },
    [primary],
  );
  check(r && r.x >= 0 && r.y >= 0, `A: a fully off-screen rect is pulled back on-screen (got ${JSON.stringify(r)})`);

  check(parseWindowBounds({ width: 'x', height: 10 }) === null, 'A: non-numeric size -> null');
  check(parseWindowBounds(null) === null, 'A: null -> null');
  check(parseWindowBounds('nope') === null, 'A: string -> null');

  r = parseWindowBounds({ width: 120, height: 120, x: 0, y: 0, maximized: false });
  check(
    r && r.width === MIN_WINDOW_WIDTH && r.height === MIN_WINDOW_HEIGHT,
    `A: a sub-minimum size is clamped up to the floor (got ${JSON.stringify(r)})`,
  );

  r = parseWindowBounds({ width: 900, height: 700 });
  check(r && r.x === null && r.y === null, 'A: a missing x/y stays null so the OS centers the window');

  r = sanitizeWindowBounds({ width: 900, height: 700, x: 10, y: 10, maximized: true }, [primary]);
  check(r && r.maximized === true, 'A: the maximized flag is preserved');

  // No display info at all -> keep size, drop position.
  r = sanitizeWindowBounds({ width: 900, height: 700, x: 300, y: 300, maximized: false }, []);
  check(r && r.width === 900 && r.height === 700 && r.x === null && r.y === null, 'A: no display info -> size only');
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
const writeWindowBounds = (windowBounds) => {
  const current = fs.existsSync(settingsPath)
    ? JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    : {};
  current.windowBounds = windowBounds;
  fs.writeFileSync(settingsPath, JSON.stringify(current, null, 2));
};

const launch = () =>
  electron.launch({
    executablePath: electronExecutable,
    args: [`--user-data-dir=${bootstrapUserData}`, repoRoot],
    cwd: repoRoot,
    env: isolatedEnvironment({ isolatedUserData, isolatedDatabase, pythonBin }),
  });

const getBounds = (electronApp) =>
  electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());

let electronApp = null;
let failure = null;

try {
  // ---- Launch 1: default sizing on a first run, then move/resize ----------------------
  electronApp = await launch();
  let page = await electronApp.firstWindow();
  await page.locator('#message-input').waitFor({ state: 'visible' });

  const firstRun = await getBounds(electronApp);
  check(
    firstRun.width === 800 && firstRun.height === 600,
    `1: first run (no saved bounds) keeps the 800x600 default (got ${firstRun.width}x${firstRun.height})`,
  );

  const target = { x: 70, y: 80, width: 840, height: 660 };
  await electronApp.evaluate(({ BrowserWindow }, b) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.unmaximize();
    win.setBounds(b);
  }, target);
  await page.waitForTimeout(300);
  const applied = await getBounds(electronApp);

  await electronApp.close();
  electronApp = null;

  // ---- 2: the move/resize was persisted ---------------------------------------------
  const saved = readSettings();
  check(saved && saved.windowBounds, '2: settings.json gained a windowBounds block after close');
  check(
    near(saved.windowBounds.width, applied.width) && near(saved.windowBounds.height, applied.height),
    `2: persisted size follows the resized window (saved ${JSON.stringify(saved.windowBounds)}, window ${JSON.stringify(applied)})`,
  );
  check(
    near(saved.windowBounds.x, applied.x) && near(saved.windowBounds.y, applied.y),
    `2: persisted position follows the moved window (saved ${JSON.stringify(saved.windowBounds)}, window ${JSON.stringify(applied)})`,
  );
  check(saved.windowBounds.maximized === false, '2: a non-maximized window persists maximized:false');

  // ---- Launch 3: the saved bounds are restored -------------------------------------
  electronApp = await launch();
  page = await electronApp.firstWindow();
  await page.locator('#message-input').waitFor({ state: 'visible' });
  await page.waitForTimeout(250);
  const restored = await getBounds(electronApp);
  check(
    near(restored.width, saved.windowBounds.width) && near(restored.height, saved.windowBounds.height),
    `3: window size is restored on relaunch (got ${JSON.stringify(restored)}, expected ~${JSON.stringify(saved.windowBounds)})`,
  );
  check(
    near(restored.x, saved.windowBounds.x) && near(restored.y, saved.windowBounds.y),
    `3: window position is restored on relaunch (got ${JSON.stringify(restored)}, expected ~${JSON.stringify(saved.windowBounds)})`,
  );
  await electronApp.close();
  electronApp = null;

  // ---- Launch 4: a fully off-screen saved origin is clamped onto a real display ----
  writeWindowBounds({ x: -9000, y: -9000, width: 900, height: 700, maximized: false });
  electronApp = await launch();
  page = await electronApp.firstWindow();
  await page.locator('#message-input').waitFor({ state: 'visible' });
  await page.waitForTimeout(250);
  const clamped = await electronApp.evaluate(({ BrowserWindow, screen }) => {
    const b = BrowserWindow.getAllWindows()[0].getBounds();
    const intersects = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      const ox = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x);
      const oy = Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y);
      return ox > 0 && oy > 0;
    });
    return { b, intersects };
  });
  check(
    clamped.intersects,
    `4: an off-screen saved origin is clamped back onto a connected display (got ${JSON.stringify(clamped.b)})`,
  );
  check(
    clamped.b.x > -9000 && clamped.b.y > -9000,
    `4: the off-screen origin was actually corrected (got ${JSON.stringify(clamped.b)})`,
  );
  await electronApp.close();
  electronApp = null;

  // ---- Launch 5: a corrupt windowBounds value degrades to the default -------------
  writeWindowBounds({ width: 'huge', height: null, x: 10, y: 10 });
  electronApp = await launch();
  page = await electronApp.firstWindow();
  await page.locator('#message-input').waitFor({ state: 'visible' });
  await page.waitForTimeout(250);
  const fallback = await getBounds(electronApp);
  check(
    fallback.width === 800 && fallback.height === 600,
    `5: a corrupt windowBounds falls back to the 800x600 default (got ${fallback.width}x${fallback.height})`,
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
  console.error(`Window-bounds self-test failed after ${checks} checks: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`Window-bounds self-test passed (${checks} checks)`);
}
