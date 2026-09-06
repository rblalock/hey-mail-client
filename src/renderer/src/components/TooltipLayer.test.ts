import { describe, expect, it } from "vitest";
import { tooltipPosition } from "./TooltipLayer";
describe("tooltip placement", () => {
  it("flips above the bottom edge and clamps long hints into the viewport", () => {
    expect(tooltipPosition({ left: 280, right: 300, top: 280, bottom: 300, width: 20, height: 20 }, 200, 50, 320, 320, "bottom")).toEqual({ left: 112, top: 222 });
  });
  it("keeps top and left edge hints visible", () => {
    const position = tooltipPosition({ left: 0, right: 20, top: 0, bottom: 20, width: 20, height: 20 }, 200, 50, 320, 320, "left");
    expect(position).toEqual({ left: 28, top: 8 });
  });
});
