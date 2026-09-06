import { describe, expect, it, vi } from "vitest";
import { dismissObjectPreviewOnEscape } from "./AgentObjectPreview";

describe("AgentObjectPreview keyboard behavior", () => {
  it("consumes Escape before the app beneath the preview can handle it", () => {
    const preventDefault = vi.fn();
    const stopImmediatePropagation = vi.fn();
    const close = vi.fn();

    expect(dismissObjectPreviewOnEscape({ key: "Escape", preventDefault, stopImmediatePropagation }, close)).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("leaves unrelated keys for the application", () => {
    const preventDefault = vi.fn();
    const stopImmediatePropagation = vi.fn();
    const close = vi.fn();

    expect(dismissObjectPreviewOnEscape({ key: "ArrowDown", preventDefault, stopImmediatePropagation }, close)).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(stopImmediatePropagation).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
