import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImboxPosting, MailboxKey, MailWatchChange } from "../../shared/contracts";
import type { MailSplitPage } from "../../shared/mail-splits";
import { mergeSplitPage, SplitMailSession } from "./use-split-mail";
import { groupAccountSplitMailboxes } from "./sectioned-imbox";

const row = (id: string, seen = false): ImboxPosting => ({ id, topicId: `topic-${id}`, seen, subject: id, summary: "", createdAt: "2026-09-27", contacts: [], sender: { name: "Example" }, visibleEntryCount: 1 });
const box = (boxKey: MailboxKey, postings: ImboxPosting[]) => ({ status: "ready" as const, boxKey, boxName: boxKey, postings });
const page = (ids: string[], nextPage?: string): MailSplitPage => ({ mailboxes: { imbox: box("imbox", ids.map((id) => row(id))) }, ...(nextPage ? { nextPage } : {}) });
const deferred = () => {
  let resolve!: (value: MailSplitPage) => void;
  const promise = new Promise<MailSplitPage>((done) => { resolve = done; });
  return { promise, resolve };
};
const sessions: SplitMailSession[] = [];
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture() {
  const list = vi.fn<(id: string, cursor?: string) => Promise<MailSplitPage>>().mockResolvedValue(page([]));
  let listener: (change: MailWatchChange) => void = () => {};
  const unsubscribe = vi.fn();
  const source = { listSplitMail: list, subscribe: (value: typeof listener) => { listener = value; return unsubscribe; } };
  const changed = vi.fn();
  const session = new SplitMailSession("team", "team:definition", source);
  sessions.push(session);
  return { session, list, source, changed, unsubscribe, emit: (change: MailWatchChange) => listener(change), start: () => session.start(changed) };
}
afterEach(() => { sessions.splice(0).forEach((session) => session.stop()); vi.useRealTimers(); });

describe("split page merging", () => {
  it("prepends an authoritative head, updates historical rows, and retains older history", () => {
    const old = { imbox: box("imbox", [row("head"), row("older", true), row("oldest", true)]) };
    const updated = { ...row("older"), bubbledUp: true };
    const merged = mergeSplitPage(old, { mailboxes: { imbox: box("imbox", [row("new"), updated]) } }, new Set(["head"]), true);
    expect(merged.imbox?.postings.map((item) => item.id)).toEqual(["new", "older", "oldest"]);
    expect(merged.imbox?.postings[1]).toEqual(updated);
    expect(old.imbox.postings[1]?.seen).toBe(true);
  });

  it("retains source memberships unless an explicit replacement retires a cached location", () => {
    const sameTopic = { ...row("saved"), topicId: "topic" };
    const moved = { ...row("new-id"), topicId: "topic" };
    const merged = mergeSplitPage({ feedbox: box("feedbox", [sameTopic]), imbox: box("imbox", [sameTopic]) }, {
      mailboxes: { asidebox: box("asidebox", [moved]), laterbox: box("laterbox", [moved]) },
    });
    expect(merged.feedbox?.postings).toEqual([sameTopic]);
    expect(merged.imbox?.postings).toEqual([sameTopic]);
    expect(merged.asidebox?.postings).toEqual([moved]);
    expect(merged.laterbox?.postings).toEqual([moved]);
    const retired = mergeSplitPage(merged, { mailboxes: {} }, new Set([sameTopic.id]));
    expect(retired.feedbox?.postings).toEqual([]);
    expect(retired.imbox?.postings).toEqual([]);
    expect(retired.laterbox?.postings).toEqual([moved]);
  });

  it.each([false, true])("preserves a loaded Reply Later membership when another Imbox page repeats its topic (head=%s)", (prepend) => {
    const saved = row("saved");
    const current = { laterbox: box("laterbox", [saved]) };
    const merged = mergeSplitPage(current, { mailboxes: { imbox: box("imbox", [{ ...saved, seen: true }]) } }, new Set(), prepend);
    expect(merged.laterbox?.postings).toEqual([saved]);
    expect(merged.imbox?.postings).toHaveLength(1);
    const groups = groupAccountSplitMailboxes(merged);
    expect(groups.replyLater).toEqual([saved]);
    expect(groups.previouslySeen).toEqual([]);
  });

  it("keeps the current head over overlapping older pages and deduplicates by ID or topic", () => {
    const original = { ...row("1", true), topicId: undefined };
    const merged = mergeSplitPage({ imbox: box("imbox", [original, row("2", true)]) }, {
      mailboxes: { imbox: box("imbox", [row("1"), { ...row("another-id"), topicId: "topic-2" }, row("3"), row("3")]) },
    });
    expect(merged.imbox?.postings).toEqual([original, row("2", true), row("3")]);
  });
});

describe("split request lifecycle", () => {
  it("preserves the next unread cursor when refreshing a head over loaded history", async () => {
    const { session, list, start } = fixture();
    list.mockResolvedValueOnce(page(["1"], "first")).mockResolvedValueOnce(page(["2"], "second"))
      .mockResolvedValueOnce(page(["new"], "replacement-first")).mockResolvedValueOnce(page(["3"]));
    start(); await tick();
    await session.loadMore();
    await session.refresh();
    expect(session.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["new", "2"]);
    expect(session.state.nextPage).toBe("second");
    await session.loadMore();
    expect(list.mock.calls.at(-1)).toEqual(["team", "second"]);
    expect(session.state.nextPage).toBeUndefined();
  });

  it("does not restart exhausted history after a watch refresh, while explicit reset restarts it", async () => {
    const { session, list, start } = fixture();
    list.mockResolvedValueOnce(page(["1"], "first")).mockResolvedValueOnce(page(["2"]))
      .mockResolvedValue(page(["new"], "replacement"));
    start(); await tick();
    await session.loadMore();
    await session.refresh();
    expect(session.state.nextPage).toBeUndefined();
    await session.loadMore();
    expect(list).toHaveBeenCalledTimes(3);
    await session.refresh(true);
    expect(session.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["new"]);
    expect(session.state.nextPage).toBe("replacement");
  });

  it("invalidates stale history immediately on deletion and pauses pagination until refresh", async () => {
    vi.useFakeTimers();
    const stale = deferred();
    const { session, list, emit, start } = fixture();
    list.mockResolvedValueOnce(page(["1"], "first")).mockReturnValueOnce(stale.promise).mockResolvedValue(page([]));
    start(); await tick();
    const loading = session.loadMore();
    emit({ change: "deleted", postingId: "1" });
    expect(session.state.mailboxes.imbox?.postings).toEqual([]);
    stale.resolve(page(["1", "stale"], "second"));
    await loading;
    await session.loadMore();
    expect(list).toHaveBeenCalledTimes(2);
    expect(session.state.mailboxes.imbox?.postings).toEqual([]);
    await vi.advanceTimersByTimeAsync(300);
    expect(list).toHaveBeenCalledTimes(3);
    expect(session.state.mailboxes.imbox?.postings).toEqual([]);
  });

  it("resumes mutation-interrupted pagination after the confirming head refresh", async () => {
    const stale = deferred();
    const { session, list, start } = fixture();
    list.mockResolvedValueOnce(page(["1"], "first")).mockResolvedValueOnce(page(["2"], "second"))
      .mockReturnValueOnce(stale.promise).mockResolvedValueOnce({ mailboxes: { imbox: box("imbox", [row("1", true)]) }, nextPage: "new-first" })
      .mockResolvedValueOnce(page(["3"], "third"));
    start(); await tick(); await session.loadMore();
    const interrupted = session.loadMore();
    session.apply({ operation: "seen", postingIds: ["1"] });
    stale.resolve(page(["stale"], "lost")); await interrupted;
    expect(list).toHaveBeenCalledTimes(3);
    await session.refresh();
    expect(list.mock.calls.at(-1)).toEqual(["team", "second"]);
    expect(session.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(session.state.mailboxes.imbox?.postings[0]?.seen).toBe(true);
    expect(session.state.nextPage).toBe("third");
    expect(session.state.loadingMore).toBe(false);
  });

  it("ignores old-account responses and unsubscribes when the renderer context changes", async () => {
    const stale = deferred();
    const first = fixture();
    first.list.mockReturnValue(stale.promise);
    first.start();
    first.session.stop();
    const notified = first.changed.mock.calls.length;
    const second = fixture();
    second.list.mockResolvedValue(page(["new-account"]));
    second.start(); await tick();
    stale.resolve(page(["private-old-account"])); await tick();
    expect(first.unsubscribe).toHaveBeenCalledOnce();
    expect(first.changed).toHaveBeenCalledTimes(notified);
    expect(second.session.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["new-account"]);
  });

  it("lets a later refresh replace an in-flight older head and ignores stale failures", async () => {
    const stale = deferred();
    const { session, list, start } = fixture();
    list.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(page(["fresh"]));
    start();
    await session.refresh();
    stale.resolve(page(["stale"])); await tick();
    expect(session.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["fresh"]);
    expect(session.state.loading).toBe(false);
  });

  it("rejects repeated cursors without appending untrusted repeat pages", async () => {
    const { session, list, start } = fixture();
    list.mockResolvedValueOnce(page(["1"], "first")).mockResolvedValueOnce(page(["2"], "second"))
      .mockResolvedValueOnce(page(["3"], "first"));
    start(); await tick();
    await session.loadMore(); await session.loadMore();
    expect(session.state.error).toContain("repeated");
    expect(session.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["1", "2"]);
    expect(session.state.loadingMore).toBe(false);
  });

  it("retains empty page continuations and retries failed history from the same cursor", async () => {
    const { session, list, start } = fixture();
    list.mockResolvedValueOnce(page([], "first")).mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(page([], "second")).mockResolvedValueOnce(page(["match"]));
    start(); await tick();
    await session.loadMore();
    expect(session.state.error).toBe("Offline");
    await session.loadMore();
    expect(session.state.nextPage).toBe("second");
    expect(list.mock.calls.slice(1, 3)).toEqual([["team", "first"], ["team", "first"]]);
    await session.loadMore();
    expect(session.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["match"]);
  });

  it("keeps resync reset intent when more watch events arrive before the debounce", async () => {
    vi.useFakeTimers();
    const { session, list, emit, start } = fixture();
    list.mockResolvedValueOnce(page(["1"], "first")).mockResolvedValueOnce(page(["history"], "second"))
      .mockResolvedValue(page(["fresh"], "new-first"));
    start(); await tick(); await session.loadMore();
    emit({ change: "resync" }); emit({ change: "updated", postingId: "fresh" });
    await vi.advanceTimersByTimeAsync(300);
    expect(session.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["fresh"]);
    expect(session.state.nextPage).toBe("new-first");
  });
});
