import type { List, Tag, Task } from '../types';
import type { CompiledPredicate, ParseError } from './query.js';

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
  searchMode: 'simple' | 'advanced';
  queryPredicate: CompiledPredicate | null;
  queryError: ParseError | null;
  // 'pending' means the parse failed only because the user is mid-token: the tail is
  // incomplete and the caret is still on it. Results are left untouched and no error is
  // shown. 'invalid' is a real error: the last-good predicate stays on screen but dimmed.
  queryStatus: 'empty' | 'pending' | 'valid' | 'invalid';
  queryUsesDone: boolean;
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
  searchMode: 'simple',
  queryPredicate: null,
  queryError: null,
  queryStatus: 'empty',
  queryUsesDone: false,
  timeFormat: '12h',
  dateFormat: 'YYYY-MM-DD',
};
