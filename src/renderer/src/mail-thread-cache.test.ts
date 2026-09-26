import { describe, expect, it, vi } from "vitest";
import type { MailThread } from "../../shared/contracts";
import { MailThreadCache } from "./mail-thread-cache";

function thread(id: string): MailThread {
  return { topicId: id, subject: `Conversation ${id}`, entries: [] };
}

describe("MailThreadCache", () => {
  it("reuses completed reads and deduplicates reads already in flight", async () => {
    let resolve!: (value: MailThread) => void;
    const reader = vi.fn(() => new Promise<MailThread>((done) => { resolve = done; }));
    const cache = new MailThreadCache();

    const first = cache.read("101", reader);
    const second = cache.read("101", reader);
    expect(reader).toHaveBeenCalledTimes(1);

    resolve(thread("101"));
    await expect(first).resolves.toEqual(thread("101"));
    await expect(second).resolves.toEqual(thread("101"));
    await expect(cache.read("101", reader)).resolves.toEqual(thread("101"));
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it("evicts the least recently used thread when it reaches capacity", async () => {
    const reader = vi.fn(async (id: string) => thread(id));
    const cache = new MailThreadCache(2);

    await cache.read("101", reader);
    await cache.read("102", reader);
    expect(cache.get("101")).toEqual(thread("101"));
    await cache.read("103", reader);

    expect(cache.get("102")).toBeUndefined();
    expect(cache.get("101")).toEqual(thread("101"));
    expect(cache.get("103")).toEqual(thread("103"));
  });

  it("can replace or invalidate a cached thread", async () => {
    const reader = vi.fn()
      .mockResolvedValueOnce(thread("old"))
      .mockResolvedValueOnce(thread("new"));
    const cache = new MailThreadCache();

    await cache.read("101", reader);
    await cache.read("101", reader, true);
    expect(cache.get("101")).toEqual(thread("new"));

    cache.invalidate("101");
    expect(cache.get("101")).toBeUndefined();
  });

  it("shows a disk preview before the live read finishes and replaces it", async () => {
    let finish!: (value: MailThread) => void;
    const cache = new MailThreadCache();
    const preview = vi.fn();
    const live = cache.read("101", () => new Promise((resolve) => { finish = resolve; }), false, async () => thread("disk"), preview);
    await Promise.resolve();
    expect(preview).toHaveBeenCalledWith(thread("disk"));
    expect(cache.get("101")).toEqual(thread("disk"));
    expect(cache.isFresh("101")).toBe(false);
    finish(thread("live"));
    await live;
    expect(cache.get("101")).toEqual(thread("live"));
    expect(cache.isFresh("101")).toBe(true);
  });

  it("does not allow a slow disk preview to overwrite a live result", async () => {
    let finish!: (value: MailThread) => void;
    const cache = new MailThreadCache();
    const preview = vi.fn();
    await cache.read("101", async () => thread("live"), false, () => new Promise((resolve) => { finish = resolve; }), preview);
    finish(thread("disk"));
    await Promise.resolve();
    expect(cache.get("101")).toEqual(thread("live"));
    expect(preview).not.toHaveBeenCalled();
  });

  it("keeps a delayed disk copy when the live request fails immediately", async () => {
    let finish!: (value: MailThread) => void;
    const cache = new MailThreadCache();
    const live = cache.read("101", async () => { throw new Error("offline"); }, false, () => new Promise((resolve) => { finish = resolve; }));
    const rejected = expect(live).rejects.toThrow("offline");
    await Promise.resolve();
    finish(thread("disk"));
    await rejected;
    expect(cache.get("101")).toEqual(thread("disk"));
    expect(cache.isFresh("101")).toBe(false);
  });

  it("refreshes expired memory entries without dropping the displayed copy", async () => {
    let now = 1;
    const cache = new MailThreadCache(10, () => now, 100);
    await cache.read("101", async () => thread("old"));
    now += 101;
    let finish!: (value: MailThread) => void;
    const live = cache.read("101", () => new Promise((resolve) => { finish = resolve; }));
    expect(cache.get("101")).toEqual(thread("old"));
    finish(thread("updated"));
    await live;
    expect(cache.get("101")).toEqual(thread("updated"));
  });

  it("joins force reads but invalidation starts a new request and rejects stale completion", async () => {
    const cache = new MailThreadCache();
    await cache.read("101", async () => thread("original"));
    let finish!: (value: MailThread) => void;
    const first = cache.read("101", () => new Promise((resolve) => { finish = resolve; }), true);
    const ignored = vi.fn(async () => thread("duplicate"));
    const joined = cache.read("101", ignored, true);
    expect(ignored).not.toHaveBeenCalled();
    cache.invalidate("101", true);
    expect(cache.get("101")).toEqual(thread("original"));
    await cache.read("101", async () => thread("newer"), true);
    finish(thread("stale"));
    await Promise.all([first, joined]);
    expect(cache.get("101")).toEqual(thread("newer"));
  });

  it("rejects late disk previews after invalidation", async () => {
    let finishDisk!: (value: MailThread) => void;
    let finishLive!: (value: MailThread) => void;
    const cache = new MailThreadCache();
    const first = cache.read("101", () => new Promise((resolve) => { finishLive = resolve; }), false, () => new Promise((resolve) => { finishDisk = resolve; }));
    cache.invalidate();
    finishDisk(thread("wrong-profile"));
    finishLive(thread("wrong-profile"));
    await first;
    expect(cache.get("101")).toBeUndefined();
  });

  it("keeps an active reply reconciliation during a mailbox resync", async () => {
    const cache = new MailThreadCache();
    await cache.read("102", async () => thread("other"));
    let finish!: (value: MailThread) => void;
    const reply = cache.read("101", () => new Promise((resolve) => { finish = resolve; }));
    cache.invalidate(undefined, true, ["101"]);
    expect(cache.get("102")).toEqual(thread("other"));
    expect(cache.isFresh("102")).toBe(false);
    const duplicate = vi.fn(async () => thread("duplicate"));
    expect(cache.read("101", duplicate, true)).toBe(reply);
    expect(duplicate).not.toHaveBeenCalled();
    finish(thread("sent reply"));
    await reply;
    expect(cache.get("101")).toEqual(thread("sent reply"));
    expect(cache.isFresh("101")).toBe(true);
  });
});
