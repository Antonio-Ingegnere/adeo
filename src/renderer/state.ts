import type { List, SmartList, Tag, Task, Theme } from '../types';
import type { CompiledPredicate, ParseError } from './query.js';

export type UIState = {
  tasks: Task[];
  lists: List[];
  tags: Tag[];
  smartLists: SmartList[];
  /**
   * One selection, two jobs: which list the rows below are filtered to, and which list a new
   * task goes into. The title picker and the sidebar pills both write it through selectList().
   * null is "All lists" for the view and "no list" for a new task -- the same thing said twice.
   */
  selectedListId: number | null;
  selectedTagId: number | null;
  listsExpanded: boolean;
  tagsExpanded: boolean;
  smartListsExpanded: boolean;
  showCompleted: boolean;
  expandedDetails: Set<number>;
  dragIndex: number | null;
  dropIndex: number | null;
  editingTaskId: number | null;
  editingListId: number | null;
  editingTagId: number | null;
  /** null while the smart-list modal is creating rather than editing */
  editingSmartListId: number | null;
  /**
   * The smart list the search bar is working on, which survives editing its query -- that is
   * the whole point of storing it. Which one is *running* is still derived (an exact query
   * match, see activeSmartList); this only adds the "edited from X" state that no comparison
   * can express, since an edited query matches nothing.
   */
  smartListOrigin: number | null;
  openSmartListMenuId: number | null;
  modalSelectedListId: number | null;
  modalTagIds: number[];
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
  theme: Theme;
};

export const state: UIState = {
  tasks: [],
  lists: [],
  tags: [],
  smartLists: [],
  selectedListId: null,
  selectedTagId: null,
  listsExpanded: true,
  tagsExpanded: true,
  smartListsExpanded: true,
  showCompleted: true,
  expandedDetails: new Set<number>(),
  dragIndex: null,
  dropIndex: null,
  editingTaskId: null,
  editingListId: null,
  editingTagId: null,
  editingSmartListId: null,
  smartListOrigin: null,
  openSmartListMenuId: null,
  modalSelectedListId: null,
  modalTagIds: [],
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
  theme: 'system',
};
