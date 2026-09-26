import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MailAccountProfile, MailThread } from "../shared/contracts";
import { MailDiskCache } from "./mail-disk-cache";
import { CachedMailReader } from "./cached-mail-reader";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
function profile(id = "1"): MailAccountProfile {
  const server = "https://app.hey.com";
  return { key: createHash("sha256").update(`${server}\n${id}`).digest("hex").slice(0, 32), server, accountId: id, name: "Example", email: "test@example.com" };
}
const thread: MailThread = { topicId: "100", subject: "Synthetic mail", entries: [{ id: "200", sender: { name: "Example" }, body: "Fictional body", occurredAt: "2026-09-26T12:00:00Z" }] };
async function disk() {
  const root = await mkdtemp(join(tmpdir(), "hey-cached-reader-")); roots.push(root);
  const cache = new MailDiskCache(join(root, "cache"));
  await cache.configure({ enabled: true, maxBytes: 100_000, retentionMs: 86_400_000 });
  return cache;
}

describe("CachedMailReader", () => {
  it("persists a successful live read for another instance and isolates accounts", async () => {
    const cache = await disk();
    const reader = new CachedMailReader(cache, async () => thread);
    expect(await reader.read(profile(), "100")).toEqual(thread);
    expect(await new CachedMailReader(cache, async () => { throw Error("offline"); }).cached(profile(), "100")).toEqual(thread);
    expect(await reader.cached(profile("2"), "100")).toBeUndefined();
  });

  it("deduplicates network reads per account but not across accounts", async () => {
    const cache = await disk();
    let complete!: (value: MailThread) => void;
    const fetch = vi.fn(() => new Promise<MailThread>((resolve) => { complete = resolve; }));
    const reader = new CachedMailReader(cache, fetch);
    const a = reader.read(profile(), "100"), b = reader.read(profile(), "100");
    expect(a).toBe(b);
    expect(fetch).toHaveBeenCalledTimes(1);
    complete(thread); await a;
    const c = reader.read(profile("2"), "100");
    expect(fetch).toHaveBeenCalledTimes(2);
    complete(thread); await c;
  });

  it("does not repopulate cleared disk with an old request and permits a replacement fetch", async () => {
    const cache = await disk();
    let complete!: (value: MailThread) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<MailThread>((resolve) => { complete = resolve; })).mockResolvedValue({ ...thread, subject: "Newer" });
    const reader = new CachedMailReader(cache, fetch);
    const old = reader.read(profile(), "100");
    await cache.clear();
    await reader.read(profile(), "100");
    complete(thread); await old;
    expect((await reader.cached(profile(), "100"))?.subject).toBe("Newer");
  });

  it("does not persist partial failures and keeps live reads working with caching off", async () => {
    const cache = await disk();
    const reader = new CachedMailReader(cache, async () => ({ ...thread, attachmentsError: "Try again" }));
    await reader.read(profile(), "100");
    expect(await reader.cached(profile(), "100")).toBeUndefined();
    await cache.configure({ enabled: false, maxBytes: 100_000, retentionMs: 86_400_000 });
    expect(await new CachedMailReader(cache, async () => thread).read(profile(), "100")).toEqual(thread);
    expect((await cache.stats()).entries).toBe(0);
  });
});
