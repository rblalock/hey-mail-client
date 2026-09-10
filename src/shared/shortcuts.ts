import { DEFAULT_AI_SETTINGS, DEFAULT_SOUND_SETTINGS, type AppSettings, type ShortcutProfile } from "./contracts";
import { matchesBindingStep, normalizeBindings, isShortcutEvent } from "./shortcut-binding";
import { DEFAULT_ENABLED_HELPERS, HELPER_CATALOG_VERSION, type HelperId } from "./helpers";

export type ShortcutId =
  | "commands" | "search" | "compose" | "next" | "previous" | "open" | "back" | "undo-trash"
  | "toggle-navigation" | "toggle-agent" | "focus-agent" | "select-next" | "select-previous"
  | "composer-write" | "composer-send" | "composer-save" | "composer-cc" | "composer-bcc" | "composer-attach"
  | "select" | "bulk-actions" | "read-together" | "reply-together" | "bulk-label" | "bulk-collection" | "bulk-imbox" | "bulk-feed" | "bulk-trail" | "bulk-ignore"
  | "reply" | "forward" | "seen" | "later" | "aside" | "bubble" | "unread" | "trash" | "stop-ignoring"
  | "nav-imbox" | "nav-feed" | "nav-trail" | "nav-later" | "nav-aside" | "nav-bubble"
  | "nav-sessions" | "nav-screener" | "nav-previously" | "nav-calendar" | "nav-settings"
  | "session-new" | "session-close" | "session-next" | "session-previous"
  | "session-1" | "session-2" | "session-3" | "session-4" | "session-5" | "session-6" | "session-7" | "session-8" | "session-9"
  | "agent-focus-context" | "agent-start-context" | "agent-add-context" | "agent-summarize-selection" | "agent-replies-selection"
  | `helper-${HelperId}`;

export type ShortcutDefinition = {
  id: ShortcutId;
  label: string;
  keys: string[];
  display: string;
  scope: "global" | "mailbox" | "bulk" | "conversation" | "reader" | "session" | "agent-context" | "composer";
};

type ShortcutCatalogEntry = Omit<ShortcutDefinition, "keys" | "display"> & { hey: string[]; superhuman: string[] };

const CATALOG: ShortcutCatalogEntry[] = [
  { id: "composer-write", label: "Write with AI", hey: ["mod+k"], superhuman: ["mod+k"], scope: "composer" },
  { id: "composer-send", label: "Send message", hey: ["mod+enter"], superhuman: ["mod+enter"], scope: "composer" },
  { id: "composer-save", label: "Save draft", hey: ["mod+s"], superhuman: ["mod+s"], scope: "composer" },
  { id: "composer-cc", label: "Focus Cc", hey: ["mod+shift+c"], superhuman: ["mod+shift+c"], scope: "composer" },
  { id: "composer-bcc", label: "Focus Bcc", hey: ["mod+shift+b"], superhuman: ["mod+shift+b"], scope: "composer" },
  { id: "composer-attach", label: "Attach files", hey: ["mod+shift+a"], superhuman: ["mod+shift+a"], scope: "composer" },
  { id: "commands", label: "Open command palette", hey: ["mod+k"], superhuman: ["mod+k"], scope: "global" },
  { id: "undo-trash", label: "Undo pending trash action", hey: ["mod+z"], superhuman: ["mod+z"], scope: "global" },
  { id: "search", label: "Search all email", hey: ["/"], superhuman: ["/"], scope: "global" },
  { id: "compose", label: "Compose a message", hey: ["w", "c"], superhuman: ["c", "w"], scope: "global" },
  { id: "toggle-navigation", label: "Toggle navigation sidebar", hey: ["mod+b"], superhuman: ["mod+b"], scope: "global" },
  { id: "toggle-agent", label: "Toggle HEY Agent sidebar", hey: ["mod+shift+b"], superhuman: ["mod+shift+b"], scope: "global" },
  { id: "focus-agent", label: "Focus AI chat composer", hey: ["mod+shift+l"], superhuman: ["mod+shift+l"], scope: "global" },
  { id: "nav-imbox", label: "Go to Imbox", hey: ["1"], superhuman: ["g i", "1"], scope: "global" },
  { id: "nav-feed", label: "Go to The Feed", hey: ["2"], superhuman: ["g f", "2"], scope: "global" },
  { id: "nav-trail", label: "Go to Paper Trail", hey: ["3"], superhuman: ["g p", "3"], scope: "global" },
  { id: "nav-later", label: "Go to Reply Later", hey: ["4"], superhuman: ["g l", "4"], scope: "global" },
  { id: "nav-aside", label: "Go to Set Aside", hey: ["5"], superhuman: ["g a", "5"], scope: "global" },
  { id: "nav-bubble", label: "Go to Bubble Up", hey: ["6"], superhuman: ["g b", "6"], scope: "global" },
  { id: "nav-sessions", label: "Go to Sessions", hey: ["7"], superhuman: ["g s", "7"], scope: "global" },
  { id: "nav-screener", label: "Go to The Screener", hey: ["8"], superhuman: ["g r", "8"], scope: "global" },
  { id: "nav-previously", label: "Go to Previously Seen", hey: ["9"], superhuman: ["g v", "9"], scope: "global" },
  { id: "nav-calendar", label: "Go to Calendar", hey: ["0"], superhuman: ["g c", "0"], scope: "global" },
  { id: "nav-settings", label: "Go to Settings", hey: ["g ,"], superhuman: ["g ,"], scope: "global" },
  { id: "next", label: "Next conversation", hey: ["j", "arrowdown"], superhuman: ["j", "arrowdown"], scope: "mailbox" },
  { id: "previous", label: "Previous conversation", hey: ["k", "arrowup"], superhuman: ["k", "arrowup"], scope: "mailbox" },
  { id: "open", label: "Open conversation", hey: ["enter"], superhuman: ["enter"], scope: "mailbox" },
  { id: "select", label: "Select conversation", hey: ["x"], superhuman: ["x"], scope: "mailbox" },
  { id: "select-next", label: "Extend selection down", hey: ["shift+j", "shift+arrowdown"], superhuman: ["shift+j", "shift+arrowdown"], scope: "mailbox" },
  { id: "select-previous", label: "Extend selection up", hey: ["shift+k", "shift+arrowup"], superhuman: ["shift+k", "shift+arrowup"], scope: "mailbox" },
  { id: "bulk-actions", label: "Focus bulk actions", hey: [";"], superhuman: [";"], scope: "bulk" },
  { id: "read-together", label: "Read Together", hey: ["o"], superhuman: ["o"], scope: "bulk" },
  { id: "reply-together", label: "Reply Together", hey: ["r"], superhuman: ["r"], scope: "bulk" },
  { id: "bulk-label", label: "Add selected to a label", hey: ["b"], superhuman: ["b"], scope: "bulk" },
  { id: "bulk-collection", label: "Add selected to a Collection", hey: ["n"], superhuman: ["n"], scope: "bulk" },
  { id: "bulk-imbox", label: "Move selected to Imbox", hey: ["i"], superhuman: ["i"], scope: "bulk" },
  { id: "bulk-feed", label: "Move selected to The Feed", hey: ["d"], superhuman: ["d"], scope: "bulk" },
  { id: "bulk-trail", label: "Move selected to Paper Trail", hey: ["p"], superhuman: ["p"], scope: "bulk" },
  { id: "bulk-ignore", label: "Ignore selected conversations", hey: ["-"], superhuman: ["-"], scope: "bulk" },
  { id: "back", label: "Close conversation", hey: ["escape"], superhuman: ["escape"], scope: "reader" },
  { id: "reply", label: "Reply", hey: ["r"], superhuman: ["r"], scope: "conversation" },
  { id: "forward", label: "Forward", hey: ["f"], superhuman: ["f"], scope: "conversation" },
  { id: "seen", label: "Mark seen", hey: ["e"], superhuman: ["e"], scope: "conversation" },
  { id: "later", label: "Toggle Reply Later", hey: ["l", "h"], superhuman: ["h", "l"], scope: "conversation" },
  { id: "aside", label: "Set Aside / remove", hey: ["a"], superhuman: ["a"], scope: "conversation" },
  { id: "bubble", label: "Toggle Bubble Up", hey: ["z"], superhuman: ["z"], scope: "conversation" },
  { id: "unread", label: "Toggle read / unread", hey: ["u"], superhuman: ["u"], scope: "conversation" },
  { id: "stop-ignoring", label: "Stop ignoring conversation", hey: [], superhuman: [], scope: "conversation" },
  { id: "trash", label: "Move to Trash", hey: ["t", "#"], superhuman: ["#", "t"], scope: "conversation" },
  { id: "session-new", label: "New session", hey: ["mod+t"], superhuman: ["mod+t"], scope: "session" },
  { id: "session-close", label: "Close session", hey: ["mod+w"], superhuman: ["mod+w"], scope: "session" },
  { id: "session-next", label: "Next session", hey: ["ctrl+tab"], superhuman: ["ctrl+tab"], scope: "session" },
  { id: "session-previous", label: "Previous session", hey: ["ctrl+shift+tab"], superhuman: ["ctrl+shift+tab"], scope: "session" },
  ...Array.from({ length: 9 }, (_, index): ShortcutCatalogEntry => ({
    id: `session-${index + 1}` as ShortcutId,
    label: `Open session ${index + 1}`,
    hey: [`ctrl+${index + 1}`],
    superhuman: [`ctrl+${index + 1}`],
    scope: "session",
  })),
];

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  interfaceFont: "instrument",
  showSenderAvatars: false,
  shortcutProfile: "hey",
  customShortcuts: {},
  sound: DEFAULT_SOUND_SETTINGS,
  ai: DEFAULT_AI_SETTINGS,
  helpers: { catalogVersion: HELPER_CATALOG_VERSION, enabled: DEFAULT_ENABLED_HELPERS },
};

export function formatBinding(binding: string): string {
  return binding.split(" ").map((step) => step.split("+").map((part) => ({ mod: "Ctrl", ctrl: "Ctrl", meta: "Meta", shift: "Shift", alt: "Alt", enter: "Enter", escape: "Esc", tab: "Tab", plus: "+", space: "Space", arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→" }[part] ?? part.toUpperCase())).join("+")).join(" then ");
}

export function resolveShortcuts(settings: AppSettings = DEFAULT_SETTINGS): ShortcutDefinition[] {
  const profile: ShortcutProfile = settings.shortcutProfile;
  return CATALOG.map((entry) => {
    const preset = profile === "superhuman" ? entry.superhuman : entry.hey;
    const custom = settings.customShortcuts[entry.id];
    const keys = profile === "custom" && custom !== undefined ? custom : preset;
    return { id: entry.id, label: entry.label, keys, display: formatBinding(keys[0] ?? ""), scope: entry.scope };
  });
}

export const SHORTCUTS = resolveShortcuts();

export function isEditableTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : undefined;
  return Boolean(element?.isContentEditable || element && ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName));
}


export function matchesShortcut(event: KeyboardEvent, definition: ShortcutDefinition): boolean {
  const repeatable = ["next", "previous", "select-next", "select-previous"].includes(definition.id);
  return definition.keys.some((binding) => !binding.includes(" ") && matchesBindingStep(event, binding, repeatable));
}

export function startsShortcutChord(event: KeyboardEvent, definition: ShortcutDefinition): boolean {
  return definition.keys.some((binding) => binding.includes(" ") && matchesBindingStep(event, binding.split(" ")[0]!));
}

export function completesShortcutChord(first: string, event: KeyboardEvent, definition: ShortcutDefinition): boolean {
  return definition.keys.some((binding) => {
    const [start, end, extra] = binding.split(" ");
    return isShortcutEvent(event) && !extra && start === first && Boolean(end) && matchesBindingStep(event, end!);
  });
}

export function shortcutById(shortcuts: ShortcutDefinition[], id: ShortcutId): ShortcutDefinition {
  return shortcuts.find((shortcut) => shortcut.id === id) ?? SHORTCUTS.find((shortcut) => shortcut.id === id)!;
}

export function validateCustomShortcuts(value: Record<string, string[]>): Record<string, string[]> {
  const normalized: Record<string, string[]> = {};
  for (const [id, bindings] of Object.entries(value)) {
    const entry = CATALOG.find((item) => item.id === id);
    if (!entry) throw new Error(`Unknown shortcut command: ${id}.`);
    normalized[id] = normalizeBindings(bindings);
    if (entry.scope === "composer" && normalized[id]!.some((key) => key.includes(" ") || !/^(mod|ctrl|meta)\+/.test(key))) throw new Error("Composer shortcuts need Ctrl or Meta and a single step, so ordinary typing stays safe.");
    if (normalized[id]!.some((key) => /^(mod|ctrl)\+(?:shift\+)?(?:q|r|w)$/.test(key) && !["session-close"].includes(id))) throw new Error("That shortcut is reserved for window/session controls. Choose another combination.");
  }
  const resolved = resolveShortcuts({ ...DEFAULT_SETTINGS, shortcutProfile: "custom", customShortcuts: normalized });
  for (const a of resolved) for (const b of resolved) {
    if (a.id >= b.id || normalized[a.id] === undefined && normalized[b.id] === undefined) continue;
    // Composer owns keys locally. Bulk reply and individual reply are mutually exclusive.
    if ((a.scope === "composer") !== (b.scope === "composer")) continue;
    if ([a.scope, b.scope].includes("bulk") && [a.scope, b.scope].includes("conversation") && (a.id === "reply" || b.id === "reply")) continue;
    if (a.keys.some((x) => b.keys.some((y) => bindingsOverlap(x, y)))) throw new Error(`“${a.label}” conflicts with “${b.label}”. Change or disable one of them first.`);
  }
  return normalized;
}

function bindingsOverlap(a: string, b: string): boolean {
  const left = a.split(" "), right = b.split(" ");
  return left.slice(0, Math.min(left.length, right.length)).every((step, index) => {
    const keyName = step.split("+").at(-1)!;
    const key = keyName === "plus" ? "+" : keyName === "space" ? " " : keyName;
    for (let mask = 0; mask < 16; mask++) {
      const event = { key, ctrlKey: Boolean(mask & 1), metaKey: Boolean(mask & 2), altKey: Boolean(mask & 4), shiftKey: Boolean(mask & 8) };
      if (matchesBindingStep(event, step) && matchesBindingStep(event, right[index]!)) return true;
    }
    return false;
  });
}
