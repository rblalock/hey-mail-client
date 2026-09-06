import { describe, expect, it } from "vitest";
import { navigationPresentation } from "./shell-layout";

describe("navigationPresentation", () => {
  it("preserves the user's navigation preference when space is available", () => {
    expect(navigationPresentation(false, false, false)).toEqual({ collapsed: false, overlay: false });
    expect(navigationPresentation(false, true, false)).toEqual({ collapsed: true, overlay: false });
  });

  it("collapses navigation while the agent uses constrained horizontal space", () => {
    expect(navigationPresentation(true, false, false)).toEqual({ collapsed: true, overlay: false });
    expect(navigationPresentation(true, true, false)).toEqual({ collapsed: true, overlay: false });
  });

  it("expands constrained navigation as an overlay without changing the desktop preference", () => {
    expect(navigationPresentation(true, false, true)).toEqual({ collapsed: false, overlay: true });
    expect(navigationPresentation(true, true, true)).toEqual({ collapsed: false, overlay: true });
  });
});
