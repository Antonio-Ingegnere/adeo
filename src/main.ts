import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import Database from 'better-sqlite3';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import path from 'path';

const APP_NAME = 'Adeo';


let db: BetterSqliteDatabase | null = null;
let mainWindow: BrowserWindow | null = null;
let showCompleted = true;

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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
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
            window.webContents.send('show-completed-changed', showCompleted);
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

ipcMain.handle('add-task', async (_event, text: string) => {
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
    .prepare('INSERT INTO tasks (text, details, done, position) VALUES (?, ?, 0, ?)')
    .run(trimmed, '', nextPosition);
  const task = { id: Number(result.lastInsertRowid), text: trimmed, details: '', done: false, position: nextPosition };
  return task;
});

ipcMain.handle('get-tasks', async () => {
  const database = ensureDb();
  const rows = database
    .prepare('SELECT id, text, details, done, position FROM tasks ORDER BY position ASC, id ASC')
    .all() as Array<{ id: number; text: string; details: string; done: number; position: number }>;
  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    details: row.details,
    done: Boolean(row.done),
    position: row.position,
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
  return { showCompleted };
});

ipcMain.handle('add-project', async (_event, name: string) => {
  const trimmed = name?.trim();
  if (!trimmed) {
    return { error: 'Project name is empty' };
  }
  const database = ensureDb();
  const result = database.prepare('INSERT INTO projects (name) VALUES (?)').run(trimmed);
  return { id: Number(result.lastInsertRowid), name: trimmed };
});

ipcMain.handle('get-projects', async () => {
  const database = ensureDb();
  const rows = database
    .prepare('SELECT id, name FROM projects ORDER BY id ASC')
    .all() as Array<{ id: number; name: string }>;
  return rows;
});

app.on('ready', () => {
  initializeDatabase();
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
