// The strip under the search field in Query mode. It answers two questions the input itself
// cannot: which smart list this query belongs to, and what can be done about it. Everything
// that needs the API or a sidebar repaint leaves here as a CustomEvent, handled in index.ts --
// which is what keeps this module out of the smartLists.ts <-> activeSmartList.ts graph and
// lets smartLists.ts call renderQueryBar() without a cycle.
import { associatedSmartList } from './activeSmartList.js';
import { refs } from './dom.js';
import { state } from './state.js';

/** Non-null while the bar is asking for a name. `asNew` only changes the placeholder. */
let naming: { asNew: boolean } | null = null;
let namingValue = '';
let error: string | null = null;

export const exitQueryBarNaming = () => {
  naming = null;
  namingValue = '';
  error = null;
};

/** Reports a failure (name clash declined, server error) where the name was just typed. */
export const showQueryBarError = (message: string | null) => {
  error = message;
  renderQueryBar();
};

const action = (
  label: string,
  title: string,
  onClick: () => void,
  primary = false
): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `query-bar-action${primary ? ' primary' : ''}`;
  button.textContent = label;
  button.title = title;
  button.addEventListener('click', onClick);
  return button;
};

const emit = (name: string, detail?: unknown) => {
  document.dispatchEvent(new CustomEvent(name, { detail }));
};

const startNaming = (asNew: boolean) => {
  naming = { asNew };
  namingValue = '';
  error = null;
  renderQueryBar();
  const input = refs.queryBarIdentity?.querySelector<HTMLInputElement>('.query-bar-name-input');
  input?.focus();
};

const commitName = () => {
  const name = namingValue.trim();
  if (!name) {
    showQueryBarError('Give the smart list a name.');
    return;
  }
  emit('smart-list-create', { name });
};

const renderNaming = () => {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'query-bar-name-input';
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
      exitQueryBarNaming();
      renderQueryBar();
      refs.listsSearchInput?.focus();
    }
  });
  refs.queryBarIdentity?.appendChild(input);

  if (error) {
    const note = document.createElement('span');
    note.className = 'query-bar-error';
    note.textContent = error;
    refs.queryBarIdentity?.appendChild(note);
  }

  refs.queryBarActions?.appendChild(action('Save', 'Save this query as a smart list', commitName, true));
  refs.queryBarActions?.appendChild(
    action('Cancel', 'Cancel', () => {
      exitQueryBarNaming();
      renderQueryBar();
      refs.listsSearchInput?.focus();
    })
  );
};

/**
 * Cheap enough to run on every keystroke, and it has to: the actions depend on the parse
 * status, which is only settled at the end of applySearchQuery. The bookmark this replaced was
 * originally wired to the earlier hook and spent a release one character behind.
 */
export const renderQueryBar = () => {
  const bar = refs.queryBar;
  if (!bar || !refs.queryBarIdentity || !refs.queryBarActions) return;

  if (state.searchMode !== 'advanced') {
    exitQueryBarNaming();
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';
  refs.queryBarIdentity.innerHTML = '';
  refs.queryBarActions.innerHTML = '';

  if (naming) {
    renderNaming();
    return;
  }

  const association = associatedSmartList();
  if (association) {
    const name = document.createElement('span');
    name.className = 'query-bar-name';
    name.textContent = association.smartList.name;
    name.title = association.smartList.query;
    refs.queryBarIdentity.appendChild(name);
    if (association.edited) {
      const edited = document.createElement('span');
      edited.className = 'query-bar-edited';
      edited.textContent = 'edited';
      refs.queryBarIdentity.appendChild(edited);
    }
  }

  // an unparseable query is not a thing to save, and saving is the only verb here. 'pending'
  // is left alone on purpose: it only means mid-token, and buttons that blink away on every
  // second keystroke are worse than a save that reports the error.
  if (!state.searchQuery.trim() || state.queryStatus === 'invalid') return;

  if (association?.edited) {
    refs.queryBarActions.appendChild(
      action(
        'Update',
        `Save this query to "${association.smartList.name}"`,
        () => emit('smart-list-update'),
        true
      )
    );
    refs.queryBarActions.appendChild(
      action('Save as new', 'Save this query as a separate smart list', () => startNaming(true))
    );
    return;
  }

  if (association) {
    refs.queryBarActions.appendChild(
      action('Edit', `Rename or edit "${association.smartList.name}"`, () =>
        emit('open-smart-list-modal', { smartListId: association.smartList.id })
      )
    );
    return;
  }

  refs.queryBarActions.appendChild(
    action('Save as smart list', 'Name this query and keep it', () => startNaming(false))
  );
};
