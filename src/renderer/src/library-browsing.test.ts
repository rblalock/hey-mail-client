import type { KeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ImboxPosting } from "../../shared/contracts";
import { mergeLibraryPostings, navigateLibraryRows } from "./library-browsing";

const posting = (id: string, topicId?: string): ImboxPosting => ({ id, topicId, subject: id, sender: { name: "Example" }, contacts: [], summary: "", seen: true, createdAt: "", visibleEntryCount: 1 });

describe("Library page merging", () => {
  it("deduplicates threads across pages while retaining their first position", () => {
    const current = [posting("1", "10"), posting("2", "20")];
    const next = [posting("3", "10"), posting("4", "40")];
    expect(mergeLibraryPostings(current, next).map((p) => p.id)).toEqual(["3", "2", "4"]);
    expect(current.map((p) => p.id)).toEqual(["1", "2"]);
  });
  it("falls back to posting IDs when no thread ID was returned", () => {
    expect(mergeLibraryPostings([posting("1")], [posting("1"), posting("2")])).toHaveLength(2);
  });
});

describe("local Library keyboard navigation", () => {
  function fixture(key: string, index = 0, editable = false) {
    const rows = Array.from({ length: 3 }, () => ({ focus: vi.fn(), contains: () => false, closest: () => editable ? {} : null }));
    const event = { key, target: rows[index], currentTarget: { querySelectorAll: () => rows }, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    return { rows, event, run: () => navigateLibraryRows(event as unknown as KeyboardEvent<HTMLElement>) };
  }
  it.each(["ArrowDown", "j"])("%s moves focus to the next actual row", (key) => {
    const { rows, event, run } = fixture(key); run();
    expect(rows[1]!.focus).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });
  it.each(["ArrowUp", "k"])("%s moves focus to the previous actual row", (key) => {
    const { rows, run } = fixture(key, 2); run();
    expect(rows[1]!.focus).toHaveBeenCalledOnce();
  });
  it("clamps navigation at the last row", () => {
    const { rows, run } = fixture("ArrowDown", 2); run();
    expect(rows[2]!.focus).toHaveBeenCalledOnce();
  });
  it("does not intercept typing or native Enter activation", () => {
    for (const [key, editable] of [["j", true], ["Enter", false]] as const) {
      const { rows, event, run } = fixture(key, 0, editable); run();
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(rows.every((row) => row.focus.mock.calls.length === 0)).toBe(true);
    }
  });
});
