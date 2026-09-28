import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImboxPosting, MailboxKey, MailCompletionState } from "../../shared/contracts";
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
    expect((await api.mail.listMailbox("feedbox")).postings).toEqual([]);
    expect((await api.mail.listMailbox("trailbox")).postings).toEqual([]);
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
    expect(fixture().labelSnapshot().find((label) => label.id === team.labelId)?.postingIds).toHaveLength(68);
  });

  it("uses real fixture label members and cursor pagination in the library", async () => {
    const api = await boot("?split-inbox");
    expect((await api.mail.listLibrary("labels")).items.some((label) => label.title === "Team")).toBe(true);
    const first = await api.mail.readLibrarySource("labels", "704");
    expect(first.totalCount).toBe(68);
    expect(first.postings).toHaveLength(25);
    const second = await api.mail.listLibraryThreads("labels", "704", first.nextPage);
    expect(second.postings).toHaveLength(25);
    const third = await api.mail.listLibraryThreads("labels", "704", second.nextPage);
    expect(third.postings).toHaveLength(18);
    expect(third.nextPage).toBeUndefined();
  });

  it("lists split matches from all six sources and keeps an empty history continuation usable", async () => {
    const api = await boot("?split-inbox");
    const first = await api.mail.listSplitMail("team");
    expect(Object.keys(first.mailboxes).sort()).toEqual(["asidebox", "bubblebox", "feedbox", "imbox", "laterbox", "trailbox"]);
    expect(first.mailboxes.feedbox?.postings.map((posting) => posting.id)).toEqual(["2601"]);
    expect(first.mailboxes.trailbox?.postings.map((posting) => posting.id)).toEqual(["2701"]);
    expect(first.mailboxes.bubblebox?.postings.map((posting) => posting.id)).toEqual(["2501"]);
    expect(first.mailboxes.imbox?.postings.map((posting) => posting.id)).not.toContain("2601");
    expect(Object.values(first.mailboxes).every((result) => result?.nextPage === undefined)).toBe(true);
    const second = await api.mail.listSplitMail("team", first.nextPage);
    expect(Object.values(second.mailboxes).flatMap((result) => result?.postings ?? [])).toEqual([]);
    expect(second.nextPage).toBeDefined();
    expect(second.nextPage).not.toBe(first.nextPage);
    const loaded = new Map(Object.values(first.mailboxes).flatMap((result) => result?.postings.map((posting) => [posting.id, posting] as const) ?? []));
    let page = second.nextPage;
    let reads = 2;
    while (page) {
      const next = await api.mail.listSplitMail("team", page);
      Object.values(next.mailboxes).forEach((result) => result?.postings.forEach((posting) => loaded.set(posting.id, posting)));
      page = next.nextPage;
      if (++reads > 6) throw new Error("Preview history cursor did not finish.");
    }
    expect(reads).toBe(5);
    expect(loaded.size).toBe(68);
    expect(loaded.has("3124")).toBe(true);
  });

  it("rejects continuation cursors for a different split, account, or changed rule", async () => {
    const api = await boot("?split-inbox");
    const first = await api.mail.listSplitMail("team");
    await expect(api.mail.listSplitMail("vip", first.nextPage)).rejects.toThrow(/page expired/);
    await expect(api.mail.listSplitMail("team", "unknown-page")).rejects.toThrow(/page expired/);
    const team = (await api.mail.getSplits()).splits.find((split) => split.id === "team")!;
    await api.mail.saveSplit({ ...team, name: "Studio team" });
    await expect(api.mail.listSplitMail("team", first.nextPage)).rejects.toThrow(/page expired/);
    const secondAccount = await boot("?split-inbox", "b".repeat(32));
    await secondAccount.mail.saveSplit({ name: "Team", enabled: true, people: [], domains: ["studio.example"], labelName: "Team" });
    await expect(secondAccount.mail.listSplitMail("team", first.nextPage)).rejects.toThrow(/no longer exists/);
  });

  it("adds nonmatching conversations to an existing split label without moving mail or replacing its rules", async () => {
    const api = await boot("?split-inbox");
    const listener = vi.fn();
    api.mail.subscribeSplits(listener);
    const before = fixture().mailboxSnapshot();
    const state = await api.mail.addToSplit({ splitId: "team", postingIds: ["2702", "2103"] });
    expect(state.memberships.team).toEqual(expect.arrayContaining(["12702", "12103"]));
    expect(state.splits.find((split) => split.id === "team")).toMatchObject({ people: [], domains: ["studio.example"], labelId: "704" });
    expect(fixture().mailboxSnapshot()).toEqual(before);
    expect(listener).toHaveBeenCalledOnce();
    const page = await api.mail.listSplitMail("team");
    expect(page.mailboxes.trailbox?.postings.map((posting) => posting.id)).toContain("2702");
    const reloaded = await boot("?split-inbox");
    expect((await reloaded.mail.getSplits()).memberships.team).toEqual(expect.arrayContaining(["12702", "12103"]));
  });

  it("creates a manual label for a paused split and merges optional future rules additively", async () => {
    const api = await boot("?split-inbox");
    const saved = await api.mail.saveSplit({ name: "Manual", enabled: false, people: ["sam@example.com"], domains: [], labelName: "Manual" });
    const manual = saved.splits.find((split) => split.name === "Manual")!;
    expect(manual.labelId).toBeUndefined();
    const state = await api.mail.addToSplit({ splitId: manual.id, postingIds: ["2702"], people: ["SAM@EXAMPLE.COM", "maya@studio.example"], domains: ["@northline.example"] });
    expect(state.splits.find((split) => split.id === manual.id)).toMatchObject({ enabled: false, people: ["sam@example.com", "maya@studio.example"], domains: ["northline.example"] });
    expect(state.splits.find((split) => split.id === manual.id)?.labelId).toBeDefined();
    expect(state.memberships[manual.id]).toEqual(["12702"]);
    const enabled = await api.mail.saveSplit({ ...state.splits.find((split) => split.id === manual.id)!, enabled: true });
    expect(enabled.memberships[manual.id]).toEqual(expect.arrayContaining(["12702", "12601", "12501"]));
  });

  it("validates merged limits and selected preview IDs before adding a label", async () => {
    const api = await boot("?split-inbox");
    const saved = await api.mail.saveSplit({ name: "Full", enabled: false, people: Array.from({ length: 50 }, (_, index) => `person${index}@example.com`), domains: [], labelName: "Full" });
    const split = saved.splits.find((item) => item.name === "Full")!;
    const before = fixture().labelSnapshot();
    await expect(api.mail.addToSplit({ splitId: split.id, postingIds: ["2702"], people: ["another@example.com"] })).rejects.toThrow(/at most 50/);
    await expect(api.mail.addToSplit({ splitId: split.id, postingIds: ["999999"] })).rejects.toThrow(/unavailable/);
    expect(fixture().labelSnapshot()).toEqual(before);
    expect((await api.mail.getSplits()).splits.find((item) => item.id === split.id)?.labelId).toBeUndefined();
  });

  it("marks Feed, Paper Trail and scheduled Bubble Up seen in place while completing saved and due mail", async () => {
    const api = await boot("?split-inbox");
    const original = fixture().mailboxSnapshot();
    const selections = [["feedbox", "2601"], ["trailbox", "2701"], ["bubblebox", "2501"], ["laterbox", "2201"], ["imbox", "2401"]] as const;
    const completion: MailCompletionState[] = selections.map(([sourceBox, id]) => {
      const posting = original[sourceBox].find((item) => item.id === id)!;
      return { id, sourceBox, seen: posting.seen, bubbledUp: sourceBox === "imbox" && posting.bubbledUp === true };
    });
    const done = await api.mail.mutate({ operation: "done", postingIds: completion.map((item) => item.id), completion });
    const changed = fixture().mailboxSnapshot();
    for (const [box, id] of selections.slice(0, 3)) expect(changed[box].find((item) => item.id === id)?.seen).toBe(true);
    expect(changed.imbox.some((item) => ["2601", "2701", "2501"].includes(item.id))).toBe(false);
    expect(changed.laterbox.some((item) => item.id === "2201")).toBe(false);
    expect(changed.imbox.find((item) => item.id === "2201")?.seen).toBe(true);
    expect(changed.imbox.find((item) => item.id === "2401")?.bubbledUp).toBe(false);
    await api.mail.mutate(done.undo!);
    for (const item of completion) expect(fixture().mailboxSnapshot()[item.sourceBox].find((posting) => posting.id === item.id)).toMatchObject({ seen: item.seen, bubbledUp: item.bubbledUp });
  });
});
