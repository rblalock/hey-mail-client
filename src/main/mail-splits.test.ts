import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImboxPosting } from "../shared/contracts";
import type { MailSplitDraft } from "../shared/mail-splits";
import { MailSplits, type MailSplitDependencies } from "./mail-splits";

const roots: string[] = [];
const instances: MailSplits[] = [];
afterEach(async () => {
  instances.splice(0).forEach((service) => service.stop());
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const draft: MailSplitDraft = { name: "Team", enabled: true, people: [], domains: ["company.com"], labelName: "Team" };
const row = (id = "10", email = "person@company.com"): ImboxPosting => ({ id, topicId: String(Number(id) + 1_000), subject: "Private subject", summary: "Private body", seen: false, createdAt: "2026-09-27", visibleEntryCount: 1, contacts: [], sender: { name: "Person", email } });
const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

async function fixture(overrides: Partial<MailSplitDependencies> = {}) {
  const root = await mkdtemp(join(tmpdir(), "hey-agent-splits-"));
  roots.push(root);
  const file = join(root, "mail-splits.json");
  const dependencies: MailSplitDependencies = {
    listLabels: vi.fn(async () => [{ id: "31", name: "Existing" }]),
    listLabelPage: vi.fn(async () => ({ postings: [] })),
    createLabel: vi.fn(async (name) => ({ id: "32", name })),
    addLabel: vi.fn(async () => undefined),
    onChange: vi.fn(),
    ...overrides,
  };
  const service = new MailSplits(file, dependencies);
  instances.push(service);
  return { root, file, dependencies, service };
}

describe("profile split configuration", () => {
  it("keeps get and preview read-only, with explicit scoped sample counts", async () => {
    const { service, dependencies } = await fixture();
    expect(await service.get()).toEqual({ splits: [], errors: {}, memberships: {} });
    await service.observe([row(), row("11", "other@example.com")]);
    const preview = await service.preview(draft);
    expect(preview).toMatchObject({ count: 1, scannedCount: 2, samples: [row()] });
    expect(preview.scope).toContain("currently loaded");
    expect(preview.scope).toContain("Older mail");
    expect(dependencies.createLabel).not.toHaveBeenCalled();
    expect(dependencies.addLabel).not.toHaveBeenCalled();
    expect(dependencies.listLabels).not.toHaveBeenCalled();
  });

  it("serializes portable definitions without persisting mail, errors, or memberships", async () => {
    const { service, file, dependencies } = await fixture();
    await Promise.all([service.save({ ...draft, enabled: false }), service.save({ ...draft, name: "Friends", enabled: false, labelName: "Friends" })]);
    const state = await service.get();
    expect(state.splits).toHaveLength(2);
    expect(state.splits[0]!.id).not.toBe(state.splits[1]!.id);
    await service.observe([row()]);
    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved).toEqual({ version: 1, splits: state.splits });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const reopened = new MailSplits(file, dependencies);
    instances.push(reopened);
    expect((await reopened.get()).splits).toEqual(state.splits);
    expect(dependencies.createLabel).not.toHaveBeenCalled();
    expect(dependencies.addLabel).not.toHaveBeenCalled();
  });

  it("rejects invented IDs, duplicate names, and other-account label IDs", async () => {
    const { service } = await fixture();
    await expect(service.save({ ...draft, id: "not-saved" })).rejects.toThrow("no longer exists");
    await expect(service.save({ ...draft, labelId: "999" })).rejects.toThrow("this account");
    await service.save(draft);
    await expect(service.save({ ...draft, name: "TEAM" })).rejects.toThrow("already exists");
    expect((await service.get()).splits).toHaveLength(1);
  });

  it("fails closed on malformed saved rules without overwriting the file", async () => {
    const { service, file, dependencies } = await fixture();
    await service.get();
    await writeFile(file, "invalid saved data");
    const bad = new MailSplits(file, dependencies);
    instances.push(bad);
    await expect(bad.get()).rejects.toThrow("left unchanged");
    await expect(bad.save(draft)).rejects.toThrow("left unchanged");
    expect(await readFile(file, "utf8")).toBe("invalid saved data");
    expect(dependencies.createLabel).not.toHaveBeenCalled();
  });
});

describe("additive split label synchronization", () => {
  it("defers label creation until a match, records returned ID, and ignores watcher echoes", async () => {
    const { service, dependencies, file } = await fixture();
    const state = await service.save(draft);
    await service.idle();
    expect(dependencies.createLabel).not.toHaveBeenCalled();
    await service.observe([row("10", "unrelated@example.com")]);
    expect(dependencies.createLabel).not.toHaveBeenCalled();
    await service.observe([row()]);
    expect(dependencies.createLabel).toHaveBeenCalledExactlyOnceWith("Team", ["10"]);
    expect(dependencies.addLabel).not.toHaveBeenCalled();
    expect((await service.get()).splits[0]!.labelId).toBe("32");
    expect((await service.get()).memberships[state.splits[0]!.id]).toEqual(["1010"]);
    expect(JSON.parse(await readFile(file, "utf8")).splits[0].labelId).toBe("32");
    await service.observe([row(), row()]);
    await service.observe([row()]);
    expect(dependencies.createLabel).toHaveBeenCalledTimes(1);
    expect(dependencies.addLabel).not.toHaveBeenCalled();
  });

  it("loads every membership page, keeps manual members, and only labels missing rows", async () => {
    const manual = row("99", "manual@elsewhere.com");
    const listLabelPage = vi.fn(async (_id: string, page?: string) => page ? { postings: [manual] } : { postings: [row()], nextPage: "next" });
    const { service, dependencies } = await fixture({ listLabelPage });
    const saved = await service.save({ ...draft, labelId: "31" });
    await service.observe([row(), row("11")]);
    expect(listLabelPage.mock.calls).toEqual([["31", undefined], ["31", "next"]]);
    expect(dependencies.addLabel).toHaveBeenCalledExactlyOnceWith("31", ["11"]);
    expect((await service.get()).memberships[saved.splits[0]!.id]).toEqual(["1010", "1099", "1011"]);
  });

  it("can reuse an existing same-named label before deferred creation", async () => {
    const { service, dependencies } = await fixture({ listLabels: vi.fn(async () => [{ id: "33", name: "Team" }]) });
    await service.save(draft);
    await service.observe([row()]);
    expect(dependencies.createLabel).not.toHaveBeenCalled();
    expect(dependencies.addLabel).toHaveBeenCalledExactlyOnceWith("33", ["10"]);
    expect((await service.get()).splits[0]!.labelId).toBe("33");
  });

  it("supports overlapping splits without duplicate writes to the same linked label", async () => {
    const { service, dependencies } = await fixture();
    await service.save({ ...draft, labelId: "31" });
    await service.save({ ...draft, name: "VIP", people: ["person@company.com"], domains: [], labelId: "31" });
    await service.observe([row()]);
    expect(dependencies.addLabel).toHaveBeenCalledExactlyOnceWith("31", ["10"]);
    expect(Object.values((await service.get()).memberships)).toEqual([["1010"], ["1010"]]);
  });

  it("does not relabel old rows on process restart", async () => {
    const listLabelPage = vi.fn(async () => ({ postings: [] as ImboxPosting[] }));
    const { service, file, dependencies } = await fixture({ listLabelPage });
    await service.save({ ...draft, labelId: "31" });
    await service.observe([row()]);
    service.stop();
    listLabelPage.mockResolvedValue({ postings: [row()] });
    const restarted = new MailSplits(file, dependencies);
    instances.push(restarted);
    await restarted.observe([row()]);
    expect(dependencies.addLabel).toHaveBeenCalledTimes(1);
  });

  it("backs off after errors and refreshes authoritative state before retry", async () => {
    let now = 100;
    const addLabel = vi.fn().mockRejectedValueOnce(new Error("Private CLI details secret=123")).mockResolvedValue(undefined);
    const { service, dependencies } = await fixture({ addLabel, now: () => now });
    const saved = await service.save({ ...draft, labelId: "31" });
    await service.observe([row()]);
    expect((await service.get()).errors[saved.splits[0]!.id]).toContain("Could not sync");
    expect(JSON.stringify(await service.get())).not.toContain("secret=123");
    await service.observe([row()]);
    expect(addLabel).toHaveBeenCalledTimes(1);
    now += 30_001;
    await service.observe([row()]);
    expect(addLabel).toHaveBeenCalledTimes(2);
    expect(dependencies.listLabelPage).toHaveBeenCalledTimes(2);
    expect((await service.get()).errors).toEqual({});
  });

  it("recovers an uncertain create response through label lookup without creating twice", async () => {
    let created = false;
    let now = 0;
    const { service, dependencies } = await fixture({
      listLabels: vi.fn(async () => created ? [{ id: "45", name: "Team" }] : []),
      createLabel: vi.fn(async () => { created = true; throw new Error("transport interrupted"); }),
      listLabelPage: vi.fn(async () => ({ postings: created ? [row()] : [] })),
      now: () => now,
    });
    await service.save(draft);
    await service.observe([row()]);
    now += 30_001;
    await service.observe([row()]);
    expect(dependencies.createLabel).toHaveBeenCalledTimes(1);
    expect(dependencies.addLabel).not.toHaveBeenCalled();
    expect((await service.get()).splits[0]!.labelId).toBe("45");
  });

  it("does not retry an unconfirmed creation after app restart when the new label is not visible", async () => {
    const { service, file, dependencies } = await fixture({ createLabel: vi.fn(async () => { throw new Error("transport interrupted"); }) });
    await service.save(draft);
    await service.observe([row()]);
    const pending = JSON.parse(await readFile(`${file}.pending-labels.json`, "utf8"));
    expect(Object.values(pending)).toEqual(["Team"]);
    service.stop();
    const restarted = new MailSplits(file, dependencies);
    instances.push(restarted);
    await restarted.observe([row()]);
    expect(dependencies.createLabel).toHaveBeenCalledTimes(1);
    expect(Object.values((await restarted.get()).errors)[0]).toContain("could not be confirmed");
    expect(dependencies.addLabel).not.toHaveBeenCalled();
  });

  it("reconciles an uncertain create immediately on explicit Retry without bypassing its creation fence", async () => {
    let visible = false;
    const { service, dependencies } = await fixture({
      listLabels: vi.fn(async () => visible ? [{ id: "45", name: "Team" }] : []),
      createLabel: vi.fn(async () => { throw new Error("transport interrupted"); }),
      listLabelPage: vi.fn(async () => ({ postings: [row()] })),
      now: () => 100,
    });
    await service.save(draft);
    await service.observe([row()]);
    await service.refreshMemberships();
    await service.idle();
    expect(dependencies.createLabel).toHaveBeenCalledTimes(1);
    expect(Object.values((await service.get()).errors)[0]).toContain("could not be confirmed");
    visible = true;
    await service.refreshMemberships();
    await service.idle();
    expect((await service.get()).splits[0]!.labelId).toBe("45");
    expect((await service.get()).errors).toEqual({});
    expect(dependencies.createLabel).toHaveBeenCalledTimes(1);
    expect(dependencies.addLabel).not.toHaveBeenCalled();
  });

  it("guards own-domain matching consistently in previews and background writes", async () => {
    const { service, dependencies } = await fixture({ ownEmail: "me@company.com" });
    await service.save(draft);
    await service.observe([{ ...row("10", "other@elsewhere.com"), addressedContacts: [{ name: "Me", email: "me@company.com" }] }]);
    expect((await service.preview(draft)).count).toBe(0);
    expect((await service.get()).ownEmail).toBe("me@company.com");
    expect(dependencies.createLabel).not.toHaveBeenCalled();
    await service.observe([{ ...row("11", "me@company.com"), contacts: [{ name: "Colleague", email: "colleague@company.com" }] }]);
    expect(dependencies.createLabel).toHaveBeenCalledExactlyOnceWith("Team", ["11"]);
  });

  it("reports malformed and looping membership responses instead of applying labels", async () => {
    const { service, dependencies } = await fixture({ listLabelPage: vi.fn(async () => ({ postings: [], nextPage: "same-page" })) });
    const saved = await service.save({ ...draft, labelId: "31" });
    await service.observe([row()]);
    expect(dependencies.listLabelPage).toHaveBeenCalledTimes(2);
    expect(dependencies.addLabel).not.toHaveBeenCalled();
    expect((await service.get()).errors[saved.splits[0]!.id]).toContain("history");
  });

  it("bounds a very large linked label with an explicit incomplete error", async () => {
    let page = 0;
    const { service, dependencies } = await fixture({ listLabelPage: vi.fn(async () => ({ postings: [], nextPage: String(++page) })) });
    const saved = await service.save({ ...draft, labelId: "31" });
    await service.observe([row()]);
    expect(dependencies.listLabelPage).toHaveBeenCalledTimes(200);
    expect(dependencies.addLabel).not.toHaveBeenCalled();
    expect((await service.get()).errors[saved.splits[0]!.id]).toContain("too much history");
  });
});

describe("split lifecycle and account boundaries", () => {
  it("allows disabling offline and cancels queued batches without removing labels", async () => {
    const started = deferred();
    const finish = deferred();
    const addLabel = vi.fn(async (_labelId: string, _postingIds: string[]) => { started.resolve(); await finish.promise; });
    const { service, dependencies } = await fixture({ addLabel });
    const state = await service.save({ ...draft, labelId: "31" });
    const observing = service.observe(Array.from({ length: 30 }, (_, index) => row(String(10 + index))));
    await started.promise;
    vi.mocked(dependencies.listLabels).mockRejectedValue(new Error("offline"));
    await service.save({ ...state.splits[0], enabled: false });
    finish.resolve();
    await observing;
    expect(addLabel).toHaveBeenCalledTimes(1);
    expect(addLabel.mock.calls[0]![1]).toHaveLength(25);
    expect((await service.get()).splits[0]).toMatchObject({ enabled: false, labelId: "31" });
  });

  it("does not resurrect a split deleted while label creation is already in flight", async () => {
    const started = deferred();
    const finish = deferred<{ id: string; name: string }>();
    const { service, dependencies } = await fixture({ createLabel: vi.fn(async () => { started.resolve(); return finish.promise; }) });
    const state = await service.save(draft);
    const observing = service.observe(Array.from({ length: 30 }, (_, index) => row(String(10 + index))));
    await started.promise;
    await service.remove(state.splits[0]!.id);
    finish.resolve({ id: "32", name: "Team" });
    await observing;
    expect((await service.get()).splits).toEqual([]);
    expect(dependencies.addLabel).not.toHaveBeenCalled();
  });

  it("drops stale mailbox rows from queued batches after a move or delete", async () => {
    const started = deferred();
    const finish = deferred();
    const addLabel = vi.fn(async (_id: string, _postingIds: string[]) => { started.resolve(); await finish.promise; });
    const { service } = await fixture({ addLabel });
    await service.save({ ...draft, labelId: "31" });
    const observing = service.observe(Array.from({ length: 30 }, (_, index) => row(String(10 + index))));
    await started.promise;
    service.forget(["35", "36", "37", "38", "39"]);
    finish.resolve();
    await observing;
    expect(addLabel).toHaveBeenCalledTimes(1);
    expect((await service.preview(draft)).scannedCount).toBe(25);
    await service.replaceObserved([row("50", "nonmatching@elsewhere.com")]);
    expect((await service.preview(draft)).count).toBe(0);
    expect(addLabel).toHaveBeenCalledTimes(1);
  });

  it("stops before a write if account deactivation occurs during membership loading", async () => {
    const started = deferred();
    const finish = deferred<{ postings: ImboxPosting[] }>();
    const { service, dependencies } = await fixture({ listLabelPage: vi.fn(async () => { started.resolve(); return finish.promise; }) });
    await service.save({ ...draft, labelId: "31" });
    const observing = service.observe([row()]);
    await started.promise;
    service.stop();
    finish.resolve({ postings: [] });
    await observing;
    expect(dependencies.addLabel).not.toHaveBeenCalled();
    await expect(service.save(draft)).rejects.toThrow("no longer active");
  });

  it("keeps profile definitions, membership and write dependencies isolated", async () => {
    const first = await fixture();
    const second = await fixture();
    await first.service.save({ ...draft, labelId: "31" });
    await second.service.save({ ...draft, labelId: "31", domains: ["other.com"] });
    await Promise.all([first.service.observe([row()]), second.service.observe([row()])]);
    expect(first.dependencies.addLabel).toHaveBeenCalledExactlyOnceWith("31", ["10"]);
    expect(second.dependencies.addLabel).not.toHaveBeenCalled();
    expect(Object.values((await second.service.get()).memberships)).toEqual([[]]);
  });
});
