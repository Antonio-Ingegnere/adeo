/**
 * Small production DOM factories shared by renderer features and Storybook.
 *
 * Keep this module deliberately dependency-free: callers provide data, state flags, and
 * callbacks explicitly. That makes these elements safe to render without Electron services,
 * renderer refs, or mutable application state.
 */

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
