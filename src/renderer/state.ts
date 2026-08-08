import type { List, Tag, Task } from '../types';

export type UIState = {
  tasks: Task[];
  lists: List[];
  tags: Tag[];
  selectedListId: number | null;
  selectedTagId: number | null;
  listsExpanded: boolean;
  tagsExpanded: boolean;
  showCompleted: boolean;
  expandedDetails: Set<number>;
  dragIndex: number | null;
  dropIndex: number | null;
  listDragIndex: number | null;
  listDropIndex: number | null;
  editingTaskId: number | null;
  editingListId: number | null;
  editingTagId: number | null;
  modalSelectedListId: number | null;
  modalTagIds: number[];
  addTaskSelectedListId: number | null;
  openListMenuId: number | null;
  openTagMenuId: number | null;
  pendingTagIds: number[];
  modalPriority: Task['priority'];
  modalReminderDate: string | null;
  modalReminderTime: string | null;
  modalRepeat: string | null;
  modalRepeatRule: string | null;
  modalRepeatStart: string | null;
  searchQuery: string;
  timeFormat: '12h' | '24h';
  dateFormat: string;
};

export const state: UIState = {
  tasks: [],
  lists: [],
  tags: [],
  selectedListId: null,
  selectedTagId: null,
  listsExpanded: true,
  tagsExpanded: true,
  showCompleted: true,
  expandedDetails: new Set<number>(),
  dragIndex: null,
  dropIndex: null,
  listDragIndex: null,
  listDropIndex: null,
  editingTaskId: null,
  editingListId: null,
  editingTagId: null,
  modalSelectedListId: null,
  modalTagIds: [],
  addTaskSelectedListId: null,
  openListMenuId: null,
  openTagMenuId: null,
  pendingTagIds: [],
  modalPriority: 'none',
  modalReminderDate: null,
  modalReminderTime: null,
  modalRepeat: null,
  modalRepeatRule: null,
  modalRepeatStart: null,
  searchQuery: '',
  timeFormat: '12h',
  dateFormat: 'YYYY-MM-DD',
};
