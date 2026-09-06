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
});
