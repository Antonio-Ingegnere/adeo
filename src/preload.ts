import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  showMessage: (text: string) => ipcRenderer.invoke('show-message', text),
});

declare global {
  interface Window {
    electronAPI: {
      showMessage: (text: string) => Promise<void>;
    };
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const versionElement = document.getElementById('app-version');
  if (versionElement) {
    versionElement.textContent = process.versions.electron;
  }
});
