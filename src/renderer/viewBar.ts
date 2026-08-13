// The line above the add-task input: what you are looking at, how to switch it, and what can be
// done about it. It is the one place lists and smart lists meet -- they are two answers to the
// same question, so they share a picker. (A *task* still belongs to a list or to nothing; the
// edit modal's picker never offers a smart list.)
//
// Everything that needs the API, the sidebar or the search field leaves here as a CustomEvent
// handled in index.ts. That is what keeps this module a leaf the renderers can all call.
import { refs } from './dom.js';
import { currentView } from './currentView.js';
import { getSearchMatches, isSearching, isStale } from './searchMatches.js';
import { state } from './state.js';
import { paintTagChip } from './tagColor.js';

/** Non-null while the bar is asking for a name. `asNew` only changes the placeholder. */
let naming: { asNew: boolean } | null = null;
let namingValue = '';
let error: string | null = null;

export const exitViewBarNaming = () => {
  naming = null;
  namingValue = '';
  error = null;
};

/** Reports a failure (name clash declined, server error) where the name was just typed. */
export const showViewBarError = (message: string | null) => {
  error = message;
  renderViewBar();
};

const emit = (name: string, detail?: unknown) => {
  document.dispatchEvent(new CustomEvent(name, { detail }));
};

const action = (
  label: string,
  title: string,
  onClick: () => void,
  primary = false
): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `view-bar-action${primary ? ' primary' : ''}`;
  button.textContent = label;
  button.title = title;
  button.addEventListener('click', onClick);
  return button;
};

const startNaming = (asNew: boolean) => {
  naming = { asNew };
  namingValue = '';
  error = null;
  renderViewBar();
  refs.viewBarNaming?.querySelector<HTMLInputElement>('.view-bar-name-input')?.focus();
};

const commitName = () => {
  const name = namingValue.trim();
  if (!name) {
    showViewBarError('Give the smart list a name.');
    return;
  }
  emit('smart-list-create', { name });
};

// ---------- The picker menu ----------

const menuItem = (label: string, selected: boolean, onPick: () => void): HTMLButtonElement => {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = `view-menu-item${selected ? ' selected' : ''}`;
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', String(selected));
  item.textContent = label;
  item.title = label;
  item.addEventListener('click', (event) => {
    event.stopPropagation();
    onPick();
  });
  return item;
};

const menuGroup = (label: string): HTMLDivElement => {
  const el = document.createElement('div');
  el.className = 'view-menu-group';
  el.textContent = label;
  return el;
};

const renderViewMenu = () => {
  const menu = refs.viewMenu;
  if (!menu) return;
  menu.innerHTML = '';
  const view = currentView();

  menu.appendChild(
    menuItem('All lists', view.kind === 'list' && view.id === null, () =>
      emit('select-list', { listId: null })
    )
  );

  if (state.lists.length) {
    menu.appendChild(menuGroup('Lists'));
    state.lists.forEach((list) => {
      menu.appendChild(
        menuItem(list.name, view.kind === 'list' && view.id === list.id, () =>
          emit('select-list', { listId: list.id })
        )
      );
    });
  }

  if (state.smartLists.length) {
    menu.appendChild(menuGroup('Smart lists'));
    state.smartLists.forEach((smartList) => {
      menu.appendChild(
        menuItem(smartList.name, view.kind === 'smart' && view.smartList.id === smartList.id, () =>
          emit('run-smart-list', { smartListId: smartList.id })
        )
      );
    });
  }
};

// ---------- The bar ----------

const viewLabel = (view: ReturnType<typeof currentView>): string => {
  if (view.kind === 'smart') return view.smartList.name;
  if (view.kind === 'search') return 'Search results';
  if (view.id === null) return 'All lists';
  return state.lists.find((l) => l.id === view.id)?.name ?? 'All lists';
};

const renderNaming = () => {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'view-bar-name-input';
  input.placeholder = naming?.asNew ? 'New smart list name' : 'Smart list name';
  input.value = namingValue;
  input.setAttribute('aria-label', 'Smart list name');
  input.addEventListener('input', () => {
    namingValue = input.value;
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitName();
    } else if (event.key === 'Escape') {
      // stops the field's own Escape handler from clearing the search as well: cancelling the
      // name must leave the query it was about to name alone
      event.preventDefault();
      event.stopPropagation();
      exitViewBarNaming();
      renderViewBar();
      refs.listsSearchInput?.focus();
    }
  });
  refs.viewBarNaming?.appendChild(input);

  if (error) {
    const note = document.createElement('span');
    note.className = 'view-bar-error';
    note.textContent = error;
    refs.viewBarNaming?.appendChild(note);
  }

  refs.viewBarActions?.appendChild(
    action('Save', 'Save this query as a smart list', commitName, true)
  );
  refs.viewBarActions?.appendChild(
    action('Cancel', 'Cancel', () => {
      exitViewBarNaming();
      renderViewBar();
      refs.listsSearchInput?.focus();
    })
  );
};

/**
 * Cheap enough to run on every keystroke, and it has to: the actions depend on the parse
 * status, which is only settled at the end of applySearchQuery.
 */
export const renderViewBar = () => {
  if (!refs.viewLabel || !refs.viewBarActions || !refs.viewBarNaming) return;
  const view = currentView();
  const searching = isSearching();

  refs.viewLabel.textContent = viewLabel(view);
  refs.viewBarActions.innerHTML = '';
  refs.viewBarNaming.innerHTML = '';
  refs.viewBarNaming.style.display = naming ? 'flex' : 'none';
  renderViewMenu();

  // the count belongs to the search, not to the list: a list's count is already on its pill
  if (refs.viewCount) {
    const show = searching && !isStale();
    refs.viewCount.style.display = show ? 'inline' : 'none';
    refs.viewCount.textContent = show ? `· ${getSearchMatches().length}` : '';
  }
  if (refs.viewEdited) {
    refs.viewEdited.style.display = view.kind === 'smart' && view.edited ? 'inline' : 'none';
  }
  if (refs.searchStaleNote) {
    refs.searchStaleNote.style.display = searching && isStale() ? 'inline' : 'none';
  }
  // a tag narrows whatever view is up; while searching the query owns the filtering instead
  if (refs.tagFilterChip) {
    const tag =
      state.selectedTagId !== null
        ? state.tags.find((t) => t.id === state.selectedTagId)
        : undefined;
    if (!tag || searching) {
      refs.tagFilterChip.style.display = 'none';
    } else {
      refs.tagFilterChip.textContent = `#${tag.name} ✕`;
      paintTagChip(refs.tagFilterChip, tag.color);
      refs.tagFilterChip.style.display = 'inline-block';
    }
  }

  if (naming) {
    renderNaming();
    return;
  }

  // an unparseable query is not a thing to save, and saving is the only verb here. 'pending' is
  // left alone on purpose: it only means mid-token, and buttons that blink away on every second
  // keystroke are worse than a save that reports the error.
  if (view.kind === 'list' || state.queryStatus === 'invalid') return;

  if (view.kind === 'smart' && view.edited) {
    refs.viewBarActions.appendChild(
      action(
        'Update',
        `Save this query to "${view.smartList.name}"`,
        () => emit('smart-list-update'),
        true
      )
    );
    refs.viewBarActions.appendChild(
      action('Save as new', 'Save this query as a separate smart list', () => startNaming(true))
    );
    return;
  }

  if (view.kind === 'smart') {
    refs.viewBarActions.appendChild(
      action('Edit', `Rename or edit "${view.smartList.name}"`, () =>
        emit('open-smart-list-modal', { smartListId: view.smartList.id })
      )
    );
    return;
  }

  refs.viewBarActions.appendChild(
    action('Save as smart list', 'Name this query and keep it', () => startNaming(false))
  );
};
