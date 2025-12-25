import type { List, Task } from '../types';

export type UIState = {
  tasks: Task[];
  lists: List[];
  selectedListId: number | null;
  listsExpanded: boolean;
  showCompleted: boolean;
  expandedDetails: Set<number>;
  dragIndex: number | null;
  dropIndex: number | null;
  listDragIndex: number | null;
  listDropIndex: number | null;
  editingTaskId: number | null;
  editingListId: number | null;
  modalSelectedListId: number | null;
  addTaskSelectedListId: number | null;
  openListMenuId: number | null;
  modalPriority: Task['priority'];
  modalReminderDate: string | null;
  modalReminderTime: string | null;
  modalRepeat: string | null;
  modalRepeatRule: string | null;
  modalRepeatStart: string | null;
  timeFormat: '12h' | '24h';
  dateFormat: string;
};

export const state: UIState = {
  tasks: [],
  lists: [],
  selectedListId: null,
  listsExpanded: true,
  showCompleted: true,
  expandedDetails: new Set<number>(),
  dragIndex: null,
  dropIndex: null,
  listDragIndex: null,
  listDropIndex: null,
  editingTaskId: null,
  editingListId: null,
  modalSelectedListId: null,
  addTaskSelectedListId: null,
  openListMenuId: null,
  modalPriority: 'none',
  modalReminderDate: null,
  modalReminderTime: null,
  modalRepeat: null,
  modalRepeatRule: null,
  modalRepeatStart: null,
  timeFormat: '12h',
  dateFormat: 'YYYY-MM-DD',
};
