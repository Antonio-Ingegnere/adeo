// What the user is looking at, as one value. A list, a smart list and a bare search are three
// answers to the same question, and before this they were three unrelated pieces of state that
// could each claim to be the answer at once -- the sidebar lit a list pill *and* a smart-list
// pill while the heading named a third thing.
//
// Nothing new is stored. state.selectedListId survives underneath a running search, which is
// exactly what lets clearing the search drop the user back into the list they were in.
import type { SmartList } from '../types.js';
import { associatedSmartList } from './activeSmartList.js';
import { isSearching } from './searchMatches.js';
import { state } from './state.js';

export type View =
  | { kind: 'list'; id: number | null }
  | { kind: 'smart'; smartList: SmartList; edited: boolean }
  | { kind: 'search' };

export const currentView = (): View => {
  if (isSearching() || state.searchQuery.trim()) {
    const association = associatedSmartList();
    if (association) {
      return { kind: 'smart', smartList: association.smartList, edited: association.edited };
    }
    return { kind: 'search' };
  }
  return { kind: 'list', id: state.selectedListId };
};

/** True when this list is the view, so the sidebar and the picker cannot disagree about it. */
export const isListInView = (id: number | null): boolean => {
  const view = currentView();
  return view.kind === 'list' && view.id === id;
};

export const isSmartListInView = (id: number): boolean => {
  const view = currentView();
  return view.kind === 'smart' && view.smartList.id === id;
};

/**
 * Where a new task goes. A running smart list's own `list:` term still wins over this (see
 * resolveTemplateNames in addTask) -- it is the more specific statement of intent.
 */
export const addTargetListId = (): number | null => state.selectedListId;
