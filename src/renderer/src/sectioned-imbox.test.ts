import { describe, expect, it } from "vitest";
import type { ImboxPosting, ImboxResult, MailboxKey } from "../../shared/contracts";
import { ACCOUNT_SPLIT_SECTION_ORDER, groupAccountSplitMailboxes, groupSectionedImbox, IMBOX_SECTION_ORDER, sectionedPostingSource, sectionedSelectionSource } from "./sectioned-imbox";
import { mailToggle } from "./mail-toggles";

const row = (id: string, overrides: Partial<ImboxPosting> = {}): ImboxPosting => ({ id, topicId: `topic-${id}`, subject: id, summary: "", seen: false, createdAt: "2026-09-27T12:00:00Z", contacts: [], sender: { name: "Example" }, visibleEntryCount: 1, ...overrides });
const box = (boxKey: MailboxKey, postings: ImboxPosting[]): ImboxResult => ({ boxKey, boxName: boxKey, status: "ready", postings });

describe("sectioned Imbox membership", () => {
  it("keeps read saved mail in its section and excludes scheduled Bubble Up mail", () => {
    const groups = groupSectionedImbox({ imbox: box("imbox", [row("active"), row("seen", { seen: true }), row("due", { seen: true, bubbledUp: true })]), laterbox: box("laterbox", [row("later", { seen: true })]), asidebox: box("asidebox", [row("aside", { seen: true })]), bubblebox: box("bubblebox", [row("scheduled")]) });
    expect(IMBOX_SECTION_ORDER.flatMap((key) => groups[key].map((posting) => posting.id))).toEqual(["active", "later", "aside", "due", "seen"]);
  });

  it("gives saved memberships precedence with one row per topic across posting IDs", () => {
    const mailboxes = { imbox: box("imbox", [row("imbox-version", { topicId: "shared" }), row("aside-imbox", { topicId: "aside" }), row("unread", { topicId: "duplicate" }), row("read-copy", { topicId: "duplicate", seen: true })]), laterbox: box("laterbox", [row("later-version", { topicId: "shared", seen: true })]), asidebox: box("asidebox", [row("aside-shared", { topicId: "shared" }), row("aside-version", { topicId: "aside", seen: true })]) };
    const groups = groupSectionedImbox(mailboxes);
    expect(groups.active.map((posting) => posting.id)).toEqual(["unread"]);
    expect(groups.replyLater.map((posting) => posting.id)).toEqual(["later-version"]);
    expect(groups.setAside.map((posting) => posting.id)).toEqual(["aside-version"]);
    expect(groups.previouslySeen).toEqual([]);
    expect(sectionedPostingSource(mailboxes, mailboxes.imbox.postings[0]!)).toBe("laterbox");
    expect(sectionedPostingSource(mailboxes, groups.setAside[0]!)).toBe("asidebox");
    expect(sectionedPostingSource(mailboxes, groups.active[0]!)).toBe("imbox");
  });

  it("retains only the currently opened Active row until its reader closes", () => {
    const mailboxes = { imbox: box("imbox", [row("open", { seen: true }), row("older", { seen: true })]) };
    expect(groupSectionedImbox(mailboxes, "open").active.map((posting) => posting.id)).toEqual(["open"]);
    expect(groupSectionedImbox(mailboxes).active).toEqual([]);
    expect(groupSectionedImbox(mailboxes).previouslySeen).toHaveLength(2);
  });

  it("prefers a due reminder over unseen and seen duplicate topic versions", () => {
    const groups = groupSectionedImbox({ imbox: box("imbox", [row("seen", { topicId: "same", seen: true }), row("unread", { topicId: "same" }), row("due", { topicId: "same", seen: true, bubbledUp: true })]) });
    expect(groups.bubbledUp.map((posting) => posting.id)).toEqual(["due"]);
    expect(groups.active).toEqual([]);
    expect(groups.previouslySeen).toEqual([]);
  });

  it("falls back to posting IDs and ignores unavailable mailbox data", () => {
    const groups = groupSectionedImbox({ imbox: box("imbox", [row("one", { topicId: undefined }), row("one", { topicId: undefined }), row("two", { topicId: undefined })]), laterbox: { ...box("laterbox", [row("one")]), status: "unavailable" } });
    expect(groups.active.map((posting) => posting.id)).toEqual(["one", "two"]);
    expect(groups.replyLater).toEqual([]);
  });

  it("labels homogeneous saved selections as removal and mixed selections as additions", () => {
    const mailboxes = { imbox: box("imbox", [row("active")]), laterbox: box("laterbox", [row("later-a"), row("later-b")]), asidebox: box("asidebox", [row("aside-a"), row("aside-b")]) };
    for (const [ids, command, label] of [
      [["later-a", "later-b"], "later", "Remove from Reply Later"],
      [["aside-a", "aside-b"], "aside", "Remove from Set Aside"],
      [["active", "later-a"], "later", "Move to Reply Later"],
      [["aside-a", "later-a"], "aside", "Move to Set Aside"],
      [["later-a", "missing"], "later", "Move to Reply Later"],
    ] as const) {
      const selectedIds = [...ids];
      expect(mailToggle(command, selectedIds, sectionedSelectionSource(mailboxes, selectedIds))?.label).toBe(label);
    }
  });
});

describe("account split membership", () => {
  it.each([
    ["imbox", "active"],
    ["feedbox", "feed"],
    ["trailbox", "paperTrail"],
  ] as const)("keeps %s pending through an open reader, then moves it to history until unseen again", (source, section) => {
    const pending = row("open");
    const history = row("older", { seen: true });
    const mailboxes = { [source]: box(source, [pending, history]) };
    expect(groupAccountSplitMailboxes(mailboxes)[section]).toEqual([{ ...pending, sourceBox: source }]);
    expect(groupAccountSplitMailboxes(mailboxes).previouslySeen).toEqual([{ ...history, sourceBox: source }]);

    const read = { ...pending, seen: true };
    const readMailboxes = { [source]: box(source, [read, history]) };
    const opened = groupAccountSplitMailboxes(readMailboxes, read.id);
    expect(opened[section]).toEqual([{ ...read, sourceBox: source }]);
    expect(opened.previouslySeen).toEqual([{ ...history, sourceBox: source }]);
    expect(sectionedPostingSource(readMailboxes, opened[section][0]!, true)).toBe(source);
    expect(sectionedSelectionSource(readMailboxes, [read.id], true, read.id)).toBe(source);

    const closed = groupAccountSplitMailboxes(readMailboxes);
    expect(closed[section]).toEqual([]);
    expect(closed.previouslySeen).toEqual([read, history].map((posting) => ({ ...posting, sourceBox: source })));
    expect(sectionedSelectionSource(readMailboxes, [read.id, history.id], true)).toBe(source);

    const refreshed = { [source]: box(source, [{ ...read, seen: false }, history]) };
    expect(groupAccountSplitMailboxes(refreshed)[section]).toEqual([{ ...pending, sourceBox: source }]);
    expect(groupAccountSplitMailboxes(refreshed).previouslySeen).toEqual([{ ...history, sourceBox: source }]);
  });

  it.each([
    ["imbox", "active"],
    ["feedbox", "feed"],
    ["trailbox", "paperTrail"],
  ] as const)("preserves the retained row's %s order among unread neighbors", (source, section) => {
    const before = row("before");
    const opened = row("opened", { seen: true });
    const after = row("after");
    const last = row("last");
    for (const postings of [[opened, after, last], [before, opened, after]]) {
      const mailboxes = { [source]: box(source, postings) };
      const groups = groupAccountSplitMailboxes(mailboxes, opened.id);
      expect(groups[section]).toEqual(postings.map((posting) => ({ ...posting, sourceBox: source })));
      expect(groups.previouslySeen).toEqual([]);
    }
  });

  it("keeps all six physical sources with saved-state precedence and one row per topic", () => {
    const mailboxes = {
      imbox: box("imbox", [row("active"), row("seen", { seen: true }), row("due", { bubbledUp: true }), row("later-copy", { topicId: "saved-later" }), row("aside-copy", { topicId: "saved-aside" }), row("future-copy", { topicId: "scheduled", bubbledUp: true })]),
      laterbox: box("laterbox", [row("later", { topicId: "saved-later", seen: true })]),
      asidebox: box("asidebox", [row("aside", { topicId: "saved-aside", seen: true }), row("later-aside-copy", { topicId: "saved-later" })]),
      feedbox: box("feedbox", [row("feed"), row("active-copy", { topicId: "topic-active" })]),
      trailbox: box("trailbox", [row("trail"), row("feed-copy", { topicId: "topic-feed" })]),
      bubblebox: box("bubblebox", [row("future", { topicId: "scheduled", bubbledUp: true }), row("later-future-copy", { topicId: "saved-later" })]),
    };
    const groups = groupAccountSplitMailboxes(mailboxes);
    expect(ACCOUNT_SPLIT_SECTION_ORDER.flatMap((key) => groups[key].map((posting) => posting.id))).toEqual(["active", "later", "aside", "due", "feed", "trail", "future", "seen"]);
    expect(ACCOUNT_SPLIT_SECTION_ORDER.flatMap((key) => groups[key].map((posting) => posting.sourceBox))).toEqual(["imbox", "laterbox", "asidebox", "imbox", "feedbox", "trailbox", "bubblebox", "imbox"]);
    expect(ACCOUNT_SPLIT_SECTION_ORDER.flatMap((key) => groups[key].map((posting) => sectionedPostingSource(mailboxes, posting, true)))).toEqual(["imbox", "laterbox", "asidebox", "imbox", "feedbox", "trailbox", "bubblebox", "imbox"]);
    expect(groups.bubbledUp.map((posting) => posting.id)).toEqual(["due"]);
    expect(groups.scheduledBubbleUp.map((posting) => posting.id)).toEqual(["future"]);
    expect(sectionedSelectionSource(mailboxes, ["feed"], true)).toBe("feedbox");
    expect(sectionedSelectionSource(mailboxes, ["feed", "trail"], true)).toBe("imbox");
    expect(groupSectionedImbox(mailboxes).bubbledUp.map((posting) => posting.id)).toEqual(["due", "future-copy"]);
    expect(sectionedPostingSource(mailboxes, mailboxes.imbox.postings[5]!)).toBe("imbox");
  });

  it("prefers pending Feed and Paper Trail rows over read copies in earlier sources", () => {
    const mailboxes = {
      imbox: box("imbox", [row("feed-history", { topicId: "feed-topic", seen: true }), row("trail-history", { topicId: "trail-topic", seen: true }), row("same-id", { seen: true })]),
      feedbox: box("feedbox", [row("feed-pending", { topicId: "feed-topic" }), row("trail-feed-history", { topicId: "trail-topic", seen: true }), row("same-id")]),
      trailbox: box("trailbox", [row("trail-pending", { topicId: "trail-topic" })]),
    };
    const groups = groupAccountSplitMailboxes(mailboxes);
    expect(groups.feed.map((posting) => posting.id)).toEqual(["feed-pending", "same-id"]);
    expect(groups.paperTrail.map((posting) => posting.id)).toEqual(["trail-pending"]);
    expect(groups.previouslySeen).toEqual([]);
    expect(sectionedPostingSource(mailboxes, groups.feed[0]!, true)).toBe("feedbox");
    expect(sectionedPostingSource(mailboxes, groups.feed[1]!, true)).toBe("feedbox");
    expect(sectionedPostingSource(mailboxes, groups.paperTrail[0]!, true)).toBe("trailbox");
    expect(sectionedSelectionSource(mailboxes, ["feed-pending", "same-id"], true)).toBe("feedbox");
    expect(sectionedSelectionSource(mailboxes, ["trail-pending"], true)).toBe("trailbox");
    expect(groupAccountSplitMailboxes(mailboxes, "same-id").feed.map((posting) => posting.id)).toEqual(["feed-pending", "same-id"]);
  });

  it.each([
    ["feedbox", "feed"],
    ["trailbox", "paperTrail"],
  ] as const)("preserves a retained %s selection over a duplicate in Imbox history", (source, section) => {
    const mailboxes = {
      imbox: box("imbox", [row("imbox-copy", { topicId: "shared", seen: true })]),
      [source]: box(source, [row("opened", { topicId: "shared", seen: true }), row("history", { seen: true })]),
    };
    const groups = groupAccountSplitMailboxes(mailboxes, "opened");
    expect(groups[section].map((posting) => posting.id)).toEqual(["opened"]);
    expect(groups.previouslySeen.map((posting) => posting.id)).toEqual(["history"]);
    expect(sectionedPostingSource(mailboxes, groups[section][0]!, true)).toBe(source);
    expect(sectionedSelectionSource(mailboxes, ["opened", "history"], true, "opened")).toBe(source);
    expect(sectionedSelectionSource(mailboxes, ["opened", "missing"], true, "opened")).toBe("imbox");
  });

  it.each([
    ["feedbox", "feed"],
    ["trailbox", "paperTrail"],
  ] as const)("keeps cloned %s reader rows and retained same-ID copies in their physical source", (source, section) => {
    const history = row("history", { seen: true });
    const pending = row("shared", { sourceBox: "imbox" });
    const mailboxes = {
      imbox: box("imbox", [row("shared", { seen: true }), row("imbox-history", { seen: true })]),
      [source]: box(source, [pending, history]),
    };
    const grouped = groupAccountSplitMailboxes(mailboxes)[section][0]!;
    expect(grouped.sourceBox).toBe(source);
    expect(pending.sourceBox).toBe("imbox");
    const selected = { ...grouped, seen: true };
    expect(sectionedPostingSource(mailboxes, selected, true)).toBe(source);

    const readMailboxes = { ...mailboxes, [source]: box(source, [{ ...pending, seen: true }, history]) };
    expect(sectionedPostingSource(readMailboxes, selected, true)).toBe(source);
    const retained = groupAccountSplitMailboxes(readMailboxes, selected.id, selected.sourceBox);
    expect(retained.active).toEqual([]);
    expect(retained[section]).toEqual([{ ...selected }]);
    expect(retained.previouslySeen.map((posting) => posting.id)).toEqual(["imbox-history", "history"]);
    expect(sectionedSelectionSource(readMailboxes, [selected.id, history.id], true, selected.id, selected.sourceBox)).toBe(source);
    expect(sectionedSelectionSource(readMailboxes, [selected.id, "imbox-history"], true, selected.id, selected.sourceBox)).toBe("imbox");

    expect(groupAccountSplitMailboxes(readMailboxes)[section]).toEqual([]);
    expect(groupAccountSplitMailboxes(readMailboxes).previouslySeen.map((posting) => posting.id)).toEqual(["shared", "imbox-history", "history"]);
    expect(groupAccountSplitMailboxes(mailboxes, selected.id, selected.sourceBox)[section][0]!.sourceBox).toBe(source);
  });

  it("validates split source provenance against loaded membership and lets saved states override it", () => {
    const selected = row("selected", { topicId: "shared", sourceBox: "feedbox", seen: true });
    const mailboxes = {
      imbox: box("imbox", [row("selected", { topicId: "shared", seen: true })]),
      feedbox: box("feedbox", [row("new-id", { topicId: "shared", seen: true })]),
    };
    expect(sectionedPostingSource(mailboxes, selected, true)).toBe("feedbox");
    expect(sectionedPostingSource({ ...mailboxes, laterbox: box("laterbox", [row("saved", { topicId: "shared" })]) }, selected, true)).toBe("laterbox");
    expect(sectionedPostingSource({ ...mailboxes, feedbox: box("feedbox", [row("other")]) }, selected, true)).toBe("imbox");
    expect(sectionedPostingSource({ ...mailboxes, feedbox: { ...mailboxes.feedbox, status: "unavailable" } }, selected, true)).toBe("imbox");
    expect(sectionedPostingSource({ imbox: mailboxes.imbox }, selected, true)).toBe("imbox");
    expect(sectionedPostingSource(mailboxes, selected)).toBe("imbox");
    expect(groupSectionedImbox(mailboxes).previouslySeen[0]).toBe(mailboxes.imbox.postings[0]);
    expect(groupSectionedImbox(mailboxes).previouslySeen[0]!.sourceBox).toBeUndefined();
  });

  it("preserves read saved states over pending, retained, and history copies", () => {
    const mailboxes = {
      imbox: box("imbox", [row("due", { topicId: "due-topic", seen: true, bubbledUp: true }), row("scheduled-due", { topicId: "scheduled-topic", bubbledUp: true })]),
      laterbox: box("laterbox", [row("later", { topicId: "later-topic", seen: true })]),
      asidebox: box("asidebox", [row("aside", { topicId: "aside-topic", seen: true }), row("later-aside", { topicId: "later-topic", seen: true })]),
      bubblebox: box("bubblebox", [row("scheduled", { topicId: "scheduled-topic", seen: true }), row("aside-scheduled", { topicId: "aside-topic", seen: true })]),
      feedbox: box("feedbox", [row("later-feed", { topicId: "later-topic" }), row("aside-feed", { topicId: "aside-topic", seen: true }), row("scheduled-feed", { topicId: "scheduled-topic" }), row("due-feed", { topicId: "due-topic" })]),
      trailbox: box("trailbox", [row("later-trail", { topicId: "later-topic", seen: true }), row("aside-trail", { topicId: "aside-topic" }), row("scheduled-trail", { topicId: "scheduled-topic", seen: true }), row("due-trail", { topicId: "due-topic", seen: true })]),
    };
    const groups = groupAccountSplitMailboxes(mailboxes, "aside-feed");
    expect(groups.replyLater.map((posting) => posting.id)).toEqual(["later"]);
    expect(groups.setAside.map((posting) => posting.id)).toEqual(["aside"]);
    expect(groups.scheduledBubbleUp.map((posting) => posting.id)).toEqual(["scheduled"]);
    expect(groups.bubbledUp.map((posting) => posting.id)).toEqual(["due"]);
    expect(groups.feed).toEqual([]);
    expect(groups.paperTrail).toEqual([]);
    expect(groups.previouslySeen).toEqual([]);
    expect(sectionedPostingSource(mailboxes, mailboxes.feedbox.postings[0]!, true)).toBe("laterbox");
    expect(sectionedPostingSource(mailboxes, mailboxes.feedbox.postings[1]!, true)).toBe("asidebox");
    expect(sectionedPostingSource(mailboxes, mailboxes.feedbox.postings[2]!, true)).toBe("bubblebox");
    expect(sectionedSelectionSource(mailboxes, ["later"], true)).toBe("laterbox");
    expect(sectionedSelectionSource(mailboxes, ["aside"], true)).toBe("asidebox");
    expect(sectionedSelectionSource(mailboxes, ["scheduled"], true)).toBe("bubblebox");
  });

  it("merges history newest first with stable ties and invalid dates, without reordering physical mailboxes", () => {
    const mailboxes = {
      imbox: box("imbox", [row("oldest", { seen: true, createdAt: "2026-09-20T12:00:00Z" }), row("invalid-imbox", { seen: true, createdAt: "bad" }), row("tie-imbox", { seen: true })]),
      feedbox: box("feedbox", [row("newest", { seen: true, createdAt: "2026-09-28T12:00:00Z" }), row("invalid-feed", { seen: true, createdAt: "" }), row("tie-feed", { seen: true })]),
      trailbox: box("trailbox", [row("middle", { seen: true, createdAt: "2026-09-25T12:00:00Z" }), row("invalid-trail", { seen: true, createdAt: "not-a-date" })]),
    };
    const before = structuredClone(mailboxes);
    const history = groupAccountSplitMailboxes(mailboxes).previouslySeen;
    expect(history.map((posting) => posting.id)).toEqual(["newest", "tie-imbox", "tie-feed", "middle", "oldest", "invalid-imbox", "invalid-feed", "invalid-trail"]);
    expect(history.map((posting) => sectionedPostingSource(mailboxes, posting, true))).toEqual(["feedbox", "imbox", "feedbox", "trailbox", "imbox", "imbox", "feedbox", "trailbox"]);
    expect(mailboxes).toEqual(before);
    expect(sectionedSelectionSource(mailboxes, ["newest", "tie-feed", "invalid-feed"], true)).toBe("feedbox");
    expect(sectionedSelectionSource(mailboxes, ["middle", "invalid-trail"], true)).toBe("trailbox");
    expect(sectionedSelectionSource(mailboxes, ["newest", "middle"], true)).toBe("imbox");
    expect(sectionedSelectionSource(mailboxes, [], true)).toBe("imbox");
  });

  it("ignores unavailable sources and deduplicates rows without topic metadata", () => {
    const groups = groupAccountSplitMailboxes({
      feedbox: box("feedbox", [row("same", { topicId: undefined })]),
      trailbox: box("trailbox", [row("same", { topicId: undefined }), row("other", { topicId: undefined })]),
      bubblebox: { ...box("bubblebox", [row("scheduled")]), status: "unavailable" },
    });
    expect(groups.feed.map((posting) => posting.id)).toEqual(["same"]);
    expect(groups.paperTrail.map((posting) => posting.id)).toEqual(["other"]);
    expect(groups.scheduledBubbleUp).toEqual([]);
  });
});
