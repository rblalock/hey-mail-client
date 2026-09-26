import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MailThread } from "../shared/contracts";
import { MailDiskCache, type MailDiskCachePolicy, type MailDiskCacheProfile } from "./mail-disk-cache";

const directories: string[] = [];
const DAY = 86_400_000;
const policy: MailDiskCachePolicy = { enabled: true, maxBytes: 100 * 1024 * 1024, retentionMs: 7 * DAY };
const profile = (accountId = "101", server = "https://app.hey.com"): MailDiskCacheProfile => ({
  accountId, server, key: createHash("sha256").update(`${server}\n${accountId}`).digest("hex").slice(0, 32),
});
const thread = (topicId = "21", body = "Synthetic message"): MailThread => ({
  topicId, subject: "Synthetic conversation", entries: [{ id: "41", sender: { name: "Example Person" }, occurredAt: "2026-09-20T10:00:00Z", body,
    html: "<p>Synthetic message</p>", attachments: [{ id: "41:51", messageId: "41", filename: "example.pdf", contentType: "application/pdf", byteSize: 1_000 }] }],
});
async function setup(options = policy) {
  const directory = await mkdtemp(join(tmpdir(), "hey-mail-cache-test-"));
  directories.push(directory);
  const root = join(directory, "cache");
  let now = Date.now();
  const cache = new MailDiskCache(root, options, () => now);
  return { directory, root, cache, advance: (milliseconds: number) => { now += milliseconds; } };
}
const store = (cache: MailDiskCache, value = thread(), account = profile()) => cache.write(account, value, cache.generation);
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("bounded private mail disk cache", () => {
  it("is off by default and does not create a directory until an enabled successful write", async () => {
    const { root } = await setup();
    const cache = new MailDiskCache(root);
    expect(await store(cache)).toBe(false);
    expect(await cache.read(profile(), "21")).toBeUndefined();
    expect(await cache.stats()).toEqual({ entries: 0, bytes: 0 });
    await expect(stat(root)).rejects.toThrow();
  });

  it("round trips complete mail bodies and attachment metadata across instances with private modes", async () => {
    const { cache, root } = await setup();
    expect(await store(cache)).toBe(true);
    const cached = await new MailDiskCache(root, policy).read(profile(), "21");
    expect(cached?.thread).toEqual(thread());
    expect(cached?.cachedAt).toBeTypeOf("number");
    const [filename] = await readdir(root);
    expect(filename).toBe(`${profile().key}-21.json`);
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await stat(join(root, filename!))).mode & 0o777).toBe(0o600);
    expect(await cache.stats()).toEqual({ entries: 1, bytes: (await stat(join(root, filename!))).size });
  });

  it("isolates the same topic ID across linked accounts and servers", async () => {
    const { cache } = await setup();
    const anotherAccount = profile("102");
    const anotherServer = profile("101", "https://example.test");
    await store(cache, thread("21", "First"));
    expect(await cache.read(anotherAccount, "21")).toBeUndefined();
    await store(cache, thread("21", "Second"), anotherAccount);
    await store(cache, thread("21", "Third"), anotherServer);
    expect((await cache.read(profile(), "21"))?.thread.entries[0]?.body).toBe("First");
    expect((await cache.read(anotherAccount, "21"))?.thread.entries[0]?.body).toBe("Second");
    expect((await cache.read(anotherServer, "21"))?.thread.entries[0]?.body).toBe("Third");
    expect((await cache.stats()).entries).toBe(3);
  });

  it("rejects malformed profiles and path-like IDs without creating cache files", async () => {
    const { cache, root } = await setup();
    expect(await store(cache, thread("../21"))).toBe(false);
    expect(await store(cache, thread(), { ...profile(), key: "../outside" })).toBe(false);
    expect(await store(cache, thread(), { ...profile(), accountId: "102" })).toBe(false);
    expect(await cache.read(profile(), "../../outside")).toBeUndefined();
    expect(await cache.read({ ...profile(), server: "https://app.hey.com/path" }, "21")).toBeUndefined();
    await expect(stat(root)).rejects.toThrow();
  });

  it("evicts globally by byte budget using least-recent access, not one budget per profile", async () => {
    const { cache, advance } = await setup();
    await store(cache, thread("21", "a".repeat(1_000)));
    advance(1_000);
    await store(cache, thread("22", "b".repeat(1_000)), profile("102"));
    advance(1_000);
    await cache.read(profile(), "21");
    const { bytes } = await cache.stats();
    await cache.configure({ ...policy, maxBytes: Math.ceil(bytes / 2) });
    expect(await cache.read(profile("102"), "22")).toBeUndefined();
    expect((await cache.read(profile(), "21"))?.thread.topicId).toBe("21");
    expect((await cache.stats()).bytes).toBeLessThanOrEqual(Math.ceil(bytes / 2));
  });

  it("expires by fetch time even when the entry was read recently", async () => {
    const { cache, advance } = await setup();
    await store(cache);
    advance(6 * DAY);
    expect(await cache.read(profile(), "21")).toBeDefined();
    advance(DAY);
    expect(await cache.read(profile(), "21")).toBeUndefined();
    expect(await cache.stats()).toEqual({ entries: 0, bytes: 0 });
  });

  it("applies shorter retention immediately", async () => {
    const { cache, advance } = await setup();
    await store(cache);
    advance(2 * DAY);
    await cache.configure({ ...policy, retentionMs: DAY });
    expect(await cache.stats()).toEqual({ entries: 0, bytes: 0 });
  });

  it("does not store partial/error results, empty threads, oversized threads or arbitrary blobs", async () => {
    const { cache } = await setup();
    expect(await store(cache, { ...thread(), attachmentsError: "Loading failed" })).toBe(false);
    expect(await store(cache, { ...thread(), entries: [] })).toBe(false);
    expect(await store(cache, thread("21", "x".repeat(5 * 1024 * 1024)))).toBe(false);
    const extra = { ...thread(), downloadedFile: "/tmp/not-cache-data" };
    Object.assign(extra.entries[0]!.attachments![0]!, { bytes: [1, 2, 3], path: "/tmp/attachment" });
    expect(await store(cache, extra)).toBe(true);
    expect((await cache.read(profile(), "21"))?.thread).toEqual(thread());
  });

  it("fails closed on corrupt JSON, wrong schemas, cross-account envelopes and invalid thread bodies", async () => {
    const { cache, root } = await setup();
    await store(cache);
    const path = join(root, `${profile().key}-21.json`);
    const valid = JSON.parse(await readFile(path, "utf8"));
    for (const value of ["broken JSON", JSON.stringify({ ...valid, version: 2 }), JSON.stringify({ ...valid, accountId: "102" }),
      JSON.stringify({ ...valid, thread: { ...thread(), topicId: "22" } }), JSON.stringify({ ...valid, thread: { ...thread(), entries: [null] } })]) {
      await writeFile(path, value);
      expect(await cache.read(profile(), "21")).toBeUndefined();
    }
  });

  it("does not follow symlink roots, ancestors, or cache entries, nor change targets during clear", async () => {
    const { cache, root, directory } = await setup();
    await store(cache);
    const outside = join(directory, "outside.json");
    await writeFile(outside, "unrelated");
    const path = join(root, `${profile().key}-21.json`);
    await rm(path);
    await symlink(outside, path);
    expect(await cache.read(profile(), "21")).toBeUndefined();
    await cache.clear();
    expect(await readFile(outside, "utf8")).toBe("unrelated");
    const alias = join(directory, "alias");
    await symlink(root, alias);
    const linked = new MailDiskCache(alias, policy);
    expect(await store(linked)).toBe(false);
    expect(await linked.read(profile(), "21")).toBeUndefined();
    await expect(linked.clear()).rejects.toThrow("Unsafe");
    const nested = new MailDiskCache(join(alias, "nested"), policy);
    expect(await store(nested)).toBe(false);
    await expect(stat(join(root, "nested"))).rejects.toThrow();
  });

  it("clear invalidates queued and late network writes, while later new reads may populate again", async () => {
    const { cache } = await setup();
    await store(cache);
    const oldGeneration = cache.generation;
    const pending = cache.write(profile(), thread("22"), oldGeneration);
    const cleared = cache.clear();
    expect(await pending).toBe(false);
    await cleared;
    expect(await cache.write(profile(), thread("23"), oldGeneration)).toBe(false);
    expect(await cache.stats()).toEqual({ entries: 0, bytes: 0 });
    expect(await store(cache)).toBe(true);
  });

  it("disable clears every profile and rejects in-flight generations after re-enable", async () => {
    const { cache } = await setup();
    await store(cache);
    await store(cache, thread("22"), profile("102"));
    const oldGeneration = cache.generation;
    await cache.configure({ ...policy, enabled: false });
    expect(await cache.stats()).toEqual({ entries: 0, bytes: 0 });
    expect(await store(cache)).toBe(false);
    await cache.configure(policy);
    expect(await cache.write(profile(), thread(), oldGeneration)).toBe(false);
    expect(await store(cache)).toBe(true);
  });

  it("removes only its targeted thread and invalidates older in-flight results", async () => {
    const { cache } = await setup();
    await store(cache);
    await store(cache, thread("22"));
    const oldGeneration = cache.generation;
    await cache.remove(profile(), "21");
    expect(await cache.read(profile(), "21")).toBeUndefined();
    expect(await cache.read(profile(), "22")).toBeDefined();
    expect(await cache.write(profile(), thread(), oldGeneration)).toBe(false);
  });

  it("clears one profile without deleting another account or server's cache", async () => {
    const { cache } = await setup();
    await store(cache);
    await store(cache, thread("22"));
    await store(cache, thread(), profile("102"));
    await store(cache, thread(), profile("101", "https://example.test"));
    const oldGeneration = cache.generation;
    await cache.clearProfile(profile());
    expect(await cache.read(profile(), "21")).toBeUndefined();
    expect(await cache.read(profile(), "22")).toBeUndefined();
    expect(await cache.read(profile("102"), "21")).toBeDefined();
    expect(await cache.read(profile("101", "https://example.test"), "21")).toBeDefined();
    expect(await cache.write(profile(), thread(), oldGeneration)).toBe(false);
  });

  it("no-ops identical policy saves but performs the initial disabled cleanup", async () => {
    const { cache, root } = await setup();
    await cache.configure(policy);
    const generation = cache.generation;
    await cache.configure({ ...policy });
    expect(cache.generation).toBe(generation);
    await store(cache);
    const disabled = new MailDiskCache(root);
    await disabled.configure({ ...policy, enabled: false });
    expect(await disabled.stats()).toEqual({ entries: 0, bytes: 0 });
    const disabledGeneration = disabled.generation;
    await disabled.configure({ ...policy, enabled: false });
    expect(disabled.generation).toBe(disabledGeneration);
  });

  it("removes abandoned staging files when pruning without touching unrelated temporary files", async () => {
    const { cache, root } = await setup();
    await store(cache);
    const abandoned = `.${profile().key}-21.12345678-1234-1234-1234-123456789012.tmp`;
    await writeFile(join(root, abandoned), "unfinished write");
    await writeFile(join(root, "keep.tmp"), "unrelated");
    await cache.configure(policy);
    expect(await readdir(root)).toEqual(expect.arrayContaining([`${profile().key}-21.json`, "keep.tmp"]));
    expect(await readdir(root)).not.toContain(abandoned);
  });

  it("uses its in-memory metadata index for ordinary reads and writes instead of rescanning the directory", async () => {
    const { cache, root } = await setup();
    await cache.configure(policy);
    await store(cache);
    const abandoned = join(root, `.${profile().key}-21.12345678-1234-1234-1234-123456789012.tmp`);
    await writeFile(abandoned, "created outside this running instance");
    expect(await cache.read(profile(), "21")).toBeDefined();
    await store(cache, thread("22"));
    // A whole-directory scan would discover and clean this. Opens touch only the requested file.
    expect(await readFile(abandoned, "utf8")).toBe("created outside this running instance");
    expect((await cache.stats()).entries).toBe(2);
    await expect(stat(abandoned)).rejects.toThrow();
  });

  it("preserves unrelated files and directories during global clear", async () => {
    const { cache, root } = await setup();
    await store(cache);
    await writeFile(join(root, "keep.txt"), "do not delete");
    await cache.clear();
    expect(await readdir(root)).toEqual(["keep.txt"]);
    expect(await readFile(join(root, "keep.txt"), "utf8")).toBe("do not delete");
  });

  it("serializes simultaneous stores and leaves no temporary files", async () => {
    const { cache, root } = await setup();
    expect(await Promise.all([store(cache, thread("21", "First")), store(cache, thread("21", "Second")), store(cache, thread("22"))])).toEqual([true, true, true]);
    expect((await cache.read(profile(), "21"))?.thread.entries[0]?.body).toBe("Second");
    expect((await readdir(root)).every((name) => name.endsWith(".json"))).toBe(true);
  });
});
