// One grammar for settings validation, display and keyboard dispatch.
const aliases: Record<string, string> = { control: "ctrl", cmd: "meta", command: "meta", option: "alt", esc: "escape", return: "enter", spacebar: "space", del: "delete", comma: ",", plus: "+" };
const modifiers = ["mod", "ctrl", "meta", "alt", "shift"];
const namedKeys = new Set(["enter", "escape", "tab", "space", "backspace", "delete", "insert", "home", "end", "pageup", "pagedown", "arrowup", "arrowdown", "arrowleft", "arrowright"]);

export function normalizeBinding(value: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 80 || /[\r\n\0]/.test(value)) throw new Error("Enter a shortcut, such as Ctrl+K or g i.");
  const steps = value.trim().toLowerCase().replace(/\s*\+\s*/g, "+").split(/\s+/);
  if (steps.length > 2) throw new Error("Use at most two steps, such as g i.");
  return steps.map((step) => {
    const parts = step.split("+").map((part) => aliases[part] ?? part);
    const key = parts.pop()!;
    if (!key || !(key.length === 1 || namedKeys.has(key) || /^f([1-9]|1\d|2[0-4])$/.test(key))) throw new Error(`Unknown key “${key || step}”. Use a letter, punctuation, or a key name such as Enter.`);
    if (parts.some((part) => !modifiers.includes(part))) throw new Error("Unknown modifier. Use Ctrl, Alt, Shift, or Meta.");
    if (new Set(parts).size !== parts.length || parts.includes("mod") && (parts.includes("ctrl") || parts.includes("meta"))) throw new Error("Do not repeat or combine Ctrl/Meta with Mod.");
    return [...modifiers.filter((part) => parts.includes(part)), key === "+" ? "plus" : key].join("+");
  }).join(" ");
}

export function normalizeBindings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 5 || value.some((item) => typeof item !== "string")) throw new Error("Use up to five shortcuts, one per line.");
  return [...new Set(value.map(normalizeBinding))];
}

export type KeyEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"> & Partial<Pick<KeyboardEvent, "repeat" | "isComposing" | "keyCode" | "getModifierState">>;
export function isShortcutEvent(event: KeyEvent, allowRepeat = false): boolean { return (allowRepeat || !event.repeat) && !event.isComposing && event.keyCode !== 229 && !event.getModifierState?.("AltGraph"); }

export function matchesBindingStep(event: KeyEvent, binding: string, allowRepeat = false): boolean {
  if (!isShortcutEvent(event, allowRepeat)) return false;
  let normalized: string;
  try { normalized = normalizeBinding(binding); } catch { return false; }
  if (normalized.includes(" ")) return false;
  const parts = normalized.split("+");
  const key = parts.pop()!;
  const mod = parts.includes("mod");
  if (mod ? event.ctrlKey === event.metaKey : event.ctrlKey !== parts.includes("ctrl") || event.metaKey !== parts.includes("meta")) return false;
  if (event.altKey !== parts.includes("alt")) return false;
  const actualKey = event.key === " " ? "space" : event.key === "+" ? "plus" : event.key.toLowerCase();
  const symbol = key === "plus" || key.length === 1 && /[^a-z0-9]/.test(key);
  if (event.shiftKey !== parts.includes("shift") && !(symbol && !parts.includes("shift"))) return false;
  return actualKey === key;
}
