import { describe, expect, it } from "vitest";
import { completesShortcutChord, DEFAULT_SETTINGS, matchesShortcut, resolveShortcuts, SHORTCUTS, startsShortcutChord } from "./shortcuts";

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
});
