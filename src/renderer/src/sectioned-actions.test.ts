import { describe, expect, it } from "vitest";
import type { ImboxPosting, ImboxResult, MailboxKey } from "../../shared/contracts";
import { cursorAfterRemoval, sectionedActionRequests, sectionedDoneRequest } from "./sectioned-actions";

const posting = (id: string, extra: Partial<ImboxPosting> = {}): ImboxPosting => ({ id, topicId: id, subject: id, summary: "", seen: false, createdAt: "2026-09-20T12:00:00Z", sender: { name: "Example" }, contacts: [], visibleEntryCount: 1, ...extra });
const box = (boxKey: MailboxKey, postings: ImboxPosting[]): ImboxResult => ({ status: "ready", boxKey, boxName: boxKey, postings });

describe("sectioned Imbox actions", () => {
  const active = posting("1");
  const later = posting("2", { seen: true });
  const aside = posting("3", { boxGroupId: "42" });
  const bubble = posting("4", { seen: true, bubbledUp: true });
  const mailboxes = { imbox: box("imbox", [active, bubble]), laterbox: box("laterbox", [later]), asidebox: box("asidebox", [aside]) };

  it("snapshots each physical source, read state, due reminder and Set Aside group for Undo", () => {
    expect(sectionedDoneRequest([active, later, aside, bubble], mailboxes)).toEqual({
      operation: "done", postingIds: ["1", "2", "3", "4"], completion: [
        { id: "1", sourceBox: "imbox", seen: false, bubbledUp: false },
        { id: "2", sourceBox: "laterbox", seen: true, bubbledUp: false },
        { id: "3", sourceBox: "asidebox", seen: false, bubbledUp: false, boxGroupId: "42" },
        { id: "4", sourceBox: "imbox", seen: true, bubbledUp: true },
      ],
    });
  });
  it("requires individual conversations for Done", () => {
    expect(sectionedDoneRequest([], mailboxes)).toBeUndefined();
    expect(sectionedDoneRequest([posting("5", { kind: "bundle" })], mailboxes)).toBeUndefined();
    expect(sectionedDoneRequest([posting("5", { topicId: undefined })], mailboxes)).toBeUndefined();
  });
  it("adds a mixed selection to Reply Later without removing items already there", () => {
    expect(sectionedActionRequests("later", [active, later, aside], mailboxes)).toEqual([
      { operation: "move", postingIds: ["1"], sourceBox: "imbox", destination: "laterbox" },
      { operation: "move", postingIds: ["3"], sourceBox: "asidebox", destination: "laterbox" },
    ]);
    expect(sectionedActionRequests("later", [later], mailboxes)).toEqual([
      { operation: "move", postingIds: ["2"], sourceBox: "laterbox", destination: "imbox" },
    ]);
  });
  it("keeps trash source-scoped and uses one consistent read toggle across sections", () => {
    expect(sectionedActionRequests("trash", [active, aside], mailboxes)).toEqual([
      { operation: "trash", postingIds: ["1"], sourceBox: "imbox" },
      { operation: "trash", postingIds: ["3"], sourceBox: "asidebox" },
    ]);
    expect(sectionedActionRequests("unread", [active, later], mailboxes).map((request) => request.operation)).toEqual(["unseen", "unseen"]);
    expect(sectionedActionRequests("unread", [active, aside], mailboxes).map((request) => request.operation)).toEqual(["seen", "seen"]);
  });
  it("chooses the next visible row, then the previous row, never a removed row", () => {
    const rows = [active, later, aside];
    expect(cursorAfterRemoval(rows, "1", new Set(["1", "2"]))).toBe("3");
    expect(cursorAfterRemoval(rows, "3", new Set(["3"]))).toBe("2");
    expect(cursorAfterRemoval(rows, "1", new Set(["1", "2", "3"]))).toBeUndefined();
    expect(cursorAfterRemoval(rows, undefined, new Set())).toBe("1");
  });
});
