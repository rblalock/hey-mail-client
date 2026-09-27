import { describe, expect, it } from "vitest";
import type { ImboxPosting, ImboxResult } from "../../shared/contracts";
import { appendMailboxPage, refreshMailboxHead } from "./mailbox-pages";

const posting = (id: string, seen = true, date = 20): ImboxPosting => ({ id, topicId: id, subject: id, summary: "", seen, createdAt: `2026-09-${date}T12:00:00Z`, sender: { name: "Example" }, contacts: [], visibleEntryCount: 1 });
const page = (postings: ImboxPosting[], nextPage?: string): ImboxResult => ({ status: "ready", boxKey: "imbox", boxName: "Imbox", postings, nextPage });

describe("mailbox page reconciliation", () => {
  it("appends older mail once without overwriting read state or duplicating a topic", () => {
    const first = page([posting("1")], "two");
    const next = page([{ ...posting("2", false), topicId: "1" }, posting("3"), posting("3")]);
    expect(appendMailboxPage(first, next)).toMatchObject({ nextPage: undefined, postings: [posting("1"), posting("3")] });
  });
  it("preserves older loaded history and its cursor while refreshing live mail", () => {
    const first = page([posting("1", false), posting("2"), posting("3", true, 19)], "three");
    const fresh = page([posting("4", false), posting("2")], "two");
    expect(refreshMailboxHead(first, fresh, true)).toMatchObject({ nextPage: "three", postings: [posting("4", false), posting("2"), posting("3", true, 19)] });
  });
  it("does not keep disappeared rows from the refreshed history range", () => {
    const old = page([posting("1", true, 21), posting("2"), posting("3", true, 19)]);
    expect(refreshMailboxHead(old, page([posting("2")], "older"), true).postings.map((p) => p.id)).toEqual(["2", "3"]);
  });
  it("drops stale tail rows when the fresh response contains the complete mailbox", () => {
    expect(refreshMailboxHead(page([posting("1"), posting("2", true, 19)]), page([posting("1")]), true).postings.map((p) => p.id)).toEqual(["1"]);
  });
  it("replaces an unpaged head and never masks an unavailable response", () => {
    const first = page([posting("1")]);
    const fresh = page([posting("2")]);
    expect(refreshMailboxHead(first, fresh, false)).toBe(fresh);
    const failure = { ...fresh, status: "unavailable" as const, detail: "Offline" };
    expect(refreshMailboxHead(first, failure, true)).toBe(failure);
  });
});
