export type Task = {
  id: number;
  text: string;
  details: string;
  done: boolean;
  position: number;
  listId: number | null;
  priority: 'none' | 'low' | 'medium' | 'high';
};

export type Settings = {
  showCompleted: boolean;
  timeFormat: '12h' | '24h';
};

export type List = {
  id: number;
  name: string;
  position: number;
};

export type ElectronAPI = {
  addTask: (text: string, listId?: number | null) => Promise<Task | { error: string }>;
  getTasks: () => Promise<Task[]>;
  updateTaskDone: (id: number, done: boolean) => Promise<{ id: number; done: boolean }>;
  updateTaskText: (id: number, text: string) => Promise<{ id: number; text: string } | { error: string }>;
  updateTaskOrder: (orderedIds: number[]) => Promise<{ success: boolean }>;
  updateTaskDetails: (id: number, details: string) => Promise<{ id: number; details: string }>;
  updateTaskList: (id: number, listId: number | null) => Promise<{ id: number; listId: number | null }>;
  updateTaskPriority: (id: number, priority: Task['priority']) => Promise<{ id: number; priority: Task['priority'] }>;
  getSettings: () => Promise<Settings>;
  onShowCompletedChanged: (callback: (show: boolean) => void) => () => void;
  addList: (name: string) => Promise<List | { error: string }>;
  getLists: () => Promise<List[]>;
  updateListName: (id: number, name: string) => Promise<{ id: number; name: string } | { error: string }>;
  deleteList: (id: number) => Promise<{ id: number }>;
  updateListOrder: (orderedIds: number[]) => Promise<{ success: boolean }>;
  confirmDeleteList: (name: string) => Promise<boolean>;
  updateTimeFormat: (format: '12h' | '24h') => Promise<{ timeFormat: '12h' | '24h' }>;
  onOpenSettings: (callback: () => void) => () => void;
};

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
