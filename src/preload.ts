import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI, List, Settings, Task } from './types';

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
  updateTaskPriority: (id: number, priority: Task['priority']) =>
    ipcRenderer.invoke('update-task-priority', id, priority) as Promise<{ id: number; priority: Task['priority'] }>,
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
  deleteList: (id: number) => ipcRenderer.invoke('delete-list', id) as Promise<{ id: number }>,
  updateListOrder: (orderedIds: number[]) =>
    ipcRenderer.invoke('update-list-order', orderedIds) as Promise<{ success: boolean }>,
  confirmDeleteList: (name: string) => ipcRenderer.invoke('confirm-delete-list', name) as Promise<boolean>,
  updateTimeFormat: (format: '12h' | '24h') =>
    ipcRenderer.invoke('update-time-format', format) as Promise<{ timeFormat: '12h' | '24h' }>,
  onOpenSettings: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('open-settings', listener);
    return () => ipcRenderer.removeListener('open-settings', listener);
  },
} satisfies ElectronAPI);

window.addEventListener('DOMContentLoaded', () => {
  const versionElement = document.getElementById('app-version');
  if (versionElement) {
    versionElement.textContent = process.versions.electron;
  }
});
