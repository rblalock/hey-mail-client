import { describe, expect, it } from "vitest";
import type { ImboxPosting, ImboxResult, MailboxKey, MailMutationRequest } from "../../shared/contracts";
import { applyOptimisticMailMutation, nextPostingInSequence, type MailboxCache } from "./optimistic-mail";

function posting(id: string, seen: boolean): ImboxPosting {
  return {
    id,
    topicId: `topic-${id}`,
    subject: `Conversation ${id}`,
    summary: "Synthetic mail",
    seen,
    createdAt: "2026-09-01T12:00:00Z",
    contacts: [],
    sender: { name: `Sender ${id}` },
    visibleEntryCount: 1,
  };
}

function mailbox(boxKey: MailboxKey, postings: ImboxPosting[]): ImboxResult {
  return { status: "ready", boxKey, boxName: boxKey, postings };
}

function update(cache: MailboxCache, request: MailMutationRequest, cursor = "2") {
  return applyOptimisticMailMutation(cache, "imbox", cursor, request);
}

describe("optimistic mail mutations", () => {
  it("chooses only the following conversation for reader triage", () => {
    const postings = [posting("1", false), posting("2", false), posting("3", true)];
    expect(nextPostingInSequence(postings, "1")?.id).toBe("2");
    expect(nextPostingInSequence(postings, "3")).toBeUndefined();
  });

  it("marks matching conversations seen immediately without removing them", () => {
    const cache = { imbox: mailbox("imbox", [posting("1", false), posting("2", false)]) };
    const result = update(cache, { operation: "seen", postingIds: ["2"] });

    expect(result.mailboxes.imbox?.postings.map((item) => [item.id, item.seen])).toEqual([["1", false], ["2", true]]);
    expect(result.removedFromActiveMailbox).toBe(false);
    expect(cache.imbox.postings[1]?.seen).toBe(false);
  });

  it("marks matching conversations unseen across cached mailboxes", () => {
    const shared = posting("2", true);
    const cache = {
      imbox: mailbox("imbox", [posting("1", false), shared]),
      laterbox: mailbox("laterbox", [shared]),
    };
    const result = update(cache, { operation: "unseen", postingIds: ["2"] });

    expect(result.mailboxes.imbox?.postings[1]?.seen).toBe(false);
    expect(result.mailboxes.laterbox?.postings[0]?.seen).toBe(false);
  });

  it("removes moved conversations immediately and advances the cursor", () => {
    const cache = { imbox: mailbox("imbox", [posting("1", false), posting("2", false), posting("3", false)]) };
    const result = update(cache, { operation: "move", postingIds: ["2"], sourceBox: "imbox", destination: "laterbox" });

    expect(result.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["1", "3"]);
    expect(result.nextCursor).toBe("3");
    expect(result.removedFromActiveMailbox).toBe(true);
  });

  it.each([
    { operation: "bubble", postingIds: ["2"], sourceBox: "imbox", bubbleSchedule: "tomorrow" },
    { operation: "trash", postingIds: ["2"], sourceBox: "imbox" },
    { operation: "spam", postingIds: ["2"], sourceBox: "imbox" },
  ] satisfies MailMutationRequest[])("removes $operation actions from the source mailbox immediately", (request) => {
    const cache = { imbox: mailbox("imbox", [posting("1", false), posting("2", false)]) };
    const result = update(cache, request);

    expect(result.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["1"]);
    expect(result.nextCursor).toBe("1");
  });

  it("keeps an item in place when its destination is already the active box", () => {
    const cache = { imbox: mailbox("imbox", [posting("1", false), posting("2", false)]) };
    const result = update(cache, { operation: "move", postingIds: ["2"], sourceBox: "imbox", destination: "imbox" });

    expect(result.mailboxes).toBe(cache);
    expect(result.nextCursor).toBeUndefined();
    expect(result.removedFromActiveMailbox).toBe(false);
  });
});
