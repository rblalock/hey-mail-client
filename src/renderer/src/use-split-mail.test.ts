import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImboxPosting, MailboxKey, MailWatchChange } from "../../shared/contracts";
import type { MailSplitPage } from "../../shared/mail-splits";
import { applyWatchSeen, mergeSplitPage, SplitMailCache, SplitMailSession } from "./use-split-mail";
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
const caches: SplitMailCache[] = [];
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
function cacheFixture(options: { maxSessions?: number; staleAfterMs?: number; now?: () => number } = {}) {
  const list = vi.fn<(id: string, cursor?: string) => Promise<MailSplitPage>>().mockImplementation(async (id) => page([id], `${id}-history`));
  const listeners = new Set<(change: MailWatchChange) => void>();
  const source = { listSplitMail: list, subscribe: (listener: (change: MailWatchChange) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  const cache = new SplitMailCache(source, options);
  caches.push(cache);
  let selected: SplitMailSession | undefined;
  const select = (id: string, definition = "definition") => {
    selected?.deactivate();
    selected = cache.get(id, definition);
    selected.start(vi.fn());
    return selected;
  };
  return { cache, list, listeners, select, emit: (change: MailWatchChange) => listeners.forEach((listener) => listener(change)) };
}
afterEach(() => { sessions.splice(0).forEach((session) => session.stop()); caches.splice(0).forEach((cache) => cache.stop()); vi.useRealTimers(); });

describe("watched posting read state", () => {
  it("paints the first source heads while remaining heads load, without automatically loading history", async () => {
    const remaining = deferred();
    const { session, list, changed, start } = fixture();
    list.mockResolvedValueOnce({ ...page(["first"], "head-two"), headComplete: false }).mockReturnValueOnce(remaining.promise);
    start(); await tick();
    expect(session.state.mailboxes.imbox?.postings[0]?.id).toBe("first");
    expect(session.state.loading).toBe(false);
    expect(session.state.loadingMore).toBe(true);
    expect(list.mock.calls).toEqual([["team", undefined], ["team", "head-two"]]);
    remaining.resolve({ mailboxes: { laterbox: box("laterbox", [row("saved")]) }, nextPage: "history", headComplete: true });
    await tick();
    expect(session.state.mailboxes.imbox?.postings[0]?.id).toBe("first");
    expect(session.state.mailboxes.laterbox?.postings[0]?.id).toBe("saved");
    expect(session.state.loadingMore).toBe(false);
    expect(session.state.nextPage).toBe("history");
    expect(list).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalled();
  });

  it("retains history cursor and saved source rows during a progressive head refresh", async () => {
    const { session, list, start } = fixture();
    list.mockResolvedValueOnce({ ...page(["head"], "head-two"), headComplete: false })
      .mockResolvedValueOnce({ mailboxes: { laterbox: box("laterbox", [row("saved")]) }, headComplete: true, nextPage: "older" })
      .mockResolvedValueOnce(page(["old"], "oldest"));
    start(); await tick(); await tick(); await session.loadMore();
    const remaining = deferred();
    list.mockResolvedValueOnce({ ...page(["fresh"], "new-head-two"), headComplete: false }).mockReturnValueOnce(remaining.promise);
    const refresh = session.refresh(); await tick();
    expect(session.state.mailboxes.laterbox?.postings[0]?.id).toBe("saved");
    remaining.resolve({ mailboxes: { laterbox: box("laterbox", [row("saved-new")]) }, headComplete: true, nextPage: "new-older" });
    await refresh;
    expect(session.state.nextPage).toBe("oldest");
    expect(session.state.mailboxes.imbox?.postings.map((posting) => posting.id)).toEqual(["fresh", "old"]);
    expect(session.state.mailboxes.laterbox?.postings.map((posting) => posting.id)).toEqual(["saved-new"]);
  });

  it("keeps in-flight pages and seen updates without refresh work for metadata-only changes", async () => {
    vi.useFakeTimers();
    const waiting = deferred();
    const { session, list, start, emit } = fixture();
    list.mockResolvedValueOnce(page(["1"], "older")).mockReturnValueOnce(waiting.promise);
    start(); await tick();
    const loading = session.loadMore();
    session.apply({ operation: "seen", postingIds: ["1"] });
    emit({ change: "ready" });
    emit({ change: "updated", metadataOnly: true, postingId: "1", topicId: "topic-1", postingSeen: true, box: { id: "1", key: "imbox", name: "Imbox" } });
    waiting.resolve(page(["1", "2"])); await loading;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.state.mailboxes.imbox?.postings.map((posting) => [posting.id, posting.seen])).toEqual([["1", true], ["2", false]]);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("does not mistake an interrupted automatic head continuation for a request to page history", async () => {
    vi.useFakeTimers();
    const waiting = deferred();
    const { session, list, start, emit } = fixture();
    list.mockResolvedValueOnce(page(["head"], "older")).mockResolvedValueOnce(page(["old"], "oldest"))
      .mockResolvedValueOnce({ ...page(["fresh"], "head-two"), headComplete: false }).mockReturnValueOnce(waiting.promise)
      .mockResolvedValueOnce({ ...page(["newer"], "new-head-two"), headComplete: false })
      .mockResolvedValueOnce({ mailboxes: { laterbox: box("laterbox", []) }, headComplete: true, nextPage: "new-history" });
    start(); await tick(); await session.loadMore();
    const refresh = session.refresh(); await tick();
    emit({ change: "updated", box: { id: "1", key: "imbox", name: "Imbox" }, postingId: "head" });
    waiting.resolve({ mailboxes: { laterbox: box("laterbox", [row("stale")]) }, headComplete: true, nextPage: "stale-history" });
    await refresh;
    await vi.advanceTimersByTimeAsync(300);
    expect(session.state.nextPage).toBe("oldest");
    expect(session.state.mailboxes.imbox?.postings.map((posting) => posting.id)).toEqual(["newer", "old"]);
    expect(list).toHaveBeenCalledTimes(6);
  });

  it("automatically retries a change-during-read race while retaining already visible rows", async () => {
    vi.useFakeTimers();
    const { session, list, start } = fixture();
    list.mockResolvedValueOnce(page(["warm"])).mockRejectedValueOnce(new Error("Mail changed while loading this split. Refresh to continue.")).mockResolvedValueOnce(page(["fresh"]));
    start(); await tick();
    await session.refresh();
    expect(session.state.error).toBeUndefined();
    expect(session.state.mailboxes.imbox?.postings[0]?.id).toBe("warm");
    await vi.advanceTimersByTimeAsync(300);
    expect(session.state.mailboxes.imbox?.postings[0]?.id).toBe("fresh");
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("allows later authoritative heads to update seen state after a missed watch event", async () => {
    const { session, list, start } = fixture();
    list.mockResolvedValue(page(["1"]));
    start(); await tick();
    session.apply({ operation: "seen", postingIds: ["1"] });
    expect(session.state.mailboxes.imbox?.postings[0]?.seen).toBe(true);
    await session.refresh();
    expect(session.state.mailboxes.imbox?.postings[0]?.seen).toBe(false);
  });

  const update: MailWatchChange = { change: "updated", box: { id: "feed", key: "feedbox", name: "The Feed" }, postingId: "shared", topicId: "topic-shared", postingSeen: true };

  it.each([
    { postingId: "shared", topicId: "topic-shared" },
    { postingId: "shared", topicId: undefined },
    { postingId: undefined, topicId: "topic-shared" },
  ])("updates only existing rows in the stated physical source with identity %j", (identity) => {
    const shared = row("shared");
    const current = { feedbox: box("feedbox", [shared, row("other")]), trailbox: box("trailbox", [shared]) };
    const changed = applyWatchSeen(current, { ...update, ...identity });
    expect(changed.feedbox?.postings).toEqual([{ ...shared, seen: true }, row("other")]);
    expect(changed.feedbox?.postings[1]).toBe(current.feedbox.postings[1]);
    expect(changed.trailbox).toBe(current.trailbox);
    expect(current.feedbox.postings[0]?.seen).toBe(false);
    expect(applyWatchSeen(changed, { ...update, ...identity })).toBe(changed);
    expect(applyWatchSeen(changed, { ...update, ...identity, postingSeen: false }).feedbox?.postings[0]?.seen).toBe(false);
  });

  it.each<Partial<MailWatchChange>>([
    { box: undefined },
    { box: { id: "trail", key: "trailbox", name: "Paper Trail" } },
    { box: { id: "all", key: "all", name: "All" } },
    { box: { id: "invalid", key: "constructor", name: "Invalid" } },
    { postingId: undefined, topicId: undefined },
    { postingId: "unfiltered", topicId: "topic-unfiltered" },
    { postingId: "shared", topicId: "topic-other" },
    { postingId: "other", topicId: "topic-shared" },
    { postingId: "", topicId: "topic-shared" },
    { postingId: " shared", topicId: "topic-shared" },
    { postingId: 42 as unknown as string },
    { topicId: " " },
    { postingSeen: undefined, isNew: false },
    { postingSeen: "true" as unknown as boolean },
    { change: "ready" },
    { change: "disconnected" },
    { change: "deleted" },
    { change: "resync" },
  ])("does not patch or introduce rows for unsupported or conflicting watch data: %j", (change) => {
    const current = { feedbox: box("feedbox", [row("shared"), row("other")]) };
    expect(applyWatchSeen(current, { ...update, ...change })).toBe(current);
  });
});

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
    expect(groups.replyLater).toEqual([{ ...saved, sourceBox: "laterbox" }]);
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

  it("replaces head IDs within their source without losing a historical Reply Later membership", async () => {
    const { session, list, start } = fixture();
    const shared = row("shared");
    list.mockResolvedValueOnce({ mailboxes: { imbox: box("imbox", [shared]), laterbox: box("laterbox", []) }, nextPage: "first" })
      .mockResolvedValueOnce({ mailboxes: { laterbox: box("laterbox", [shared]) }, nextPage: "second" })
      .mockResolvedValueOnce({ mailboxes: { imbox: box("imbox", [{ ...shared, seen: true }]), laterbox: box("laterbox", []) }, nextPage: "new-first" });
    start(); await tick(); await session.loadMore(); await session.refresh();
    expect(session.state.mailboxes.imbox?.postings).toEqual([{ ...shared, seen: true }]);
    expect(session.state.mailboxes.laterbox?.postings).toEqual([shared]);
    expect(groupAccountSplitMailboxes(session.state.mailboxes).replyLater).toEqual([{ ...shared, sourceBox: "laterbox" }]);
    expect(session.state.nextPage).toBe("second");
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
    session.apply({ operation: "trash", postingIds: ["removed"] });
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

  it.each([
    "This split page has expired. Refresh to continue.",
    "This split changed or its page expired. Refresh to continue.",
    "Error invoking remote method 'mail:list-split-mail': Error: This split changed or its page expired. Refresh to continue.",
  ])("recovers expired history on explicit retry without clearing visible rows: %s", async (message) => {
    const replacement = deferred();
    const { session, list, start } = fixture();
    list.mockResolvedValueOnce(page(["head"], "old-first"))
      .mockResolvedValueOnce(page(["history"], "expired"))
      .mockRejectedValueOnce(new Error(message))
      .mockReturnValueOnce(replacement.promise)
      .mockResolvedValueOnce(page(["fresh-history"]));
    start(); await tick(); await session.loadMore(); await session.loadMore();
    expect(session.state.error).toBe(message);
    expect(list).toHaveBeenCalledTimes(3);
    const retry = session.loadMore();
    expect(list.mock.calls.at(-1)).toEqual(["team", undefined, { refresh: true }]);
    expect(session.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["head", "history"]);
    expect(session.state.loading).toBe(false);
    replacement.resolve(page(["fresh-head"], "fresh-next")); await retry;
    expect(session.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["fresh-head"]);
    expect(session.state.error).toBeUndefined();
    await session.loadMore();
    expect(list.mock.calls.at(-1)).toEqual(["team", "fresh-next"]);
    expect(session.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["fresh-head", "fresh-history"]);
  });

  it("retains expired-cursor restart intent if the replacement head fails", async () => {
    const { session, list, start } = fixture();
    list.mockResolvedValueOnce(page(["head"], "expired"))
      .mockRejectedValueOnce(new Error("This split page has expired. Refresh to continue."))
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(page(["fresh-head"], "fresh-next"));
    start(); await tick(); await session.loadMore(); await session.loadMore();
    expect(session.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["head"]);
    expect(session.state.error).toBe("Offline");
    expect(list).toHaveBeenCalledTimes(3);
    await session.loadMore();
    expect(list.mock.calls.slice(2)).toEqual([["team", undefined, { refresh: true }], ["team", undefined, { refresh: true }]]);
    expect(session.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["fresh-head"]);
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

describe("retained account split views", () => {
  it("reuses rows and the exact history cursor for A → B → A without refetching", async () => {
    const { select, list } = cacheFixture();
    const first = select("a"); await tick();
    list.mockResolvedValueOnce(page(["a-old"], "a-next"));
    await first.loadMore();
    select("b"); await tick();
    const retained = select("a");
    expect(retained).toBe(first);
    expect(retained.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["a", "a-old"]);
    expect(retained.state.nextPage).toBe("a-next");
    expect(retained.state.loading).toBe(false);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("lets an already-started request finish offscreen without launching extra work", async () => {
    const pending = deferred();
    const { select, list } = cacheFixture();
    list.mockReturnValueOnce(pending.promise);
    const first = select("a");
    const second = select("b"); await tick();
    pending.resolve(page(["a"], "a-history")); await tick();
    expect(first.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["a"]);
    expect(second.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["b"]);
    select("a");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("does not duplicate an in-flight request when returning before it finishes", async () => {
    const pending = deferred();
    const { select, list } = cacheFixture();
    list.mockReturnValueOnce(pending.promise);
    select("a"); select("b"); await tick(); select("a");
    expect(list).toHaveBeenCalledTimes(2);
    pending.resolve(page(["a"])); await tick();
    expect(select("a").state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["a"]);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("keeps expired rows visible while refreshing on reactivation", async () => {
    let now = 0;
    const { select, list } = cacheFixture({ now: () => now, staleAfterMs: 100 });
    select("a"); await tick(); select("b"); await tick();
    now = 101;
    const pending = deferred(); list.mockReturnValueOnce(pending.promise);
    const retained = select("a");
    expect(retained.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["a"]);
    expect(retained.state.loading).toBe(false);
    expect(list).toHaveBeenCalledTimes(3);
    pending.resolve(page(["fresh"])); await tick();
    expect(retained.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["fresh"]);
  });

  it("retains a stale view after a refresh failure and retries on the next visit", async () => {
    let now = 0;
    const { select, list } = cacheFixture({ now: () => now, staleAfterMs: 100 });
    const first = select("a"); await tick(); select("b"); await tick();
    now = 101; list.mockRejectedValueOnce(new Error("Offline")); select("a"); await tick();
    expect(first.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["a"]);
    expect(first.state.error).toBe("Offline");
    select("b"); await tick(); select("a"); await tick();
    expect(first.state.error).toBeUndefined();
    expect(list.mock.calls.filter(([id]) => id === "a")).toHaveLength(3);
  });

  it("does not auto-resume interrupted history until its split is active again", async () => {
    const interrupted = deferred(); const refreshed = deferred();
    const { cache, select, list } = cacheFixture();
    const first = select("a"); await tick();
    list.mockResolvedValueOnce(page(["a-old"], "a-second")); await first.loadMore();
    list.mockReturnValueOnce(interrupted.promise); const oldRead = first.loadMore();
    cache.apply({ operation: "seen", postingIds: ["a"] });
    list.mockReturnValueOnce(refreshed.promise); const refreshing = cache.refresh();
    select("b"); await tick();
    interrupted.resolve(page(["stale"], "lost")); await oldRead;
    refreshed.resolve(page(["a"], "new-first")); await refreshing;
    expect(list.mock.calls.map(([id]) => id)).toEqual(["a", "a", "a", "a", "b"]);
    list.mockResolvedValueOnce(page(["a-next"])); select("a"); await tick();
    expect(list.mock.calls.at(-1)).toEqual(["a", "a-second"]);
    expect(first.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["a", "a-old", "a-next"]);
  });

  it("updates inactive views after local mutations and refreshes only the active split", async () => {
    const { cache, select, list } = cacheFixture();
    list.mockResolvedValue(page(["shared"]));
    const first = select("a"); await tick();
    const second = select("b"); await tick();
    cache.apply({ operation: "seen", postingIds: ["shared"] });
    expect(first.state.mailboxes.imbox?.postings[0]?.seen).toBe(true);
    expect(second.state.mailboxes.imbox?.postings[0]?.seen).toBe(true);
    await cache.refresh();
    expect(list.mock.calls.map(([id]) => id)).toEqual(["a", "b", "b"]);
    select("a"); await tick();
    expect(list.mock.calls.map(([id]) => id)).toEqual(["a", "b", "b", "a"]);
  });

  it.each(["feedbox", "trailbox"] as const)("propagates remote read and unread state through overlapping loaded %s history", async (source) => {
    vi.useFakeTimers();
    const { select, list, emit } = cacheFixture();
    list.mockImplementation(async (id, cursor) => ({
      mailboxes: { [source]: box(source, cursor ? [row("shared"), row(`${id}-older`)] : [row(`${id}-head`)]) },
      nextPage: cursor ? `${id}-next` : `${id}-history`,
    }));
    const first = select("a"); await tick(); await first.loadMore();
    const second = select("b"); await tick(); await second.loadMore();
    const ids = (session: SplitMailSession) => session.state.mailboxes[source]?.postings.map((posting) => posting.id);
    const sharedSeen = (session: SplitMailSession) => session.state.mailboxes[source]?.postings.find((posting) => posting.id === "shared")?.seen;
    const watched = { box: { id: source, key: source, name: source }, postingId: "shared", topicId: "topic-shared" };

    emit({ ...watched, change: "added", postingSeen: true, isNew: true });
    expect(sharedSeen(first)).toBe(true);
    expect(sharedSeen(second)).toBe(true);
    expect(list).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(300);
    expect(list.mock.calls).toEqual([["a", undefined], ["a", "a-history"], ["b", undefined], ["b", "b-history"], ["b", undefined]]);
    expect(sharedSeen(second)).toBe(true);

    expect(select("a")).toBe(first); await tick();
    expect(sharedSeen(first)).toBe(true);
    emit({ ...watched, change: "updated", postingSeen: false, isNew: false });
    expect(sharedSeen(first)).toBe(false);
    expect(sharedSeen(second)).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(list.mock.calls.slice(5)).toEqual([["a", undefined], ["a", undefined]]);
    expect(ids(first)).toEqual(["a-head", "shared", "a-older"]);
    expect(ids(second)).toEqual(["b-head", "shared", "b-older"]);
    expect(first.state.nextPage).toBe("a-next");
    expect(second.state.nextPage).toBe("b-next");
    expect(sharedSeen(first)).toBe(false);
    expect(sharedSeen(second)).toBe(false);
  });

  it("refreshes the current split when an older split's async operation completes", async () => {
    const pending = deferred();
    const { cache, select, list } = cacheFixture();
    select("a"); await tick();
    const operationCompleted = cache.refresh;
    list.mockReturnValueOnce(pending.promise);
    const second = select("b");
    expect(second.state.loading).toBe(true);
    list.mockResolvedValueOnce(page(["fresh-b"]));
    await operationCompleted();
    pending.resolve(page(["stale-b"])); await tick();
    expect(list.mock.calls.map(([id]) => id)).toEqual(["a", "b", "b"]);
    expect(second.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["fresh-b"]);
    expect(second.state.loading).toBe(false);
    expect(second.state.error).toBeUndefined();
  });

  it("removes watched deletions from inactive views without eagerly loading them", async () => {
    vi.useFakeTimers();
    const { select, list, emit } = cacheFixture();
    const first = select("a"); await tick(); select("b"); await tick();
    emit({ change: "deleted", postingId: "a" });
    expect(first.state.mailboxes.imbox?.postings).toEqual([]);
    await vi.advanceTimersByTimeAsync(300);
    expect(list.mock.calls.map(([id]) => id)).toEqual(["a", "b", "b"]);
    list.mockResolvedValueOnce(page([])); select("a"); await tick();
    expect(first.state.mailboxes.imbox?.postings).toEqual([]);
    expect(list.mock.calls.map(([id]) => id)).toEqual(["a", "b", "b", "a"]);
  });

  it("ignores stale inactive responses after deletion and preserves resync reset intent", async () => {
    vi.useFakeTimers();
    const pending = deferred();
    const { select, list, emit } = cacheFixture();
    const first = select("a"); await tick();
    list.mockResolvedValueOnce(page(["older"], "second")); await first.loadMore();
    list.mockReturnValueOnce(pending.promise); const loading = first.loadMore();
    select("b"); await tick();
    emit({ change: "deleted", postingId: "older" }); emit({ change: "resync" });
    pending.resolve(page(["older", "stale"], "lost")); await loading;
    expect(first.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["a"]);
    list.mockResolvedValueOnce(page(["new-a"], "new-cursor")); select("a"); await tick();
    expect(first.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["new-a"]);
    expect(first.state.nextPage).toBe("new-cursor");
    expect(list.mock.calls.at(-1)).toEqual(["a", undefined, { refresh: true }]);
  });

  it("discards changed definitions and old-account requests", async () => {
    const pending = deferred();
    const old = cacheFixture(); old.list.mockReturnValueOnce(pending.promise);
    const original = old.select("a", "old");
    const replacement = old.select("a", "new"); await tick();
    expect(replacement).not.toBe(original);
    old.cache.stop();
    expect(old.listeners.size).toBe(0);
    const current = cacheFixture(); const currentSession = current.select("a", "new"); await tick();
    pending.resolve(page(["private-old-account"])); await tick();
    expect(original.state.mailboxes).toEqual({});
    expect(currentSession.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["a"]);
    expect(current.list).toHaveBeenCalledOnce();
  });

  it("an old-account operation completion cannot cancel the new account's pending load", async () => {
    const old = cacheFixture(); old.select("a"); await tick();
    const oldOperationCompleted = old.cache.refresh;
    old.cache.stop();
    const current = cacheFixture(); const pending = deferred(); current.list.mockReturnValueOnce(pending.promise);
    const currentSession = current.select("a");
    await oldOperationCompleted();
    expect(currentSession.state.loading).toBe(true);
    pending.resolve(page(["new-account"])); await tick();
    expect(currentSession.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["new-account"]);
    expect(current.list).toHaveBeenCalledOnce();
    expect(old.list).toHaveBeenCalledOnce();
  });

  it("evicts the least recently selected split and cleans up its subscription", async () => {
    const { select, list, listeners } = cacheFixture({ maxSessions: 2 });
    const first = select("a"); await tick();
    select("b"); await tick(); select("a"); select("c"); await tick();
    expect(listeners.size).toBe(2);
    expect(select("a")).toBe(first);
    const second = select("b"); await tick();
    expect(second.state.mailboxes.imbox?.postings.map((item) => item.id)).toEqual(["b"]);
    expect(list.mock.calls.map(([id]) => id)).toEqual(["a", "b", "c", "b"]);
    expect(listeners.size).toBe(2);
  });

  it("can restart after effect cleanup and still applies mutations to the active view", async () => {
    const { cache, select, list, listeners } = cacheFixture();
    const first = select("a"); await tick();
    cache.stop(); expect(listeners.size).toBe(0);
    first.start(vi.fn());
    cache.apply({ operation: "seen", postingIds: ["a"] });
    expect(first.state.mailboxes.imbox?.postings[0]?.seen).toBe(true);
    expect(listeners.size).toBe(1);
    expect(list).toHaveBeenCalledOnce();
  });
});
