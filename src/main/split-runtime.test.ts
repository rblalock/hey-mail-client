import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeyAccountScope } from "../../resources/hey-account-scope.mjs";
import type { ImboxPosting, ImboxResult, MailboxKey, MailLibraryThreads } from "../shared/contracts";
import { SPLIT_MAILBOXES } from "../shared/mail-splits";
import { listLibrary, listLibraryThreads, listMailbox, updateMailOrganization } from "./hey";
import { profileRequest } from "./profile-process";
import { createSplitLabel } from "./split-label";
import { changesSplitSources, SplitRuntime } from "./split-runtime";

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
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("split runtime snapshots", () => {
  it("reads six bounded source heads and captures account and environment for reads and writes", async () => {
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
    expect(seenContexts).toEqual(SPLIT_MAILBOXES.map(() => context));
    expect(vi.mocked(listMailbox).mock.calls.map(([name]) => name)).toEqual(SPLIT_MAILBOXES);
    expect(vi.mocked(listMailbox).mock.calls.every((call) => call[2]?.paginated && call[2]?.singlePage)).toBe(true);
    expect(runWrite).toHaveBeenCalledTimes(1);
    expect((await runtime.get()).ownEmail).toBe("me@company.com");
  });

  it("does not label a partial snapshot before all six boxes have loaded", async () => {
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
    runtime.invalidate();
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
    await runtime.refresh(true);
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
    const two = runtime.refresh();
    first.resolve(box("imbox", [row()]));
    await Promise.all([one, two]);
    expect(listMailbox).toHaveBeenCalledTimes(6);
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
    expect(listMailbox).toHaveBeenCalledTimes(12);
    expect(updateMailOrganization).not.toHaveBeenCalled();
    expect((await runtime.store.preview(draft)).count).toBe(0);
  });

  it("accepts Feed, Paper Trail, and scheduled Bubble Up observations", async () => {
    const { runtime } = await fixture();
    runtime.observe("feedbox", box("feedbox", [row()]));
    runtime.observe("trailbox", box("trailbox", [row("11")]));
    runtime.observe("bubblebox", box("bubblebox", [row("12")]));
    await runtime.store.idle();
    expect(updateMailOrganization).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateMailOrganization).mock.calls[0]?.[0].postingIds).toEqual(["10", "11", "12"]);
  });

  it("does not scan with no enabled splits unless explicitly requested", async () => {
    const { runtime } = await fixture(false);
    await runtime.refresh();
    expect(listMailbox).not.toHaveBeenCalled();
    await runtime.refresh(true);
    expect(listMailbox).toHaveBeenCalledTimes(6);
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
    expect(listMailbox).toHaveBeenCalledTimes(3);
    expect(updateMailOrganization).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(notifications);
    await expect(runtime.preview(draft)).rejects.toThrow("no longer active");
  });
});

describe("account-wide split pages", () => {
  it("finds rule or linked-label members in their real sources, excluding outside-label-only rows", async () => {
    const { runtime, context } = await fixture(false);
    const manual = row("21", "manual@elsewhere.com");
    const outside = row("22", "outside@elsewhere.com");
    vi.mocked(listLibraryThreads).mockResolvedValue({ kind: "labels", id: "31", title: "Team", postings: [manual, outside] });
    const saved = await runtime.store.save({ ...draft, enabled: false });
    vi.mocked(listMailbox).mockImplementation(async (name) => {
      expect(profileRequest.getStore()).toBe(context);
      return box(name, name === "feedbox" ? [row("20"), manual] : name === "bubblebox" ? [row("23")] : []);
    });
    const result = await runtime.listMail(saved.splits[0]!.id);
    expect(Object.keys(result.mailboxes)).toEqual(SPLIT_MAILBOXES);
    expect(result.mailboxes.feedbox?.postings.map((item) => item.id)).toEqual(["20", "21"]);
    expect(result.mailboxes.bubblebox?.postings.map((item) => item.id)).toEqual(["23"]);
    expect(Object.values(result.mailboxes).flatMap((source) => source.postings).some((item) => item.id === "22")).toBe(false);
    expect(result.nextPage).toBeUndefined();
    expect(updateMailOrganization).not.toHaveBeenCalled();
  });

  it("carries empty match pages forward and bounds each continuation to six source reads", async () => {
    const { runtime } = await fixture();
    const id = (await runtime.get()).splits[0]!.id;
    vi.mocked(listMailbox).mockImplementation(async (name, _env, options) => {
      const page = Number(options?.page ?? "0");
      return { ...box(name, name === "trailbox" && page === 2 ? [row("55")] : [row("56", "other@example.com")]), ...(page < 3 ? { nextPage: String(page + 1) } : {}) };
    });
    const head = await runtime.listMail(id);
    expect(Object.values(head.mailboxes).flatMap((source) => source.postings)).toEqual([]);
    expect(head.nextPage).toBeTruthy();
    expect(listMailbox).toHaveBeenCalledTimes(6);
    const older = await runtime.listMail(id, head.nextPage);
    expect(older.nextPage).toBeTruthy();
    expect(listMailbox).toHaveBeenCalledTimes(12);
    const match = await runtime.listMail(id, older.nextPage);
    expect(match.mailboxes.trailbox?.postings.map((item) => item.id)).toEqual(["55"]);
    expect(listMailbox).toHaveBeenCalledTimes(18);
    await runtime.store.idle();
    expect(listLibraryThreads).toHaveBeenCalledTimes(1);
  });

  it("rejects cursors after split edits and across runtime/profile contexts", async () => {
    const { runtime } = await fixture();
    const split = (await runtime.get()).splits[0]!;
    vi.mocked(listMailbox).mockImplementation(async (name) => ({ ...box(name), nextPage: "older" }));
    const head = await runtime.listMail(split.id);
    await runtime.store.save({ ...split, domains: ["changed.com"] });
    vi.mocked(listMailbox).mockClear();
    await expect(runtime.listMail(split.id, head.nextPage)).rejects.toThrow("changed or its page expired");
    expect(listMailbox).not.toHaveBeenCalled();
    const other = await fixture();
    const otherSplit = (await other.runtime.get()).splits[0]!;
    await expect(other.runtime.listMail(otherSplit.id, head.nextPage)).rejects.toThrow("expired");
  });

  it("fails source errors explicitly and prevents cursor loops", async () => {
    const { runtime } = await fixture();
    const id = (await runtime.get()).splits[0]!.id;
    vi.mocked(listMailbox).mockImplementation(async (name) => name === "trailbox" ? { ...box(name), status: "unavailable", detail: "private data" } : box(name));
    await expect(runtime.listMail(id)).rejects.toThrow("Could not check all six");
    expect(updateMailOrganization).not.toHaveBeenCalled();
    vi.mocked(listMailbox).mockImplementation(async (name) => ({ ...box(name), nextPage: "same" }));
    const head = await runtime.listMail(id);
    await expect(runtime.listMail(id, head.nextPage)).rejects.toThrow("stopped making progress");
  });

  it("stops listing after account deactivation during a source read", async () => {
    const { runtime } = await fixture();
    const id = (await runtime.get()).splits[0]!.id;
    const entered = deferred<void>();
    const first = deferred<ImboxResult>();
    vi.mocked(listMailbox).mockImplementation(async () => { entered.resolve(); return first.promise; });
    const listing = runtime.listMail(id);
    await entered.promise;
    runtime.stop();
    first.resolve(box("imbox", [row()]));
    await expect(listing).rejects.toThrow("no longer active");
    expect(listMailbox).toHaveBeenCalledTimes(3);
    expect(updateMailOrganization).not.toHaveBeenCalled();
  });
});

describe("shared split source cache", () => {
  it("shows rule matches before a cold linked label finishes and then includes manual members", async () => {
    const { runtime, onChange } = await fixture(false);
    const saved = await runtime.store.save({ ...draft, enabled: false });
    await runtime.store.idle();
    const id = saved.splits[0]!.id;
    const waiting = deferred<MailLibraryThreads>();
    vi.mocked(listLibraryThreads).mockReturnValueOnce(waiting.promise);
    const manual = row("19", "manual@elsewhere.test");
    vi.mocked(listMailbox).mockImplementation(async (name) => box(name, name === "imbox" ? [row(), manual] : []));
    const first = await runtime.listMail(id, undefined, { progressive: true });
    expect(first.membershipLoading).toBe(true);
    expect(first.mailboxes.imbox?.postings.map((posting) => posting.id)).toEqual(["10"]);
    expect((await runtime.get()).loadingMemberships).toEqual([id]);
    expect(updateMailOrganization).not.toHaveBeenCalled();
    waiting.resolve({ kind: "labels", id: "31", title: "Team", postings: [manual] });
    await runtime.store.idle();
    await vi.waitFor(() => expect(onChange.mock.calls.at(-1)?.[0].loadingMemberships).toBeUndefined());
    const ready = await runtime.listMail(id, undefined, { progressive: true });
    expect(ready.membershipLoading).toBe(false);
    expect(ready.mailboxes.imbox?.postings.map((posting) => posting.id)).toEqual(["10", "19"]);
    expect(listMailbox).toHaveBeenCalledTimes(3);
    expect(updateMailOrganization).not.toHaveBeenCalled();
  });

  it("reports a cold linked-label read failure without blocking rule matches and retries explicitly", async () => {
    const { runtime } = await fixture(false);
    const saved = await runtime.store.save({ ...draft, enabled: false });
    await runtime.store.idle();
    const id = saved.splits[0]!.id;
    vi.mocked(listLibraryThreads).mockRejectedValue(new Error("private transport failure"));
    await runtime.listMail(id, undefined, { progressive: true });
    await vi.waitFor(async () => expect(Object.values((await runtime.get()).errors)).toEqual(expect.arrayContaining([expect.stringContaining("linked label")])));
    const result = await runtime.listMail(id, undefined, { progressive: true });
    expect(result.membershipError).toContain("linked label");
    expect(result.membershipError).not.toContain("private");
    expect(result.membershipLoading).toBe(false);
    expect(result.mailboxes.imbox?.postings).toHaveLength(1);
    expect(listLibraryThreads).toHaveBeenCalledTimes(1);
    vi.mocked(listLibraryThreads).mockResolvedValue({ kind: "labels", id: "31", title: "Team", postings: [] });
    runtime.invalidate();
    await runtime.listMail(id, undefined, { progressive: true });
    await runtime.store.idle();
    await vi.waitFor(async () => expect((await runtime.get()).errors).toEqual({}));
  });

  it("preserves native authentication failures and never caches them", async () => {
    const { runtime } = await fixture();
    vi.mocked(listMailbox).mockResolvedValue({ ...box("feedbox"), status: "needs-auth", detail: "Sign in again." });
    for (let attempt = 0; attempt < 2; attempt++) expect(await runtime.listMailbox("feedbox", { paginated: true, singlePage: true })).toMatchObject({ status: "needs-auth", detail: "Sign in again." });
    expect(listMailbox).toHaveBeenCalledTimes(2);
  });

  it("shares native first pages with split reads and refreshes only the requested mailbox", async () => {
    const { runtime } = await fixture();
    const id = (await runtime.get()).splits[0]!.id;
    await runtime.listMailbox("imbox", { paginated: true, singlePage: true });
    await runtime.listMail(id);
    expect(listMailbox).toHaveBeenCalledTimes(6);
    await runtime.listMailbox("imbox", { paginated: true, singlePage: true, refresh: true });
    await runtime.listMail(id);
    expect(listMailbox).toHaveBeenCalledTimes(7);
    expect(vi.mocked(listMailbox).mock.calls.filter(([name]) => name === "imbox")).toHaveLength(2);
  });

  it("publishes the first three split sources before the other heads and never walks history automatically", async () => {
    const { runtime } = await fixture();
    const id = (await runtime.get()).splits[0]!.id;
    vi.mocked(listMailbox).mockImplementation(async (name) => ({ ...box(name, [row()]), nextPage: "history" }));
    const first = await runtime.listMail(id, undefined, { progressive: true });
    expect(first.headComplete).toBe(false);
    expect(Object.keys(first.mailboxes)).toEqual(["imbox", "feedbox", "trailbox"]);
    expect(listMailbox).toHaveBeenCalledTimes(3);
    const second = await runtime.listMail(id, first.nextPage, { progressive: true });
    expect(second.headComplete).toBe(true);
    expect(Object.keys(second.mailboxes)).toEqual(["asidebox", "laterbox", "bubblebox"]);
    expect(second.nextPage).toBeTruthy();
    expect(listMailbox).toHaveBeenCalledTimes(6);
    expect(vi.mocked(listMailbox).mock.calls.every(([, , options]) => options?.page === undefined)).toBe(true);
  });

  it("deduplicates native and split in-flight heads and overlays confirmed seen state on old responses", async () => {
    const { runtime } = await fixture();
    const id = (await runtime.get()).splits[0]!.id;
    const waiting = deferred<ImboxResult>();
    vi.mocked(listMailbox).mockImplementation(async (name) => name === "imbox" ? waiting.promise : box(name));
    const native = runtime.listMailbox("imbox", { paginated: true, singlePage: true });
    const split = runtime.listMail(id, undefined, { progressive: true });
    await vi.waitFor(() => expect(listMailbox).toHaveBeenCalledTimes(3));
    runtime.applySeen(["10"], true);
    waiting.resolve(box("imbox", [row()]));
    expect((await native).postings[0]?.seen).toBe(true);
    expect((await split).mailboxes.imbox?.postings[0]?.seen).toBe(true);
    expect(listMailbox).toHaveBeenCalledTimes(3);
    expect((await runtime.listMailbox("imbox", { paginated: true, singlePage: true })).postings[0]?.seen).toBe(true);
  });

  it("ignores initial ready and applies metadata-only watch events without rescanning", async () => {
    const { runtime } = await fixture();
    const id = (await runtime.get()).splits[0]!.id;
    await runtime.listMail(id);
    await runtime.store.idle();
    vi.useFakeTimers();
    runtime.noteChange({ change: "ready" });
    runtime.noteChange({ change: "updated", metadataOnly: true, postingId: "10", postingSeen: true });
    await vi.advanceTimersByTimeAsync(1_500);
    expect((await runtime.listMail(id)).mailboxes.imbox?.postings[0]?.seen).toBe(true);
    expect(listMailbox).toHaveBeenCalledTimes(6);
  });

  it("invalidates only the changed source while retaining other source pages", async () => {
    const { runtime } = await fixture();
    const id = (await runtime.get()).splits[0]!.id;
    await runtime.listMail(id);
    runtime.noteChange({ change: "updated", postingId: "10", box: { id: "1", key: "imbox", name: "Imbox" } });
    await runtime.listMail(id);
    expect(listMailbox).toHaveBeenCalledTimes(7);
  });

  it("lets a fresh authoritative read replace seen state when another device changed it", async () => {
    const { runtime } = await fixture();
    const options = { paginated: true, singlePage: true };
    await runtime.listMailbox("imbox", options);
    runtime.applySeen(["10"], true);
    expect((await runtime.listMailbox("imbox", options)).postings[0]?.seen).toBe(true);
    // A missed watch event must not make a local read-state override permanent.
    expect((await runtime.listMailbox("imbox", { ...options, refresh: true })).postings[0]?.seen).toBe(false);
    expect((await runtime.listMailbox("imbox", options)).postings[0]?.seen).toBe(false);
    expect(listMailbox).toHaveBeenCalledTimes(2);
  });

  it.each(["send", "send-draft", "bulk-reply-send", "bulk-reply-undo", "unbundle-contact", "update-set-aside-group", "update-organization"])("invalidates split sources for %s", (command) => {
    expect(changesSplitSources(`mail:${command}`)).toBe(true);
  });

  it.each(["edit-draft", "delete-draft", "list-drafts", "show-draft", "bulk-reply-preview", "list-split-mail", "preview-split", "get-splits", "select-attachments", "paste-attachments"])("does not invalidate sources for draft-only/readonly/composer command %s", (command) => {
    expect(changesSplitSources(`mail:${command}`)).toBe(false);
  });

  it("reuses six heads across split changes and previews without aliasing returned rows", async () => {
    const { runtime } = await fixture();
    const saved = await runtime.store.save({ ...draft, enabled: false, name: "Friends" });
    await runtime.store.idle();
    const [one, two] = saved.splits;
    const result = await runtime.listMail(one!.id);
    result.mailboxes.imbox!.postings[0]!.subject = "Changed only in caller";
    expect((await runtime.listMail(two!.id)).mailboxes.imbox?.postings[0]?.subject).toBe("Fictional subject");
    await runtime.preview(draft);
    await runtime.listMail(one!.id);
    expect(listMailbox).toHaveBeenCalledTimes(6);
  });

  it("deduplicates concurrent snapshot and list reads with at most three CLI requests running", async () => {
    const { runtime } = await fixture();
    const id = (await runtime.get()).splits[0]!.id;
    const pending: { name: MailboxKey; done: ReturnType<typeof deferred<ImboxResult>> }[] = [];
    let active = 0;
    let peak = 0;
    vi.mocked(listMailbox).mockImplementation(async (name) => {
      active += 1;
      peak = Math.max(peak, active);
      const done = deferred<ImboxResult>();
      pending.push({ name, done });
      try { return await done.promise; } finally { active -= 1; }
    });
    const preview = runtime.preview(draft);
    const listing = runtime.listMail(id);
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    for (const item of pending.slice(0, 3)) item.done.resolve(box(item.name));
    await vi.waitFor(() => expect(pending).toHaveLength(6));
    for (const item of pending.slice(3)) item.done.resolve(box(item.name));
    await Promise.all([preview, listing]);
    expect(listMailbox).toHaveBeenCalledTimes(6);
    expect(peak).toBe(3);
  });

  it("expires source pages after thirty seconds and keeps the cache account-owned", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
    const { runtime } = await fixture();
    const id = (await runtime.get()).splits[0]!.id;
    await runtime.listMail(id);
    now.mockReturnValue(129_999);
    await runtime.listMail(id);
    expect(listMailbox).toHaveBeenCalledTimes(6);
    now.mockReturnValue(130_000);
    await runtime.listMail(id);
    expect(listMailbox).toHaveBeenCalledTimes(12);
    const second = await fixture();
    await second.runtime.listMail((await second.runtime.get()).splits[0]!.id);
    expect(listMailbox).toHaveBeenCalledTimes(18);
  });

  it("shares older source pages across splits and evicts least recently used pages at its bound", async () => {
    const { runtime } = await fixture();
    const state = await runtime.store.save({ ...draft, enabled: false, name: "Friends" });
    await runtime.store.idle();
    const [one, two] = state.splits;
    vi.mocked(listMailbox).mockImplementation(async (name, _env, options) => ({ ...box(name), nextPage: String(Number(options?.page ?? "0") + 1) }));
    const first = await runtime.listMail(one!.id);
    const second = await runtime.listMail(two!.id);
    await runtime.listMail(two!.id, second.nextPage);
    await runtime.listMail(one!.id, first.nextPage);
    expect(listMailbox).toHaveBeenCalledTimes(12);
    let page = first.nextPage;
    for (let index = 1; index <= 16; index += 1) page = (await runtime.listMail(one!.id, page)).nextPage;
    expect(listMailbox).toHaveBeenCalledTimes(102);
    await runtime.listMail(one!.id);
    expect(listMailbox).toHaveBeenCalledTimes(108);
  });

  it("invalidates cached heads after watch/mutation scheduling and on explicit refresh", async () => {
    const { runtime } = await fixture();
    const id = (await runtime.get()).splits[0]!.id;
    await runtime.listMail(id);
    vi.mocked(listMailbox).mockImplementation(async (name) => box(name));
    runtime.schedule();
    expect((await runtime.listMail(id)).mailboxes.imbox?.postings).toEqual([]);
    expect(listMailbox).toHaveBeenCalledTimes(12);
    await runtime.refresh(true);
    expect(listMailbox).toHaveBeenCalledTimes(18);
    await runtime.listMail(id);
    expect(listMailbox).toHaveBeenCalledTimes(18);
  });

  it("never repopulates the cache or observes stale list results after invalidation during a read", async () => {
    const { runtime } = await fixture();
    const id = (await runtime.get()).splits[0]!.id;
    const pending: { name: MailboxKey; done: ReturnType<typeof deferred<ImboxResult>> }[] = [];
    vi.mocked(listMailbox).mockImplementation(async (name) => {
      const done = deferred<ImboxResult>();
      pending.push({ name, done });
      return done.promise;
    });
    const stale = runtime.listMail(id);
    const rejected = expect(stale).rejects.toThrow("Mail changed");
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    runtime.invalidate();
    vi.mocked(listMailbox).mockImplementation(async (name) => box(name));
    const fresh = runtime.listMail(id);
    for (const item of pending) item.done.resolve(box(item.name, [row()]));
    await rejected;
    expect(Object.values((await fresh).mailboxes).flatMap((source) => source.postings)).toEqual([]);
    expect(listMailbox).toHaveBeenCalledTimes(9);
    await runtime.listMail(id);
    expect(listMailbox).toHaveBeenCalledTimes(9);
    await runtime.store.idle();
    expect(updateMailOrganization).not.toHaveBeenCalled();
  });

  it("rechecks an in-flight background scan when force-refreshed before labeling", async () => {
    const { runtime } = await fixture();
    const entered = deferred<void>();
    const first = deferred<ImboxResult>();
    let imboxReads = 0;
    vi.mocked(listMailbox).mockImplementation(async (name) => {
      if (name === "imbox" && ++imboxReads === 1) { entered.resolve(); return first.promise; }
      return box(name);
    });
    const stale = runtime.refresh();
    await entered.promise;
    const fresh = runtime.refresh(true);
    first.resolve(box("imbox", [row()]));
    await Promise.all([stale, fresh]);
    expect(listMailbox).toHaveBeenCalledTimes(12);
    expect(updateMailOrganization).not.toHaveBeenCalled();
    expect((await runtime.store.preview(draft)).count).toBe(0);
  });
});
