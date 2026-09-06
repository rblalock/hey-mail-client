import { describe, expect, it } from "vitest";
import { readerScrollIntent } from "./reader-scroll";

describe("readerScrollIntent", () => {
  it("moves by a readable page while preserving overlap", () => {
    expect(readerScrollIntent("PageDown", false, 1_000, 4_000)).toEqual({ kind: "by", top: 850 });
    expect(readerScrollIntent("PageUp", false, 1_000, 4_000)).toEqual({ kind: "by", top: -850 });
  });

  it("supports arrows, shifted space, and document edges", () => {
    expect(readerScrollIntent("ArrowDown", false, 600, 2_500)).toEqual({ kind: "by", top: 52 });
    expect(readerScrollIntent(" ", true, 600, 2_500)).toEqual({ kind: "by", top: -510 });
    expect(readerScrollIntent("Home", false, 600, 2_500)).toEqual({ kind: "to", top: 0 });
    expect(readerScrollIntent("End", false, 600, 2_500)).toEqual({ kind: "to", top: 2_500 });
  });
});
