import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import net from 'net';
import path from 'path';
import fs from 'fs';

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

let apiBaseUrl: string | null = null;
let apiProcess: ChildProcess | null = null;
let apiReady: Promise<void> | null = null;

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
  const maxAttempts = 40;
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

const startApiProcess = async () => {
  const port = await getFreePort();
  const dbPath = path.join(app.getPath('userData'), 'tasks.db');
  const pythonBin =
    process.env.ADEO_PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
  const appPath = app.getAppPath();
  const candidates = [
    path.join(appPath, 'dist', 'server', 'app.py'),
    path.join(appPath, 'server', 'app.py'),
  ];
  const apiScript = candidates.find((candidate) => fs.existsSync(candidate));
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
  if (apiProcess.stderr) {
    apiProcess.stderr.on('data', (chunk) => {
      stderrOutput += chunk.toString();
    });
  }
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

const apiRequest = async <T>(path: string, options?: RequestInit): Promise<T> => {
  await ensureApiReady();
  const url = `${apiBaseUrl}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
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

  await ensureApiReady();
  //Get back after debugging
  createWindow();
  if (mainWindow) {
    setupMenu(mainWindow);
  }

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
  if (apiProcess) {
    apiProcess.kill();
    apiProcess = null;
  }
});
