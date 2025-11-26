import { contextBridge, ipcRenderer } from 'electron';

type Task = {
  id: number;
  text: string;
  done: boolean;
};

contextBridge.exposeInMainWorld('electronAPI', {
  addTask: (text: string) => ipcRenderer.invoke('add-task', text) as Promise<Task | { error: string }>,
  getTasks: () => ipcRenderer.invoke('get-tasks') as Promise<Task[]>,
  updateTaskDone: (id: number, done: boolean) =>
    ipcRenderer.invoke('update-task-done', id, done) as Promise<{ id: number; done: boolean }>,
});

declare global {
  interface Window {
    electronAPI: {
      addTask: (text: string) => Promise<Task | { error: string }>;
      getTasks: () => Promise<Task[]>;
      updateTaskDone: (id: number, done: boolean) => Promise<{ id: number; done: boolean }>;
    };
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const versionElement = document.getElementById('app-version');
  if (versionElement) {
    versionElement.textContent = process.versions.electron;
  }
});
