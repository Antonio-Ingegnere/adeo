import { contextBridge, ipcRenderer } from 'electron';

type Task = {
  id: number;
  text: string;
  details: string;
  done: boolean;
  position: number;
  listId: number | null;
};

type Settings = {
  showCompleted: boolean;
};

type List = {
  id: number;
  name: string;
};

contextBridge.exposeInMainWorld('electronAPI', {
  addTask: (text: string, listId?: number | null) =>
    ipcRenderer.invoke('add-task', text, listId) as Promise<Task | { error: string }>,
  getTasks: () => ipcRenderer.invoke('get-tasks') as Promise<Task[]>,
  updateTaskDone: (id: number, done: boolean) =>
    ipcRenderer.invoke('update-task-done', id, done) as Promise<{ id: number; done: boolean }>,
  updateTaskText: (id: number, text: string) =>
    ipcRenderer.invoke('update-task-text', id, text) as Promise<{ id: number; text: string } | { error: string }>,
  updateTaskOrder: (orderedIds: number[]) =>
    ipcRenderer.invoke('update-task-order', orderedIds) as Promise<{ success: boolean }>,
  updateTaskDetails: (id: number, details: string) =>
    ipcRenderer.invoke('update-task-details', id, details) as Promise<{ id: number; details: string }>,
  updateTaskList: (id: number, listId: number | null) =>
    ipcRenderer.invoke('update-task-list', id, listId) as Promise<{ id: number; listId: number | null }>,
  getSettings: () => ipcRenderer.invoke('get-settings') as Promise<Settings>,
  onShowCompletedChanged: (callback: (show: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: boolean) => callback(value);
    ipcRenderer.on('show-completed-changed', listener);
    return () => ipcRenderer.removeListener('show-completed-changed', listener);
  },
  addList: (name: string) => ipcRenderer.invoke('add-list', name) as Promise<List | { error: string }>,
  getLists: () => ipcRenderer.invoke('get-lists') as Promise<List[]>,
  updateListName: (id: number, name: string) =>
    ipcRenderer.invoke('update-list-name', id, name) as Promise<{ id: number; name: string } | { error: string }>,
});

declare global {
  interface Window {
    electronAPI: {
      addTask: (text: string, listId?: number | null) => Promise<Task | { error: string }>;
      getTasks: () => Promise<Task[]>;
      updateTaskDone: (id: number, done: boolean) => Promise<{ id: number; done: boolean }>;
      updateTaskText: (id: number, text: string) => Promise<{ id: number; text: string } | { error: string }>;
      updateTaskOrder: (orderedIds: number[]) => Promise<{ success: boolean }>;
      updateTaskDetails: (id: number, details: string) => Promise<{ id: number; details: string }>;
      updateTaskList: (id: number, listId: number | null) => Promise<{ id: number; listId: number | null }>;
      getSettings: () => Promise<Settings>;
      onShowCompletedChanged: (callback: (show: boolean) => void) => () => void;
      addList: (name: string) => Promise<List | { error: string }>;
      getLists: () => Promise<List[]>;
      updateListName: (id: number, name: string) => Promise<{ id: number; name: string } | { error: string }>;
    };
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const versionElement = document.getElementById('app-version');
  if (versionElement) {
    versionElement.textContent = process.versions.electron;
  }
});
