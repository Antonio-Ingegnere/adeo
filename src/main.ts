import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage } from 'electron';
import Database from 'better-sqlite3';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const APP_NAME = 'Adeo';


let db: BetterSqliteDatabase | null = null;
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

function ensureDb(): BetterSqliteDatabase {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

function initializeDatabase(): void {
  const dbPath = path.join(app.getPath('userData'), 'tasks.db');
  db = new Database(dbPath);
  //db.prepare('DROP TABLE IF EXISTS tasks').run();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      done INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      list_id INTEGER,
      priority TEXT NOT NULL DEFAULT 'none',
      reminder_date TEXT,
      reminder_time TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  const taskColumns = db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>;
  const hasListId = taskColumns.some((col) => col.name === 'list_id');
  const hasPriority = taskColumns.some((col) => col.name === 'priority');
  const hasReminderDate = taskColumns.some((col) => col.name === 'reminder_date');
  const hasReminderTime = taskColumns.some((col) => col.name === 'reminder_time');
  if (!hasListId) {
    try {
      db.prepare('ALTER TABLE tasks ADD COLUMN list_id INTEGER').run();
    } catch (error) {
      console.error('Failed to add list_id column to tasks', error);
    }
  }
  if (!hasPriority) {
    try {
      db.prepare('ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT \"none\"').run();
    } catch (error) {
      console.error('Failed to add priority column to tasks', error);
    }
  }
  if (!hasReminderDate) {
    try {
      db.prepare('ALTER TABLE tasks ADD COLUMN reminder_date TEXT').run();
    } catch (error) {
      console.error('Failed to add reminder_date column to tasks', error);
    }
  }
  if (!hasReminderTime) {
    try {
      db.prepare('ALTER TABLE tasks ADD COLUMN reminder_time TEXT').run();
    } catch (error) {
      console.error('Failed to add reminder_time column to tasks', error);
    }
  }

  const listColumns = db.prepare('PRAGMA table_info(lists)').all() as Array<{ name: string }>;
  const hasListPosition = listColumns.some((col) => col.name === 'position');
  if (!hasListPosition) {
    try {
      db.prepare('ALTER TABLE lists ADD COLUMN position INTEGER NOT NULL DEFAULT 0').run();
      db.prepare('UPDATE lists SET position = id WHERE position = 0').run();
    } catch (error) {
      console.error('Failed to add position column to lists', error);
    }
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
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

  const database = ensureDb();
  const nextPositionRow = database.prepare('SELECT MAX(position) as maxPos FROM tasks').get() as {
    maxPos: number | null;
  };
  const nextPosition = typeof nextPositionRow?.maxPos === 'number' ? nextPositionRow.maxPos + 1 : 0;
  const result = database
    .prepare(
      'INSERT INTO tasks (text, details, done, position, list_id, priority, reminder_date, reminder_time) VALUES (?, ?, 0, ?, ?, ?, ?, ?)'
    )
    .run(trimmed, '', nextPosition, listId ?? null, 'none', null, null);
  const task = {
    id: Number(result.lastInsertRowid),
    text: trimmed,
    details: '',
    done: false,
    position: nextPosition,
    listId: listId ?? null,
    priority: 'none' as Priority,
    reminderDate: null as string | null,
    reminderTime: null as string | null,
  };
  return task;
});

ipcMain.handle('get-tasks', async () => {
  const database = ensureDb();
  const rows = database
    .prepare(
      `SELECT id, text, details, done, position, list_id as listId, priority, reminder_date as reminderDate, reminder_time as reminderTime
       FROM tasks
       ORDER BY position ASC, id ASC`
    )
    .all() as Array<{
      id: number;
      text: string;
      details: string;
      done: number;
      position: number;
      listId: number | null;
      priority?: Priority;
      reminderDate?: string | null;
      reminderTime?: string | null;
    }>;
  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    details: row.details,
    done: Boolean(row.done),
    position: row.position,
    listId: row.listId ?? null,
    priority: (row.priority ?? 'none') as Priority,
    reminderDate: row.reminderDate ?? null,
    reminderTime: row.reminderTime ?? null,
  }));
});

ipcMain.handle('update-task-done', async (_event, id: number, done: boolean) => {
  const database = ensureDb();
  database.prepare('UPDATE tasks SET done = ? WHERE id = ?').run(done ? 1 : 0, id);
  return { id, done };
});

ipcMain.handle('update-task-text', async (_event, id: number, text: string) => {
  const trimmed = text?.trim();
  if (!trimmed) {
    return { error: 'Task text is empty' };
  }
  const database = ensureDb();
  database.prepare('UPDATE tasks SET text = ? WHERE id = ?').run(trimmed, id);
  return { id, text: trimmed };
});

ipcMain.handle('update-task-list', async (_event, id: number, listId: number | null) => {
  const database = ensureDb();
  database.prepare('UPDATE tasks SET list_id = ? WHERE id = ?').run(listId ?? null, id);
  return { id, listId: listId ?? null };
});

ipcMain.handle('update-task-priority', async (_event, id: number, priority: Priority) => {
  const allowed: Priority[] = ['none', 'low', 'medium', 'high'];
  if (!allowed.includes(priority)) {
    return { error: 'Invalid priority' };
  }
  const database = ensureDb();
  database.prepare('UPDATE tasks SET priority = ? WHERE id = ?').run(priority, id);
  return { id, priority };
});

ipcMain.handle('update-task-details', async (_event, id: number, details: string) => {
  const database = ensureDb();
  database.prepare('UPDATE tasks SET details = ? WHERE id = ?').run(details ?? '', id);
  return { id, details: details ?? '' };
});

ipcMain.handle('update-task-order', async (_event, orderedIds: number[]) => {
  const database = ensureDb();
  const update = database.prepare('UPDATE tasks SET position = ? WHERE id = ?');
  const reorder = database.transaction((ids: number[]) => {
    ids.forEach((taskId, index) => {
      update.run(index, taskId);
    });
  });
  reorder(orderedIds);
  return { success: true };
});

ipcMain.handle('get-settings', async () => {
  return { ...appSettings };
});

ipcMain.handle('add-list', async (_event, name: string) => {
  const trimmed = name?.trim();
  if (!trimmed) {
    return { error: 'List name is empty' };
  }
  const database = ensureDb();
  const nextPosRow = database.prepare('SELECT MAX(position) as maxPos FROM lists').get() as { maxPos: number | null };
  const nextPos = typeof nextPosRow?.maxPos === 'number' ? nextPosRow.maxPos + 1 : 0;
  const result = database.prepare('INSERT INTO lists (name, position) VALUES (?, ?)').run(trimmed, nextPos);
  return { id: Number(result.lastInsertRowid), name: trimmed, position: nextPos };
});

ipcMain.handle('get-lists', async () => {
  const database = ensureDb();
  const rows = database
    .prepare('SELECT id, name, position FROM lists ORDER BY position ASC, id ASC')
    .all() as Array<{ id: number; name: string; position: number }>;
  return rows;
});

ipcMain.handle('update-list-name', async (_event, id: number, name: string) => {
  const trimmed = name?.trim();
  if (!trimmed) {
    return { error: 'List name is empty' };
  }
  const database = ensureDb();
  database.prepare('UPDATE lists SET name = ? WHERE id = ?').run(trimmed, id);
  return { id, name: trimmed };
});

ipcMain.handle('delete-list', async (_event, id: number) => {
  const database = ensureDb();
  const deleteTasks = database.prepare('DELETE FROM tasks WHERE list_id = ?');
  const deleteListStmt = database.prepare('DELETE FROM lists WHERE id = ?');
  const tx = database.transaction((listId: number) => {
    deleteTasks.run(listId);
    deleteListStmt.run(listId);
  });
  tx(id);
  return { id };
});

ipcMain.handle('update-list-order', async (_event, orderedIds: number[]) => {
  const database = ensureDb();
  const update = database.prepare('UPDATE lists SET position = ? WHERE id = ?');
  const reorder = database.transaction((ids: number[]) => {
    ids.forEach((listId, index) => {
      update.run(index, listId);
    });
  });
  reorder(orderedIds);
  return { success: true };
});

ipcMain.handle('update-task-reminder', async (_event, id: number, reminderDate: string | null, reminderTime: string | null) => {
  const database = ensureDb();
  database.prepare('UPDATE tasks SET reminder_date = ?, reminder_time = ? WHERE id = ?').run(reminderDate, reminderTime, id);
  return { id, reminderDate, reminderTime };
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

app.on('ready', () => {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  if (process.platform === 'darwin' && app.dock) {
    const dockIcon = nativeImage.createFromPath(iconPath);
    if (!dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon);
    }
  }

  initializeDatabase();
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
  if (db) {
    db.close();
  }
});
