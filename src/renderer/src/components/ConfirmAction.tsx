import { useEffect, useRef, useSyncExternalStore } from "react";

type Confirmation = { message: string; action: string; resolve: (confirmed: boolean) => void };
let pending: Confirmation | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => pending;
const notify = () => listeners.forEach((listener) => listener());

export function confirmAction(message: string, action: string): Promise<boolean> {
  // Repeated keys must not stack dialogs or duplicate the operation.
  if (pending) return Promise.resolve(false);
  return new Promise((resolve) => { pending = { message, action, resolve }; notify(); });
}

export function resolveConfirmation(confirmed: boolean): void {
  const current = pending;
  pending = undefined;
  notify();
  current?.resolve(confirmed);
}

export default function ConfirmAction() {
  const confirmation = useSyncExternalStore(subscribe, snapshot, snapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const finish = (confirmed: boolean) => {
    dialog.current?.close();
    resolveConfirmation(confirmed);
  };
  useEffect(() => {
    if (!confirmation) return;
    const previous = document.activeElement;
    dialog.current?.showModal();
    cancel.current?.focus();
    return () => {
      // Resolve safely on profile change/unmount too.
      if (pending === confirmation) resolveConfirmation(false);
      if (previous instanceof HTMLElement && previous.isConnected && previous.getClientRects().length) previous.focus({ preventScroll: true });
    };
  }, [confirmation]);
  if (!confirmation) return null;
  return <dialog ref={dialog} role="alertdialog" className="confirm-action-dialog" aria-labelledby="confirm-action-title" aria-describedby="confirm-action-message"
    onCancel={(event) => { event.preventDefault(); finish(false); }}
    onKeyDownCapture={(event) => { event.stopPropagation(); }}>
    <h2 id="confirm-action-title">{confirmation.action}?</h2>
    <p id="confirm-action-message">{confirmation.message}</p>
    <div className="confirm-action-buttons">
      <button ref={cancel} type="button" className="secondary-button" onClick={() => finish(false)}>Cancel</button>
      <button type="button" className="primary-button" onClick={() => finish(true)}>{confirmation.action}</button>
    </div>
  </dialog>;
}
