import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeyAccountScope } from "../../resources/hey-account-scope.mjs";
import type { ImboxPosting, ImboxResult, MailboxKey } from "../shared/contracts";
import { listLibrary, listLibraryThreads, listMailbox, updateMailOrganization } from "./hey";
import { profileRequest } from "./profile-process";
import { createSplitLabel } from "./split-label";
import { SplitRuntime } from "./split-runtime";

vi.mock("./hey", () => ({ listLibrary: vi.fn(), listLibraryThreads: vi.fn(), listMailbox: vi.fn(), updateMailOrganization: vi.fn() }));
vi.mock("./split-label", () => ({ createSplitLabel: vi.fn() }));

const roots: string[] = [];
const runtimes: SplitRuntime[] = [];
const draft = { name: "Team", enabled: true, people: [], domains: ["company.com"], labelName: "Team", labelId: "31" };
const row = (id = "10", email = "friend@company.com"): ImboxPosting => ({ id, topicId: `${id}00`, sender: { name: "Friend", email }, contacts: [], subject: "Fictional subject", summary: "Example summary", seen: false, createdAt: "2026-09-27", visibleEntryCount: 1 });
const box = (boxKey: MailboxKey, postings: ImboxPosting[] = []): ImboxResult => ({ boxKey, boxName: boxKey, status: "ready", postings });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

async function fixture(enabled = true) {
  const root = await mkdtemp(join(tmpdir(), "hey-agent-split-runtime-"));
  roots.push(root);
  const context = { scope: new HeyAccountScope("7", "https://app.hey.com"), env: { PATH: "/profile/bin", HEY_AGENT_HEY_PATH: "/profile/bin/hey" } };
  const onChange = vi.fn();
  const runWrite = vi.fn();
  const write = <T>(task: () => Promise<T>): Promise<T> => { runWrite(); return task(); };
  const runtime = new SplitRuntime(join(root, "mail-splits.json"), context, onChange, write, "me@company.com");
  runtimes.push(runtime);
  if (enabled) { await runtime.store.save(draft); await runtime.store.idle(); }
  return { runtime, context, onChange, runWrite };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listLibrary).mockResolvedValue({ kind: "labels", items: [{ id: "31", title: "Team" }] });
  vi.mocked(listLibraryThreads).mockResolvedValue({ kind: "labels", id: "31", title: "Team", postings: [] });
  vi.mocked(listMailbox).mockImplementation(async (name) => box(name, name === "imbox" ? [row()] : []));
  vi.mocked(updateMailOrganization).mockResolvedValue({ message: "Added" });
  vi.mocked(createSplitLabel).mockResolvedValue({ id: "32", name: "Second" });
});

afterEach(async () => {
  runtimes.splice(0).forEach((runtime) => runtime.stop());
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("split runtime snapshots", () => {
  it("reads only workflow boxes and captures account and environment for reads and writes", async () => {
    const { runtime, context, runWrite } = await fixture();
    const seenContexts: unknown[] = [];
    vi.mocked(listMailbox).mockImplementation(async (name, env) => {
      seenContexts.push(profileRequest.getStore());
      expect(env).toBe(context.env);
      return box(name, name === "imbox" ? [row()] : []);
    });
    vi.mocked(updateMailOrganization).mockImplementation(async (_request, env) => {
      expect(profileRequest.getStore()).toBe(context);
      expect(env).toBe(context.env);
      return { message: "Added" };
    });
    const other = { scope: new HeyAccountScope("8", "https://app.hey.com"), env: { PATH: "/other/bin" } };
    await profileRequest.run(other, () => runtime.refresh());
    expect(seenContexts).toEqual([context, context, context]);
    expect(vi.mocked(listMailbox).mock.calls.map(([name]) => name)).toEqual(["imbox", "laterbox", "asidebox"]);
    expect(vi.mocked(listMailbox).mock.calls[0]?.[2]).toEqual({ paginated: true });
    expect(runWrite).toHaveBeenCalledTimes(1);
    expect((await runtime.get()).ownEmail).toBe("me@company.com");
  });

  it("does not label a partial snapshot before all three boxes have loaded", async () => {
    const thirdStarted = deferred<void>();
    const third = deferred<ImboxResult>();
    const { runtime } = await fixture();
    vi.mocked(listMailbox).mockImplementation(async (name) => {
      if (name === "asidebox") { thirdStarted.resolve(); return third.promise; }
      return box(name, name === "imbox" ? [row()] : []);
    });
    const refresh = runtime.refresh();
    await thirdStarted.promise;
    runtime.observe("imbox", box("imbox", [row("88")]));
    await runtime.store.idle();
    expect(updateMailOrganization).not.toHaveBeenCalled();
    third.resolve(box("asidebox"));
    await refresh;
    expect(updateMailOrganization).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateMailOrganization).mock.calls[0]?.[0].postingIds).toEqual(["10"]);
  });

  it("keeps preview strictly read-only even with enabled rules and validates before reads", async () => {
    const { runtime, runWrite } = await fixture();
    const preview = await runtime.preview(draft);
    expect(preview).toMatchObject({ count: 1, scannedCount: 1 });
    expect(updateMailOrganization).not.toHaveBeenCalled();
    expect(createSplitLabel).not.toHaveBeenCalled();
    expect(runWrite).not.toHaveBeenCalled();
    expect((await runtime.store.preview(draft)).count).toBe(0);
    vi.mocked(listMailbox).mockClear();
    await expect(runtime.preview({ ...draft, people: ["invalid"] })).rejects.toThrow("email addresses");
    expect(listMailbox).not.toHaveBeenCalled();
  });

  it("does not reuse stale preview data or write from a partial failed refresh", async () => {
    const { runtime } = await fixture();
    expect((await runtime.preview(draft)).count).toBe(1);
    vi.mocked(listMailbox).mockImplementation(async (name) => name === "asidebox" ? { ...box(name), status: "unavailable", detail: "secret output" } : box(name, [row()]));
    await expect(runtime.preview(draft)).rejects.toThrow("Could not check");
    await runtime.refresh();
    expect((await runtime.get()).errors._sync).toContain("Could not check");
    expect((await runtime.get()).errors._sync).not.toContain("secret");
    expect((await runtime.store.preview(draft)).count).toBe(0);
    expect(updateMailOrganization).not.toHaveBeenCalled();
  });

  it("replaces the old snapshot after a conversation leaves eligible mailboxes", async () => {
    const { runtime } = await fixture();
    await runtime.refresh();
    expect((await runtime.store.preview(draft)).count).toBe(1);
    vi.mocked(listMailbox).mockImplementation(async (name) => box(name));
    await runtime.refresh();
    expect((await runtime.store.preview(draft)).count).toBe(0);
    await runtime.store.save({ ...draft, labelId: undefined, name: "Second", labelName: "Second" });
    await runtime.store.idle();
    expect(createSplitLabel).not.toHaveBeenCalled();
  });

  it("coalesces concurrent refresh calls into a single mailbox scan", async () => {
    const entered = deferred<void>();
    const first = deferred<ImboxResult>();
    const { runtime } = await fixture();
    vi.mocked(listMailbox).mockImplementation(async (name) => {
      if (name === "imbox") { entered.resolve(); return first.promise; }
      return box(name);
    });
    const one = runtime.refresh();
    await entered.promise;
    const two = runtime.refresh(true);
    first.resolve(box("imbox", [row()]));
    await Promise.all([one, two]);
    expect(listMailbox).toHaveBeenCalledTimes(3);
    expect(updateMailOrganization).toHaveBeenCalledTimes(1);
  });

  it("rescans watch events that arrive during a scan before applying stale matches", async () => {
    const entered = deferred<void>();
    const first = deferred<ImboxResult>();
    const { runtime } = await fixture();
    let imboxReads = 0;
    vi.mocked(listMailbox).mockImplementation(async (name) => {
      if (name === "imbox" && ++imboxReads === 1) { entered.resolve(); return first.promise; }
      return box(name);
    });
    const refresh = runtime.refresh();
    await entered.promise;
    runtime.schedule();
    first.resolve(box("imbox", [row()]));
    await refresh;
    expect(listMailbox).toHaveBeenCalledTimes(6);
    expect(updateMailOrganization).not.toHaveBeenCalled();
    expect((await runtime.store.preview(draft)).count).toBe(0);
  });

  it("ignores Feed/Paper Trail observations while accepting workflow mailbox pages", async () => {
    const { runtime } = await fixture();
    runtime.observe("feedbox", box("feedbox", [row()]));
    runtime.observe("trailbox", box("trailbox", [row()]));
    await runtime.store.idle();
    expect(updateMailOrganization).not.toHaveBeenCalled();
    runtime.observe("imbox", box("imbox", [row()]));
    await runtime.store.idle();
    expect(updateMailOrganization).toHaveBeenCalledTimes(1);
  });

  it("does not scan with no enabled splits unless explicitly requested", async () => {
    const { runtime } = await fixture(false);
    await runtime.refresh();
    expect(listMailbox).not.toHaveBeenCalled();
    await runtime.refresh(true);
    expect(listMailbox).toHaveBeenCalledTimes(3);
    expect(updateMailOrganization).not.toHaveBeenCalled();
  });

  it("stops before additional reads, writes, or notifications on profile deactivation", async () => {
    const entered = deferred<void>();
    const first = deferred<ImboxResult>();
    const { runtime, onChange } = await fixture();
    vi.mocked(listMailbox).mockImplementation(async () => { entered.resolve(); return first.promise; });
    const refresh = runtime.refresh();
    await entered.promise;
    runtime.stop();
    const notifications = onChange.mock.calls.length;
    first.resolve(box("imbox", [row()]));
    await refresh;
    expect(listMailbox).toHaveBeenCalledTimes(1);
    expect(updateMailOrganization).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(notifications);
    await expect(runtime.preview(draft)).rejects.toThrow("no longer active");
  });
});
