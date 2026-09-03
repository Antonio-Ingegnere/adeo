// Persisting the left sidebar's last UI state (which sections are open, which item is
// selected, any tag filter) so a relaunch reopens where the user left off. The store is
// settings.json in the main process -- the same mechanism theme / showCompleted / shortcuts
// already use; this only adds a `sidebarUi` key and one IPC channel.
//
// Capture is derived from `state` + currentView() so it can never disagree with what is on
// screen. Restore validates every id against the freshly loaded lists / smart lists / boards
// and dispatches the app's own selection events; anything that no longer resolves is left as
// the default "All lists" view.

import type { SidebarUiState } from '../types.js';
import { currentView } from './currentView.js';
import { state } from './state.js';

/** Suppresses write-back while restore is dispatching selection events during launch. */
let restoring = false;
let pendingWrite: ReturnType<typeof setTimeout> | null = null;
let stashed: SidebarUiState | null = null;

const captureSidebarUi = (): SidebarUiState => {
  const view = currentView();
  let selection: SidebarUiState['selection'];
  if (view.kind === 'board' && view.board && view.board.id != null) {
    // Only a *saved* board is restorable; an unsaved working board (view.board === null)
    // falls through to the underlying list so a phantom board is never recreated on launch.
    selection = { kind: 'board', id: view.board.id };
  } else if (view.kind === 'smart') {
    selection = { kind: 'smart', id: view.smartList.id };
  } else {
    // 'list', 'search', or an unsaved board: the meaningful sidebar item is the selected list.
    selection = { kind: 'list', id: state.selectedListId };
  }

  return {
    sections: {
      lists: state.listsExpanded,
      tags: state.tagsExpanded,
      smartLists: state.smartListsExpanded,
      boards: state.boardsExpanded,
    },
    selection,
    tagFilterId: state.selectedTagId,
  };
};

/**
 * Called from every sidebar toggle / selection path. Debounced because one user action
 * (selectList) fans out into several renders; coalescing keeps it to a single disk write.
 */
export const persistSidebarUi = (): void => {
  if (restoring) return;
  if (pendingWrite) clearTimeout(pendingWrite);
  pendingWrite = setTimeout(() => {
    pendingWrite = null;
    const snapshot = captureSidebarUi();
    try {
      void window.electronAPI.updateSidebarUiState(snapshot);
    } catch (error) {
      console.error('Failed to persist sidebar UI state', error);
    }
  }, 150);
};

/** Applies the restored expand/collapse state onto `state` before the first sidebar render. */
export const applySidebarSections = (sidebarUi: SidebarUiState): void => {
  state.listsExpanded = sidebarUi.sections.lists;
  state.tagsExpanded = sidebarUi.sections.tags;
  state.smartListsExpanded = sidebarUi.sections.smartLists;
  state.boardsExpanded = sidebarUi.sections.boards;
};

/** Holds the loaded snapshot between loadSettings() and the post-load selection restore. */
export const stashSidebarUi = (sidebarUi: SidebarUiState): void => {
  stashed = sidebarUi;
};

/**
 * Re-selects the saved sidebar item once lists / smart lists / boards are loaded, reusing the
 * app's existing selection events so the main view follows. A saved id that no longer exists
 * leaves the default "All lists" view in place -- no throw, no empty screen.
 */
export const restoreSidebarSelection = (): void => {
  const sidebarUi = stashed;
  stashed = null;
  if (!sidebarUi) return;

  restoring = true;
  try {
    const sel = sidebarUi.selection;
    if (sel.kind === 'smart' && state.smartLists.some((s) => s.id === sel.id)) {
      document.dispatchEvent(new CustomEvent('run-smart-list', { detail: { smartListId: sel.id } }));
    } else if (sel.kind === 'board' && state.boards.some((b) => b.id === sel.id)) {
      document.dispatchEvent(new CustomEvent('enter-board-view', { detail: { boardId: sel.id } }));
    } else if (sel.kind === 'list' && sel.id !== null && state.lists.some((l) => l.id === sel.id)) {
      document.dispatchEvent(new CustomEvent('select-list', { detail: { listId: sel.id } }));
    }
    // else: 'All lists' / unresolved selection -> leave init()'s default view untouched.

    if (
      sidebarUi.tagFilterId !== null &&
      state.tags.some((t) => t.id === sidebarUi.tagFilterId)
    ) {
      document.dispatchEvent(
        new CustomEvent('filter-by-tag', { detail: { tagId: sidebarUi.tagFilterId } }),
      );
    }
  } finally {
    restoring = false;
  }
};
