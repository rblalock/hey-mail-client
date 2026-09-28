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
  it.each(["feedbox", "trailbox", "bubblebox"] as const)("completes %s mail in place and restores its read state without moving or reordering it", (sourceBox) => {
    const rows = [posting("1", true), posting("2", false), posting("3", false)];
    const cache = { [sourceBox]: mailbox(sourceBox, rows), imbox: mailbox("imbox", [posting("4", false)]) };
    const request: MailMutationRequest = { operation: "done", postingIds: ["2"], completion: [{ id: "2", sourceBox, seen: false, bubbledUp: false }] };
    const result = applyOptimisticMailMutation(cache, sourceBox, "2", request);
    expect(result.mailboxes[sourceBox]?.postings.map((row) => [row.id, row.seen])).toEqual([["1", true], ["2", true], ["3", false]]);
    expect(result.mailboxes.imbox?.postings).toEqual(cache.imbox.postings);
    expect(result.removedFromActiveMailbox).toBe(false);
    expect(rows[1]?.seen).toBe(false);
    const undo = applyOptimisticMailMutation(result.mailboxes, sourceBox, "2", { ...request, operation: "undo-done" });
    expect(undo.mailboxes[sourceBox]?.postings).toEqual(rows.map((row) => row.id === "2" ? { ...row, bubbledUp: false, boxGroupId: undefined } : row));
    expect(undo.mailboxes.imbox?.postings).toEqual(cache.imbox.postings);
  });

  it("completes mixed source selections without moving Feed, Paper Trail, or scheduled reminders into Imbox", () => {
    const sources = ["imbox", "laterbox", "asidebox", "feedbox", "trailbox", "bubblebox"] as const;
    const cache = Object.fromEntries(sources.map((source, index) => [source, mailbox(source, [posting(String(index + 1), false)])]));
    const completion = sources.map((sourceBox, index) => ({ id: String(index + 1), sourceBox, seen: false, bubbledUp: false }));
    const request: MailMutationRequest = { operation: "done", postingIds: completion.map((state) => state.id), completion };
    const done = update(cache, request).mailboxes;
    expect(done.imbox?.postings.map((row) => row.id)).toEqual(["3", "2", "1"]);
    expect(done.laterbox?.postings).toEqual([]);
    expect(done.asidebox?.postings).toEqual([]);
    for (const [source, id] of [["feedbox", "4"], ["trailbox", "5"], ["bubblebox", "6"]] as const) expect(done[source]?.postings).toMatchObject([{ id, seen: true }]);
    const restored = update(done, { ...request, operation: "undo-done" }).mailboxes;
    for (const [index, source] of sources.entries()) expect(restored[source]?.postings).toMatchObject([{ id: String(index + 1), seen: false }]);
  });

  it("finishes kept and resurfaced conversations once, then restores their original state", () => {
    const aside = { ...posting("1", false), boxGroupId: "42" };
    const due = { ...posting("2", true), bubbledUp: true };
    const cache = { imbox: mailbox("imbox", [due]), asidebox: mailbox("asidebox", [aside]), laterbox: mailbox("laterbox", [posting("3", false)]) };
    const completion = [
      { id: "1", sourceBox: "asidebox" as const, seen: false, bubbledUp: false, boxGroupId: "42" },
      { id: "2", sourceBox: "imbox" as const, seen: true, bubbledUp: true },
      { id: "3", sourceBox: "laterbox" as const, seen: false, bubbledUp: false },
    ];
    const request = { operation: "done" as const, postingIds: ["1", "2", "3"], completion };
    const finished = update(cache, request).mailboxes;
    expect(finished.asidebox?.postings).toEqual([]);
    expect(finished.laterbox?.postings).toEqual([]);
    expect(finished.imbox?.postings).toHaveLength(3);
    expect(finished.imbox?.postings.every((row) => row.seen && !row.bubbledUp && !row.boxGroupId)).toBe(true);
    expect(cache.asidebox.postings).toEqual([aside]);
    const restored = update(finished, { ...request, operation: "undo-done" }).mailboxes;
    expect(restored.asidebox?.postings[0]).toMatchObject(aside);
    expect(restored.imbox?.postings[0]).toMatchObject(due);
    expect(restored.laterbox?.postings[0]).toMatchObject(posting("3", false));
  });
  it("moves saved mail into a cached destination without stale group membership", () => {
    const saved = { ...posting("1", true), boxGroupId: "42" };
    const cache = { imbox: mailbox("imbox", []), asidebox: mailbox("asidebox", [saved]) };
    const result = update(cache, { operation: "move", postingIds: ["1"], sourceBox: "asidebox", destination: "imbox" });
    expect(result.mailboxes.imbox?.postings[0]).toMatchObject({ id: "1", boxGroupId: undefined });
    expect(result.mailboxes.asidebox?.postings).toEqual([]);
  });
  it("clears a returned bubble without removing its email or changing read state", () => {
    const cache = { imbox: mailbox("imbox", [{ ...posting("1", true), bubbledUp: true }, posting("2", false)]) };
    const result = update(cache, { operation: "bubble-pop", postingIds: ["1"], sourceBox: "imbox" });
    expect(result.removedFromActiveMailbox).toBe(false);
    expect(result.mailboxes.imbox?.postings[0]).toMatchObject({ id: "1", seen: true, bubbledUp: false });
    expect(cache.imbox.postings[0]?.bubbledUp).toBe(true);
  });
  it("removes a canceled scheduled bubble from Bubble Up and keeps the next cursor", () => {
    const cache = { bubblebox: mailbox("bubblebox", [posting("1", true), posting("2", true)]) };
    const result = applyOptimisticMailMutation(cache, "bubblebox", "1", { operation: "bubble-pop", postingIds: ["1"], sourceBox: "bubblebox" });
    expect(result.removedFromActiveMailbox).toBe(true);
    expect(result.nextCursor).toBe("2");
    expect(result.mailboxes.bubblebox?.postings.map((p) => p.id)).toEqual(["2"]);
  });
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
