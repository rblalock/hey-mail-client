import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImboxPosting, MailboxKey } from "../../shared/contracts";
import { splitContainsPosting } from "../../shared/mail-splits";

let stored: Map<string, string>;
beforeEach(() => { stored = new Map(); });
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

async function boot(search: string, profile = "a".repeat(32)) {
  vi.resetModules();
  stored.set("preview-profile", profile);
  const location = { search, reload: vi.fn() };
  vi.stubGlobal("location", location);
  vi.stubGlobal("window", { location });
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value); } });
  const { previewApi } = await import("./preview");
  return previewApi();
}

const fixture = () => (window as unknown as {
  __splitInboxPreview: {
    storageKey: string;
    mailboxSnapshot: () => Record<MailboxKey, ImboxPosting[]>;
    labelSnapshot: () => Array<{ id: string; name: string; postingIds: string[] }>;
  };
}).__splitInboxPreview;

describe("split inbox preview API", () => {
  it("leaves the existing sectioned fixture at 75 history rows with no seeded splits", async () => {
    const api = await boot("?sectioned-imbox");
    expect((await api.mail.getSplits()).splits).toEqual([]);
    expect((await api.mail.listMailbox("imbox")).postings.filter((posting) => posting.seen && !posting.bubbledUp)).toHaveLength(75);
  });

  it("seeds overlapping groups while preserving the outstanding counts", async () => {
    const api = await boot("?split-inbox");
    const state = await api.mail.getSplits();
    const boxes = fixture().mailboxSnapshot();
    const outstanding = [...boxes.imbox.filter((posting) => !posting.seen || posting.bubbledUp), ...boxes.laterbox, ...boxes.asidebox];
    expect(outstanding).toHaveLength(9);
    expect(Object.fromEntries(state.splits.map((split) => [split.id, outstanding.filter((posting) => splitContainsPosting(posting, split, state.memberships, state.ownEmail)).length]))).toEqual({ vip: 4, team: 5, github: 1 });
    expect(outstanding.filter((posting) => !state.splits.some((split) => splitContainsPosting(posting, split, state.memberships, state.ownEmail)))).toHaveLength(2);
    expect(state.memberships.vip).toContain("13000");
    expect((await api.settings.get()).imboxLayout).toBe("sectioned");
  });

  it("offers all 125 history rows with no duplicate topic IDs after merging pages", async () => {
    const api = await boot("?split-inbox");
    let page: string | undefined;
    const history = new Map<string, ImboxPosting>();
    let requests = 0;
    do {
      const result = await api.mail.listMailbox("imbox", { paginated: true, ...(page ? { page } : {}) });
      result.postings.filter((posting) => posting.seen && !posting.bubbledUp).forEach((posting) => history.set(posting.id, posting));
      page = result.nextPage;
      requests++;
    } while (page);
    expect(requests).toBe(5);
    expect(history.size).toBe(125);
    expect([...history.values()].slice(0, 50).some((posting) => posting.sender.email?.endsWith("@studio.example"))).toBe(false);
    expect([...history.values()].slice(100, 115).every((posting) => posting.sender.email === "notifications@github.example")).toBe(true);
  });

  it("previews without writing labels, then persists an enabled rule and notifies subscribers", async () => {
    const api = await boot("?split-inbox");
    const listener = vi.fn();
    const unsubscribe = api.mail.subscribeSplits(listener);
    const draft = { name: "Northline", enabled: true, people: [], domains: ["northline.example"], labelName: "Northline" };
    const before = fixture().labelSnapshot();
    const preview = await api.mail.previewSplit(draft);
    expect(preview.count).toBe(52);
    expect(preview.samples.length).toBeGreaterThan(0);
    expect(fixture().labelSnapshot()).toEqual(before);
    const state = await api.mail.saveSplit(draft);
    expect(state.splits).toHaveLength(4);
    expect(listener).toHaveBeenCalledOnce();
    const added = state.splits.find((split) => split.name === "Northline")!;
    expect(added.labelId).toBeDefined();
    expect(state.memberships[added.id]).toHaveLength(52);
    unsubscribe();
    const reloaded = await boot("?split-inbox");
    expect((await reloaded.mail.getSplits()).splits.find((split) => split.name === "Northline")?.id).toBe(added.id);
  });

  it("keeps disabled and removed labels intact, with separate profile definitions", async () => {
    const api = await boot("?split-inbox");
    const state = await api.mail.getSplits();
    const team = state.splits.find((split) => split.id === "team")!;
    const labels = fixture().labelSnapshot();
    await api.mail.saveSplit({ ...team, enabled: false });
    await api.mail.removeSplit(team.id);
    expect(fixture().labelSnapshot()).toEqual(labels);
    const second = await boot("?split-inbox", "b".repeat(32));
    expect((await second.mail.getSplits()).splits).toEqual([]);
    const first = await boot("?split-inbox");
    expect((await first.mail.getSplits()).splits.map((split) => split.id)).toEqual(["vip", "github"]);
    expect(fixture().labelSnapshot().find((label) => label.id === team.labelId)?.postingIds).toHaveLength(65);
  });

  it("uses real fixture label members and cursor pagination in the library", async () => {
    const api = await boot("?split-inbox");
    expect((await api.mail.listLibrary("labels")).items.some((label) => label.title === "Team")).toBe(true);
    const first = await api.mail.readLibrarySource("labels", "704");
    expect(first.totalCount).toBe(65);
    expect(first.postings).toHaveLength(25);
    const second = await api.mail.listLibraryThreads("labels", "704", first.nextPage);
    expect(second.postings).toHaveLength(25);
    const third = await api.mail.listLibraryThreads("labels", "704", second.nextPage);
    expect(third.postings).toHaveLength(15);
    expect(third.nextPage).toBeUndefined();
  });
});
