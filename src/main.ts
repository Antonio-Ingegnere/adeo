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
  db.prepare('DROP TABLE IF EXISTS tasks').run();
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
