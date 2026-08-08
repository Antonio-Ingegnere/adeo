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

/** The topmost open overlay — the repeat modal can open on top of the edit modal. */
const activeOverlay = (): HTMLElement | null => {
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

      const items = Array.from(overlay.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible);
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
