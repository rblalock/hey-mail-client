import { describe, expect, it } from "vitest";
import { iframeAnchorRect } from "./EmailObjectPreviewBridge";

describe("email object preview bridge", () => {
  it("translates iframe link bounds into the app viewport", () => {
    expect(iframeAnchorRect(
      { left: 100, top: 200, right: 700, bottom: 800, width: 600 },
      { left: 20, top: 30, right: 120, bottom: 50, width: 100 },
    )).toEqual({ left: 120, top: 230, right: 220, bottom: 250, width: 100 });
  });
});
