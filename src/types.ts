export type Task = {
  id: number;
  text: string;
  details: string;
  done: boolean;
  position: number;
  listId: number | null;
  priority: 'none' | 'low' | 'medium' | 'high';
  reminderDate?: string | null;
  reminderTime?: string | null;
  repeatRule?: string | null;
  repeatStart?: string | null;
  seriesId?: number | null;
};

export type Settings = {
  showCompleted: boolean;
  timeFormat: '12h' | '24h';
  dateFormat: string;
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
  updateTaskReminder: (
    id: number,
    reminderDate: string | null,
    reminderTime: string | null
  ) => Promise<{ id: number; reminderDate: string | null; reminderTime: string | null }>;
  updateTaskRepeat: (
    id: number,
    repeatRule: string | null,
    repeatStart: string | null
  ) => Promise<{ id: number; repeatRule: string | null; repeatStart: string | null }>;
  getSettings: () => Promise<Settings>;
  onShowCompletedChanged: (callback: (show: boolean) => void) => () => void;
  addList: (name: string) => Promise<List | { error: string }>;
  getLists: () => Promise<List[]>;
  updateListName: (id: number, name: string) => Promise<{ id: number; name: string } | { error: string }>;
  deleteList: (id: number) => Promise<{ id: number }>;
  updateListOrder: (orderedIds: number[]) => Promise<{ success: boolean }>;
  confirmDeleteList: (name: string) => Promise<boolean>;
  updateTimeFormat: (format: '12h' | '24h') => Promise<{ timeFormat: '12h' | '24h' }>;
  updateDateFormat: (format: string) => Promise<{ dateFormat: string }>;
  onOpenSettings: (callback: () => void) => () => void;
};

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
