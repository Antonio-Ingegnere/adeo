// The overlays already declare role="dialog" aria-modal="true", but nothing enforced it:
// tabbing out of an open modal walked straight into the page behind it. One document-level
// handler covers all five overlays, since they all use the same .overlay.open toggle.

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const isVisible = (el: HTMLElement) => {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

/**
 * Matching FOCUSABLE is not the same as being reachable by Tab, and the difference decides
 * whether this trap holds. `button:not([disabled])` matches a `tabindex="-1"` button, so a
 * roving-tabindex widget — the settings tab rail, the tag swatches — puts an *unfocusable*
 * element at the boundary. The handler below only intervenes when focus is exactly on the
 * first or last item, so a bogus boundary means it never fires and Tab walks out of the modal.
 *
 * tabIndex reports -1 for tabindex="-1" and 0 for a plain button, which is exactly the
 * distinction needed. (It does not describe radio groups, where only the checked input is
 * tabbable though every one reports 0 — which is why the tab rail is buttons, not radios.)
 */
const isTabbable = (el: HTMLElement) => el.tabIndex >= 0 && isVisible(el);

/**
 * The topmost open overlay — the repeat modal can open on top of the edit modal.
 * Exported because it is the app's single answer to "is a modal open, and which one":
 * Escape uses it to close only the topmost, and the shortcut dispatcher uses it to
 * decide a key's scope. A second copy of this would drift.
 */
export const activeOverlay = (): HTMLElement | null => {
  const open = document.querySelectorAll<HTMLElement>('.overlay.open');
  return open.length ? open[open.length - 1] : null;
};

export const installModalFocusTrap = () => {
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Tab') return;
      const overlay = activeOverlay();
      if (!overlay) return;

      const items = Array.from(overlay.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isTabbable);
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (!active || !overlay.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      }
    },
    true // capture: settle focus before the feature-level keydown handlers run
  );
};
