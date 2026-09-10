import { describe, expect, it, vi } from "vitest";
import { activateMailRow } from "./mail-row-keyboard";

const key = (overrides = {}) => ({ key: "Enter", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...overrides });

describe("explicit mail-row activation", () => {
  it("opens on keydown without a browser-generated click and consumes activation", () => {
    const event = key();
    const open = vi.fn();
    expect(activateMailRow(event, open)).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });
  it("opens the current row callback after switching rows, not a stale highlighted ID", () => {
    const open = vi.fn();
    for (const id of ["one", "two", "three"]) activateMailRow(key(), () => open(id));
    expect(open.mock.calls).toEqual([["one"], ["two"], ["three"]]);
  });
  it("consumes repeated Enter without opening again", () => {
    const event = key({ repeat: true });
    const open = vi.fn();
    expect(activateMailRow(event, open)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  });
  it("respects composition, cancelled events, modifiers and unrelated keys", () => {
    for (const overrides of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }, { ctrlKey: true }, { key: "ArrowDown" }]) {
      const event = key(overrides);
      const open = vi.fn();
      expect(activateMailRow(event, open)).toBe(false);
      expect(open).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
  });
  it("supports a custom open key without stealing chord prefixes", () => {
    const open = vi.fn();
    expect(activateMailRow(key({ key: "o" }), open, ["o"])).toBe(true);
    expect(activateMailRow(key({ key: "g" }), open, ["g o"])).toBe(false);
    expect(open).toHaveBeenCalledOnce();
  });
});
