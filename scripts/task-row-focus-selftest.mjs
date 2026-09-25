// Task-row keyboard-cursor ring acceptance suite.
// Run with: npm run test:task-row-focus
//
// Same shape and safety posture as scripts/task-delete-selftest.mjs: a full ADEO_UI_TEST launch
// against an isolated userData dir + SQLite file, with the real dev database/settings
// snapshotted before and re-asserted byte-unchanged in the finally block.
//
// Covers the .task-row.focused ring introduced by markCursorRow / attachTaskListKeyboard
// (src/renderer/tasks.ts): the ring must show only when the row element itself is the real
// DOM focus target, never merely because focus landed on a child control inside the row.

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

/**
 * classList assertions alone cannot tell "the row ring is off, and the child's own
 * :focus-visible outline is genuinely rendering" apart from "the row ring is off, and NOTHING
 * is rendering" -- both look identical at the class level. This reads the actual computed
 * outline the browser is painting, the authoritative ground truth for whether a keyboard user
 * sees any indicator at all.
 */
const outlineIsVisible = (locator) =>
  locator.evaluate((el) => {
    const cs = getComputedStyle(el);
    return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
  });

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

  const addTask = async (text) => {
    await input.fill(text);
    await input.press('Enter');
    await page.locator('.task-text').filter({ hasText: text }).waitFor({ state: 'visible' });
  };

  const rowFor = (text) =>
    page.locator('.task-row', { has: page.locator('.task-text', { hasText: text }) });

  const textA = `Focus ring A ${randomUUID()}`;
  const textB = `Focus ring B ${randomUUID()}`;
  const textC = `Focus ring C ${randomUUID()}`;
  await addTask(textA);
  await addTask(textB);
  await addTask(textC);

  const rowA = rowFor(textA);
  const rowB = rowFor(textB);
  const rowC = rowFor(textC);

  // ---------------------------------------------------------------------------
  // 1. Arrow-key navigation shows the row cursor ring.
  // ---------------------------------------------------------------------------
  {
    await rowA.click({ position: { x: 5, y: 5 } });
    // Clicking the row background (not a child control) focuses the row itself.
    check(await rowA.evaluate((el) => el === document.activeElement), '1 setup: row A has real DOM focus');
    check(await rowA.evaluate((el) => el.classList.contains('focused')), '1: row A shows the cursor ring after gaining real focus');

    await page.keyboard.press('ArrowDown');
    check(await rowB.evaluate((el) => el === document.activeElement), '1: ArrowDown moves real DOM focus to row B');
    check(await rowB.evaluate((el) => el.classList.contains('focused')), '1: row B shows the cursor ring after ArrowDown');
  }

  // ---------------------------------------------------------------------------
  // 2. Moving the cursor between rows leaves no stale ring on the previous row.
  // ---------------------------------------------------------------------------
  {
    check(!(await rowA.evaluate((el) => el.classList.contains('focused'))), '2: row A no longer shows the ring once the cursor moved to row B');
  }

  // ---------------------------------------------------------------------------
  // 3. Mouse-clicking a child control does not show the full-row ring.
  //
  // The kebab (.task-menu-btn) is used rather than the checkbox here to isolate the
  // focusin-driven ring logic without also exercising the re-render path; checkbox +
  // re-render is covered separately in scenario 8 below.
  // ---------------------------------------------------------------------------
  {
    await rowB.hover();
    const kebab = rowB.locator('.task-menu-btn');
    await kebab.click();
    check(
      await kebab.evaluate((el) => el === document.activeElement),
      '3 setup: the kebab itself has real DOM focus after being clicked',
    );
    check(
      !(await rowB.evaluate((el) => el.classList.contains('focused'))),
      '3: clicking the kebab does not paint the row-level ring',
    );
    await page.keyboard.press('Escape');
    await page.locator('.task-context-menu').waitFor({ state: 'hidden' }).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // 4. Tabbing focus onto the checkbox shows only its own ring, not the row ring. Asserted at
  //    the computed-style level, not just classList: a prior manual-QA round found that
  //    classList-only assertions here could not distinguish "no row ring because the
  //    checkbox's own ring is genuinely showing" from "no row ring and nothing else either".
  // ---------------------------------------------------------------------------
  {
    await rowB.click({ position: { x: 5, y: 5 } });
    check(await rowB.evaluate((el) => el.classList.contains('focused')), '4 setup: row B has the cursor ring after being focused directly');

    await page.keyboard.press('Tab');
    const checkbox = rowB.locator('input[type="checkbox"]');
    check(
      await checkbox.evaluate((el) => el === document.activeElement),
      '4: Tab from the row moves real DOM focus onto the checkbox',
    );
    check(
      !(await rowB.evaluate((el) => el.classList.contains('focused'))),
      '4: the row ring is removed once focus is on the checkbox child',
    );
    check(
      await outlineIsVisible(checkbox),
      '4: the checkbox itself has a genuinely visible computed outline (not just "no row ring") -- this is the sole indicator in this scenario',
    );
  }

  // ---------------------------------------------------------------------------
  // 5. Focus returning from the child back to the row restores the cursor ring.
  // ---------------------------------------------------------------------------
  {
    await page.keyboard.press('Shift+Tab');
    check(await rowB.evaluate((el) => el === document.activeElement), '5: Shift+Tab from the checkbox returns real DOM focus to row B');
    check(await rowB.evaluate((el) => el.classList.contains('focused')), '5: the row cursor ring reappears once focus returns to the row');
  }

  // ---------------------------------------------------------------------------
  // 6. Every row is a Tab stop followed by its own checkbox and other controls.
  // Check all stops in both directions, including the second and third row boundaries.
  // ---------------------------------------------------------------------------
  {
    const stops = [];
    for (const row of [rowA, rowB, rowC]) {
      stops.push(row);
      const controls = row.locator('input[type="checkbox"], .expand-btn, .task-menu-btn');
      for (let i = 0; i < await controls.count(); i++) {
        const control = controls.nth(i);
        if (await control.isEnabled()) stops.push(control);
      }
    }
    await rowA.focus();
    const assertStop = async (stop, direction, index) => {
      check(await stop.evaluate((el) => el === document.activeElement),
        `6: ${direction} stop ${index} has real DOM focus`);
      check(await stop.evaluate((el) => {
        const row = el.closest('.task-row');
        return row.classList.contains('focused') === (row === el);
      }), `6: ${direction} stop ${index} shows the row ring only for row focus`);
      check(await outlineIsVisible(stop), `6: ${direction} stop ${index} has a visible outline`);
    };
    for (let i = 0; i < stops.length; i++) {
      if (i > 0) await page.keyboard.press('Tab');
      await assertStop(stops[i], 'forward', i);
    }
    for (let i = stops.length - 2; i >= 0; i--) {
      await page.keyboard.press('Shift+Tab');
      await assertStop(stops[i], 'backward', i);
    }
  }

  // ---------------------------------------------------------------------------
  // 7. Mouse-clicking a different row's child does not show that row's ring, and does not
  //    pick up the keyboard cross-row row-ring substitution either -- the critical
  //    regression check: this is the ORIGINAL bug (a mouse click producing a full-row
  //    outline), and it must never come back regardless of which row the cursor was
  //    previously on. Mouse clicks stay within the child's own :focus-visible ring only,
  //    never the row ring, whether the click lands on the current cursor row or a
  //    different one.
  // ---------------------------------------------------------------------------
  {
    // Reset by clicking row A.
    await rowA.click({ position: { x: 5, y: 5 } });
    check(await rowA.evaluate((el) => el.classList.contains('focused')), '7 setup: row A has the cursor ring');

    // Mouse-click on row B's kebab (different row, different child)
    await rowB.hover();
    const rowBKebab = rowB.locator('.task-menu-btn');
    await rowBKebab.click();
    check(
      await rowBKebab.evaluate((el) => el === document.activeElement),
      '7 setup: row B kebab has real DOM focus after mouse click',
    );
    check(
      !(await rowB.evaluate((el) => el.classList.contains('focused'))),
      '7: mouse click on row B child does not paint row B ring (even though we crossed into a different row)',
    );
    check(
      !(await rowA.evaluate((el) => el.classList.contains('focused'))),
      '7: row A ring is removed when focus leaves via mouse click',
    );
    await page.keyboard.press('Escape');
    await page.locator('.task-context-menu').waitFor({ state: 'hidden' }).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // 8. Backward (Shift+Tab) navigation through multiple rows is symmetric with scenario 6's
  //    forward check: crossing backward into a different row's child shows only that child's
  //    own ring, never the row ring -- direction-independent.
  // ---------------------------------------------------------------------------
  {
    await rowC.click({ position: { x: 5, y: 5 } });
    check(await rowC.evaluate((el) => el.classList.contains('focused')), '8 setup: row C has the cursor ring');

    await page.keyboard.press('Shift+Tab');
    for (let i = 0; i < 5; i++) {
      const focusedTaskId = await page.evaluate(() => {
        const active = document.activeElement;
        return active?.closest('.task-row')?.dataset?.taskId;
      });
      if (focusedTaskId === '2') break; // Reached row B
      await page.keyboard.press('Shift+Tab');
    }
    const focusedTaskId = await page.evaluate(() => {
      const active = document.activeElement;
      return active?.closest('.task-row')?.dataset?.taskId;
    });
    check(focusedTaskId === '2', '8: Shift+Tab navigation crossed backward into row B');
    const rowBChildHandle = await page.evaluateHandle(() => document.activeElement);
    check(
      !(await rowB.evaluate((el) => el.classList.contains('focused'))),
      '8: row B does NOT show the row ring on backward Shift+Tab entry into a child -- direction-independent, symmetric with scenario 6',
    );
    check(
      await outlineIsVisible(rowBChildHandle.asElement()),
      '8: the child real focus landed on has a genuinely visible computed outline of its own on backward entry too',
    );
    check(
      !(await rowC.evaluate((el) => el.classList.contains('focused'))),
      '8: row C no longer shows the ring after Shift+Tab moved back to row B',
    );
  }

  // ---------------------------------------------------------------------------
  // 9. Re-rendering the task list while a checkbox has real DOM focus must not
  //    paint the row-level ring merely because state.focusedTaskId still points at
  //    that task, and should not leave focus stranded worse than before.
  //
  // Clicking the checkbox itself is the real-world trigger for this: the click keeps
  // real DOM focus on the checkbox, then its 'change' handler calls toggleTaskDone(),
  // which calls the synchronous renderTasks() that tears every row down and rebuilds it
  // -- exactly the "normal re-render while checkbox has focus" scenario.
  // ---------------------------------------------------------------------------
  {
    await rowA.click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Tab');
    const checkboxA = rowA.locator('input[type="checkbox"]');
    check(
      await checkboxA.evaluate((el) => el === document.activeElement),
      '9 setup: row A checkbox has real DOM focus',
    );
    check(
      !(await rowA.evaluate((el) => el.classList.contains('focused'))),
      '9 setup: row A has no row-level ring while the checkbox holds focus',
    );

    // Click the focused checkbox: toggles the task done, which synchronously re-renders the
    // list (state.showCompleted defaults to true, so the row stays visible).
    await checkboxA.click();

    check(
      !(await rowA.evaluate((el) => el.classList.contains('focused'))),
      '9: row A does not gain the row-level ring after a re-render, even though state.focusedTaskId still points at it',
    );
    const checkboxAAfter = rowA.locator('input[type="checkbox"]');
    check(
      await checkboxAAfter.evaluate((el) => el === document.activeElement),
      '9: the rebuilt row A checkbox is the real DOM focus target after the re-render (not the row, not stranded on <body>)',
    );

    // Restore state: uncheck it back (another checkbox click + re-render), and confirm the
    // rule holds symmetrically on the way back too.
    await checkboxAAfter.click();
    check(
      !(await rowA.evaluate((el) => el.classList.contains('focused'))),
      '9: row A still shows no row-level ring after the second re-render (un-checking)',
    );
    const checkboxAFinal = rowA.locator('input[type="checkbox"]');
    check(
      await checkboxAFinal.evaluate((el) => el === document.activeElement),
      '9: the checkbox remains the real DOM focus target after un-checking too',
    );
  }

  console.log(`Task row focus self-test: ${checks} scenario checks passed before teardown`);
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
  console.error(`Task row focus self-test failed after ${checks} checks: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`Task row focus self-test passed (${checks} checks)`);
}
