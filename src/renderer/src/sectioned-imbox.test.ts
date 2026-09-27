import { describe, expect, it } from "vitest";
import type { ImboxPosting, ImboxResult, MailboxKey } from "../../shared/contracts";
import { groupSectionedImbox, IMBOX_SECTION_ORDER, sectionedPostingSource, sectionedSelectionSource } from "./sectioned-imbox";
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
