// What a search currently resolves to, and whether there is one at all. Split out of tasks.ts
// so the view bar can ask for the count without importing the renderer that it, in turn, has
// to repaint -- these are pure selectors over state, with no DOM of their own.
import type { Task } from '../types.js';
import type { EvalContext } from './query.js';
import { state } from './state.js';

export const isSearching = (): boolean => {
  if (!state.searchQuery.trim()) return false;
  if (state.searchMode === 'advanced') return state.queryPredicate !== null;
  return true;
};

/** A query that no longer parses: the rows on screen are the last good query's. */
export const isStale = (): boolean =>
  state.searchMode === 'advanced' && state.queryStatus === 'invalid';

const buildEvalContext = (): EvalContext => {
  const now = new Date();
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
  return {
    listNameById: new Map(state.lists.map((l) => [l.id, l.name.toLowerCase()])),
    tagNameById: new Map(state.tags.map((t) => [t.id, t.name.toLowerCase()])),
    todayISO,
  };
};

/**
 * The task set a search currently resolves to. Shared by the renderer and the view bar so the
 * count in "· N" can never disagree with the rows underneath it.
 */
export const getSearchMatches = (): Task[] => {
  let matches: Task[];
  if (state.searchMode === 'advanced' && state.queryPredicate) {
    const ctx = buildEvalContext();
    const predicate = state.queryPredicate;
    matches = state.tasks.filter((task) => predicate(task, ctx));
  } else {
    const searchQuery = state.searchQuery.trim().toLowerCase();
    matches = state.tasks.filter((task) => {
      const text = task.text.toLowerCase();
      const details = task.details?.toLowerCase() ?? '';
      return text.includes(searchQuery) || details.includes(searchQuery);
    });
  }
  // respect the View > Show completed setting; an advanced query that
  // explicitly filters on `done` states the user's intent and wins
  const doneOverride = state.searchMode === 'advanced' && state.queryUsesDone;
  if (!state.showCompleted && !doneOverride) {
    matches = matches.filter((task) => !task.done);
  }
  return matches;
};
