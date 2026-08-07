import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification } from 'electron';
import { spawn, exec, type ChildProcess } from 'child_process';
import net from 'net';
import path from 'path';
import fs from 'fs';
import os from 'os';

const APP_NAME = 'Adeo';


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

type AppSettings = {
  showCompleted: boolean;
  timeFormat: TimeFormat;
  dateFormat: DateFormat;
};

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

const defaultSettings: AppSettings = {
  showCompleted: true,
  timeFormat: '12h',
  dateFormat: 'YYYY-MM-DD',
};

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
app.setAsDefaultProtocolClient('adeo');

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

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
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

app.on('open-url', (event, url) => {
  event.preventDefault();
  pendingAdeoUrl = url;
  tryHandlePendingAdeoUrl();
});

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
  const dbPath = path.join(app.getPath('userData'), 'tasks.db');
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

const installWindowsScheduledTask = (pythonBin: string, scriptPath: string) => {
  const taskName = 'AdeoReminders';
  const command = `schtasks /create /tn "${taskName}" /tr "\\"${pythonBin}\\" \\"${scriptPath}\\"" /sc minute /mo 1 /f`;
  exec(command, (error) => {
    if (error) {
      console.error('Failed to register reminder Scheduled Task', error);
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
    installWindowsScheduledTask(pythonBin, scriptPath);
  } else {
    installLinuxSystemdTimer(pythonBin, scriptPath);
  }
};

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 480,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  setupMenu(mainWindow);
}

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
    {
      label: 'View',
      submenu: [
        {
          label: 'Show Completed Tasks',
          type: 'checkbox',
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
          click: () => {
            window.webContents.send('open-settings');
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

ipcMain.handle('add-task', async (_event, text: string, listId?: number | null) => {
  const trimmed = text?.trim();
  if (!trimmed) {
    return { error: 'Task text is empty' };
  }
  return apiRequest('/tasks', {
    method: 'POST',
    body: JSON.stringify({ text: trimmed, listId: listId ?? null }),
  });
});

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

ipcMain.handle('delete-list', async (_event, id: number) => {
  return apiRequest(`/lists/${id}`, { method: 'DELETE' });
});

ipcMain.handle('update-list-order', async (_event, orderedIds: number[]) => {
  return apiRequest('/lists/order', {
    method: 'POST',
    body: JSON.stringify({ orderedIds }),
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


// //TODO: Only for debugging, remove later!!!
// app.whenReady().then(() => {
//   setTimeout(() => {
//     createWindow();
//   }, 2000); // give VS Code 2000ms to attach
// });

app.whenReady().then(async () => {
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
  startReminderPolling();
  writeRunningLock();
  ensureBackgroundReminderService();

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
  stopReminderPolling();
  removeRunningLock();
  if (apiProcess) {
    apiProcess.kill();
    apiProcess = null;
  }
});
