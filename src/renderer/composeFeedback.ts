import { refs } from './dom.js';

/**
 * The compose row's own feedback surfaces (#compose-status, #compose-error). Kept as a leaf
 * module importing only dom.js so actions.ts can call it without pulling in anything that
 * imports actions.ts back.
 */

export const announceComposeSuccess = (text: string) => {
  if (refs.composeStatus) {
    // Clear first: some screen readers do not re-announce a live region whose text is set to
    // the same string it already held, so a second identical "Added..." in a row must still
    // fire. querySearch.ts's announce() deliberately does the opposite (dedupes) for its own
    // debounced case -- do not copy that guard here.
    refs.composeStatus.textContent = '';
    requestAnimationFrame(() => {
      if (refs.composeStatus) refs.composeStatus.textContent = `Added “${text}”.`;
    });
  }
  if (refs.composeError) refs.composeError.textContent = '';
};

export const showComposeError = (message: string) => {
  if (refs.composeError) refs.composeError.textContent = message;
  if (refs.composeStatus) refs.composeStatus.textContent = '';
};

export const clearComposeFeedback = () => {
  if (refs.composeError) refs.composeError.textContent = '';
  if (refs.composeStatus) refs.composeStatus.textContent = '';
};
