import { describe, expect, it } from "vitest";
import type { ImboxPosting } from "../../shared/contracts";
import { extendMailboxSelection, groupImboxPostings, moveMailboxCursor, postingAtCursor } from "./mailbox-navigation";

const postings = ["one", "two", "three"].map((id): ImboxPosting => ({
  id,
  subject: id,
  summary: "",
  seen: true,
  createdAt: "2026-08-28T12:00:00Z",
  contacts: [],
  sender: { name: "Example sender" },
  visibleEntryCount: 1,
}));

describe("Imbox sections", () => {
  const row = (id: string, seen: boolean, bubbledUp?: boolean): ImboxPosting => ({ ...postings[0]!, id, seen, bubbledUp });

  it("keeps returned reminders separate regardless of read status, preserving order in each section", () => {
    const input = [row("old", true), row("new", false), row("bubble", false, true), row("read-bubble", true, true), row("newer", false)];
    const original = structuredClone(input);
    const groups = groupImboxPostings(input);
    expect(groups.bubbledUp.map((posting) => posting.id)).toEqual(["bubble", "read-bubble"]);
    expect(groups.newForYou.map((posting) => posting.id)).toEqual(["new", "newer"]);
    expect(groups.previouslySeen.map((posting) => posting.id)).toEqual(["old"]);
    const visible = [...groups.bubbledUp, ...groups.newForYou, ...groups.previouslySeen];
    expect(new Set(visible.map((posting) => posting.id)).size).toBe(input.length);
    expect(input).toEqual(original);
    expect(moveMailboxCursor(visible, "read-bubble", 1)).toBe("new");
    expect(moveMailboxCursor(visible, "new", -1)).toBe("read-bubble");
    expect(moveMailboxCursor(visible, "newer", 1)).toBe("old");
  });

  it("moves newly read mail to Previously Seen but keeps returned reminders in Bubbled Up", () => {
    const groups = groupImboxPostings([row("new", true), row("bubble", true, true)]);
    expect(groups.newForYou).toEqual([]);
    expect(groups.previouslySeen.map((posting) => posting.id)).toEqual(["new"]);
    expect(groups.bubbledUp.map((posting) => posting.id)).toEqual(["bubble"]);
  });

  it("has no rows in any section for an empty Imbox", () => {
    expect(groupImboxPostings([])).toEqual({ bubbledUp: [], newForYou: [], previouslySeen: [] });
  });
});

describe("mailbox keyboard cursor", () => {
  it("extends and shrinks an anchored range while preserving prior X selections", () => {
    const ids = ["one", "two", "three", "four"];
    const down = extendMailboxSelection(ids, "two", 1, ["four"])!;
    expect(down.selected).toEqual(["four", "two", "three"]);
    const up = extendMailboxSelection(ids, down.edge, -1, down.selected, down.range)!;
    expect(up.selected).toEqual(["four", "two"]);
    const pastAnchor = extendMailboxSelection(ids, up.edge, -1, up.selected, up.range)!;
    expect(pastAnchor.selected).toEqual(["four", "one", "two"]);
    expect(extendMailboxSelection(ids, "one", -1, pastAnchor.selected, pastAnchor.range)?.selected).toEqual(pastAnchor.selected);
  });
  it("uses filtered visual order and resets a range when it changes", () => {
    const first = extendMailboxSelection(["three", "one"], "three", 1, [])!;
    expect(first.selected).toEqual(["three", "one"]);
    expect(extendMailboxSelection(["one", "four"], "one", 1, [], first.range)?.selected).toEqual(["one", "four"]);
    expect(extendMailboxSelection([], undefined, 1, [])).toBeUndefined();
  });
  it("moves independently without choosing a conversation to open", () => {
    expect(moveMailboxCursor(postings, "one", 1)).toBe("two");
    expect(moveMailboxCursor(postings, "two", -1)).toBe("one");
  });

  it("clamps at the list boundaries", () => {
    expect(moveMailboxCursor(postings, "one", -1)).toBe("one");
    expect(moveMailboxCursor(postings, "three", 1)).toBe("three");
  });

  it("opens the highlighted conversation and falls back to the first row", () => {
    expect(postingAtCursor(postings, "two")?.id).toBe("two");
    expect(postingAtCursor(postings, undefined)?.id).toBe("one");
  });
});
