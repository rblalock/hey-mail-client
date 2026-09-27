import { describe, expect, it } from "vitest";
import { canNavigateSplits, isSplitNavigationCommand } from "./split-keyboard";

// Structural DOM nodes intentionally avoid instanceof checks, as shadow editors
// and email frames do not share the main window's element constructor.
function element(tagName = "DIV", attributes: Record<string, string> = {}, parent?: HTMLElement): HTMLElement {
  const node = {
    nodeType: 1, tagName, parentElement: parent,
    ownerDocument: parent?.ownerDocument ?? { activeElement: null },
    getAttribute: (name: string) => attributes[name] ?? null,
    hasAttribute: (name: string) => name in attributes,
    matches(selector: string): boolean {
      return selector.split(",").some((part) => {
        const tag = part.trim().match(/^[a-z]+/i)?.[0];
        if (tag && tag.toUpperCase() !== tagName) return false;
        const checks = [...part.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
        return checks.every(([, name, value]) => name! in attributes && (value === undefined || attributes[name!] === value));
      });
    },
    closest(selector: string): Element | null {
      return node.matches(selector) ? node as unknown as Element : parent?.closest(selector) ?? null;
    },
  };
  return node as unknown as HTMLElement;
}

function keyboard(target: EventTarget | null, overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key: "Tab", target, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, ...overrides } as KeyboardEvent;
}

function mailbox() {
  const surface = element("DIV", { "data-split-navigation": "surface", tabindex: "-1", role: "listbox" });
  const row = element("BUTTON", { role: "option", "data-posting-id": "1" }, surface);
  return { surface, row };
}

describe("split keyboard ownership", () => {
  it("allows cycling from mailbox rows, row descendants and the mailbox surface", () => {
    const { surface, row } = mailbox();
    for (const target of [surface, row, element("SPAN", {}, row)]) {
      expect(canNavigateSplits(keyboard(target), true)).toBe(true);
      expect(canNavigateSplits(keyboard(target, { shiftKey: true }), true)).toBe(true);
    }
  });

  it("allows cycling from an actual split tab, but not its neighboring controls", () => {
    const tab = element("BUTTON", { "data-split-navigation": "tab", role: "tab", tabindex: "0" });
    expect(canNavigateSplits(keyboard(tab), true)).toBe(true);
    expect(canNavigateSplits(keyboard(element("SPAN", {}, tab)), true)).toBe(true);
    expect(canNavigateSplits(keyboard(element("BUTTON", { "aria-label": "Manage splits" })), true)).toBe(false);
  });

  it("leaves controls inside the mailbox available for normal Tab navigation", () => {
    const { surface, row } = mailbox();
    const controls: [string, Record<string, string>][] = [
      ["BUTTON", {}], ["A", { href: "#" }], ["INPUT", {}], ["TEXTAREA", {}], ["SELECT", {}],
      ["SUMMARY", {}], ["IFRAME", {}], ["DIV", { role: "checkbox" }], ["DIV", { role: "slider" }],
      ["DIV", { role: "switch" }], ["DIV", { role: "button" }], ["DIV", { tabindex: "0" }],
    ];
    for (const [tag, attrs] of controls) {
      expect(canNavigateSplits(keyboard(element(tag, attrs, surface)), true)).toBe(false);
    }
    expect(canNavigateSplits(keyboard(element("A", { href: "#" }, row)), true)).toBe(false);
  });

  it("never handles editing, editor toolbars, dialogs or hidden mailboxes", () => {
    const contexts: Record<string, string>[] = [
      { contenteditable: "true" }, { contenteditable: "plaintext-only" }, { role: "textbox" },
      { role: "searchbox" }, { "data-keyboard-scope": "editor" }, { role: "dialog" }, { role: "alertdialog" },
      { hidden: "" }, { inert: "" }, { "aria-hidden": "true" }, { "data-helper-controls": "" },
    ];
    for (const attrs of contexts) {
      const context = element("DIV", attrs);
      const surface = element("DIV", { "data-split-navigation": "surface" }, context);
      expect(canNavigateSplits(keyboard(surface), true)).toBe(false);
    }
    const dialog = element("DIALOG", { open: "" });
    expect(canNavigateSplits(keyboard(element("DIV", { "data-split-navigation": "surface" }, dialog)), true)).toBe(false);
  });

  it("rejects retargeted shadow editors and focus belonging to another control", () => {
    const { surface } = mailbox();
    const editor = element("TEXTAREA");
    expect(canNavigateSplits(keyboard(surface, { composedPath: () => [editor, surface] }), true)).toBe(false);
    Object.assign(surface.ownerDocument, { activeElement: { shadowRoot: { activeElement: editor } } });
    expect(canNavigateSplits(keyboard(surface), true)).toBe(false);
    Object.assign(surface.ownerDocument, { activeElement: element("BUTTON") });
    expect(canNavigateSplits(keyboard(surface), true)).toBe(false);
    Object.assign(surface.ownerDocument, { activeElement: surface });
    expect(canNavigateSplits(keyboard(surface), true)).toBe(true);
  });

  it("does not navigate outside a split mailbox or during composition/repeated Tab", () => {
    const { row } = mailbox();
    expect(canNavigateSplits(keyboard(row), false)).toBe(false);
    expect(canNavigateSplits(keyboard(element("BODY")), true)).toBe(false);
    expect(canNavigateSplits(keyboard(null), true)).toBe(false);
    for (const overrides of [{ defaultPrevented: true }, { isComposing: true }, { keyCode: 229 }, { repeat: true }]) {
      expect(canNavigateSplits(keyboard(row, overrides), true)).toBe(false);
    }
  });

  it("guards custom keys and chord steps using the same ownership rule", () => {
    const { row } = mailbox();
    expect(canNavigateSplits(keyboard(row, { key: "ArrowRight", altKey: true }), true)).toBe(true);
    expect(canNavigateSplits(keyboard(element("TEXTAREA"), { key: "ArrowRight", altKey: true }), true)).toBe(false);
    expect(isSplitNavigationCommand("split-next")).toBe(true);
    expect(isSplitNavigationCommand("split-previous")).toBe(true);
    expect(isSplitNavigationCommand("session-next")).toBe(false);
    expect(isSplitNavigationCommand("split-go:work")).toBe(false);
  });
});
