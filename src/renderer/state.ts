import type { Board, List, SmartList, Tag, Task, Theme } from '../types';
import type { CompiledPredicate, ParseError } from './query.js';

/**
 * One column of the multi-column board, in the renderer's working copy. `clientId` is a
 * throwaway local handle so a column can be addressed before it is persisted and while it is
 * being reordered; identity for persistence is (sourceKind, sourceId, position).
 */
export type BoardWorkingColumn = {
  clientId: string;
  sourceKind: 'list' | 'smart';
  /** list id, or smart-list id; a `list` column with sourceId 0 means "No list" */
  sourceId: number;
};

/** Attribute snapshot a board move can touch, held client-side for the Undo-toast window. */
export type BoardMoveSnapshot = {
  taskId: number;
  listId: number | null;
  priority: Task['priority'];
  tagIds: number[];
  reminderDate: string | null;
  reminderTime: string | null;
  repeatRule: string | null;
  repeatStart: string | null;
  done: boolean;
};

/** Inline preview / confirm state for a best-effort, blocked or no-op move. */
export type BoardPreviewState = {
  destColumnId: string;
  fromColumnId: string;
  taskId: number;
};

export type BoardToastState = {
  message: string;
  /** the snapshot is what Undo restores; absent when there is nothing to undo (errors) */
  undo: boolean;
};

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
  /** Tag colours on chips and dots; see tagColor.ts. */
  tagColors: boolean;
  /**
   * The user's rebound shortcuts, by id — overrides only, never a full keymap (see Settings
   * in types.ts). Held here so the Settings modal can seed its rows without another IPC round
   * trip; the dispatcher keeps its own resolved copy.
   */
  shortcutOverrides: Record<string, string[]>;
  /**
   * The task the keyboard cursor is on. An id rather than an index because the row's
   * dataset.index is the drag-and-drop coordinate and every reorder or refetch invalidates
   * it, and because renderTasks() rebuilds the list from scratch — the cursor has to be
   * something that survives having its DOM thrown away.
   */
  focusedTaskId: number | null;
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
  /**
   * The compose row's own draft metadata (Quick Add "Options"), distinct from the edit dialog's
   * modal* fields above: these describe the *next* task to be created from #message-input, not a
   * task being edited. Cleared on a successful add (resetComposeOptions), preserved on a blank
   * submit or a save failure so the draft is not lost.
   */
  composePriority: Task['priority'];
  composeReminderDate: string | null;
  /**
   * Tri-state, unlike modalSelectedListId: undefined means "not overridden" -- inherit whatever
   * the view/template would already send the task to. null means the user explicitly picked
   * "No list" in Options. A number means the user explicitly picked that list. Collapsing
   * undefined into null would make an explicit "No list" indistinguishable from never having
   * opened Options at all.
   */
  composeListId: number | null | undefined;
  /**
   * Set true when Escape collapses the activity-revealed metadata row, so the activity
   * predicate does not immediately re-show it against a still-non-empty draft. Cleared when
   * focus leaves the compose block and re-enters. Transient; never persisted.
   */
  composeMetaDismissed: boolean;

  /** Saved boards (Alternative B). CRUD mirrors the smart-list stack. */
  boards: Board[];
  boardsExpanded: boolean;
  openBoardMenuId: number | null;
  /** true while the main column shows the board instead of the single view */
  boardMode: boolean;
  /** which saved board is open, or null for an unsaved working board */
  activeBoardId: number | null;
  /** the renderer's working copy of the open board's ordered columns */
  boardColumns: BoardWorkingColumn[];
  /** working columns / name differ from the saved board */
  boardUnsaved: boolean;
  /** open column options (⋯) menu, by column clientId */
  boardOpenColumnMenuId: string | null;
  /** open header source picker, by column clientId ('__add__' for the end-of-row control) */
  boardOpenSourcePickerId: string | null;
  /** open per-card "Move to…" menu */
  boardOpenMoveMenu: { taskId: number; columnId: string } | null;
  /** inline preview / confirm surface for a best-effort / blocked / no-op move */
  boardPreview: BoardPreviewState | null;
  /** non-live Undo toast; auto-clears */
  boardToast: BoardToastState | null;
  /** pre-move attribute snapshot; lifetime = the toast window, does not survive reload */
  boardSnapshot: BoardMoveSnapshot | null;
  /** column whose body / header last held focus, for seeding the single view on leave */
  boardFocusColumnId: string | null;
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
  tagColors: true,
  shortcutOverrides: {},
  focusedTaskId: null,
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
  composePriority: 'none',
  composeReminderDate: null,
  composeListId: undefined,
  composeMetaDismissed: false,
  boards: [],
  boardsExpanded: true,
  openBoardMenuId: null,
  boardMode: false,
  activeBoardId: null,
  boardColumns: [],
  boardUnsaved: false,
  boardOpenColumnMenuId: null,
  boardOpenSourcePickerId: null,
  boardOpenMoveMenu: null,
  boardPreview: null,
  boardToast: null,
  boardSnapshot: null,
  boardFocusColumnId: null,
};
