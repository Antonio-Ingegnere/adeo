'use strict';
// electron-builder afterPack hook: fails the build with an actionable message instead of
// shipping a release whose bundled Python runtime or backend dependencies are missing or
// mismatched for the architecture that was just packaged.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REQUIRED_DIST_INFO_PREFIXES = [
  'fastapi-',
  'starlette-',
  'uvicorn-',
  'pydantic-',
  'pydantic_core-',
  'python_dateutil-',
  'anyio-',
  'click-',
  'h11-',
  'idna-',
  'annotated_types-',
  'typing_extensions-',
  'typing_inspection-',
];

const archName = (arch) => ['ia32', 'x64', 'armv7l', 'arm64', 'universal'][arch] || String(arch);

function findResourcesDir(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  if (electronPlatformName === 'darwin') {
    const appName = `${packager.appInfo.productFilename}.app`;
    return path.join(appOutDir, appName, 'Contents', 'Resources');
  }
  return path.join(appOutDir, 'resources');
}

function findPythonBinary(resourcesDir, electronPlatformName) {
  const pythonDir = path.join(resourcesDir, 'python');
  if (electronPlatformName === 'win32') {
    const direct = path.join(pythonDir, 'python.exe');
    if (fs.existsSync(direct)) return direct;
    if (fs.existsSync(pythonDir)) {
      for (const entry of fs.readdirSync(pythonDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(pythonDir, entry.name, 'python.exe');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    return null;
  }
  for (const name of ['bin/python3', 'bin/python']) {
    const candidate = path.join(pythonDir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function findSitePackages(pythonBinary, electronPlatformName) {
  if (electronPlatformName === 'win32') {
    return path.join(path.dirname(pythonBinary), 'Lib', 'site-packages');
  }
  const pythonDir = path.dirname(path.dirname(pythonBinary));
  const libDir = path.join(pythonDir, 'lib');
  if (!fs.existsSync(libDir)) return null;
  const versionDir = fs.readdirSync(libDir).find((name) => /^python3\.\d+$/.test(name));
  return versionDir ? path.join(libDir, versionDir, 'site-packages') : null;
}

function checkRequiredPackages(sitePackagesDir) {
  if (!sitePackagesDir || !fs.existsSync(sitePackagesDir)) {
    return [`site-packages directory not found: ${sitePackagesDir}`];
  }
  const entries = fs.readdirSync(sitePackagesDir);
  const missing = [];
  for (const prefix of REQUIRED_DIST_INFO_PREFIXES) {
    if (!entries.some((entry) => entry.toLowerCase().startsWith(prefix.toLowerCase()) && entry.endsWith('.dist-info'))) {
      missing.push(prefix);
    }
  }
  return missing.map((prefix) => `missing backend dependency in bundled Python: ${prefix}*`);
}

function checkServerScript(resourcesDir) {
  const problems = [];
  if (!fs.existsSync(path.join(resourcesDir, 'server', 'app.py'))) {
    problems.push(`missing backend script: ${path.join(resourcesDir, 'server', 'app.py')}`);
  }
  if (!fs.existsSync(path.join(resourcesDir, 'server', 'reminder_notifier.py'))) {
    problems.push(`missing reminder helper script: ${path.join(resourcesDir, 'server', 'reminder_notifier.py')}`);
  }
  return problems;
}

function canExecuteNatively(electronPlatformName, arch) {
  const platformMatches =
    (electronPlatformName === 'darwin' && process.platform === 'darwin') ||
    (electronPlatformName === 'win32' && process.platform === 'win32') ||
    (electronPlatformName === 'linux' && process.platform === 'linux');
  if (!platformMatches) return false;
  const archString = archName(arch);
  if (archString === process.arch) return true;
  // Apple Silicon can run an x64 (Rosetta 2) mac binary.
  if (electronPlatformName === 'darwin' && process.arch === 'arm64' && archString === 'x64') return true;
  return false;
}

function smokeTestInterpreter(pythonBinary) {
  const probe = 'import fastapi, uvicorn, dateutil, pydantic, pydantic_core, sqlite3; print("ok")';
  try {
    const output = execFileSync(pythonBinary, ['-c', probe], {
      env: { PATH: process.env.PATH || '' },
      timeout: 30000,
      encoding: 'utf8',
    });
    if (!output.includes('ok')) {
      return [`bundled interpreter smoke test produced unexpected output: ${output}`];
    }
    return [];
  } catch (error) {
    return [`bundled interpreter failed to import required backend dependencies: ${error.message}`];
  }
}

module.exports = async function afterPack(context) {
  const { electronPlatformName, arch } = context;
  const resourcesDir = findResourcesDir(context);
  const problems = [];

  const pythonBinary = findPythonBinary(resourcesDir, electronPlatformName);
  if (!pythonBinary) {
    problems.push(`no bundled Python runtime found under ${path.join(resourcesDir, 'python')}`);
  } else {
    if (electronPlatformName !== 'win32') {
      const mode = fs.statSync(pythonBinary).mode;
      if (!(mode & 0o111)) {
        problems.push(`bundled Python binary is not executable: ${pythonBinary}`);
      }
    }
    const sitePackagesDir = findSitePackages(pythonBinary, electronPlatformName);
    problems.push(...checkRequiredPackages(sitePackagesDir));
    if (canExecuteNatively(electronPlatformName, arch)) {
      problems.push(...smokeTestInterpreter(pythonBinary));
    }
  }

  problems.push(...checkServerScript(resourcesDir));

  if (problems.length > 0) {
    throw new Error(
      `Adeo release bundle for ${electronPlatformName}/${archName(arch)} is incomplete:\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    );
  }

  console.log(`[after-pack-verify] ${electronPlatformName}/${archName(arch)} bundle verified OK.`);
};
