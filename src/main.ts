import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, screen } from 'electron';
import { spawn, exec, type ChildProcess } from 'child_process';
import net from 'net';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  clampWindowBoundsToDisplays,
  parseWindowBounds,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  type WindowBounds,
} from './window-bounds';

const APP_NAME = 'Adeo';

const isUiTest = process.env.ADEO_UI_TEST === '1';
const defaultUserDataPath = path.resolve(app.getPath('userData'));
const normalAdeoUserDataPath = path.resolve(
  process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', APP_NAME)
    : process.platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), APP_NAME)
      : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), APP_NAME),
);
const normalDatabasePath = path.join(normalAdeoUserDataPath, 'tasks.db');

const samePath = (left: string, right: string): boolean => {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
};

const failUiTestConfiguration = (message: string): never => {
  // Electron may discard an asynchronously buffered console message when process.exit follows
  // immediately. The self-test relies on this diagnostic to name the rejected variable, so
  // write it synchronously before terminating.
  fs.writeSync(2, `[Adeo UI test] ${message}\n`);
  // A top-level throw can leave Electron's browser process alive with no window. Invalid
  // isolation must terminate before settings, IPC, API or app lifecycle work.
  process.exit(1);
};

const requiredAbsoluteTestPath = (name: 'ADEO_USER_DATA_DIR' | 'ADEO_DB_PATH'): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    return failUiTestConfiguration(`${name} is required when ADEO_UI_TEST=1`);
  }
  if (!path.isAbsolute(value)) {
    return failUiTestConfiguration(`${name} must be an absolute path when ADEO_UI_TEST=1`);
  }
  return path.resolve(value);
};

let configuredDatabasePath = process.env.ADEO_DB_PATH?.trim()
  ? path.resolve(process.env.ADEO_DB_PATH)
  : null;

if (isUiTest) {
  if (process.env.ADEO_API_URL?.trim()) {
    failUiTestConfiguration('ADEO_API_URL must be unset when ADEO_UI_TEST=1');
  }

  const isolatedUserDataPath = requiredAbsoluteTestPath('ADEO_USER_DATA_DIR');
  configuredDatabasePath = requiredAbsoluteTestPath('ADEO_DB_PATH');

  if (
    samePath(isolatedUserDataPath, defaultUserDataPath) ||
    samePath(isolatedUserDataPath, normalAdeoUserDataPath)
  ) {
    failUiTestConfiguration('ADEO_USER_DATA_DIR must not use the normal Adeo userData path');
  }
  if (samePath(configuredDatabasePath, normalDatabasePath)) {
    failUiTestConfiguration('ADEO_DB_PATH must not use the normal Adeo database path');
  }

  // This must run before settingsPath, appSettings and lockFilePath are initialized.
  app.setPath('userData', isolatedUserDataPath);
}


let mainWindow: BrowserWindow | null = null;
let showCompleted = true;
type Priority = 'none' | 'low' | 'medium' | 'high';

type TimeFormat = '12h' | '24h';
type DateFormat =
  | 'YYYY-MM-DD'
  | 'DD/MM/YYYY'
  | 'MM/DD/YYYY'
  | 'DD.MM.YYYY'
  | 'YYYY/MM/DD'
  | 'MM-DD-YYYY'
  | 'DD-MM-YYYY'
  | 'MMM DD, YYYY'
  | 'DD MMM YYYY'
  | 'YYYY.MM.DD';

// Mirrors Theme in src/types.ts by hand, as TimeFormat/DateFormat already do.
type Theme = 'system' | 'light' | 'dark';

// Mirrors SidebarUiState in src/types.ts by hand, as Theme/TimeFormat already do.
type SidebarUiState = {
  sections: {
    lists: boolean;
    tags: boolean;
    smartLists: boolean;
    boards: boolean;
  };
  selection:
    | { kind: 'list'; id: number | null }
    | { kind: 'smart'; id: number }
    | { kind: 'board'; id: number };
  tagFilterId: number | null;
};

type AppSettings = {
  showCompleted: boolean;
  timeFormat: TimeFormat;
  dateFormat: DateFormat;
  theme: Theme;
  tagColors: boolean;
  // Mirrors Settings in src/types.ts by hand, as Theme/TimeFormat already do.
  shortcuts: Record<string, string[]>;
  menuAccelerators: Record<string, string>;
  sidebarUi: SidebarUiState;
  /** Last main-window geometry, restored (and display-clamped) on the next launch. */
  windowBounds: WindowBounds | null;
};

/** Accelerators the menu falls back to when the stored ones are missing or unusable. */
const DEFAULT_MENU_ACCELERATORS: Record<string, string> = {
  'search.focus': 'CmdOrCtrl+F',
  'view.toggleCompleted': 'CmdOrCtrl+Shift+H',
  'app.settings': 'CmdOrCtrl+,',
};

/**
 * Menu.buildFromTemplate *throws* on a malformed accelerator, which would leave the app with
 * no menu at all — and this value came off disk, where anything could have edited it. So it
 * is validated against a deliberately narrow shape rather than trusted.
 */
const ACCELERATOR_PATTERN =
  /^(?:(?:CmdOrCtrl|Command|Cmd|Control|Ctrl|Alt|Option|AltGr|Shift|Super|Meta)\+)*(?:[A-Za-z0-9]|F[1-9][0-2]?|[,./;'\[\]\\`\-=]|Space|Esc|Escape|Tab|Enter|Return|Backspace|Delete|Home|End|PageUp|PageDown|Up|Down|Left|Right|Plus)$/;

const safeAccelerator = (id: string, value: unknown): string => {
  const fallback = DEFAULT_MENU_ACCELERATORS[id];
  if (typeof value !== 'string' || !ACCELERATOR_PATTERN.test(value)) return fallback;
  return value;
};

/** Structural only. "Is this a shortcut id we know?" is a renderer question — main has no registry. */
const sanitizeShortcuts = (value: unknown): Record<string, string[]> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string[]> = {};
  for (const [id, bindings] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(bindings)) continue;
    if (!bindings.every((binding) => typeof binding === 'string')) continue;
    result[id] = bindings as string[];
  }
  return result;
};

const sanitizeMenuAccelerators = (value: unknown): Record<string, string> => {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const id of Object.keys(DEFAULT_MENU_ACCELERATORS)) {
    result[id] = safeAccelerator(id, raw[id]);
  }
  return result;
};

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

const defaultSidebarUi: SidebarUiState = {
  sections: { lists: true, tags: true, smartLists: true, boards: true },
  selection: { kind: 'list', id: null },
  tagFilterId: null,
};

/**
 * Structural only: main has no list/board registry, so "does this id still exist?" is a
 * renderer question answered on load. Anything that is not one of the three known selection
 * shapes, or a non-object / corrupt blob, collapses to the default (All lists, all sections
 * expanded) — the same result as a first run.
 */
const sanitizeSidebarUi = (value: unknown): SidebarUiState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...defaultSidebarUi, sections: { ...defaultSidebarUi.sections } };
  }
  const raw = value as Record<string, unknown>;
  const rawSections = (raw.sections && typeof raw.sections === 'object' ? raw.sections : {}) as Record<string, unknown>;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

  let selection: SidebarUiState['selection'] = { ...defaultSidebarUi.selection };
  const rawSelection = raw.selection;
  if (rawSelection && typeof rawSelection === 'object' && !Array.isArray(rawSelection)) {
    const sel = rawSelection as Record<string, unknown>;
    if (sel.kind === 'list' && (sel.id === null || (typeof sel.id === 'number' && Number.isFinite(sel.id)))) {
      selection = { kind: 'list', id: sel.id as number | null };
    } else if (sel.kind === 'smart' && typeof sel.id === 'number' && Number.isFinite(sel.id)) {
      selection = { kind: 'smart', id: sel.id };
    } else if (sel.kind === 'board' && typeof sel.id === 'number' && Number.isFinite(sel.id)) {
      selection = { kind: 'board', id: sel.id };
    }
  }

  const tagFilterId =
    typeof raw.tagFilterId === 'number' && Number.isFinite(raw.tagFilterId) ? raw.tagFilterId : null;

  return {
    sections: {
      lists: bool(rawSections.lists, defaultSidebarUi.sections.lists),
      tags: bool(rawSections.tags, defaultSidebarUi.sections.tags),
      smartLists: bool(rawSections.smartLists, defaultSidebarUi.sections.smartLists),
      boards: bool(rawSections.boards, defaultSidebarUi.sections.boards),
    },
    selection,
    tagFilterId,
  };
};

const defaultSettings: AppSettings = {
  showCompleted: true,
  timeFormat: '12h',
  dateFormat: 'YYYY-MM-DD',
  theme: 'system',
  tagColors: true,
  shortcuts: {},
  menuAccelerators: { ...DEFAULT_MENU_ACCELERATORS },
  sidebarUi: { ...defaultSidebarUi, sections: { ...defaultSidebarUi.sections } },
  windowBounds: null,
};

const normalizeTheme = (value: unknown): Theme =>
  value === 'light' || value === 'dark' || value === 'system' ? value : defaultSettings.theme;

const readSettings = (): AppSettings => {
  try {
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        ...defaultSettings,
        ...parsed,
        timeFormat: parsed.timeFormat === '24h' ? '24h' : '12h',
        dateFormat: parsed.dateFormat || defaultSettings.dateFormat,
        showCompleted: typeof parsed.showCompleted === 'boolean' ? parsed.showCompleted : true,
        theme: normalizeTheme(parsed.theme),
        tagColors: typeof parsed.tagColors === 'boolean' ? parsed.tagColors : true,
        shortcuts: sanitizeShortcuts(parsed.shortcuts),
        menuAccelerators: sanitizeMenuAccelerators(parsed.menuAccelerators),
        sidebarUi: sanitizeSidebarUi(parsed.sidebarUi),
        // Type/shape validation only here; display-aware clamping happens in
        // createWindow(), where Electron's screen module is ready.
        windowBounds: parseWindowBounds(parsed.windowBounds),
      };
    }
  } catch {
    // ignore and fall back
  }
  return { ...defaultSettings };
};

const writeSettings = (settings: AppSettings) => {
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('Failed to write settings', error);
  }
};

let appSettings: AppSettings = readSettings();
showCompleted = appSettings.showCompleted;

// Set the app name as early as possible so macOS uses it for the menu bar.
app.name = APP_NAME;
app.setName(APP_NAME);
if (process.platform === 'darwin') {
  app.setAboutPanelOptions({ applicationName: APP_NAME });
}
if (process.platform === 'win32') {
  app.setAppUserModelId('com.adeo.app');
}

// Registers the adeo:// scheme so background reminder notifications (fired by
// server/reminder_notifier.py while the app itself isn't running) can launch
// Adeo straight into a task's edit modal, matching in-app notification clicks.
if (!isUiTest) {
  app.setAsDefaultProtocolClient('adeo');
}

const findAdeoUrlInArgv = (argv: string[]): string | null =>
  argv.find((arg) => arg.startsWith('adeo://')) ?? null;

// app.isReady() only means Electron's browser process itself is initialized —
// it can become true well before our own ensureApiReady()+createWindow()
// sequence finishes, so it's not a safe proxy for "the renderer can actually
// handle a deep link yet". Track that explicitly instead, driven by the
// renderer's own 'renderer-ready' signal (sent once loadTasks()/loadLists()
// resolve) rather than any Electron-level readiness state.
let pendingAdeoUrl: string | null = null;
let rendererIsReady = false;

const tryHandlePendingAdeoUrl = () => {
  if (pendingAdeoUrl && rendererIsReady) {
    handleAdeoUrl(pendingAdeoUrl);
    pendingAdeoUrl = null;
  }
};

const gotSingleInstanceLock = isUiTest || app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else if (!isUiTest) {
  const launchUrl = findAdeoUrlInArgv(process.argv);
  if (launchUrl) {
    pendingAdeoUrl = launchUrl;
  }
  app.on('second-instance', (_event, argv) => {
    const url = findAdeoUrlInArgv(argv);
    if (url) {
      pendingAdeoUrl = url;
      tryHandlePendingAdeoUrl();
    } else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

if (!isUiTest) {
  app.on('open-url', (event, url) => {
    event.preventDefault();
    pendingAdeoUrl = url;
    tryHandlePendingAdeoUrl();
  });
}

let apiBaseUrl: string | null = null;
let apiProcess: ChildProcess | null = null;
let apiReady: Promise<void> | null = null;

const resetApiState = () => {
  apiBaseUrl = null;
  apiReady = null;
  if (apiProcess) {
    apiProcess.kill();
    apiProcess = null;
  }
};

const getFreePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1');
    server.on('listening', () => {
      const address = server.address() as net.AddressInfo;
      server.close(() => resolve(address.port));
    });
    server.on('error', reject);
  });

const waitForApi = async (baseUrl: string) => {
  const maxAttempts = 120;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Python API did not start in time');
};

const resolveBundledPython = (): string | null => {
  if (!app.isPackaged) return null;
  const basePath = path.join(process.resourcesPath, 'python');
  if (process.platform === 'win32') {
    const direct = path.join(basePath, 'python.exe');
    if (fs.existsSync(direct)) return direct;
    try {
      for (const entry of fs.readdirSync(basePath, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(basePath, entry.name, 'python.exe');
        if (fs.existsSync(candidate)) return candidate;
      }
    } catch {
      // ignore missing bundle
    }
    return null;
  }
  const candidates = [
    path.join(basePath, 'bin', 'python3'),
    path.join(basePath, 'bin', 'python'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
};

const resolvePythonBin = (): string =>
  process.env.ADEO_PYTHON_BIN ||
  resolveBundledPython() ||
  (process.platform === 'win32' ? 'python' : 'python3');

// python.exe is the console-subsystem build: launched detached (as Task
// Scheduler does for the background reminder checker), Windows flashes a
// visible console window on every trigger. pythonw.exe is the windowless
// twin shipped alongside it in the same directory — use it for anything
// that runs unattended in the background.
const resolveWindowsPythonwBin = (pythonBin: string): string => {
  const candidate = path.join(path.dirname(pythonBin), 'pythonw.exe');
  return fs.existsSync(candidate) ? candidate : pythonBin;
};

const resolveServerScript = (scriptName: string): string | null => {
  const appPath = app.getAppPath();
  const candidates = [
    path.join(appPath, 'dist', 'server', scriptName),
    path.join(appPath, 'server', scriptName),
  ];
  if (app.isPackaged) {
    const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked');
    candidates.unshift(
      path.join(unpackedPath, 'dist', 'server', scriptName),
      path.join(unpackedPath, 'server', scriptName),
      path.join(process.resourcesPath, 'dist', 'server', scriptName),
      path.join(process.resourcesPath, 'server', scriptName),
    );
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
};

const startApiProcess = async () => {
  const port = await getFreePort();
  const dbPath = configuredDatabasePath ?? path.join(app.getPath('userData'), 'tasks.db');
  const pythonBin = resolvePythonBin();
  const apiScript = resolveServerScript('app.py');
  if (!apiScript) {
    throw new Error('Python API script not found. Run `npm run build` or set ADEO_API_URL.');
  }
  let stderrOutput = '';
  apiProcess = spawn(pythonBin, [apiScript], {
    env: {
      ...process.env,
      ADEO_API_HOST: '127.0.0.1',
      ADEO_API_PORT: String(port),
      ADEO_DB_PATH: dbPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (apiProcess.stdout) {
    apiProcess.stdout.on('data', (chunk) => {
      console.log(`[api] ${chunk.toString().trim()}`);
    });
  }
  if (apiProcess.stderr) {
    apiProcess.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrOutput += text;
      console.error(`[api] ${text.trim()}`);
    });
  }
  apiProcess.on('exit', () => {
    apiProcess = null;
  });
  apiBaseUrl = `http://127.0.0.1:${port}`;
  const exitPromise = new Promise<never>((_, reject) => {
    apiProcess?.once('exit', (code) => {
      const message = stderrOutput.trim() || 'Python API exited before becoming ready.';
      reject(new Error(`Python API exited (code ${code ?? 'unknown'}): ${message}`));
    });
  });
  await Promise.race([waitForApi(apiBaseUrl), exitPromise]);
};

const ensureApiReady = async () => {
  if (apiBaseUrl) return;
  if (!apiReady) {
    apiReady = (async () => {
      const manualUrl = process.env.ADEO_API_URL;
      if (manualUrl) {
        apiBaseUrl = manualUrl.replace(/\/$/, '');
        await waitForApi(apiBaseUrl);
        return;
      }
      await startApiProcess();
    })();
  }
  await apiReady;
};

const apiRequest = async <T>(path: string, options?: RequestInit, retried = false): Promise<T> => {
  await ensureApiReady();
  const url = `${apiBaseUrl}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
    });
  } catch (error) {
    if (!process.env.ADEO_API_URL && !retried) {
      resetApiState();
      await ensureApiReady();
      return apiRequest(path, options, true);
    }
    throw error;
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      message = data?.detail ?? JSON.stringify(data);
    } catch {
      // ignore
    }
    return { error: message } as T;
  }
  return (await res.json()) as T;
};

type DueReminder = {
  id: number;
  text: string;
  reminderDate: string;
  reminderTime: string;
};

const notifiedReminders = new Map<number, string>();
let reminderPollTimer: NodeJS.Timeout | null = null;

const focusWindowAndOpenTask = (taskId: number) => {
  if (!mainWindow) {
    createWindow();
  }
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('open-task-edit', taskId);
};

const pollDueReminders = async () => {
  let due: DueReminder[];
  try {
    due = await apiRequest<DueReminder[]>('/reminders/due');
  } catch (error) {
    console.error('Failed to poll due reminders', error);
    return;
  }
  if (!Array.isArray(due)) return;

  const activeIds = new Set<number>();
  for (const reminder of due) {
    activeIds.add(reminder.id);
    const key = `${reminder.reminderDate}|${reminder.reminderTime}`;
    if (notifiedReminders.get(reminder.id) === key) continue;
    notifiedReminders.set(reminder.id, key);

    if (!Notification.isSupported()) continue;
    const notification = new Notification({
      title: 'Adeo Reminder',
      body: reminder.text,
    });
    notification.on('click', () => focusWindowAndOpenTask(reminder.id));
    notification.show();
  }

  for (const id of Array.from(notifiedReminders.keys())) {
    if (!activeIds.has(id)) {
      notifiedReminders.delete(id);
    }
  }
};

const startReminderPolling = () => {
  if (reminderPollTimer) return;
  pollDueReminders();
  reminderPollTimer = setInterval(pollDueReminders, 30000);
};

const stopReminderPolling = () => {
  if (reminderPollTimer) {
    clearInterval(reminderPollTimer);
    reminderPollTimer = null;
  }
};

// Lets the standalone background reminder checker (server/reminder_notifier.py,
// run by the OS scheduler even when Adeo isn't open) know whether this app
// process is already alive and handling notifications itself, so the two
// never fire duplicate notifications for the same reminder.
const lockFilePath = path.join(app.getPath('userData'), 'app-running.lock');

const writeRunningLock = () => {
  try {
    fs.mkdirSync(path.dirname(lockFilePath), { recursive: true });
    fs.writeFileSync(lockFilePath, String(process.pid));
  } catch (error) {
    console.error('Failed to write running lock', error);
  }
};

const removeRunningLock = () => {
  try {
    if (fs.existsSync(lockFilePath)) {
      fs.unlinkSync(lockFilePath);
    }
  } catch {
    // ignore
  }
};

const parseAdeoTaskUrl = (url: string): number | null => {
  const match = url.match(/^adeo:\/\/open-task\/(\d+)/);
  return match ? Number(match[1]) : null;
};

const handleAdeoUrl = (url: string) => {
  const taskId = parseAdeoTaskUrl(url);
  if (taskId !== null) {
    focusWindowAndOpenTask(taskId);
  }
};

const resolveMacNotifierBinary = (): string | null => {
  if (!app.isPackaged) {
    const devPath = path.join(
      app.getAppPath(),
      'vendor',
      'mac',
      'terminal-notifier.app',
      'Contents',
      'MacOS',
      'terminal-notifier',
    );
    return fs.existsSync(devPath) ? devPath : null;
  }
  const candidate = path.join(
    process.resourcesPath,
    'terminal-notifier.app',
    'Contents',
    'MacOS',
    'terminal-notifier',
  );
  return fs.existsSync(candidate) ? candidate : null;
};

const installMacLaunchAgent = (pythonBin: string, scriptPath: string) => {
  const label = 'com.adeo.app.reminders';
  const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
  const logPath = path.join(app.getPath('userData'), 'reminder-checker.log');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${pythonBin}</string>
      <string>${scriptPath}</string>
    </array>
    <key>StartInterval</key>
    <integer>30</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${logPath}</string>
    <key>StandardErrorPath</key>
    <string>${logPath}</string>
  </dict>
</plist>
`;
  try {
    fs.mkdirSync(path.dirname(plistPath), { recursive: true });
    fs.writeFileSync(plistPath, plist);
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    exec(
      `launchctl bootout gui/${uid}/${label} 2>/dev/null; launchctl bootstrap gui/${uid} "${plistPath}"`,
      (error) => {
        if (error) {
          console.error('Failed to (re)load reminder LaunchAgent', error);
        }
      },
    );
  } catch (error) {
    console.error('Failed to install reminder LaunchAgent', error);
  }

  // Trigger any first-run Rosetta-install prompt for the bundled (Intel-only)
  // terminal-notifier binary while we're in a normal interactive session,
  // rather than the first time the background LaunchAgent invokes it silently.
  const notifierBin = resolveMacNotifierBinary();
  if (notifierBin) {
    exec(`"${notifierBin}" -help`, () => {});
  }
};

const xmlEscape = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

// The plain `schtasks /create ... /sc minute /mo 1` command-line syntax has
// no flag to control power conditions, and Task Scheduler's default for
// tasks created that way is "don't start on battery power" / "stop if going
// onto battery power" — on a laptop running unplugged, that silently
// prevents the task from ever firing (confirmed via `schtasks /query /v`
// showing "Last Run Time" stuck at the never-ran sentinel). Registering via
// an explicit XML task definition is the only way to disable that.
const installWindowsScheduledTask = (pythonBin: string, scriptPath: string) => {
  const taskName = 'AdeoReminders';
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const startBoundary = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(
    now.getHours(),
  )}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Checks for due Adeo reminders and posts notifications even when Adeo is closed.</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <Repetition>
        <Interval>PT1M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>${startBoundary}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEscape(pythonBin)}</Command>
      <Arguments>"${xmlEscape(scriptPath)}"</Arguments>
    </Exec>
  </Actions>
</Task>`;
  try {
    const xmlPath = path.join(app.getPath('temp'), 'adeo-reminders-task.xml');
    // schtasks /create /xml requires UTF-16LE with a BOM; a plain UTF-8 file
    // fails to import with an opaque "XML data is invalid" error.
    fs.writeFileSync(xmlPath, '﻿' + xml, 'utf16le');
    exec(`schtasks /create /tn "${taskName}" /xml "${xmlPath}" /f`, { windowsHide: true }, (error) => {
      if (error) {
        console.error('Failed to register reminder Scheduled Task', error);
      }
    });
  } catch (error) {
    console.error('Failed to write Scheduled Task XML', error);
  }
};

// Windows toast notifications posted by a plain Win32 process (not an
// MSIX-packaged app) require the AUMID to be registered independently of any
// running process — either via a Start Menu shortcut carrying the AUMID
// property (which electron-builder's NSIS target does not reliably set) or,
// as done here, via registry keys under AppUserModelId. Without this,
// ToastNotificationManager.CreateToastNotifier(aumid) called from the
// standalone reminder_notifier.py -> reminder_notify_windows.ps1 (run by
// Task Scheduler while Adeo itself isn't running) fails silently — while
// Electron's own in-app Notification API keeps working because the live
// process already called setAppUserModelId. Safe/idempotent to (re)run on
// every startup.
const ensureWindowsToastAumidRegistered = () => {
  const aumid = 'com.adeo.app';
  const keyPath = `HKCU\\Software\\Classes\\AppUserModelId\\${aumid}`;
  const iconPath = process.execPath;
  const commands = [
    `reg add "${keyPath}" /v DisplayName /t REG_SZ /d "Adeo" /f`,
    `reg add "${keyPath}" /v IconUri /t REG_SZ /d "${iconPath}" /f`,
  ];
  exec(commands.join(' && '), { windowsHide: true }, (error) => {
    if (error) {
      console.error('Failed to register Windows toast AUMID', error);
    }
  });
};

const installLinuxSystemdTimer = (pythonBin: string, scriptPath: string) => {
  const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user');
  const serviceContent = `[Unit]
Description=Adeo reminder notification check

[Service]
Type=oneshot
ExecStart=${pythonBin} ${scriptPath}
`;
  const timerContent = `[Unit]
Description=Run the Adeo reminder checker periodically

[Timer]
OnBootSec=30
OnUnitActiveSec=30
Persistent=true

[Install]
WantedBy=timers.target
`;
  try {
    fs.mkdirSync(unitDir, { recursive: true });
    fs.writeFileSync(path.join(unitDir, 'adeo-reminders.service'), serviceContent);
    fs.writeFileSync(path.join(unitDir, 'adeo-reminders.timer'), timerContent);
    exec('systemctl --user daemon-reload && systemctl --user enable --now adeo-reminders.timer', (error) => {
      if (error) {
        console.error('Failed to enable reminder systemd timer', error);
      }
    });
  } catch (error) {
    console.error('Failed to install reminder systemd timer', error);
  }
};

// Installs (or refreshes) a per-OS background scheduler entry that keeps
// checking for due reminders and posting native notifications even when
// Adeo itself is fully closed. Safe to call on every startup — each
// installer overwrites its previous registration idempotently.
const ensureBackgroundReminderService = () => {
  const scriptPath = resolveServerScript('reminder_notifier.py');
  if (!scriptPath) {
    console.error('reminder_notifier.py not found; background reminders will not be installed.');
    return;
  }
  const pythonBin = resolvePythonBin();

  if (process.platform === 'darwin') {
    installMacLaunchAgent(pythonBin, scriptPath);
  } else if (process.platform === 'win32') {
    ensureWindowsToastAumidRegistered();
    installWindowsScheduledTask(resolveWindowsPythonwBin(pythonBin), scriptPath);
  } else {
    installLinuxSystemdTimer(pythonBin, scriptPath);
  }
};

// Painted before the renderer's first frame, and again whenever the resolved scheme
// changes. Without it every launch flashes white, which is invisible in the light scheme
// and glaring in the dark one. Values match --bg in styles.css.
const windowBackgroundColor = (): string => (nativeTheme.shouldUseDarkColors ? '#171717' : '#f5f5f5');

// shouldUseDarkColors already accounts for themeSource, so this covers both the user
// picking a theme and the OS flipping underneath us while the setting is 'system'.
nativeTheme.on('updated', () => {
  mainWindow?.setBackgroundColor(windowBackgroundColor());
});

// The renderer already applied its own state; this only mirrors the last window
// geometry into settings.json (same fire-and-forget shape as update-sidebar-ui).
const persistWindowBounds = (): void => {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  try {
    // getNormalBounds() is the pre-maximize/pre-fullscreen rect, so we never
    // persist the bogus full-display size while the window is maximized.
    const normal = win.getNormalBounds();
    const next: WindowBounds = {
      width: normal.width,
      height: normal.height,
      x: normal.x,
      y: normal.y,
      maximized: win.isMaximized() || win.isFullScreen(),
    };
    appSettings = { ...appSettings, windowBounds: next };
    writeSettings(appSettings);
  } catch (error) {
    console.error('Failed to persist window bounds', error);
  }
};

function createWindow(): void {
  // Re-clamped every launch against the displays connected right now, so a window
  // saved on a monitor that is no longer present can't restore off-screen. First
  // run (no saved bounds) leaves this null and the defaults below apply.
  const restoredBounds = clampWindowBoundsToDisplays(
    appSettings.windowBounds,
    screen.getAllDisplays().map((display) => display.workArea),
  );

  mainWindow = new BrowserWindow({
    width: restoredBounds?.width ?? DEFAULT_WINDOW_WIDTH,
    height: restoredBounds?.height ?? DEFAULT_WINDOW_HEIGHT,
    ...(restoredBounds && restoredBounds.x !== null && restoredBounds.y !== null
      ? { x: restoredBounds.x, y: restoredBounds.y }
      : {}),
    minWidth: 600,
    minHeight: 480,
    backgroundColor: windowBackgroundColor(),
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (restoredBounds?.maximized) {
    mainWindow.maximize();
  }

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // 'close' fires once, before the window is destroyed and before 'closed', so the
  // bounds are still readable here whether the user closed the window or quit the app.
  mainWindow.on('close', persistWindowBounds);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Electron ships no default context menu, so right-clicking a field offered nothing either.
  // Attached here rather than in setupMenu(), which is re-run on settings changes and would
  // stack duplicate listeners.
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const items: Electron.MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      items.push(
        { role: 'undo', enabled: params.editFlags.canUndo },
        { role: 'redo', enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: params.editFlags.canSelectAll }
      );
    } else if (params.selectionText.trim()) {
      items.push({ role: 'copy' });
    }
    if (items.length) {
      Menu.buildFromTemplate(items).popup({ window: mainWindow ?? undefined });
    }
  });

  setupMenu(mainWindow);
}

/**
 * Re-validated at build time, not only at read time: settings are also written from the
 * renderer, and one bad string here would throw out of Menu.buildFromTemplate and leave the
 * app with no menu.
 */
const menuAccelerator = (id: string): string =>
  safeAccelerator(id, appSettings.menuAccelerators?.[id]);

function setupMenu(window: BrowserWindow): void {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: 'about', label: `About ${APP_NAME}` },
              { type: 'separator' },
              { role: 'hide', label: `Hide ${APP_NAME}` },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit', label: `Quit ${APP_NAME}` },
            ],
          } as Electron.MenuItemConstructorOptions,
        ]
      : [
          {
            label: 'File',
            submenu: [{ role: 'quit' }],
          } as Electron.MenuItemConstructorOptions,
        ]),
    // Required, not decorative: Cmd/Ctrl+A, C, V, X, Z are delivered *by these menu roles*.
    // Calling Menu.setApplicationMenu with a template that omits them removes the
    // accelerators from the whole app, which is why every text field lost select-all and
    // clipboard support. Keep this submenu whenever the template changes.
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? ([
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' },
            ] as Electron.MenuItemConstructorOptions[])
          : ([
              { role: 'delete' },
              { type: 'separator' },
              { role: 'selectAll' },
            ] as Electron.MenuItemConstructorOptions[])),
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Find',
          accelerator: menuAccelerator('search.focus'),
          click: () => {
            window.webContents.send('focus-search');
          },
        },
        {
          label: 'Show Completed Tasks',
          type: 'checkbox',
          accelerator: menuAccelerator('view.toggleCompleted'),
          checked: showCompleted,
          click: (menuItem) => {
            showCompleted = menuItem.checked;
            appSettings = { ...appSettings, showCompleted };
            writeSettings(appSettings);
            window.webContents.send('show-completed-changed', showCompleted);
          },
        },
        {
          label: 'Settings',
          accelerator: menuAccelerator('app.settings'),
          click: () => {
            window.webContents.send('open-settings');
          },
        },
      ],
    },
    {
      label: 'Help',
      role: 'help',
      submenu: [
        {
          // No accelerator on purpose: the renderer owns this key so it can offer both "?"
          // and Mod+/, which one accelerator could not. The item is here for discovery.
          label: 'Keyboard Shortcuts',
          click: () => {
            window.webContents.send('open-shortcuts');
          },
        },
      ],
    },
    {
      label: 'Debug',
      submenu: [
        {
          label: 'Show DevTools',
          click: () => {
            if (!window.webContents.isDevToolsOpened()) {
              window.webContents.openDevTools({ mode: 'detach' });
            } else {
              window.webContents.closeDevTools();
            }
          },
        },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

ipcMain.handle('show-message', async (_event, text: string) => {
  const message = text?.trim() || 'No text provided';
  await dialog.showMessageBox({
    type: 'info',
    message,
    buttons: ['OK'],
  });
});

type TaskSeed = {
  priority?: string;
  reminderDate?: string | null;
  reminderTime?: string | null;
  repeatRule?: string | null;
  repeatStart?: string | null;
};

ipcMain.handle(
  'add-task',
  async (_event, text: string, listId?: number | null, tagIds?: number[], seed?: TaskSeed) => {
    const trimmed = text?.trim();
    if (!trimmed) {
      return { error: 'Task text is empty' };
    }
    return apiRequest('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        text: trimmed,
        listId: listId ?? null,
        tagIds: tagIds ?? [],
        ...(seed ?? {}),
      }),
    });
  }
);

ipcMain.handle('get-tasks', async () => {
  return apiRequest('/tasks');
});

ipcMain.handle('update-task-done', async (_event, id: number, done: boolean) => {
  return apiRequest(`/tasks/${id}/done`, {
    method: 'PATCH',
    body: JSON.stringify({ done }),
  });
});

ipcMain.handle('update-task-text', async (_event, id: number, text: string) => {
  const trimmed = text?.trim();
  if (!trimmed) {
    return { error: 'Task text is empty' };
  }
  return apiRequest(`/tasks/${id}/text`, {
    method: 'PATCH',
    body: JSON.stringify({ text: trimmed }),
  });
});

ipcMain.handle('update-task-list', async (_event, id: number, listId: number | null) => {
  return apiRequest(`/tasks/${id}/list`, {
    method: 'PATCH',
    body: JSON.stringify({ listId: listId ?? null }),
  });
});

ipcMain.handle('update-task-priority', async (_event, id: number, priority: Priority) => {
  const allowed: Priority[] = ['none', 'low', 'medium', 'high'];
  if (!allowed.includes(priority)) {
    return { error: 'Invalid priority' };
  }
  return apiRequest(`/tasks/${id}/priority`, {
    method: 'PATCH',
    body: JSON.stringify({ priority }),
  });
});

ipcMain.handle('update-task-details', async (_event, id: number, details: string) => {
  return apiRequest(`/tasks/${id}/details`, {
    method: 'PATCH',
    body: JSON.stringify({ details: details ?? '' }),
  });
});

ipcMain.handle('update-task-order', async (_event, orderedIds: number[]) => {
  return apiRequest('/tasks/order', {
    method: 'POST',
    body: JSON.stringify({ orderedIds }),
  });
});

ipcMain.handle('get-settings', async () => {
  return { ...appSettings };
});

ipcMain.handle('add-list', async (_event, name: string) => {
  const trimmed = name?.trim();
  if (!trimmed) {
    return { error: 'List name is empty' };
  }
  return apiRequest('/lists', {
    method: 'POST',
    body: JSON.stringify({ name: trimmed }),
  });
});

ipcMain.handle('get-lists', async () => {
  return apiRequest('/lists');
});

ipcMain.handle('update-list-name', async (_event, id: number, name: string) => {
  const trimmed = name?.trim();
  if (!trimmed) {
    return { error: 'List name is empty' };
  }
  return apiRequest(`/lists/${id}/name`, {
    method: 'PATCH',
    body: JSON.stringify({ name: trimmed }),
  });
});

ipcMain.handle('delete-task', async (_event, id: number) => {
  return apiRequest(`/tasks/${id}`, { method: 'DELETE' });
});

ipcMain.handle('delete-list', async (_event, id: number) => {
  return apiRequest(`/lists/${id}`, { method: 'DELETE' });
});

ipcMain.handle('update-list-order', async (_event, orderedIds: number[]) => {
  return apiRequest('/lists/order', {
    method: 'POST',
    body: JSON.stringify({ orderedIds }),
  });
});

ipcMain.handle('add-smart-list', async (_event, name: string, query: string) => {
  const trimmedName = name?.trim();
  const trimmedQuery = query?.trim();
  if (!trimmedName) {
    return { error: 'Smart list name is empty' };
  }
  if (!trimmedQuery) {
    return { error: 'Smart list query is empty' };
  }
  return apiRequest('/smart-lists', {
    method: 'POST',
    body: JSON.stringify({ name: trimmedName, query: trimmedQuery }),
  });
});

ipcMain.handle('get-smart-lists', async () => {
  return apiRequest('/smart-lists');
});

ipcMain.handle('update-smart-list-name', async (_event, id: number, name: string) => {
  const trimmed = name?.trim();
  if (!trimmed) {
    return { error: 'Smart list name is empty' };
  }
  return apiRequest(`/smart-lists/${id}/name`, {
    method: 'PATCH',
    body: JSON.stringify({ name: trimmed }),
  });
});

ipcMain.handle('update-smart-list-query', async (_event, id: number, query: string) => {
  const trimmed = query?.trim();
  if (!trimmed) {
    return { error: 'Smart list query is empty' };
  }
  return apiRequest(`/smart-lists/${id}/query`, {
    method: 'PATCH',
    body: JSON.stringify({ query: trimmed }),
  });
});

ipcMain.handle('delete-smart-list', async (_event, id: number) => {
  return apiRequest(`/smart-lists/${id}`, { method: 'DELETE' });
});

ipcMain.handle('update-smart-list-order', async (_event, orderedIds: number[]) => {
  return apiRequest('/smart-lists/order', {
    method: 'POST',
    body: JSON.stringify({ orderedIds }),
  });
});

type BoardColumnRef = { sourceKind: 'list' | 'smart'; sourceId: number };

ipcMain.handle('get-boards', async () => {
  return apiRequest('/boards');
});

ipcMain.handle('add-board', async (_event, name: string) => {
  const trimmed = name?.trim();
  if (!trimmed) {
    return { error: 'Board name is empty' };
  }
  return apiRequest('/boards', {
    method: 'POST',
    body: JSON.stringify({ name: trimmed }),
  });
});

ipcMain.handle('update-board-name', async (_event, id: number, name: string) => {
  const trimmed = name?.trim();
  if (!trimmed) {
    return { error: 'Board name is empty' };
  }
  return apiRequest(`/boards/${id}/name`, {
    method: 'PATCH',
    body: JSON.stringify({ name: trimmed }),
  });
});

ipcMain.handle('update-board-columns', async (_event, id: number, columns: BoardColumnRef[]) => {
  const allowed: BoardColumnRef['sourceKind'][] = ['list', 'smart'];
  const clean = (Array.isArray(columns) ? columns : []).filter(
    (column) =>
      column &&
      allowed.includes(column.sourceKind) &&
      Number.isInteger(column.sourceId)
  );
  return apiRequest(`/boards/${id}/columns`, {
    method: 'PUT',
    body: JSON.stringify({ columns: clean }),
  });
});

ipcMain.handle('delete-board', async (_event, id: number) => {
  return apiRequest(`/boards/${id}`, { method: 'DELETE' });
});

ipcMain.handle('update-board-order', async (_event, orderedIds: number[]) => {
  return apiRequest('/boards/order', {
    method: 'POST',
    body: JSON.stringify({ orderedIds }),
  });
});

ipcMain.handle('add-tag', async (_event, name: string) => {
  const trimmed = name?.trim();
  if (!trimmed) {
    return { error: 'Tag name is empty' };
  }
  return apiRequest('/tags', {
    method: 'POST',
    body: JSON.stringify({ name: trimmed }),
  });
});

ipcMain.handle('get-tags', async () => {
  return apiRequest('/tags');
});

ipcMain.handle('update-tag-name', async (_event, id: number, name: string) => {
  const trimmed = name?.trim();
  if (!trimmed) {
    return { error: 'Tag name is empty' };
  }
  return apiRequest(`/tags/${id}/name`, {
    method: 'PATCH',
    body: JSON.stringify({ name: trimmed }),
  });
});

ipcMain.handle('delete-tag', async (_event, id: number) => {
  return apiRequest(`/tags/${id}`, { method: 'DELETE' });
});

ipcMain.handle('update-tag-color', async (_event, id: number, color: string) => {
  return apiRequest(`/tags/${id}/color`, {
    method: 'PATCH',
    body: JSON.stringify({ color }),
  });
});

ipcMain.handle('update-tag-colors', async (_event, enabled: boolean) => {
  const tagColors = Boolean(enabled);
  appSettings = { ...appSettings, tagColors };
  writeSettings(appSettings);
  return { tagColors };
});

ipcMain.handle('update-tag-order', async (_event, orderedIds: number[]) => {
  return apiRequest('/tags/order', {
    method: 'POST',
    body: JSON.stringify({ orderedIds }),
  });
});

ipcMain.handle('set-task-tags', async (_event, id: number, tagIds: number[]) => {
  return apiRequest(`/tasks/${id}/tags`, {
    method: 'PUT',
    body: JSON.stringify({ tagIds: tagIds ?? [] }),
  });
});

ipcMain.handle('update-task-reminder', async (_event, id: number, reminderDate: string | null, reminderTime: string | null) => {
  return apiRequest(`/tasks/${id}/reminder`, {
    method: 'PATCH',
    body: JSON.stringify({ reminderDate, reminderTime }),
  });
});

ipcMain.handle('update-task-repeat', async (_event, id: number, repeatRule: string | null, repeatStart: string | null) => {
  return apiRequest(`/tasks/${id}/repeat`, {
    method: 'PATCH',
    body: JSON.stringify({ repeatRule, repeatStart }),
  });
});

ipcMain.handle('update-time-format', async (_event, format: TimeFormat) => {
  const nextFormat: TimeFormat = format === '24h' ? '24h' : '12h';
  appSettings = { ...appSettings, timeFormat: nextFormat };
  writeSettings(appSettings);
  return { timeFormat: nextFormat };
});

ipcMain.handle('update-date-format', async (_event, format: DateFormat) => {
  const allowed: DateFormat[] = [
    'YYYY-MM-DD',
    'DD/MM/YYYY',
    'MM/DD/YYYY',
    'DD.MM.YYYY',
    'YYYY/MM/DD',
    'MM-DD-YYYY',
    'DD-MM-YYYY',
    'MMM DD, YYYY',
    'DD MMM YYYY',
    'YYYY.MM.DD',
  ];
  const nextFormat = allowed.includes(format as DateFormat) ? (format as DateFormat) : defaultSettings.dateFormat;
  appSettings = { ...appSettings, dateFormat: nextFormat };
  writeSettings(appSettings);
  return { dateFormat: nextFormat };
});

// Setting themeSource is the whole of "apply the theme": it drives prefers-color-scheme in
// the renderer (so styles.css needs no switch of its own) and the native window chrome.
ipcMain.handle(
  'update-shortcuts',
  async (
    _event,
    payload: { overrides: Record<string, string[]>; menuAccelerators: Record<string, string> }
  ) => {
    const shortcuts = sanitizeShortcuts(payload?.overrides);
    const menuAccelerators = sanitizeMenuAccelerators(payload?.menuAccelerators);
    appSettings = { ...appSettings, shortcuts, menuAccelerators };
    writeSettings(appSettings);
    // The menu holds the keys for the menu-owned shortcuts, so rebinding one of those means
    // rebuilding the menu — otherwise the old accelerator stays live until the next launch.
    if (mainWindow) {
      setupMenu(mainWindow);
    }
    return { shortcuts, menuAccelerators };
  }
);

ipcMain.handle('update-show-completed', async (_event, show: boolean) => {
  showCompleted = Boolean(show);
  appSettings = { ...appSettings, showCompleted };
  writeSettings(appSettings);
  // The View menu owns a checkbox for this, and setupMenu reads the module-level showCompleted
  // for its `checked`, so rebuilding the menu *is* the two-way sync -- same as update-shortcuts.
  // Deliberately no send('show-completed-changed'): the renderer initiated this and already
  // knows, and echoing it back would re-render the task list twice.
  if (mainWindow) {
    setupMenu(mainWindow);
  }
  return { showCompleted };
});

ipcMain.handle('update-theme', async (_event, theme: Theme) => {
  const nextTheme = normalizeTheme(theme);
  nativeTheme.themeSource = nextTheme;
  appSettings = { ...appSettings, theme: nextTheme };
  writeSettings(appSettings);
  return { theme: nextTheme };
});

// The renderer owns which sidebar item is selected and which sections are open; this only
// persists the sanitized snapshot so the next launch can restore it. Same fire-and-forget
// shape as update-theme: the renderer already applied the change locally.
ipcMain.handle('update-sidebar-ui', async (_event, next: unknown) => {
  const sidebarUi = sanitizeSidebarUi(next);
  appSettings = { ...appSettings, sidebarUi };
  writeSettings(appSettings);
  return { sidebarUi };
});


// //TODO: Only for debugging, remove later!!!
// app.whenReady().then(() => {
//   setTimeout(() => {
//     createWindow();
//   }, 2000); // give VS Code 2000ms to attach
// });

app.whenReady().then(async () => {
  // Must precede createWindow(): the window's backgroundColor is read from
  // shouldUseDarkColors, so applying the stored theme later would flash the wrong scheme
  // on every launch for anyone not on 'system'.
  nativeTheme.themeSource = appSettings.theme;

  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  if (process.platform === 'darwin' && app.dock) {
    const dockIcon = nativeImage.createFromPath(iconPath);
    if (!dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon);
    }
  }

  try {
    await ensureApiReady();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox('Adeo failed to start', `The local API could not be started.\n\n${message}`);
    app.quit();
    return;
  }

  createWindow();
  if (mainWindow) {
    setupMenu(mainWindow);
  }
  if (!isUiTest) {
    startReminderPolling();
    writeRunningLock();
    ensureBackgroundReminderService();
  }

  // A cold launch's deep link can't be applied immediately after createWindow():
  // the renderer hasn't loaded its tasks yet (openEditModal silently no-ops if
  // state.tasks doesn't have the task), so wait for it to say it's ready.
  ipcMain.on('renderer-ready', () => {
    rendererIsReady = true;
    tryHandlePendingAdeoUrl();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      if (mainWindow) {
        setupMenu(mainWindow);
      }
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (!isUiTest) {
    stopReminderPolling();
    removeRunningLock();
  }
  if (apiProcess) {
    apiProcess.kill();
    apiProcess = null;
  }
});
