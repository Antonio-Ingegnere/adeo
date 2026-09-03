/**
 * Small production DOM factories shared by renderer features and Storybook.
 *
 * Keep this module deliberately dependency-free: callers provide data, state flags, and
 * callbacks explicitly. That makes these elements safe to render without Electron services,
 * renderer refs, or mutable application state.
 */

/**
 * The sidebar "more" (kebab) glyph. Single source of truth so the task-row kebab and the
 * sidebar list/tag/smart-list/board kebabs stay byte-identical -- same path, same 18px box
 * (see .icon-more / .list-menu-btn svg in styles.css). Rendered via innerHTML by callers.
 */
export const MORE_ICON_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" class="icon-more">' +
  '<path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>' +
  '</svg>';

export type TagChipVariant = 'task' | 'pending' | 'filter';

export type TagChipOptions = {
  label: string;
  color: string;
  colorsEnabled: boolean;
  variant?: TagChipVariant;
  title?: string;
  ariaLabel?: string;
  disabled?: boolean;
  onActivate?: (event: MouseEvent) => void;
};

export type TagDotOptions = {
  color: string;
  colorsEnabled: boolean;
};

export type ShortcutKeycapsOptions = {
  tokens: readonly string[];
};

export type ComboboxSuggestionItemOptions = {
  id: string;
  label: string;
  active: boolean;
  disabled?: boolean;
  hint?: string;
  color?: string;
  colorsEnabled?: boolean;
  variant?: 'tag' | 'query';
  onSelect?: (event: MouseEvent) => void;
};

export type SidebarPillOptions = {
  label: string;
  selected: boolean;
  count?: number;
  className?: string;
  maxLabelLength?: number;
  onActivate?: (event: MouseEvent) => void;
};

export const styleTagChip = (
  element: HTMLElement,
  color: string,
  colorsEnabled: boolean,
): void => {
  if (colorsEnabled) {
    element.classList.remove('tag-plain');
    element.style.background = color;
    return;
  }

  element.classList.add('tag-plain');
  element.style.background = '';
};

export const createTagDot = ({
  color,
  colorsEnabled,
}: TagDotOptions): HTMLSpanElement | null => {
  if (!colorsEnabled) return null;

  const dot = document.createElement('span');
  dot.className = 'tag-dot';
  dot.style.background = color;
  dot.setAttribute('aria-hidden', 'true');
  return dot;
};

export const createTagChip = ({
  label,
  color,
  colorsEnabled,
  variant = 'task',
  title,
  ariaLabel,
  disabled = false,
  onActivate,
}: TagChipOptions): HTMLButtonElement => {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className =
    variant === 'filter'
      ? 'tag-filter-chip'
      : `task-tag-chip${variant === 'pending' ? ' add-task-tag-chip' : ''}`;
  chip.textContent = label;
  chip.disabled = disabled;
  if (title) chip.title = title;
  if (ariaLabel) chip.setAttribute('aria-label', ariaLabel);
  styleTagChip(chip, color, colorsEnabled);

  if (onActivate) {
    chip.addEventListener('click', onActivate);
  }

  return chip;
};

export const createShortcutKeycaps = ({ tokens }: ShortcutKeycapsOptions): HTMLSpanElement => {
  const wrapper = document.createElement('span');
  wrapper.className = 'shortcut-keys';

  tokens.forEach((token) => {
    const keycap = document.createElement('kbd');
    keycap.textContent = token;
    wrapper.appendChild(keycap);
  });

  return wrapper;
};

export const createComboboxSuggestionItem = ({
  id,
  label,
  active,
  disabled = false,
  hint,
  color,
  colorsEnabled = true,
  variant = 'tag',
  onSelect,
}: ComboboxSuggestionItemOptions): HTMLButtonElement => {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = `tag-suggest-item${variant === 'query' ? ' query-suggest-item' : ''}${active && !disabled ? ' active' : ''}`;
  item.id = id;
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', active && !disabled ? 'true' : 'false');
  item.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  item.tabIndex = -1;
  item.disabled = disabled;

  if (color) {
    const dot = createTagDot({ color, colorsEnabled });
    if (dot) item.appendChild(dot);
  }

  item.appendChild(document.createTextNode(label));

  if (hint) {
    const metadata = document.createElement('span');
    metadata.className = 'query-suggest-hint';
    metadata.textContent = hint;
    item.appendChild(metadata);
  }

  if (onSelect) {
    item.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onSelect(event);
    });
  }

  return item;
};

export const createSidebarPill = ({
  label,
  selected,
  count,
  className = '',
  maxLabelLength = 30,
  onActivate,
}: SidebarPillOptions): HTMLDivElement => {
  const item = document.createElement('div');
  item.className = `list-pill${className ? ` ${className}` : ''}${selected ? ' selected' : ''}`;
  item.setAttribute('role', 'button');
  item.tabIndex = 0;
  item.setAttribute('aria-pressed', selected ? 'true' : 'false');

  const visibleLabel =
    label.length > maxLabelLength ? `${label.slice(0, maxLabelLength)}...` : label;
  const labelElement = document.createElement('span');
  labelElement.className = 'list-pill-label';
  labelElement.textContent = visibleLabel;
  if (visibleLabel !== label) {
    labelElement.title = label;
    item.setAttribute('aria-label', count === undefined ? label : `${label}, ${count}`);
  }
  item.appendChild(labelElement);

  if (count !== undefined) {
    const countElement = document.createElement('span');
    countElement.className = 'tag-count';
    countElement.textContent = String(count);
    item.appendChild(countElement);
  }

  if (onActivate) item.addEventListener('click', onActivate);
  item.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    item.click();
  });

  return item;
};
