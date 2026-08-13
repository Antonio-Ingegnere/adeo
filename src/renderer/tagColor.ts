/**
 * Where a tag's colour is applied, and the one place that decides whether it is applied at all.
 *
 * Every tag swatch, dot and chip in the app goes through here. The colour is an inline style
 * rather than a class -- it is data, not a variant -- so "turn tag colours off" means simply
 * not setting it, and the chip classes already carry a border and no background of their own.
 */

import { state } from './state.js';

/**
 * Hand-mirrored from TAG_PALETTE in server/app.py, the same way src/types.ts mirrors the
 * Pydantic models. The server assigns from it on creation and validates against it on change,
 * so the two lists must be edited together -- a colour offered here and unknown there is
 * rejected with a 400 rather than silently stored.
 */
export const TAG_PALETTE = [
  { color: '#F6C6C6', name: 'Rose' },
  { color: '#F9D9B8', name: 'Peach' },
  { color: '#F5EBAE', name: 'Butter' },
  { color: '#C9E8C1', name: 'Mint' },
  { color: '#BEE3E8', name: 'Aqua' },
  { color: '#C5D4F5', name: 'Periwinkle' },
  { color: '#DCCDF0', name: 'Lilac' },
  { color: '#F3CFE3', name: 'Pink' },
] as const;

export const paletteName = (color: string): string =>
  TAG_PALETTE.find((entry) => entry.color.toUpperCase() === color.toUpperCase())?.name ?? 'Custom';

/**
 * Paint a chip that carries a tag's colour. With colours off the fill is dropped and the chip
 * takes `tag-plain`, which is not only cosmetic: --text-chip is dark ink meant for pastel
 * fills and stays dark in dark mode, so a chip with no fill has to switch to --text-body or
 * it would be unreadable. The same goes for its border, which is black-on-transparent.
 */
export const paintTagChip = (el: HTMLElement, color: string) => {
  if (state.tagColors) {
    el.classList.remove('tag-plain');
    el.style.background = color;
    return;
  }
  el.classList.add('tag-plain');
  el.style.background = '';
};

/**
 * The little round swatch beside a tag's name. Returns null with colours off: a grey dot
 * beside every tag would carry no information, and the row reads better without it.
 */
export const makeTagDot = (color: string): HTMLSpanElement | null => {
  if (!state.tagColors) return null;
  const dot = document.createElement('span');
  dot.className = 'tag-dot';
  dot.style.background = color;
  return dot;
};
