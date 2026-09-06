import { describe, expect, it } from "vitest";
import { matchesBindingStep, normalizeBinding, normalizeBindings } from "./shortcut-binding";
import { DEFAULT_SETTINGS, completesShortcutChord, matchesShortcut, resolveShortcuts, validateCustomShortcuts } from "./shortcuts";
const key = (key: string, flags = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...flags });

describe("shortcut input and dispatch", () => {
  it("allows held movement and range selection, never repeated actions or IME", () => {
    const definitions = resolveShortcuts();
    for (const [id, event] of [["next", key("j", { repeat: true })], ["previous", key("ArrowUp", { repeat: true })], ["select-next", key("J", { shiftKey: true, repeat: true })]] as const) expect(matchesShortcut(event as KeyboardEvent, definitions.find((d) => d.id === id)!)).toBe(true);
    for (const id of ["select", "trash", "composer-send", "focus-agent"]) {
      const definition = definitions.find((d) => d.id === id)!;
      expect(matchesShortcut(key(id === "select" ? "x" : id === "trash" ? "t" : "Enter", { ctrlKey: id === "composer-send", repeat: true }) as KeyboardEvent, definition)).toBe(false);
    }
    expect(matchesShortcut(key("j", { repeat: true, isComposing: true }) as KeyboardEvent, definitions.find((d) => d.id === "next")!)).toBe(false);
  });
  it.each([[" Ctrl + Shift + K ", "ctrl+shift+k"], ["g ,", "g ,"], ["g comma", "g ,"], ["Esc", "escape"], ["Command+K", "meta+k"], ["Ctrl+plus", "ctrl+plus"]])("normalizes %s", (input, expected) => expect(normalizeBinding(input)).toBe(expected));
  it.each(["banana", "hyper+k", "ctrl++k", "g i x", "ctrl+ctrl+k", "mod+ctrl+k", "", "a\nb"])("rejects %s", (input) => expect(() => normalizeBinding(input)).toThrow());
  it("rejects malformed alias arrays and excessive aliases", () => {
    expect(() => normalizeBindings([1])).toThrow();
    expect(() => normalizeBindings(["a", "b", "c", "d", "e", "f"])).toThrow();
    expect(normalizeBindings(["Ctrl+k", "ctrl + k"])).toEqual(["ctrl+k"]);
  });
  it("does not turn unknown modifiers into unmodified shortcuts", () => {
    expect(matchesBindingStep(key("k"), "hyper+k")).toBe(false);
    expect(matchesBindingStep(key("k"), "cmd+k")).toBe(false);
    expect(matchesBindingStep(key("k", { metaKey: true }), "cmd+k")).toBe(true);
  });
  it("rejects repeats, IME, and extra modifiers", () => {
    for (const flags of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }, { shiftKey: true }, { altKey: true }, { metaKey: true }]) expect(matchesBindingStep(key("Enter", { ctrlKey: true, ...flags }), "ctrl+enter")).toBe(false);
    expect(matchesBindingStep(key("Enter", { ctrlKey: true }), "ctrl+enter")).toBe(true);
  });
  it("never completes malformed three-step chords after two steps", () => {
    expect(completesShortcutChord("g", key("i") as KeyboardEvent, { id: "nav-imbox", label: "Imbox", scope: "global", display: "", keys: ["g i x"] })).toBe(false);
  });
  it("rejects collisions and single-step/chord ambiguity", () => {
    expect(() => validateCustomShortcuts({ compose: ["x"] })).toThrow(/Select conversation/);
    expect(() => validateCustomShortcuts({ commands: ["ctrl+b"] })).toThrow(/conflicts/);
    expect(() => validateCustomShortcuts({ commands: ["meta+b"] })).toThrow(/conflicts/);
    expect(() => validateCustomShortcuts({ compose: ["shift+#"] })).toThrow(/conflicts/);
    expect(() => validateCustomShortcuts({ compose: ["ctrl+q"] })).toThrow(/reserved/);
    expect(() => validateCustomShortcuts({ compose: ["ctrl+shift+r"] })).toThrow(/reserved/);
    expect(() => validateCustomShortcuts({ compose: ["g"] })).toThrow(/conflicts/);
    expect(() => validateCustomShortcuts({ "composer-send": ["ctrl+s"] })).toThrow(/conflicts/);
    expect(() => validateCustomShortcuts({ "composer-send": ["s"] })).toThrow(/ordinary typing/);
  });
  it("supports explicit disabling and context-local composer keys", () => {
    const customShortcuts = validateCustomShortcuts({ compose: [], "composer-write": ["ctrl+k"] });
    const resolved = resolveShortcuts({ ...DEFAULT_SETTINGS, shortcutProfile: "custom", customShortcuts });
    expect(resolved.find((item) => item.id === "compose")?.keys).toEqual([]);
    expect(resolved.find((item) => item.id === "commands")?.display).toBe("Ctrl+K");
  });
});
