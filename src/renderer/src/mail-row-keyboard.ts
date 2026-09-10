import { matchesBindingStep, type KeyEvent } from "../../shared/shortcut-binding";

type ActivationEvent = KeyEvent & { defaultPrevented: boolean; preventDefault(): void; stopPropagation(): void };

// Call the same action as a pointer click, but do not synthesize a click. This
// remains reliable when Chromium's native activation/focus state is out of sync.
export function activateMailRow(event: ActivationEvent, open: () => void, bindings: string[] = ["enter"]): boolean {
  if (event.defaultPrevented || !bindings.some((binding) => matchesBindingStep(event, binding, true))) return false;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) open();
  return true;
}
