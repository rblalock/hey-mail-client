import { describe, expect, it } from "vitest";
import type { ImboxPosting, ImboxResult, MailboxKey } from "../../shared/contracts";
import type { MailSplit, MailSplitState } from "../../shared/mail-splits";
import { filterSplitMailboxes, splitDraftFromPosting, splitPendingCounts, splitViewIds } from "./split-mailbox";
import { groupSectionedImbox, type SectionedMailboxes } from "./sectioned-imbox";

const ownEmail = "me@company.test";
const row = (id: string, email = "jamie@company.test", overrides: Partial<ImboxPosting> = {}): ImboxPosting => ({
  id, topicId: `thread-${id}`, subject: `Conversation ${id}`, summary: "Summary", seen: false, createdAt: "2026-09-27T12:00:00Z",
  contacts: [], sender: { name: "Jamie", email }, visibleEntryCount: 1, ...overrides,
});
const box = (boxKey: MailboxKey, postings: ImboxPosting[], overrides: Partial<ImboxResult> = {}): ImboxResult => ({
  boxKey, boxName: boxKey, status: "ready", postings, ...overrides,
});
const split = (id: string, overrides: Partial<MailSplit> = {}): MailSplit => ({
  id, name: id, enabled: true, people: [], domains: [], labelName: id, ...overrides,
});
const team = split("team", { domains: ["company.test"] });
const vip = split("vip", { people: ["jamie@company.test"] });
const state = (splits: MailSplit[] = [vip, team], memberships: MailSplitState["memberships"] = {}): MailSplitState => ({ splits, memberships, errors: {}, ownEmail });
const ids = (mailboxes: SectionedMailboxes, name: MailboxKey = "imbox") => mailboxes[name]?.postings.map((posting) => posting.id);

describe("split mailbox views", () => {
  it("keeps enabled tab order between All and Remaining", () => {
    expect(splitViewIds(state([vip, split("disabled", { enabled: false }), team]))).toEqual(["all", "vip", "team", "remaining"]);
    expect(splitViewIds(state([]))).toEqual(["all", "remaining"]);
  });

  it("shows a matching conversation in every split rather than assigning priority", () => {
    const jamie = row("1");
    const mailboxes = { imbox: box("imbox", [jamie, row("2", "alex@company.test"), row("3", "outside@example.test")]) };
    expect(ids(filterSplitMailboxes(mailboxes, state(), "vip"))).toEqual(["1"]);
    expect(ids(filterSplitMailboxes(mailboxes, state(), "team"))).toEqual(["1", "2"]);
    expect(filterSplitMailboxes(mailboxes, state(), "vip").imbox?.postings[0]).toBe(jamie);
    expect(filterSplitMailboxes(mailboxes, state(), "team").imbox?.postings[0]).toBe(jamie);
  });

  it("matches people OR domains and preserves existing linked-label membership", () => {
    const work = split("work", { people: ["partner@outside.test"], domains: ["company.test"], labelId: "45" });
    const mailboxes = { imbox: box("imbox", [row("1"), row("2", "partner@outside.test"), row("3", "manual@outside.test"), row("4", "outside@example.test")]) };
    expect(ids(filterSplitMailboxes(mailboxes, state([work], { work: ["thread-3"] }), "work"))).toEqual(["1", "2", "3"]);
  });

  it("Remaining excludes every enabled rule and membership, but not disabled splits", () => {
    const disabled = split("disabled", { enabled: false, people: ["outside@example.test"] });
    const mailboxes = { imbox: box("imbox", [row("1"), row("2", "manual@example.test"), row("3", "outside@example.test")]) };
    const current = state([team, disabled], { team: ["thread-2"], disabled: ["thread-3"] });
    expect(ids(filterSplitMailboxes(mailboxes, current, "remaining"))).toEqual(["3"]);
    expect(filterSplitMailboxes(mailboxes, current, "disabled")).toBe(mailboxes);
  });

  it("All and stale selections fall back to the unchanged mailbox objects", () => {
    const mailboxes = { imbox: box("imbox", [row("1"), row("2", "outside@example.test")]) };
    expect(filterSplitMailboxes(mailboxes, state(), "all")).toBe(mailboxes);
    expect(filterSplitMailboxes(mailboxes, state(), "removed-split")).toBe(mailboxes);
    expect(ids(filterSplitMailboxes(mailboxes, state([]), "remaining"))).toEqual(["1", "2"]);
  });

  it("preserves workflow sections and physical posting IDs without changing the source", () => {
    const mailboxes: SectionedMailboxes = {
      imbox: box("imbox", [row("1"), row("2", undefined, { seen: true }), row("3", undefined, { seen: true, bubbledUp: true }), row("4", "outside@example.test")]),
      laterbox: box("laterbox", [row("5", undefined, { seen: true }), row("6", "outside@example.test")]),
      asidebox: box("asidebox", [row("7", undefined, { seen: true }), row("8", "outside@example.test")]),
    };
    const before = structuredClone(mailboxes);
    const filtered = filterSplitMailboxes(mailboxes, state(), "team");
    const grouped = groupSectionedImbox(filtered);
    expect(Object.fromEntries(Object.entries(grouped).map(([section, rows]) => [section, rows.map((posting) => posting.id)]))).toEqual({
      active: ["1"], previouslySeen: ["2"], bubbledUp: ["3"], replyLater: ["5"], setAside: ["7"],
    });
    expect(mailboxes).toEqual(before);
  });

  it("leaves Feed, Paper Trail and future Bubble Up mailboxes outside split filtering", () => {
    const mailboxes = {
      feedbox: box("feedbox", [row("1", "news@outside.test")]),
      trailbox: box("trailbox", [row("2", "receipt@outside.test")]),
      bubblebox: box("bubblebox", [row("3", "reminder@outside.test")]),
    };
    const filtered = filterSplitMailboxes(mailboxes, state(), "team");
    expect(filtered.feedbox).toBe(mailboxes.feedbox);
    expect(filtered.trailbox).toBe(mailboxes.trailbox);
    expect(filtered.bubblebox).toBe(mailboxes.bubblebox);
    expect(splitPendingCounts(mailboxes, state())).toEqual({ all: 0, vip: 0, team: 0, remaining: 0 });
  });

  it("preserves pagination and availability even when the current page has no matches", () => {
    const mailboxes = { imbox: box("imbox", [row("1", "outside@example.test")], { nextPage: "older-cursor" }), laterbox: undefined };
    const filtered = filterSplitMailboxes(mailboxes, state(), "team");
    expect(filtered.imbox).toMatchObject({ postings: [], nextPage: "older-cursor", status: "ready" });
    expect(filtered.laterbox).toBeUndefined();
    const appended = { ...mailboxes, imbox: { ...mailboxes.imbox, postings: [...mailboxes.imbox.postings, row("2", undefined, { seen: true })] } };
    expect(ids(filterSplitMailboxes(appended, state(), "team"))).toEqual(["2"]);
  });

  it("keeps a self-authored reply in the colleague's split", () => {
    const mailboxes = { imbox: box("imbox", [row("1", ownEmail, {
      sender: { name: "Me", email: ownEmail, kind: "User" },
      contacts: [{ name: "Me", email: ownEmail, kind: "User" }],
      addressedContacts: [{ name: "Jamie", email: "jamie@company.test" }],
    })]) };
    expect(ids(filterSplitMailboxes(mailboxes, state(), "team"))).toEqual(["1"]);
    expect(ids(filterSplitMailboxes(mailboxes, state(), "vip"))).toEqual(["1"]);
  });

  it("does not classify all inbound mail under the account owner's domain", () => {
    const mailboxes = { imbox: box("imbox", [row("1", "stranger@outside.test", {
      contacts: [{ name: "Me", email: ownEmail }],
      addressedContacts: [{ name: "Me", email: ownEmail.toUpperCase() }],
    }), row("2")]) };
    expect(ids(filterSplitMailboxes(mailboxes, state(), "team"))).toEqual(["2"]);
    expect(ids(filterSplitMailboxes(mailboxes, state(), "remaining"))).toEqual(["1"]);
  });
});

describe("split pending counts", () => {
  it("counts all outstanding sections, not Previously Seen or just unread rows", () => {
    const mailboxes = {
      imbox: box("imbox", [row("1"), row("2", undefined, { seen: true }), row("3", undefined, { seen: true, bubbledUp: true }), row("4", "alex@company.test"), row("5", "outside@example.test")]),
      laterbox: box("laterbox", [row("6", undefined, { seen: true })]),
      asidebox: box("asidebox", [row("7", undefined, { seen: true })]),
    };
    expect(splitPendingCounts(mailboxes, state())).toEqual({ all: 6, vip: 4, team: 5, remaining: 1 });
  });

  it("counts a kept conversation once even when duplicated across mailbox results", () => {
    const mailboxes = {
      imbox: box("imbox", [row("1"), row("2", undefined, { topicId: "shared", seen: true, bubbledUp: true })]),
      laterbox: box("laterbox", [row("3", undefined, { topicId: "shared", seen: true })]),
      asidebox: box("asidebox", [row("4", undefined, { topicId: "shared", seen: true })]),
    };
    expect(splitPendingCounts(mailboxes, state())).toEqual({ all: 2, vip: 2, team: 2, remaining: 0 });
  });

  it("updates every matching split when a conversation is completed", () => {
    const active = { imbox: box("imbox", [row("1")]) };
    expect(splitPendingCounts(active, state())).toMatchObject({ all: 1, vip: 1, team: 1 });
    const done = { imbox: box("imbox", [row("1", undefined, { seen: true })]) };
    expect(splitPendingCounts(done, state())).toEqual({ all: 0, vip: 0, team: 0, remaining: 0 });
    expect(groupSectionedImbox(filterSplitMailboxes(done, state(), "vip")).previouslySeen).toHaveLength(1);
    expect(groupSectionedImbox(filterSplitMailboxes(done, state(), "team")).previouslySeen).toHaveLength(1);
  });

  it("does not count unavailable mailbox rows as actionable", () => {
    const mailboxes = { imbox: box("imbox", [row("1")], { status: "unavailable" }), laterbox: box("laterbox", [row("2")], { status: "needs-auth" }) };
    expect(splitPendingCounts(mailboxes, state())).toEqual({ all: 0, vip: 0, team: 0, remaining: 0 });
  });
});

describe("create split from conversation", () => {
  it("prepares a named person rule without saving or assigning a label ID", () => {
    expect(splitDraftFromPosting(row("1", "JAMIE@COMPANY.TEST"), "person", ownEmail)).toEqual({
      name: "Jamie", labelName: "Jamie", enabled: true, people: ["jamie@company.test"], domains: [],
    });
  });

  it("prepares a domain rule using the selected conversation's sender", () => {
    expect(splitDraftFromPosting(row("1", "JAMIE@COMPANY.TEST"), "domain", ownEmail)).toEqual({
      name: "company.test", labelName: "company.test", enabled: true, people: [], domains: ["company.test"],
    });
  });

  it("finds the other participant after the account owner replies", () => {
    const reply = row("1", ownEmail, { sender: { name: "Me", email: ownEmail }, contacts: [{ name: "Jamie", email: "jamie@company.test" }] });
    expect(splitDraftFromPosting(reply, "person", ownEmail)).toMatchObject({ name: "Jamie", people: ["jamie@company.test"] });
  });

  it("uses addressed recipients when an outgoing reply has no other contact metadata", () => {
    const reply = row("1", ownEmail, { sender: { name: "Me", email: ownEmail }, addressedContacts: [{ name: "Jamie", email: "jamie@company.test" }] });
    expect(splitDraftFromPosting(reply, "person", ownEmail)).toMatchObject({ name: "Jamie", people: ["jamie@company.test"] });
  });

  it("skips User contacts even when the current email address is not provided", () => {
    const reply = row("1", ownEmail, { sender: { name: "Me", email: ownEmail, kind: "User" }, contacts: [{ name: "Jamie", email: "jamie@company.test" }] });
    expect(splitDraftFromPosting(reply, "person")).toMatchObject({ name: "Jamie", people: ["jamie@company.test"] });
  });

  it("falls back to the address for unnamed senders and declines unaddressable/self-only mail", () => {
    expect(splitDraftFromPosting(row("1", "jamie@company.test", { sender: { name: "", email: "jamie@company.test" } }), "person", ownEmail)?.name).toBe("jamie@company.test");
    expect(splitDraftFromPosting(row("1", undefined, { sender: { name: "Unknown" } }), "person", ownEmail)).toBeUndefined();
    expect(splitDraftFromPosting(row("1", ownEmail), "person", ownEmail)).toBeUndefined();
  });
});
