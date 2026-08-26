// Shared "safe launch" helpers for automated Electron runs. Per root CLAUDE.md: any automated
// Electron run must use the full ADEO_UI_TEST environment (ADEO_UI_TEST=1 + absolute
// ADEO_USER_DATA_DIR + absolute ADEO_DB_PATH + no ADEO_API_URL) and must never touch the real
// development database or Electron user-data directory. Extracted from
// test-isolation-selftest.mjs so a second script (quick-add-selftest.mjs) can share one
// definition of "safe launch" rather than drifting from it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const normalUserDataDir = () => {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Adeo');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Adeo');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Adeo');
};

export const protectedPaths = () => {
  const userData = normalUserDataDir();
  const database = path.join(userData, 'tasks.db');
  return [
    database,
    `${database}-wal`,
    `${database}-shm`,
    `${database}-journal`,
    path.join(userData, 'settings.json'),
  ];
};

export const snapshotFile = (filePath) =>
  fs.existsSync(filePath)
    ? { exists: true, bytes: fs.readFileSync(filePath) }
    : { exists: false, bytes: null };

/**
 * Snapshots the real dev database/settings immediately, and returns a function that re-checks
 * them later against the caller's own `check(condition, message)` assertion helper -- the
 * byte-for-byte guarantee that a run touched none of Adeo's real data.
 */
export const createProtectedFilesGuard = () => {
  const paths = protectedPaths();
  const before = new Map(paths.map((filePath) => [filePath, snapshotFile(filePath)]));
  return (check) => {
    for (const filePath of paths) {
      const beforeSnapshot = before.get(filePath);
      const after = snapshotFile(filePath);
      check(beforeSnapshot.exists === after.exists, `Protected file existence changed: ${filePath}`);
      if (beforeSnapshot.exists && after.exists) {
        check(beforeSnapshot.bytes.equals(after.bytes), `Protected file bytes changed: ${filePath}`);
      }
    }
  };
};

export const cleanEnvironment = () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry) => typeof entry[1] === 'string'),
  );
  delete env.ADEO_API_URL;
  return env;
};

export const resolvePythonBin = (repoRoot) =>
  fs.existsSync(path.join(repoRoot, '.venv', 'bin', 'python'))
    ? path.join(repoRoot, '.venv', 'bin', 'python')
    : process.platform === 'win32'
      ? 'python'
      : 'python3';

/** Creates the temp root and the subdirectories every isolated launch needs. */
export const createIsolatedPaths = () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adeo-ui-test-'));
  const isolatedUserData = path.join(tempRoot, 'user data');
  const isolatedDataDir = path.join(tempRoot, 'data');
  const isolatedDatabase = path.join(isolatedDataDir, 'tasks.db');
  const bootstrapUserData = path.join(tempRoot, 'electron bootstrap');
  fs.mkdirSync(isolatedUserData, { recursive: true });
  fs.mkdirSync(isolatedDataDir, { recursive: true });
  fs.mkdirSync(bootstrapUserData, { recursive: true });
  return { tempRoot, isolatedUserData, isolatedDataDir, isolatedDatabase, bootstrapUserData };
};

export const isolatedEnvironment = ({ isolatedUserData, isolatedDatabase, pythonBin }) => ({
  ...cleanEnvironment(),
  ADEO_UI_TEST: '1',
  ADEO_USER_DATA_DIR: isolatedUserData,
  ADEO_DB_PATH: isolatedDatabase,
  ADEO_PYTHON_BIN: pythonBin,
});

/** Refuses to delete anything outside os.tmpdir(). */
export const cleanupTempRoot = (tempRoot) => {
  const resolvedTemp = path.resolve(tempRoot);
  const tempBase = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (!resolvedTemp.startsWith(tempBase)) {
    throw new Error('Refusing to clean a temp path outside os.tmpdir()');
  }
  fs.rmSync(resolvedTemp, { recursive: true, force: true });
};
