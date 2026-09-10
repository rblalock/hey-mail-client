import { describe, expect, it } from "vitest";
import type { ImboxResult } from "../../shared/contracts";
import { hidePendingTrash } from "./optimistic-mail";

const mailbox: ImboxResult = { status: "ready", boxKey: "imbox", boxName: "Imbox", postings: ["1", "2", "3"].map((id) => ({ id, subject: id, summary: "", createdAt: "2026-09-10T12:00:00Z", seen: false, sender: { name: "Example" }, contacts: [], visibleEntryCount: 1 })) };
describe("pending trash visibility", () => {
  it("hides rapid actions across refreshes without deleting cached rows", () => {
    expect(hidePendingTrash(mailbox, new Set(["1", "2"]))?.postings.map((p) => p.id)).toEqual(["3"]);
    const refreshed = { ...mailbox, postings: mailbox.postings.map((p) => ({ ...p, seen: true })) };
    expect(hidePendingTrash(refreshed, new Set(["1", "2"]))?.postings.map((p) => p.id)).toEqual(["3"]);
    // Cancelling just the latest action keeps the older action hidden and keeps fresh read state.
    expect(hidePendingTrash(refreshed, new Set(["1"]))?.postings.map((p) => [p.id, p.seen])).toEqual([["2", true], ["3", true]]);
    expect(mailbox.postings).toHaveLength(3);
  });
  it("reveals the original list on failure/cancel and handles empty mailboxes", () => {
    expect(hidePendingTrash(mailbox, new Set())).toBe(mailbox);
    expect(hidePendingTrash(undefined, new Set(["1"]))).toBeUndefined();
    expect(hidePendingTrash(mailbox, new Set(["1", "2", "3"]))?.postings).toEqual([]);
  });
});
