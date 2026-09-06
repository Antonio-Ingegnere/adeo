import { refs } from './dom.js';

/**
 * App-owned replacement for the native OS confirm dialogs the main process used to show via
 * `dialog.showMessageBox` (see the removed `confirmAction`/`confirmDelete` helpers). Reuses the
 * `#board-move-overlay` DOM/CSS shape (`.overlay > .modal.modal-small > h2 + p + .modal-actions`)
 * generalized into one singleton dialog (`#app-confirm-overlay` in index.html) whose text and
 * button tone are set per call. Only one confirm can be open at a time across the app, matching
 * how the native dialogs were also modal/blocking.
 */

export type ConfirmTone = 'neutral' | 'danger';

export type ConfirmOptions = Readonly<{
  /** Maps to the old native dialog's `message`. */
  heading: string;
  /** Maps to the old native dialog's `detail`. */
  message: string;
  /** Primary/rightmost action label, e.g. "Delete" or "Replace". */
  confirmLabel: string;
  cancelLabel?: string;
  /** 'danger' renders confirmLabel with the destructive tint (.acd-btn-danger); 'neutral' reuses
   * `.btn.primary`, exactly as `#board-move-confirm` already does in production. */
  tone: ConfirmTone;
}>;

let pendingResolve: ((value: boolean) => void) | null = null;
let listenersBound = false;

const close = (result: boolean): void => {
  refs.appConfirmOverlay?.classList.remove('open');
  const resolve = pendingResolve;
  pendingResolve = null;
  resolve?.(result);
};

const bindListenersOnce = (): void => {
  if (listenersBound) return;
  listenersBound = true;
  refs.appConfirmCancel?.addEventListener('click', () => close(false));
  refs.appConfirmConfirm?.addEventListener('click', () => close(true));
  refs.appConfirmOverlay?.addEventListener('click', (event) => {
    if (event.target === refs.appConfirmOverlay) close(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && refs.appConfirmOverlay?.classList.contains('open')) {
      close(false);
    }
  });
};

/**
 * Opens the shared confirm dialog and resolves the same boolean shape the removed
 * `window.electronAPI.confirmDeleteTask`-style IPC calls used to return, so callers keep the
 * same `if (!(await confirmApp(...))) return;` control flow.
 */
export const confirmApp = (options: ConfirmOptions): Promise<boolean> => {
  const overlay = refs.appConfirmOverlay;
  const heading = refs.appConfirmHeading;
  const message = refs.appConfirmMessage;
  const cancelBtn = refs.appConfirmCancel;
  const confirmBtn = refs.appConfirmConfirm;
  if (!overlay || !heading || !message || !cancelBtn || !confirmBtn) {
    return Promise.resolve(false);
  }

  bindListenersOnce();
  // Defensive: only one confirm should ever be pending at a time, but a stray still-open call
  // must not be silently dropped -- resolve it false before the dialog's content changes under it.
  if (pendingResolve) close(false);

  heading.textContent = options.heading;
  message.textContent = options.message;
  cancelBtn.textContent = options.cancelLabel ?? 'Cancel';
  confirmBtn.textContent = options.confirmLabel;
  confirmBtn.className = options.tone === 'danger' ? 'btn acd-btn-danger' : 'btn primary';

  overlay.classList.add('open');
  // accessibility.md gap this must not repeat: initial focus lands on Cancel, not the
  // destructive action.
  cancelBtn.focus();

  return new Promise<boolean>((resolve) => {
    pendingResolve = resolve;
  });
};
