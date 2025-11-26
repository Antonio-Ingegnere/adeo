import { contextBridge, ipcRenderer } from 'electron';

type Task = {
  id: number;
  text: string;
  details: string;
  done: boolean;
  position: number;
};

type Settings = {
  showCompleted: boolean;
};

contextBridge.exposeInMainWorld('electronAPI', {
  addTask: (text: string) => ipcRenderer.invoke('add-task', text) as Promise<Task | { error: string }>,
  getTasks: () => ipcRenderer.invoke('get-tasks') as Promise<Task[]>,
  updateTaskDone: (id: number, done: boolean) =>
    ipcRenderer.invoke('update-task-done', id, done) as Promise<{ id: number; done: boolean }>,
  updateTaskText: (id: number, text: string) =>
    ipcRenderer.invoke('update-task-text', id, text) as Promise<{ id: number; text: string } | { error: string }>,
  updateTaskOrder: (orderedIds: number[]) =>
    ipcRenderer.invoke('update-task-order', orderedIds) as Promise<{ success: boolean }>,
  updateTaskDetails: (id: number, details: string) =>
    ipcRenderer.invoke('update-task-details', id, details) as Promise<{ id: number; details: string }>,
  getSettings: () => ipcRenderer.invoke('get-settings') as Promise<Settings>,
  onShowCompletedChanged: (callback: (show: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: boolean) => callback(value);
    ipcRenderer.on('show-completed-changed', listener);
    return () => ipcRenderer.removeListener('show-completed-changed', listener);
  },
});

declare global {
  interface Window {
    electronAPI: {
      addTask: (text: string) => Promise<Task | { error: string }>;
      getTasks: () => Promise<Task[]>;
      updateTaskDone: (id: number, done: boolean) => Promise<{ id: number; done: boolean }>;
      updateTaskText: (id: number, text: string) => Promise<{ id: number; text: string } | { error: string }>;
      updateTaskOrder: (orderedIds: number[]) => Promise<{ success: boolean }>;
      updateTaskDetails: (id: number, details: string) => Promise<{ id: number; details: string }>;
      getSettings: () => Promise<Settings>;
      onShowCompletedChanged: (callback: (show: boolean) => void) => () => void;
    };
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const versionElement = document.getElementById('app-version');
  if (versionElement) {
    versionElement.textContent = process.versions.electron;
  }
});
