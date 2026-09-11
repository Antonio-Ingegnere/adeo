// Saved-boards sidebar panel. Modelled on smartLists.ts: a list of pills, each opening the
// board in the multi-column view; a ⋯ menu to rename or delete (delete never touches a List,
// Smart list or task); a "+" to start a new board. Ordering persists like the smart-list stack.
import type { Board } from '../types.js';
import { refs } from './dom.js';
import { makePillActivatable, revealInScroller } from './helpers.js';
import { attachPillDnD, makeDragHandle, moveItem } from './pillDnD.js';
import { isBoardInView } from './currentView.js';
import { enterBoardView } from './board.js';
import { renderViewBar } from './viewBar.js';
import { state } from './state.js';
import { confirmApp } from './confirmDialog.js';
import { applyStaticTranslations, onLocaleChange, t } from './i18n/index.js';

const saveBoardOrder = async () => {
  try {
    await window.electronAPI.updateBoardOrder(state.boards.map((b) => b.id));
  } catch (error) {
    console.error('Failed to save board order', error);
  }
};

export const toggleBoardsExpanded = () => {
  state.boardsExpanded = !state.boardsExpanded;
  const icon = refs.boardsToggle?.querySelector('svg path:first-of-type');
  const icon2 = refs.boardsToggle?.querySelector('svg path:last-of-type');
  if (state.boardsExpanded) {
    icon?.setAttribute('d', 'M2 3 L7 8 L12 3');
    icon2?.setAttribute('d', 'M2 8 L7 13 L12 8');
  } else {
    icon?.setAttribute('d', 'M2 8 L7 3 L12 8');
    icon2?.setAttribute('d', 'M2 13 L7 8 L12 13');
  }
  renderBoards();
};

const renameBoard = async (board: Board) => {
  const next = window.prompt('Rename board', board.name);
  if (next === null) return;
  const trimmed = next.trim();
  if (!trimmed || trimmed === board.name) return;
  try {
    const result = await window.electronAPI.updateBoardName(board.id, trimmed);
    if (result && !('error' in result)) {
      board.name = trimmed;
      renderBoards();
      renderViewBar();
    }
  } catch (error) {
    console.error('Failed to rename board', error);
  }
};

export const renderBoards = () => {
  if (!refs.boardsList) return;
  const container = refs.boardsList;
  container.innerHTML = '';
  if (!state.boardsExpanded) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';

  if (state.boards.length === 0) {
    if (refs.boardsEmpty) {
      container.appendChild(refs.boardsEmpty);
      // See smartLists.ts: this cached empty-state node is detached whenever there are
      // boards, so a locale switch during that time never reaches it via document-rooted
      // applyStaticTranslations. Re-apply now that it is back in the tree.
      applyStaticTranslations(container);
    }
    return;
  }

  state.boards.forEach((board, index) => {
    const item = document.createElement('div');
    const selected = isBoardInView(board.id);
    item.className = `list-pill board-pill${selected ? ' selected' : ''}`;
    makePillActivatable(item, selected);
    attachPillDnD({
      kind: 'smart-list',
      item,
      index,
      reorder: (from, to) => {
        moveItem(state.boards, from, to);
        renderBoards();
        renderViewBar();
        saveBoardOrder();
      },
    });
    item.appendChild(makeDragHandle());

    const label = document.createElement('span');
    label.className = 'list-pill-label';
    label.textContent = board.name;
    label.title = `${board.columns.length} column${board.columns.length === 1 ? '' : 's'}`;
    item.appendChild(label);

    const menuBtn = document.createElement('button');
    menuBtn.className = 'list-menu-btn';
    menuBtn.title = 'More';
    menuBtn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" class="icon-more">
        <path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
      </svg>
    `;
    menuBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      state.openBoardMenuId = state.openBoardMenuId === board.id ? null : board.id;
      renderBoards();
    });

    const menu = document.createElement('div');
    menu.className = 'list-menu';
    const menuOpen = state.openBoardMenuId === board.id;
    menu.style.display = menuOpen ? 'flex' : 'none';
    menu.classList.toggle('open', menuOpen);
    if (menuOpen) revealInScroller(menu);
    menu.addEventListener('click', (event) => event.stopPropagation());

    const editItem = document.createElement('button');
    editItem.className = 'list-menu-item';
    editItem.textContent = t('menu.renameBoard');
    editItem.addEventListener('click', (event) => {
      event.stopPropagation();
      state.openBoardMenuId = null;
      renderBoards();
      void renameBoard(board);
    });
    menu.appendChild(editItem);

    const deleteItem = document.createElement('button');
    deleteItem.className = 'list-menu-item list-menu-danger';
    deleteItem.textContent = t('menu.deleteBoard');
    deleteItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      const ok = await confirmApp({
        heading: `${t('confirm.deleteBoard.heading')} "${board.name}"?`,
        message: t('confirm.deleteBoard.message'),
        confirmLabel: t('confirm.delete'),
        cancelLabel: t('confirm.cancel'),
        tone: 'danger',
      });
      if (!ok) {
        state.openBoardMenuId = null;
        renderBoards();
        return;
      }
      try {
        await window.electronAPI.deleteBoard(board.id);
        state.boards = state.boards.filter((b) => b.id !== board.id);
        state.openBoardMenuId = null;
        if (state.activeBoardId === board.id) {
          state.activeBoardId = null;
          state.boardMode = false;
          state.boardColumns = [];
          document.dispatchEvent(
            new CustomEvent('select-list', { detail: { listId: state.selectedListId } }),
          );
        }
        renderBoards();
        renderViewBar();
      } catch (error) {
        console.error('Failed to delete board', error);
      }
    });
    menu.appendChild(deleteItem);

    item.appendChild(menuBtn);
    item.appendChild(menu);
    item.addEventListener('click', () => {
      void enterBoardView(board.id);
    });
    container.appendChild(item);
  });
};

export const loadBoardsPanel = async () => {
  try {
    const boards = await window.electronAPI.getBoards();
    state.boards = boards ?? [];
    renderBoards();
    renderViewBar();
  } catch (error) {
    console.error('Failed to load boards', error);
  }
};

onLocaleChange(() => renderBoards());
