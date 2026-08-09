import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI, List, Settings, SmartList, Tag, Task, TaskSeed, Theme } from './types';

contextBridge.exposeInMainWorld('electronAPI', {
  addTask: (text: string, listId?: number | null, tagIds?: number[], seed?: TaskSeed) =>
    ipcRenderer.invoke('add-task', text, listId, tagIds, seed) as Promise<Task | { error: string }>,
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
  updateTaskReminder: (id: number, reminderDate: string | null, reminderTime: string | null) =>
    ipcRenderer.invoke('update-task-reminder', id, reminderDate, reminderTime) as Promise<{
      id: number;
      reminderDate: string | null;
      reminderTime: string | null;
    }>,
  updateTaskRepeat: (id: number, repeatRule: string | null, repeatStart: string | null) =>
    ipcRenderer.invoke('update-task-repeat', id, repeatRule, repeatStart) as Promise<{
      id: number;
      repeatRule: string | null;
      repeatStart: string | null;
    }>,
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
  addTag: (name: string) => ipcRenderer.invoke('add-tag', name) as Promise<Tag | { error: string }>,
  getTags: () => ipcRenderer.invoke('get-tags') as Promise<Tag[]>,
  updateTagName: (id: number, name: string) =>
    ipcRenderer.invoke('update-tag-name', id, name) as Promise<{ id: number; name: string } | { error: string }>,
  deleteTag: (id: number) => ipcRenderer.invoke('delete-tag', id) as Promise<{ id: number }>,
  setTaskTags: (id: number, tagIds: number[]) =>
    ipcRenderer.invoke('set-task-tags', id, tagIds) as Promise<{ id: number; tagIds: number[] } | { error: string }>,
  confirmDeleteTag: (name: string) => ipcRenderer.invoke('confirm-delete-tag', name) as Promise<boolean>,
  addSmartList: (name: string, query: string) =>
    ipcRenderer.invoke('add-smart-list', name, query) as Promise<SmartList | { error: string }>,
  getSmartLists: () => ipcRenderer.invoke('get-smart-lists') as Promise<SmartList[]>,
  updateSmartListName: (id: number, name: string) =>
    ipcRenderer.invoke('update-smart-list-name', id, name) as Promise<{ id: number; name: string } | { error: string }>,
  updateSmartListQuery: (id: number, query: string) =>
    ipcRenderer.invoke('update-smart-list-query', id, query) as Promise<{ id: number; query: string } | { error: string }>,
  deleteSmartList: (id: number) => ipcRenderer.invoke('delete-smart-list', id) as Promise<{ id: number }>,
  updateSmartListOrder: (orderedIds: number[]) =>
    ipcRenderer.invoke('update-smart-list-order', orderedIds) as Promise<{ success: boolean }>,
  confirmDeleteSmartList: (name: string) =>
    ipcRenderer.invoke('confirm-delete-smart-list', name) as Promise<boolean>,
  confirmReplaceSmartList: (name: string) =>
    ipcRenderer.invoke('confirm-replace-smart-list', name) as Promise<boolean>,
  updateTimeFormat: (format: '12h' | '24h') =>
    ipcRenderer.invoke('update-time-format', format) as Promise<{ timeFormat: '12h' | '24h' }>,
  updateDateFormat: (format: string) =>
    ipcRenderer.invoke('update-date-format', format) as Promise<{ dateFormat: string }>,
  updateTheme: (theme: Theme) => ipcRenderer.invoke('update-theme', theme) as Promise<{ theme: Theme }>,
  onOpenSettings: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('open-settings', listener);
    return () => ipcRenderer.removeListener('open-settings', listener);
  },
  onFocusSearch: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('focus-search', listener);
    return () => ipcRenderer.removeListener('focus-search', listener);
  },
  onOpenTaskEdit: (callback: (taskId: number) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, taskId: number) => callback(taskId);
    ipcRenderer.on('open-task-edit', listener);
    return () => ipcRenderer.removeListener('open-task-edit', listener);
  },
  notifyRendererReady: () => ipcRenderer.send('renderer-ready'),
} satisfies ElectronAPI);

window.addEventListener('DOMContentLoaded', () => {
  const versionElement = document.getElementById('app-version');
  if (versionElement) {
    versionElement.textContent = process.versions.electron;
  }
});
