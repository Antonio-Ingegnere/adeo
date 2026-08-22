// Safety self-test for automated Electron launches.
// Run with: npm run test:isolation
//
// This intentionally exercises the production renderer -> preload -> IPC -> FastAPI ->
// SQLite path while snapshotting Adeo's normal data files before and after the run.

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const require = createRequire(import.meta.url);
const electronExecutable = require('electron');
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

let checks = 0;
const check = (condition, message) => {
  checks += 1;
  if (!condition) throw new Error(message);
};

const normalUserDataDir = () => {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Adeo');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Adeo');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Adeo');
};

const protectedPaths = (() => {
  const userData = normalUserDataDir();
  const database = path.join(userData, 'tasks.db');
  return [
    database,
    `${database}-wal`,
    `${database}-shm`,
    `${database}-journal`,
    path.join(userData, 'settings.json'),
  ];
})();

const snapshotFile = (filePath) =>
  fs.existsSync(filePath)
    ? { exists: true, bytes: fs.readFileSync(filePath) }
    : { exists: false, bytes: null };

const protectedBefore = new Map(protectedPaths.map((filePath) => [filePath, snapshotFile(filePath)]));

const assertProtectedFilesUnchanged = () => {
  for (const filePath of protectedPaths) {
    const before = protectedBefore.get(filePath);
    const after = snapshotFile(filePath);
    check(before.exists === after.exists, `Protected file existence changed: ${filePath}`);
    if (before.exists && after.exists) {
      check(before.bytes.equals(after.bytes), `Protected file bytes changed: ${filePath}`);
    }
  }
};

const cleanEnvironment = () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry) => typeof entry[1] === 'string'),
  );
  delete env.ADEO_API_URL;
  return env;
};

const runElectronProcess = (env, bootstrapUserData, timeoutMs = 10_000) =>
  new Promise((resolve, reject) => {
    const child = spawn(electronExecutable, [`--user-data-dir=${bootstrapUserData}`, repoRoot], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Invalid isolation launch did not fail before the timeout'));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, output });
    });
  });

const pythonBin = fs.existsSync(path.join(repoRoot, '.venv', 'bin', 'python'))
  ? path.join(repoRoot, '.venv', 'bin', 'python')
  : process.platform === 'win32'
    ? 'python'
    : 'python3';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adeo-ui-test-'));
const isolatedUserData = path.join(tempRoot, 'user data');
const isolatedDataDir = path.join(tempRoot, 'data');
const isolatedDatabase = path.join(isolatedDataDir, 'tasks.db');
const bootstrapUserData = path.join(tempRoot, 'electron bootstrap');
fs.mkdirSync(isolatedUserData, { recursive: true });
fs.mkdirSync(isolatedDataDir, { recursive: true });
fs.mkdirSync(bootstrapUserData, { recursive: true });

const isolatedEnvironment = () => ({
  ...cleanEnvironment(),
  ADEO_UI_TEST: '1',
  ADEO_USER_DATA_DIR: isolatedUserData,
  ADEO_DB_PATH: isolatedDatabase,
  ADEO_PYTHON_BIN: pythonBin,
});

let electronApp = null;
let failure = null;

try {
  const normalUserData = normalUserDataDir();
  const invalidConfigurations = [
    {
      label: 'missing ADEO_DB_PATH',
      expected: 'ADEO_DB_PATH',
      mutate: (env) => delete env.ADEO_DB_PATH,
    },
    {
      label: 'missing ADEO_USER_DATA_DIR',
      expected: 'ADEO_USER_DATA_DIR',
      mutate: (env) => delete env.ADEO_USER_DATA_DIR,
    },
    {
      label: 'inherited ADEO_API_URL',
      expected: 'ADEO_API_URL',
      mutate: (env) => {
        env.ADEO_API_URL = 'http://127.0.0.1:1';
      },
    },
    {
      label: 'relative ADEO_DB_PATH',
      expected: 'ADEO_DB_PATH',
      mutate: (env) => {
        env.ADEO_DB_PATH = 'relative-tasks.db';
      },
    },
    {
      label: 'relative ADEO_USER_DATA_DIR',
      expected: 'ADEO_USER_DATA_DIR',
      mutate: (env) => {
        env.ADEO_USER_DATA_DIR = 'relative-user-data';
      },
    },
    {
      label: 'normal Adeo database path',
      expected: 'ADEO_DB_PATH',
      mutate: (env) => {
        env.ADEO_DB_PATH = path.join(normalUserData, 'tasks.db');
      },
    },
    {
      label: 'normal Adeo userData path',
      expected: 'ADEO_USER_DATA_DIR',
      mutate: (env) => {
        env.ADEO_USER_DATA_DIR = normalUserData;
      },
    },
  ];

  for (const invalid of invalidConfigurations) {
    const env = isolatedEnvironment();
    invalid.mutate(env);
    const result = await runElectronProcess(env, bootstrapUserData);
    check(result.code !== 0, `${invalid.label} did not exit non-zero`);
    check(result.output.includes(invalid.expected), `${invalid.label} did not name ${invalid.expected}`);
    check(!fs.existsSync(isolatedDatabase), `${invalid.label} created the isolated database`);
  }

  electronApp = await electron.launch({
    executablePath: electronExecutable,
    args: [`--user-data-dir=${bootstrapUserData}`, repoRoot],
    cwd: repoRoot,
    env: isolatedEnvironment(),
  });

  const page = await electronApp.firstWindow();
  await page.emulateMedia({ colorScheme: null });
  const input = page.locator('#message-input');
  await input.waitFor({ state: 'visible' });

  const taskText = `Isolation self-test ${randomUUID()}`;
  await input.fill(taskText);
  await input.press('Enter');
  await page.locator('.task-text').filter({ hasText: taskText }).waitFor({ state: 'visible' });
  check(true, 'Unique task rendered through the production Quick Add flow');

  const writtenTimeFormat = await page.evaluate(async () => {
    const settings = await window.electronAPI.getSettings();
    const next = settings.timeFormat === '24h' ? '12h' : '24h';
    const written = await window.electronAPI.updateTimeFormat(next);
    return written.timeFormat;
  });

  await electronApp.close();
  electronApp = null;

  check(fs.existsSync(isolatedDatabase), 'Isolated SQLite database was not created');
  const query = [
    'import sqlite3, sys',
    'conn = sqlite3.connect(sys.argv[1])',
    'row = conn.execute("SELECT COUNT(*) FROM tasks WHERE text = ?", (sys.argv[2],)).fetchone()',
    'conn.close()',
    'print(row[0])',
  ].join('; ');
  const queryResult = spawnSync(pythonBin, ['-c', query, isolatedDatabase, taskText], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  check(queryResult.status === 0, 'Could not inspect the isolated SQLite database');
  check(queryResult.stdout.trim() === '1', 'Unique task was not persisted in the isolated database');

  const isolatedSettingsPath = path.join(isolatedUserData, 'settings.json');
  check(fs.existsSync(isolatedSettingsPath), 'Isolated settings.json was not created');
  const isolatedSettings = JSON.parse(fs.readFileSync(isolatedSettingsPath, 'utf8'));
  check(
    isolatedSettings.timeFormat === writtenTimeFormat,
    'The settings update was not persisted under isolated userData',
  );
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
    assertProtectedFilesUnchanged();
  } catch (protectedError) {
    failure ??= protectedError;
  }

  try {
    const resolvedTemp = path.resolve(tempRoot);
    const tempBase = `${path.resolve(os.tmpdir())}${path.sep}`;
    if (!resolvedTemp.startsWith(tempBase)) {
      throw new Error('Refusing to clean a temp path outside os.tmpdir()');
    }
    fs.rmSync(resolvedTemp, { recursive: true, force: true });
  } catch (cleanupError) {
    failure ??= cleanupError;
  }
}

if (failure) {
  console.error(`Isolation self-test failed after ${checks} checks: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`Isolation self-test passed (${checks} checks)`);
}
