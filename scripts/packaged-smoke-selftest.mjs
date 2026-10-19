// Packaged bundle smoke test -- launches the actual electron-builder output (not the repo
// checkout, not a dev venv) with isolated user data, confirms it resolves its own bundled
// Python with no ADEO_PYTHON_BIN/ADEO_API_URL/dev PATH assistance, and that a task created
// through its local API survives an app restart.
//
// Playwright-core's Electron driver relies on injecting itself via NODE_OPTIONS, which
// packaged Electron apps refuse ("Most NODE_OPTIONS are not supported in packaged apps"), so
// this drives the bundled FastAPI backend directly over loopback HTTP instead of through a
// CDP-attached renderer -- the same backend the packaged window's UI calls.
//
// Run with: npm run test:packaged
// Requires a release already built for the current OS/arch (npm run package:mac/win/linux).

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  createProtectedFilesGuard,
  createIsolatedPaths,
  cleanEnvironment,
  cleanupTempRoot,
} from './lib/isolated-electron.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const releaseDir = path.join(repoRoot, 'release');

let checks = 0;
const check = (condition, message) => {
  checks += 1;
  if (!condition) throw new Error(message);
};

const findPackagedExecutable = () => {
  if (process.env.ADEO_PACKAGED_APP) {
    return path.resolve(process.env.ADEO_PACKAGED_APP);
  }
  if (!fs.existsSync(releaseDir)) return null;

  if (process.platform === 'darwin') {
    const candidateDirs = fs
      .readdirSync(releaseDir)
      .filter((name) => name === 'mac' || name.startsWith('mac-'))
      .map((name) => path.join(releaseDir, name));
    for (const dir of candidateDirs) {
      const binary = path.join(dir, 'Adeo.app', 'Contents', 'MacOS', 'Adeo');
      if (fs.existsSync(binary)) return binary;
    }
    return null;
  }

  if (process.platform === 'win32') {
    const dir = fs.readdirSync(releaseDir).find((name) => name.startsWith('win-unpacked'));
    if (!dir) return null;
    const binary = path.join(releaseDir, dir, 'Adeo.exe');
    return fs.existsSync(binary) ? binary : null;
  }

  const linuxDir = fs.readdirSync(releaseDir).find((name) => name.startsWith('linux-unpacked'));
  if (!linuxDir) return null;
  const binary = path.join(releaseDir, linuxDir, 'adeo');
  return fs.existsSync(binary) ? binary : null;
};

const assertProtectedFilesUnchanged = createProtectedFilesGuard();

const packagedExecutable = findPackagedExecutable();
if (!packagedExecutable) {
  console.error(
    'No packaged Adeo build found for this platform under release/. ' +
      'Run npm run package:mac / package:win / package:linux first, or set ADEO_PACKAGED_APP.',
  );
  process.exitCode = 1;
  process.exit(1);
}

const { tempRoot, isolatedUserData, isolatedDatabase, bootstrapUserData } = createIsolatedPaths();

const launchEnv = () => {
  const env = cleanEnvironment();
  delete env.ADEO_PYTHON_BIN;
  delete env.PYTHONHOME;
  delete env.PYTHONPATH;
  return {
    ...env,
    ADEO_UI_TEST: '1',
    ADEO_USER_DATA_DIR: isolatedUserData,
    ADEO_DB_PATH: isolatedDatabase,
  };
};

const UVICORN_URL_RE = /Uvicorn running on (http:\/\/127\.0\.0\.1:\d+)/;

/** Spawns the packaged app headlessly-equivalent and resolves once its bundled API answers /health. */
const launchPackagedApp = () =>
  new Promise((resolve, reject) => {
    const child = spawn(packagedExecutable, [`--user-data-dir=${bootstrapUserData}`], {
      cwd: tempRoot,
      env: launchEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let resolved = false;
    const onData = (chunk) => {
      output += chunk.toString();
      const match = UVICORN_URL_RE.exec(output);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({ child, apiBaseUrl: match[1] });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => {
      if (!resolved) {
        child.kill('SIGKILL');
        reject(new Error(`Packaged app did not report a healthy API within the timeout. Output:\n${output}`));
      }
    }, 30_000);
    child.once('exit', (code) => {
      if (!resolved) {
        clearTimeout(timer);
        reject(new Error(`Packaged app exited (code ${code}) before becoming ready. Output:\n${output}`));
      }
    });
  });

const stopPackagedApp = (child) =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once('exit', () => resolve());
    child.kill();
  });

const waitForHealthy = async (apiBaseUrl, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiBaseUrl}/health`);
      if (response.ok) return;
    } catch {
      // API not listening yet; retry until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Local API at ${apiBaseUrl} never became healthy`);
};

let failure = null;
let runningChild = null;

try {
  const taskText = `Packaged smoke test ${randomUUID()}`;

  const first = await launchPackagedApp();
  runningChild = first.child;
  await waitForHealthy(first.apiBaseUrl);
  check(true, 'Packaged app opened and its bundled local API became healthy');

  const createResponse = await fetch(`${first.apiBaseUrl}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: taskText }),
  });
  check(createResponse.ok, 'Task creation request failed against the packaged API');
  const created = await createResponse.json();
  check(created.text === taskText, 'Created task text did not round-trip');
  const taskId = created.id;

  const listResponse = await fetch(`${first.apiBaseUrl}/tasks`);
  const listed = await listResponse.json();
  check(listed.some((task) => task.id === taskId && task.text === taskText), 'Created task could not be read back');

  const updatedText = `${taskText} (updated)`;
  const updateResponse = await fetch(`${first.apiBaseUrl}/tasks/${taskId}/text`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: updatedText }),
  });
  check(updateResponse.ok, 'Task update request failed against the packaged API');

  const afterUpdateResponse = await fetch(`${first.apiBaseUrl}/tasks`);
  const afterUpdate = await afterUpdateResponse.json();
  check(
    afterUpdate.some((task) => task.id === taskId && task.text === updatedText),
    'Task update was not applied through the packaged API',
  );

  await stopPackagedApp(runningChild);
  runningChild = null;

  const second = await launchPackagedApp();
  runningChild = second.child;
  await waitForHealthy(second.apiBaseUrl);

  const persistedResponse = await fetch(`${second.apiBaseUrl}/tasks`);
  const persisted = await persistedResponse.json();
  check(
    persisted.some((task) => task.id === taskId && task.text === updatedText),
    'Task did not survive an app restart',
  );
} catch (error) {
  failure = error;
} finally {
  if (runningChild) {
    try {
      await stopPackagedApp(runningChild);
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
  console.error(`Packaged smoke test failed after ${checks} checks: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`Packaged smoke test passed (${checks} checks) against ${packagedExecutable}`);
}
