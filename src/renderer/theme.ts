// Priority is the one piece of colour the renderer used to set from TypeScript, via inline
// styles. That made it unreachable from CSS, which meant it could not follow the colour
// scheme -- a white "none" fill is invisible on a light background and glaring on a dark one.
//
// The colours now live in styles.css as --priority-* tokens (with a dark-scheme override)
// and the renderer only states *which* priority an element represents. Nothing here needs
// to know what any of them look like.

export type Priority = 'none' | 'low' | 'medium' | 'high';

const PRIORITIES: readonly Priority[] = ['none', 'low', 'medium', 'high'];

export const asPriority = (value: string | null | undefined): Priority =>
  PRIORITIES.includes(value as Priority) ? (value as Priority) : 'none';

/** Tags an element with the priority it represents; styles.css supplies the colour. */
export const setPriorityAttr = (el: HTMLElement | null, value: string | null | undefined) => {
  if (!el) return;
  el.dataset.priority = asPriority(value);
};
