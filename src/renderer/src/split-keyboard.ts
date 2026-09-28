import { isEditingEvent, isLocalKeyboardEvent } from "../../shared/keyboard-scope";
import { isShortcutEvent } from "../../shared/shortcut-binding";
import type { ShortcutId } from "./shortcuts";

export function isSplitNavigationCommand(id: ShortcutId): boolean {
  return id === "split-next" || id === "split-previous";
}

function elementOf(target: EventTarget | null): Element | undefined {
  const node = target as Node | null;
  return node?.nodeType === 1 ? node as Element : node?.parentElement ?? undefined;
}

const navigationSurface = '[data-split-navigation="surface"], [data-split-navigation="tab"]';
const nativeControl = 'button, a[href], input, textarea, select, summary, iframe, [tabindex], [role="button"], [role="checkbox"], [role="combobox"], [role="menu"], [role="menuitem"], [role="slider"], [role="switch"], [role="spinbutton"]';
const unavailableSurface = '[hidden], [inert], [aria-hidden="true"]';
const localSurface = '[data-helper-controls], [role="menu"], [role="menuitem"], [popover], [aria-haspopup][aria-expanded="true"], .agent-pane, .chats-section, .thread-panel, .settings-panel';

function isMailChrome(element: Element): boolean {
  const sidebarControl = element.closest('nav[aria-label="Mail"], .sidebar-toggle');
  if (sidebarControl?.closest(".sidebar")) return true;
  const toolbar = element.closest(".imbox-titlebar, .bulk-action-bar");
  return Boolean(toolbar?.closest(".imbox-panel"));
}

function ownsNavigation(control: Element): boolean {
  return ["surface", "tab"].includes(control.getAttribute("data-split-navigation") ?? "")
    || control.getAttribute("role") === "option" && control.hasAttribute("data-posting-id")
    || ["BUTTON", "A"].includes(control.tagName) && [null, "button"].includes(control.getAttribute("role")) && isMailChrome(control);
}

/**
 * Gate next/previous split commands, including custom aliases and chord steps.
 * The caller also supplies whether a split mailbox is visible (not a reader).
 * Recover stale mail-chrome/body focus after navigation while keeping other
 * panes and their native controls in charge of their own Tab behavior.
 */
export function canNavigateSplits(event: KeyboardEvent, enabled: boolean): boolean {
  if (!enabled || event.defaultPrevented || !isShortcutEvent(event)) return false;
  const targets = [event.target, ...(event.composedPath?.() ?? [])];
  const targetDocument = (event.target as Node | null)?.nodeType === 9 ? event.target as Document : elementOf(event.target)?.ownerDocument;
  let active = targetDocument?.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  if (active) targets.push(active);
  const scope = { target: event.target, composedPath: () => targets.filter((target): target is EventTarget => Boolean(target)) };
  if (isEditingEvent(scope) || isLocalKeyboardEvent(scope)) return false;
  // A menu or dialog may still be open after its focused element was removed.
  const overlays = targetDocument?.querySelectorAll?.('dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"], [popover]:popover-open');
  if (overlays && [...overlays].some((overlay) => !overlay.closest(unavailableSurface))) return false;
  const elements = targets.map(elementOf).filter((element): element is Element => Boolean(element));
  if (elements.some((element) => {
    if (element.closest(`${unavailableSurface}, ${localSurface}`)) return true;
    const control = element.closest(nativeControl);
    return Boolean(control && !ownsNavigation(control));
  })) return false;
  const focused = active && !["BODY", "HTML"].includes(active.tagName) ? active : elementOf(event.target);
  if (!focused) return (event.target as Node | null)?.nodeType === 9;
  return ["BODY", "HTML"].includes(focused.tagName) || isMailChrome(focused) || Boolean(focused.closest(navigationSurface));
}
