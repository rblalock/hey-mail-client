import { describe, expect, it } from "vitest";
import { isDialogKeyboardEvent, isEditableTarget, isEditingEvent, isLocalKeyboardEvent, isNativeEditingBinding, isNativeEditingShortcut } from "./keyboard-scope";
import { isShortcutEvent, matchesBindingStep } from "./shortcut-binding";
import { validateCustomShortcuts } from "./shortcuts";

const key = (key: string, flags = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...flags });
// Deliberately not instanceof HTMLElement: email frames have their own realm.
function element(tagName = "DIV", attributes: Record<string, string> = {}) {
  const node = { nodeType: 1, tagName, ownerDocument: { activeElement: null as unknown },
    getAttribute: (name: string) => attributes[name] ?? null,
    closest: (selector: string): unknown => Object.entries(attributes).some(([name, value]) => selector.includes(`[${name}="${value}"]`) || selector.includes(`[${name}]`)) ? node : null,
  };
  return node as unknown as HTMLElement;
}

describe("keyboard ownership", () => {
  it.each(["INPUT", "TEXTAREA", "SELECT"])("recognizes %s across document realms", (tag) => {
    expect(isEditableTarget(element(tag))).toBe(true);
  });
  it("recognizes contenteditable, text nodes, and accessible editor roles", () => {
    const cases: Record<string, string>[] = [{ contenteditable: "" }, { contenteditable: "plaintext-only" }, { role: "textbox" }, { role: "searchbox" }, { role: "combobox" }];
    for (const attributes of cases) {
      expect(isEditableTarget(element("DIV", attributes))).toBe(true);
    }
    expect(isEditableTarget({ nodeType: 3, parentElement: element("TEXTAREA") } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget(element("DIV", { contenteditable: "false" }))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
  it("finds a retargeted shadow editor and stops guarding after focus leaves", () => {
    const host = element();
    const editor = element("TEXTAREA");
    expect(isEditingEvent({ target: host, composedPath: () => [editor, host] })).toBe(true);
    Object.assign(host.ownerDocument, { activeElement: { shadowRoot: { activeElement: editor } } });
    expect(isEditingEvent({ target: host })).toBe(true);
    Object.assign(host.ownerDocument, { activeElement: host });
    expect(isEditingEvent({ target: host })).toBe(false);
  });
  it("keeps editor toolbars local without treating the chat composer as a modal", () => {
    const toolbar = element("BUTTON", { "data-keyboard-scope": "editor" });
    expect(isLocalKeyboardEvent({ target: toolbar })).toBe(true);
    expect(isDialogKeyboardEvent({ target: toolbar })).toBe(false);
    expect(isDialogKeyboardEvent({ target: element("DIV", { role: "dialog" }) })).toBe(true);
    expect(isLocalKeyboardEvent({ target: element("BUTTON") })).toBe(false);
  });
  it.each(["a", "c", "x", "v", "z", "y", "b", "i", "u", "ArrowLeft", "Backspace"])("protects native Ctrl/Meta+%s", (name) => {
    expect(isNativeEditingShortcut(key(name, { ctrlKey: true }))).toBe(true);
    expect(isNativeEditingShortcut(key(name, { metaKey: true }))).toBe(true);
    expect(isNativeEditingShortcut(key(name))).toBe(false);
  });
  it("preserves deliberate composer shortcuts, but protects redo and plain paste", () => {
    for (const binding of ["mod+enter", "ctrl+s", "mod+shift+c", "mod+shift+b", "mod+shift+a", "ctrl+k"]) expect(isNativeEditingBinding(binding)).toBe(false);
    for (const binding of ["ctrl+shift+z", "mod+shift+v", "meta+a"]) expect(isNativeEditingBinding(binding)).toBe(true);
  });
  it("rejects custom composer bindings that would steal native editing", () => {
    for (const binding of ["ctrl+a", "meta+c", "mod+v", "ctrl+z", "ctrl+shift+z"]) expect(() => validateCustomShortcuts({ "composer-send": [binding] })).toThrow(/reserved for text editing/);
  });
  it("never turns select-all or AltGraph into a plain A command", () => {
    expect(matchesBindingStep(key("a", { ctrlKey: true }), "a")).toBe(false);
    expect(matchesBindingStep(key("a", { metaKey: true }), "a")).toBe(false);
    expect(matchesBindingStep(key("a"), "a")).toBe(true);
    expect(isShortcutEvent(key("a", { getModifierState: (modifier: string) => modifier === "AltGraph" }))).toBe(false);
  });
});
