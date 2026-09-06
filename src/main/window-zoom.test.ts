import { describe, expect, it, vi } from "vitest";
import type { Input, WebContents } from "electron";
import { installWindowZoom, nextZoomFactor, zoomAction } from "./window-zoom";

const input = (key: string, overrides: Partial<Input> = {}): Input => ({ type: "keyDown", key, code: "", isAutoRepeat: false, isComposing: false, shift: false, control: true, alt: false, meta: false, location: 0, modifiers: [], ...overrides });

describe("window zoom", () => {
  it.each(["+", "=", "Add"])("accepts Ctrl+%s and the shifted plus-key variant", (key) => {
    expect(zoomAction(input(key))).toBe("in");
    expect(zoomAction(input(key, { shift: true }))).toBe("in");
  });
  it("accepts zoom out/reset and Cmd equivalents", () => {
    expect(zoomAction(input("-"))).toBe("out");
    expect(zoomAction(input("Subtract"))).toBe("out");
    expect(zoomAction(input("0"))).toBe("reset");
    expect(zoomAction(input("+", { control: false, meta: true }))).toBe("in");
  });
  it("leaves typing, other modifiers, composition, and key-up alone", () => {
    for (const candidate of [input("+", { control: false }), input("+", { alt: true }), input("+", { isComposing: true }), input("+", { type: "keyUp" }), input("-", { shift: true }), input("0", { shift: true }), input("k")]) {
      expect(zoomAction(candidate)).toBeUndefined();
    }
  });
  it("enlarges beyond 100% to 300% and can shrink/reset from there", () => {
    let factor = 1;
    for (let index = 0; index < 20; index++) factor = nextZoomFactor(factor, "in");
    expect(factor).toBe(3);
    expect(nextZoomFactor(factor, "out")).toBe(2.5);
    expect(nextZoomFactor(factor, "reset")).toBe(1);
    for (let index = 0; index < 20; index++) factor = nextZoomFactor(factor, "out");
    expect(factor).toBe(0.5);
    expect(nextZoomFactor(1.249999999, "out")).toBe(1.1);
    expect(nextZoomFactor(1.250000001, "in")).toBe(1.5);
  });
  it("consumes the native shortcut once before renderer/menu dispatch", () => {
    let handler!: (event: { preventDefault: () => void }, input: Input) => void;
    const setZoomFactor = vi.fn();
    const contents = { on: (_: string, listener: typeof handler) => { handler = listener; }, getZoomFactor: () => 1, setZoomFactor };
    installWindowZoom(contents as unknown as WebContents);
    const event = { preventDefault: vi.fn() };
    handler(event, input("+", { shift: true }));
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(setZoomFactor).toHaveBeenCalledExactlyOnceWith(1.1);
    handler(event, input("k"));
    expect(setZoomFactor).toHaveBeenCalledOnce();
  });
});
