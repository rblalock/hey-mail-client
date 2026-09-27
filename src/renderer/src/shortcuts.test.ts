import { describe, expect, it } from "vitest";
import { completesShortcutChord, DEFAULT_SETTINGS, matchesShortcut, resolveShortcuts, SHORTCUTS, startsShortcutChord, validateCustomShortcuts, type ShortcutDefinition } from "./shortcuts";

function keyboard(key: string, overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...overrides } as KeyboardEvent;
}

describe("mail shortcut registry", () => {
  it("registers trash Undo for both command modifiers, but not redo or key repeat", () => {
    const undo = SHORTCUTS.find((item) => item.id === "undo-trash")!;
    expect(undo).toMatchObject({ display: "Ctrl+Z", scope: "global" });
    expect(matchesShortcut(keyboard("z", { ctrlKey: true }), undo)).toBe(true);
    expect(matchesShortcut(keyboard("z", { metaKey: true }), undo)).toBe(true);
    expect(matchesShortcut(keyboard("z", { ctrlKey: true, shiftKey: true }), undo)).toBe(false);
    expect(matchesShortcut(keyboard("z", { ctrlKey: true, repeat: true }), undo)).toBe(false);
  });
  it("matches platform command, navigation, and triage keys", () => {
    expect(matchesShortcut(keyboard("k", { ctrlKey: true }), SHORTCUTS.find((item) => item.id === "commands")!)).toBe(true);
    expect(matchesShortcut(keyboard("j"), SHORTCUTS.find((item) => item.id === "next")!)).toBe(true);
    expect(matchesShortcut(keyboard("#", { shiftKey: true }), SHORTCUTS.find((item) => item.id === "trash")!)).toBe(true);
  });

  it("does not trigger single-key commands through modified keystrokes", () => {
    expect(matchesShortcut(keyboard("c", { ctrlKey: true }), SHORTCUTS.find((item) => item.id === "compose")!)).toBe(false);
  });

  it("provides distinct global shortcuts for the primary and agent sidebars", () => {
    const navigation = SHORTCUTS.find((item) => item.id === "toggle-navigation")!;
    const agent = SHORTCUTS.find((item) => item.id === "toggle-agent")!;

    expect(navigation).toMatchObject({ display: "Ctrl+B", scope: "global" });
    expect(agent).toMatchObject({ display: "Ctrl+Shift+B", scope: "global" });
    expect(matchesShortcut(keyboard("b", { ctrlKey: true }), navigation)).toBe(true);
    expect(matchesShortcut(keyboard("b", { ctrlKey: true, shiftKey: true }), agent)).toBe(true);
    expect(matchesShortcut(keyboard("b", { ctrlKey: true, shiftKey: true }), navigation)).toBe(false);
  });

  it("uses E for HEY's seen action rather than inventing Archive", () => {
    expect(SHORTCUTS.find((item) => item.id === "seen")).toMatchObject({ label: "Mark seen", display: "E" });
    expect(SHORTCUTS.some((item) => item.label.toLowerCase().includes("archive"))).toBe(false);
  });

  it("exposes actions on a highlighted conversation before the reader opens", () => {
    expect(SHORTCUTS.find((item) => item.id === "forward")?.scope).toBe("conversation");
    expect(SHORTCUTS.find((item) => item.id === "back")?.scope).toBe("reader");
  });

  it("uses HEY's O shortcut for Read Together while bulk selection is active", () => {
    expect(SHORTCUTS.find((item) => item.id === "read-together")).toMatchObject({ label: "Read Together", display: "O", scope: "bulk" });
    expect(matchesShortcut(keyboard("o"), SHORTCUTS.find((item) => item.id === "read-together")!)).toBe(true);
  });

  it("uses HEY's bulk organization shortcuts", () => {
    expect(SHORTCUTS.find((item) => item.id === "bulk-label")).toMatchObject({ display: "B", scope: "bulk" });
    expect(SHORTCUTS.find((item) => item.id === "bulk-collection")).toMatchObject({ display: "N", scope: "bulk" });
  });

  it("supports HEY numeric navigation and Superhuman G chords", () => {
    expect(matchesShortcut(keyboard("1"), SHORTCUTS.find((item) => item.id === "nav-imbox")!)).toBe(true);
    const superhuman = resolveShortcuts({ ...DEFAULT_SETTINGS, shortcutProfile: "superhuman" });
    const imbox = superhuman.find((item) => item.id === "nav-imbox")!;
    expect(startsShortcutChord(keyboard("g"), imbox)).toBe(true);
    expect(completesShortcutChord("g", keyboard("i"), imbox)).toBe(true);
  });

  it.each(["hey", "superhuman"] as const)("registers split cycling separately from session cycling for %s", (shortcutProfile) => {
    const shortcuts = resolveShortcuts({ ...DEFAULT_SETTINGS, shortcutProfile });
    const next = shortcuts.find((item) => item.id === "split-next")!;
    const previous = shortcuts.find((item) => item.id === "split-previous")!;
    expect(next).toMatchObject({ display: "Tab", scope: "mailbox" });
    expect(previous).toMatchObject({ display: "Shift+Tab", scope: "mailbox" });
    expect(matchesShortcut(keyboard("Tab"), next)).toBe(true);
    expect(matchesShortcut(keyboard("Tab", { shiftKey: true }), previous)).toBe(true);
    expect(matchesShortcut(keyboard("Tab", { shiftKey: true }), next)).toBe(false);
    expect(matchesShortcut(keyboard("Tab", { ctrlKey: true }), next)).toBe(false);
    expect(matchesShortcut(keyboard("Tab", { ctrlKey: true, shiftKey: true }), previous)).toBe(false);
    expect(matchesShortcut(keyboard("Tab", { repeat: true }), next)).toBe(false);
  });

  it("makes split setup discoverable without assigning ordinary typing shortcuts", () => {
    for (const id of ["split-create", "split-manage", "split-create-person", "split-create-domain"]) {
      expect(SHORTCUTS.find((item) => item.id === id)).toMatchObject({ keys: [], display: "" });
    }
    expect(SHORTCUTS.find((item) => item.id === "split-create-person")?.scope).toBe("conversation");
    expect(SHORTCUTS.find((item) => item.id === "split-create-domain")?.scope).toBe("conversation");
    const dynamic: ShortcutDefinition = { id: "split-go:work", label: "Go to Work split", keys: [], display: "", scope: "mailbox" };
    expect(matchesShortcut(keyboard("Tab"), dynamic)).toBe(false);
  });

  it("respects custom split aliases, disabling Tab, and conflict validation", () => {
    const customShortcuts = validateCustomShortcuts({ "split-next": ["Alt+ArrowRight"], "split-previous": [], "split-create": ["g x"] });
    const shortcuts = resolveShortcuts({ ...DEFAULT_SETTINGS, shortcutProfile: "custom", customShortcuts });
    const next = shortcuts.find((item) => item.id === "split-next")!;
    expect(matchesShortcut(keyboard("Tab"), next)).toBe(false);
    expect(matchesShortcut(keyboard("ArrowRight", { altKey: true }), next)).toBe(true);
    expect(shortcuts.find((item) => item.id === "split-previous")?.keys).toEqual([]);
    expect(() => validateCustomShortcuts({ "split-next": ["j"] })).toThrow(/conflicts/);
    expect(() => validateCustomShortcuts({ "split-next": ["ctrl+tab"] })).toThrow(/conflicts/);
  });
});
