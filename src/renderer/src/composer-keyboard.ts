import { useContext, useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { ShortcutContext } from "./shortcut-context";
import { matchesShortcut, type ShortcutId } from "./shortcuts";
import { isShortcutEvent } from "../../shared/shortcut-binding";

export function trapFocus(event: KeyboardEvent, root: HTMLElement) {
  if (event.key !== "Tab") return;
  const controls = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')].filter((element) => element.getClientRects().length && element.tabIndex >= 0);
  const first = controls[0], last = controls.at(-1);
  if (!first || !last) { event.preventDefault(); root.focus(); return; }
  if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
}

export function useModalFocus(ref: RefObject<HTMLElement | null>) {
  const opener = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const node = ref.current;
    if (node && !node.contains(document.activeElement)) node.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), button:not(:disabled)')?.focus();
    const contain = (event: FocusEvent) => {
      if (node?.isConnected && !node.contains(event.target as Node)) node.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), button:not(:disabled)')?.focus();
    };
    document.addEventListener("focusin", contain);
    return () => { document.removeEventListener("focusin", contain); if (opener.current?.isConnected) opener.current.focus(); };
  }, [ref]);
}

export function focusRecipient(root: HTMLElement, label: "Cc" | "Bcc", reveal?: () => void) {
  reveal?.();
  requestAnimationFrame(() => root.querySelector<HTMLInputElement>(`input[aria-label="${label} recipients"], input[aria-label="${label}"]`)?.focus());
}

export function useComposerKeyboard(actions: Partial<Record<ShortcutId, () => void>>, close?: () => void, modal = false) {
  const shortcuts = useContext(ShortcutContext);
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented) return;
    // Inner dialogs and suggestion lists own their keystrokes first.
    if (!isShortcutEvent(event.nativeEvent)) { event.stopPropagation(); return; }
    if (modal) trapFocus(event, event.currentTarget);
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close?.(); return; }
    const command = shortcuts.find((item) => item.scope === "composer" && matchesShortcut(event.nativeEvent, item));
    if (command) { event.preventDefault(); actions[command.id]?.(); }
    // A composer is a local keyboard scope, even when its action is disabled.
    event.stopPropagation();
  };
}
