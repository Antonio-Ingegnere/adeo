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
  tagIds?: number[];
};

/** 'system' follows the OS; the other two override it. Applied via nativeTheme.themeSource. */
export type Theme = 'system' | 'light' | 'dark';

export type Settings = {
  showCompleted: boolean;
  timeFormat: '12h' | '24h';
  dateFormat: string;
  theme: Theme;
};

export type List = {
  id: number;
  name: string;
  position: number;
};

export type Tag = {
  id: number;
  name: string;
  color: string;
  position: number;
};

/** A named advanced-search query. The server never parses `query`; the renderer does. */
export type SmartList = {
  id: number;
  name: string;
  query: string;
  position: number;
};

/** Fields a smart list's derived template can seed on a newly added task. */
export type TaskSeed = {
  priority?: Task['priority'];
  /** only ever true — a smart list's `done:true` records a task that is already finished */
  done?: boolean;
  reminderDate?: string | null;
  reminderTime?: string | null;
  repeatRule?: string | null;
  repeatStart?: string | null;
};

export type ElectronAPI = {
  addTask: (
    text: string,
    listId?: number | null,
    tagIds?: number[],
    seed?: TaskSeed
  ) => Promise<Task | { error: string }>;
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
  addTag: (name: string) => Promise<Tag | { error: string }>;
  getTags: () => Promise<Tag[]>;
  updateTagName: (id: number, name: string) => Promise<{ id: number; name: string } | { error: string }>;
  deleteTag: (id: number) => Promise<{ id: number }>;
  setTaskTags: (id: number, tagIds: number[]) => Promise<{ id: number; tagIds: number[] } | { error: string }>;
  confirmDeleteTag: (name: string) => Promise<boolean>;
  addSmartList: (name: string, query: string) => Promise<SmartList | { error: string }>;
  getSmartLists: () => Promise<SmartList[]>;
  updateSmartListName: (id: number, name: string) => Promise<{ id: number; name: string } | { error: string }>;
  updateSmartListQuery: (id: number, query: string) => Promise<{ id: number; query: string } | { error: string }>;
  deleteSmartList: (id: number) => Promise<{ id: number }>;
  updateSmartListOrder: (orderedIds: number[]) => Promise<{ success: boolean }>;
  confirmDeleteSmartList: (name: string) => Promise<boolean>;
  confirmReplaceSmartList: (name: string) => Promise<boolean>;
  updateTimeFormat: (format: '12h' | '24h') => Promise<{ timeFormat: '12h' | '24h' }>;
  updateDateFormat: (format: string) => Promise<{ dateFormat: string }>;
  updateTheme: (theme: Theme) => Promise<{ theme: Theme }>;
  onOpenSettings: (callback: () => void) => () => void;
  onFocusSearch: (callback: () => void) => () => void;
  onOpenTaskEdit: (callback: (taskId: number) => void) => () => void;
  notifyRendererReady: () => void;
};

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
