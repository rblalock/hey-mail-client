import type { KeyEvent } from "./shortcut-binding";

// Structural checks work for nodes from email frames as well as the main window.
function elementOf(target: EventTarget | null): Element | undefined {
  const node = target as Node | null;
  return node?.nodeType === 1 ? node as Element : node?.parentElement ?? undefined;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const element = elementOf(target);
  if (!element) return false;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)) return true;
  if ((element as HTMLElement).isContentEditable) return true;
  if (element.closest('[role="textbox"], [role="searchbox"], [role="combobox"]')) return true;
  const editable = element.closest("[contenteditable]");
  return Boolean(editable && editable.getAttribute("contenteditable") !== "false");
}

type ScopeEvent = Pick<KeyboardEvent, "target"> & Partial<Pick<KeyboardEvent, "composedPath">>;

function eventTargets(event: ScopeEvent): EventTarget[] {
  const targets = event.composedPath?.() ?? [];
  if (event.target && !targets.includes(event.target)) targets.unshift(event.target);
  const document = elementOf(event.target)?.ownerDocument;
  let active = document?.activeElement;
  // The target can be a shadow host, rather than the editor inside it.
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  if (active && !targets.includes(active)) targets.push(active);
  return targets;
}

export function isEditingEvent(event: ScopeEvent): boolean {
  return eventTargets(event).some(isEditableTarget);
}

export function isLocalKeyboardEvent(event: ScopeEvent): boolean {
  return eventTargets(event).some((target) => Boolean(elementOf(target)?.closest(
    '[data-keyboard-scope="editor"], [role="dialog"], [role="alertdialog"], dialog[open]',
  )));
}

export function isDialogKeyboardEvent(event: ScopeEvent): boolean {
  return eventTargets(event).some((target) => Boolean(elementOf(target)?.closest(
    '[role="dialog"], [role="alertdialog"], dialog[open]',
  )));
}

export function isNativeEditingShortcut(event: KeyEvent): boolean {
  if ((!event.ctrlKey && !event.metaKey) || event.altKey) return false;
  const key = event.key.toLowerCase();
  if (["arrowleft", "arrowright", "arrowup", "arrowdown", "home", "end", "backspace", "delete", "insert"].includes(key)) return true;
  // Shift+C/B/A are intentional composer commands (Cc/Bcc/attach). Keep them.
  return event.shiftKey ? ["z", "v"].includes(key) : ["a", "c", "x", "v", "z", "y", "b", "i", "u"].includes(key);
}

export function isNativeEditingBinding(binding: string): boolean {
  if (binding.includes(" ")) return false;
  const parts = binding.split("+");
  const key = parts.pop() ?? "";
  return isNativeEditingShortcut({ key, ctrlKey: parts.includes("ctrl") || parts.includes("mod"), metaKey: parts.includes("meta"), shiftKey: parts.includes("shift"), altKey: parts.includes("alt") });
}
