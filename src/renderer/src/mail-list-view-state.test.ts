import { describe, expect, it } from "vitest";
import { createMailListViewState, SplitHistoryIntent } from "./mail-list-view-state";

describe("split history scroll intent", () => {
  it("does not load history just because a restored or collapsed list has a visible sentinel", () => {
    const intent = new SplitHistoryIntent();
    expect(intent.consume([])).toBe(false);
    expect(intent.consume(["cached"])).toBe(false);
  });

  it("crosses a bounded number of empty pages per gesture, then requires another gesture", () => {
    const intent = new SplitHistoryIntent();
    intent.begin(["head"]);
    for (let i = 0; i < 6; i++) expect(intent.consume(["head"])).toBe(true);
    expect(intent.consume(["head"])).toBe(false);
    intent.begin(["head"]);
    expect(intent.consume(["head"])).toBe(true);
  });

  it("stops when new visible conversations arrive even if another loaded row disappeared", () => {
    const intent = new SplitHistoryIntent();
    intent.begin(["old"]);
    expect(intent.consume(["old"])).toBe(true);
    expect(intent.consume(["new"])).toBe(false);
    expect(intent.consume(["new"])).toBe(false);
  });

  it("does not renew an active burst on every scroll event", () => {
    const intent = new SplitHistoryIntent();
    intent.begin([]);
    for (let i = 0; i < 6; i++) {
      intent.begin([]);
      expect(intent.consume([])).toBe(true);
    }
    expect(intent.consume([])).toBe(false);
  });

  it("starts a fresh gesture after matching rows moved the sentinel out of view", () => {
    const intent = new SplitHistoryIntent();
    intent.begin(["head"]);
    expect(intent.consume(["head"])).toBe(true);
    intent.begin(["head", "new"]);
    expect(intent.consume(["head", "new"])).toBe(true);
  });

  it("cancels continuation when the user collapses, searches, pauses, or scrolls back", () => {
    const intent = new SplitHistoryIntent();
    intent.begin([]);
    expect(intent.consume([])).toBe(true);
    intent.cancel();
    expect(intent.consume([])).toBe(false);
  });
});

describe("mail list view state", () => {
  it("starts each account/split view independently", () => {
    const first = createMailListViewState();
    const second = createMailListViewState();
    first.scrollTop = 600;
    first.seenLimit = 75;
    first.highlightedId = "saved";
    first.query = "team";
    expect(second).toEqual({ scrollTop: 0, seenLimit: 25 });
  });
});
