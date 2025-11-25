import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'path';

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

app.on('ready', () => {
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
