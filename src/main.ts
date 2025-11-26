import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import Database from 'better-sqlite3';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import path from 'path';

let db: BetterSqliteDatabase | null = null;

function ensureDb(): BetterSqliteDatabase {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

function initializeDatabase(): void {
  const dbPath = path.join(app.getPath('userData'), 'tasks.db');
  db = new Database(dbPath);
  db.prepare(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
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
  const result = database.prepare('INSERT INTO tasks (text, done) VALUES (?, 0)').run(trimmed);
  const task = { id: Number(result.lastInsertRowid), text: trimmed, done: false };
  return task;
});

ipcMain.handle('get-tasks', async () => {
  const database = ensureDb();
  const rows = database
    .prepare('SELECT id, text, done FROM tasks ORDER BY id ASC')
    .all() as Array<{ id: number; text: string; done: number }>;
  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    done: Boolean(row.done),
  }));
});

ipcMain.handle('update-task-done', async (_event, id: number, done: boolean) => {
  const database = ensureDb();
  database.prepare('UPDATE tasks SET done = ? WHERE id = ?').run(done ? 1 : 0, id);
  return { id, done };
});

app.on('ready', () => {
  initializeDatabase();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (db) {
    db.close();
  }
});
