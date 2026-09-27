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

function ownsNavigation(control: Element): boolean {
  return ["surface", "tab"].includes(control.getAttribute("data-split-navigation") ?? "")
    || control.getAttribute("role") === "option" && control.hasAttribute("data-posting-id");
}

/**
 * Gate next/previous split commands, including custom aliases and chord steps.
 * The caller also supplies whether a split mailbox is visible (not a reader).
 * Bare Tab remains ordinary focus navigation everywhere outside this surface.
 */
export function canNavigateSplits(event: KeyboardEvent, enabled: boolean): boolean {
  if (!enabled || event.defaultPrevented || !isShortcutEvent(event) || isEditingEvent(event) || isLocalKeyboardEvent(event)) return false;
  const targets = [event.target, ...(event.composedPath?.() ?? [])];
  let active = elementOf(event.target)?.ownerDocument.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  if (active) targets.push(active);
  const elements = targets.map(elementOf).filter((element): element is Element => Boolean(element));
  if (elements.some((element) => {
    if (element.closest('[hidden], [inert], [aria-hidden="true"], [data-helper-controls]')) return true;
    const control = element.closest(nativeControl);
    return Boolean(control && !ownsNavigation(control));
  })) return false;
  return elements.some((element) => Boolean(element.closest(navigationSurface)));
}
