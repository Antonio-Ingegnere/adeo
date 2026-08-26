/**
 * The P2.1-reopened app-shell fixture: the real Adeo sidebar (Lists/Smart lists/Tags) plus the
 * existing production task view, so concept comparisons read as "inside Adeo" rather than an
 * isolated compose row + task list. Every element below reuses production classes/markup taken
 * directly from `index.html`, `src/renderer/lists.ts`, `smartLists.ts`, `tags.ts` and
 * `viewBar.ts`. The view-picker dropdown and list switching are genuinely wired against local
 * fixture state (view-bar/list rendering itself reads global renderer `state` in production, so
 * it cannot be imported directly -- see `ui-ux/ux/component-inventory.md`). Sidebar drag-reorder
 * uses the real, dependency-free `attachPillDnD` from `src/renderer/pillDnD.ts`.
 *
 * P2.2 reopened (shell adoption): the compose row now accepts an injectable composer (`options.
 * composer`) so the Quick Add pilot's three alternatives can mount inside this same shell instead
 * of an isolated mock. `setViewTasks`/`setComposer` let a caller update the task list and swap the
 * composer element in place without tearing down the sidebar/view-picker. Task-row drag-and-drop
 * stays deliberately NOT wired (deeply coupled to global app state in production; see the P2.1
 * review's reopened findings for why that stays structural-only here).
 */
import { createSidebarPill, createTagDot } from '../../../src/renderer/uiElements';
import { attachPillDnD, makeDragHandle, moveItem } from '../../../src/renderer/pillDnD';
import { makePillActivatable } from '../../../src/renderer/helpers';
import { createProductionTaskPreview } from './production-task-preview';
import type {
  ConceptListFixture,
  ConceptShellFixture,
  ConceptSmartListFixture,
  ConceptTagPanelFixture,
  ConceptTaskFixture,
  ConceptViewKey,
} from './fixtures';

export type AppShellPreviewOptions = Readonly<{
  /** Replaces the default plain input-row composer, e.g. with a Quick Add alternative. */
  composer?: HTMLElement;
}>;

export type AppShellPreviewHandle = Readonly<{
  element: HTMLDivElement;
  /** Switch the active view programmatically (same effect as picking it from the view menu). */
  selectView: (key: ConceptViewKey) => void;
  /** Replace the task set for one view. Re-renders immediately if that view is active. */
  setViewTasks: (key: ConceptViewKey, tasks: readonly ConceptTaskFixture[]) => void;
  /** Swap the composer mounted in the compose row without rebuilding the sidebar/view-picker. */
  setComposer: (composer: HTMLElement) => void;
}>;

let shellInstanceCount = 0;

const PANEL_ICONS: Readonly<Record<'lists' | 'smart-lists' | 'tags', string>> = {
  lists:
    'M22 7h-9v2h9V7zm0 8h-9v2h9v-2zM10.47 2.5 6.5 6.5 4.5 4.5 3.09 5.91 6.5 9.32 11.89 3.94 10.47 2.5zm0 8L6.5 14.5 4.5 12.5 3.09 13.91 6.5 17.32 11.89 11.94 10.47 10.5z',
  'smart-lists':
    'M3 6h12v2H3V6zm0 5h8v2H3v-2zm0 5h6v2H3v-2zm14.5-5.5 1.4 3.6 3.6 1.4-3.6 1.4-1.4 3.6-1.4-3.6-3.6-1.4 3.6-1.4 1.4-3.6z',
  tags:
    'M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z',
};

const CHEVRON_DOWN = ['M2 3 L7 8 L12 3', 'M2 8 L7 13 L12 8'];

const createToggleButton = (label: string, onToggle: () => void): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-button';
  button.setAttribute('aria-label', label);
  button.innerHTML = `
    <span class="expand-chevrons" aria-hidden="true">
      <svg viewBox="0 0 14 14" focusable="false">
        <path d="${CHEVRON_DOWN[0]}" />
        <path d="${CHEVRON_DOWN[1]}" />
      </svg>
    </span>
  `;
  button.addEventListener('click', onToggle);
  return button;
};

const createPanelHeader = (
  label: string,
  icon: keyof typeof PANEL_ICONS,
  onToggle: () => void,
): HTMLDivElement => {
  const header = document.createElement('div');
  header.className = 'lists-header';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'lists-title-wrap';
  const iconSpan = document.createElement('span');
  iconSpan.className = 'lists-title-icon';
  iconSpan.setAttribute('aria-hidden', 'true');
  iconSpan.innerHTML = `<svg viewBox="0 0 24 24" focusable="false"><path d="${PANEL_ICONS[icon]}" /></svg>`;
  const title = document.createElement('p');
  title.className = 'lists-title';
  title.textContent = label;
  titleWrap.append(iconSpan, title);

  const actions = document.createElement('div');
  actions.className = 'lists-actions';
  actions.append(createToggleButton(`Toggle ${label.toLowerCase()}`, onToggle));

  header.append(titleWrap, actions);
  return header;
};

type ShellState = {
  lists: ConceptListFixture[];
  smartLists: ConceptSmartListFixture[];
  tags: ConceptTagPanelFixture[];
  tasksByView: Record<ConceptViewKey, readonly ConceptTaskFixture[]>;
  activeViewKey: ConceptViewKey;
  listsExpanded: boolean;
  smartListsExpanded: boolean;
  tagsExpanded: boolean;
};

const openTaskCount = (fixture: ConceptShellFixture, predicate: (label: string) => boolean) =>
  fixture.tasksByView.all.filter((task) => !task.completed && task.tags.some(predicate)).length;

export const createAppShellPreview = (
  fixture: ConceptShellFixture,
  options: AppShellPreviewOptions = {},
): AppShellPreviewHandle => {
  const instanceId = `concept-shell-${shellInstanceCount++}`;

  const shellState: ShellState = {
    lists: fixture.lists.map((list) => ({ ...list })),
    smartLists: fixture.smartLists.map((smartList) => ({ ...smartList })),
    tags: fixture.tags.map((tag) => ({ ...tag })),
    tasksByView: { ...fixture.tasksByView },
    activeViewKey: fixture.initialViewKey,
    listsExpanded: true,
    smartListsExpanded: true,
    tagsExpanded: true,
  };

  const root = document.createElement('div');
  root.className = 'content-grid concept-shell';

  // ---------- Sidebar ----------
  const rail = document.createElement('div');
  rail.className = 'lists-rail';
  const railInner = document.createElement('div');
  railInner.className = 'lists-rail-inner';
  rail.append(railInner);

  const listsPanel = document.createElement('div');
  listsPanel.className = 'lists-panel';
  const listsListEl = document.createElement('div');
  listsListEl.className = 'lists-list';

  const smartListsPanel = document.createElement('div');
  smartListsPanel.className = 'lists-panel smart-lists-panel';
  const smartListsListEl = document.createElement('div');
  smartListsListEl.className = 'lists-list';

  const tagsPanel = document.createElement('div');
  tagsPanel.className = 'lists-panel tags-panel';
  const tagsListEl = document.createElement('div');
  tagsListEl.className = 'lists-list';

  // ---------- Main column ----------
  const mainColumn = document.createElement('div');
  mainColumn.className = 'main-column';
  const mainBody = document.createElement('div');
  mainBody.className = 'main-body';
  const composeBlock = document.createElement('div');
  composeBlock.className = 'compose-block';

  const viewBar = document.createElement('div');
  viewBar.className = 'view-bar';
  const viewPickerWrap = document.createElement('div');
  viewPickerWrap.className = 'view-picker-wrap';
  const viewPickerBtn = document.createElement('button');
  viewPickerBtn.type = 'button';
  viewPickerBtn.className = 'view-picker';
  viewPickerBtn.setAttribute('aria-haspopup', 'listbox');
  viewPickerBtn.setAttribute('aria-expanded', 'false');
  const viewLabelSpan = document.createElement('span');
  const viewCaret = document.createElement('span');
  viewCaret.className = 'view-picker-caret';
  viewCaret.setAttribute('aria-hidden', 'true');
  viewCaret.textContent = '▾';
  viewPickerBtn.append(viewLabelSpan, viewCaret);

  const viewMenu = document.createElement('div');
  viewMenu.id = `${instanceId}-view-menu`;
  viewMenu.className = 'view-menu';
  viewMenu.setAttribute('role', 'listbox');
  viewMenu.setAttribute('aria-label', 'Choose a list or smart list');
  viewMenu.style.display = 'none';
  viewPickerBtn.setAttribute('aria-controls', viewMenu.id);

  viewPickerWrap.append(viewPickerBtn, viewMenu);
  viewBar.append(viewPickerWrap);

  const composerSlot = document.createElement('div');
  composerSlot.className = 'compose-block-composer-slot';

  if (options.composer) {
    composerSlot.append(options.composer);
  } else {
    const inputRow = document.createElement('div');
    inputRow.className = 'input-row';
    const inputWrap = document.createElement('div');
    inputWrap.className = 'add-task-input-wrap';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'text-input';
    input.placeholder = 'Add a new task';
    inputWrap.append(input);
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'primary-button icon-btn';
    addButton.setAttribute('aria-label', 'Add task');
    addButton.innerHTML = `
      <svg class="icon-add" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z" fill="currentColor" />
      </svg>
    `;
    inputRow.append(inputWrap, addButton);
    composerSlot.append(inputRow);
  }

  composeBlock.append(viewBar, composerSlot);

  const tasksSection = document.createElement('div');
  tasksSection.className = 'tasks-section';

  mainBody.append(composeBlock, tasksSection);
  mainColumn.append(mainBody);

  root.append(rail, mainColumn);

  // ---------- Rendering ----------

  const closeViewMenu = () => {
    viewMenu.style.display = 'none';
    viewPickerBtn.setAttribute('aria-expanded', 'false');
  };

  const selectView = (key: ConceptViewKey) => {
    shellState.activeViewKey = key;
    closeViewMenu();
    renderAll();
  };

  const menuItem = (label: string, selected: boolean, onPick: () => void): HTMLButtonElement => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `view-menu-item${selected ? ' selected' : ''}`;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(selected));
    item.textContent = label;
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
    viewMenu.replaceChildren();
    viewMenu.append(
      menuItem('All lists', shellState.activeViewKey === 'all', () => selectView('all')),
    );
    if (shellState.lists.length) {
      viewMenu.append(menuGroup('Lists'));
      shellState.lists.forEach((list) => {
        viewMenu.append(
          menuItem(list.name, shellState.activeViewKey === list.id, () =>
            selectView(list.id as ConceptViewKey),
          ),
        );
      });
    }
    if (shellState.smartLists.length) {
      viewMenu.append(menuGroup('Smart lists'));
      shellState.smartLists.forEach((smartList) => {
        viewMenu.append(
          menuItem(smartList.name, shellState.activeViewKey === smartList.id, () =>
            selectView(smartList.id as ConceptViewKey),
          ),
        );
      });
    }
  };

  const viewLabelFor = (key: ConceptViewKey): string => {
    if (key === 'all') return 'All lists';
    const list = shellState.lists.find((candidate) => candidate.id === key);
    if (list) return list.name;
    return shellState.smartLists.find((candidate) => candidate.id === key)?.name ?? 'All lists';
  };

  const renderListsPanel = () => {
    listsListEl.replaceChildren();
    listsListEl.style.display = shellState.listsExpanded ? 'flex' : 'none';
    if (!shellState.listsExpanded) return;

    listsListEl.append(
      createSidebarPill({
        label: 'All lists',
        selected: shellState.activeViewKey === 'all',
        onActivate: () => selectView('all'),
      }),
    );

    shellState.lists.forEach((list, index) => {
      const count = fixture.tasksByView[list.id as ConceptViewKey]?.filter(
        (task) => !task.completed,
      ).length;
      const pill = createSidebarPill({
        label: list.name,
        selected: shellState.activeViewKey === list.id,
        count,
        onActivate: () => selectView(list.id as ConceptViewKey),
      });
      attachPillDnD({
        kind: 'list',
        item: pill,
        index,
        reorder: (from, to) => {
          moveItem(shellState.lists, from, to);
          renderListsPanel();
          renderViewMenu();
        },
      });
      pill.insertBefore(makeDragHandle(), pill.firstChild);
      listsListEl.append(pill);
    });
  };

  const renderSmartListsPanel = () => {
    smartListsListEl.replaceChildren();
    smartListsListEl.style.display = shellState.smartListsExpanded ? 'flex' : 'none';
    if (!shellState.smartListsExpanded) return;

    if (shellState.smartLists.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No smart lists yet.';
      smartListsListEl.append(empty);
      return;
    }

    shellState.smartLists.forEach((smartList, index) => {
      const pill = createSidebarPill({
        label: smartList.name,
        selected: shellState.activeViewKey === smartList.id,
        className: 'smart-list-pill',
        onActivate: () => selectView(smartList.id as ConceptViewKey),
      });
      pill.title = smartList.query;
      attachPillDnD({
        kind: 'smart-list',
        item: pill,
        index,
        reorder: (from, to) => {
          moveItem(shellState.smartLists, from, to);
          renderSmartListsPanel();
          renderViewMenu();
        },
      });
      pill.insertBefore(makeDragHandle(), pill.firstChild);
      smartListsListEl.append(pill);
    });
  };

  const renderTagsPanel = () => {
    tagsListEl.replaceChildren();
    tagsListEl.style.display = shellState.tagsExpanded ? 'flex' : 'none';
    if (!shellState.tagsExpanded) return;

    shellState.tags.forEach((tag, index) => {
      const item = document.createElement('div');
      item.className = 'list-pill tag-pill';
      makePillActivatable(item, false);
      attachPillDnD({
        kind: 'tag',
        item,
        index,
        reorder: (from, to) => {
          moveItem(shellState.tags, from, to);
          renderTagsPanel();
        },
      });
      item.append(makeDragHandle());
      const dot = createTagDot({ color: tag.color, colorsEnabled: true });
      if (dot) item.append(dot);
      const label = document.createElement('span');
      label.className = 'list-pill-label';
      label.textContent = tag.label;
      item.append(label);
      const count = document.createElement('span');
      count.className = 'tag-count';
      count.textContent = String(openTaskCount(fixture, (label) => label === tag.label));
      item.append(count);
      tagsListEl.append(item);
    });
  };

  const renderTasks = () => {
    tasksSection.replaceChildren(
      createProductionTaskPreview({
        tasks: shellState.tasksByView[shellState.activeViewKey] ?? [],
        availableTags: fixture.tags.map((tag) => ({ label: tag.label, color: tag.color })),
      }),
    );
  };

  const setViewTasks = (key: ConceptViewKey, tasks: readonly ConceptTaskFixture[]): void => {
    shellState.tasksByView = { ...shellState.tasksByView, [key]: tasks };
    if (key === shellState.activeViewKey) renderTasks();
  };

  const setComposer = (composer: HTMLElement): void => {
    composerSlot.replaceChildren(composer);
  };

  const renderAll = () => {
    viewLabelSpan.textContent = viewLabelFor(shellState.activeViewKey);
    viewPickerBtn.setAttribute('aria-label', `Current view: ${viewLabelSpan.textContent}`);
    renderViewMenu();
    renderListsPanel();
    renderSmartListsPanel();
    renderTagsPanel();
    renderTasks();
  };

  listsPanel.append(
    createPanelHeader('Lists', 'lists', () => {
      shellState.listsExpanded = !shellState.listsExpanded;
      renderListsPanel();
    }),
    listsListEl,
  );
  smartListsPanel.append(
    createPanelHeader('Smart lists', 'smart-lists', () => {
      shellState.smartListsExpanded = !shellState.smartListsExpanded;
      renderSmartListsPanel();
    }),
    smartListsListEl,
  );
  tagsPanel.append(
    createPanelHeader('Tags', 'tags', () => {
      shellState.tagsExpanded = !shellState.tagsExpanded;
      renderTagsPanel();
    }),
    tagsListEl,
  );
  railInner.append(listsPanel, smartListsPanel, tagsPanel);

  viewPickerBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = viewMenu.style.display !== 'flex';
    viewMenu.style.display = open ? 'flex' : 'none';
    viewPickerBtn.setAttribute('aria-expanded', String(open));
  });
  viewMenu.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', (event) => {
    if (!root.isConnected) return;
    if (root.contains(event.target as Node)) return;
    closeViewMenu();
  });

  renderAll();

  return { element: root, selectView, setViewTasks, setComposer };
};
