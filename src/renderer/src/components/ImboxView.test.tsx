import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImboxPosting, ImboxResult } from "../../../shared/contracts";
import ImboxView from "./ImboxView";

const noop = () => {};
const row = (id: string, seen: boolean, bubbledUp?: boolean): ImboxPosting => ({
  id, subject: id, summary: "Synthetic summary", seen, bubbledUp,
  createdAt: "2026-09-01T12:00:00Z", contacts: [], sender: { name: "Example" }, visibleEntryCount: 1,
});
function render(result: ImboxResult, showSenderAvatars = false, bulkSelectedIds: string[] = [], extra: Partial<ComponentProps<typeof ImboxView>> = {}) {
  return load(renderToStaticMarkup(<ImboxView mailboxKey={result.boxKey} result={result} loading={false} searchRequest={0}
    showSenderAvatars={showSenderAvatars} bulkSelectedIds={bulkSelectedIds} bulkBusy={false} commandPaletteOpen={false}
    onSelect={noop} onHighlight={noop} onToggleSelection={noop} onBulkAction={noop} onReadTogether={noop}
    onReplyTogether={noop} onOrganizeSelection={noop} onClearSelection={noop}
    onRefresh={noop} onNavigate={noop} onSetAsideGroup={noop} {...extra} />));
}
const imbox = (postings: ImboxPosting[]): ImboxResult => ({ status: "ready", boxKey: "imbox", boxName: "Imbox", postings });

describe("Imbox section presentation", () => {
  it("offers an automatic paging sentinel for every native mailbox and labels partial counts", () => {
    for (const boxKey of ["imbox", "feedbox", "trailbox", "asidebox", "laterbox", "bubblebox"] as const) {
      const $ = render({ ...imbox([row("first", false)]), boxKey, nextPage: "older" }, false, [], { onLoadMore: noop });
      expect($(".sectioned-imbox-sentinel")).toHaveLength(1);
      expect($("button").filter((_, element) => /load more/i.test($(element).text()))).toHaveLength(0);
      if (boxKey !== "imbox") expect($(".title-count").text()).toBe("1+");
    }
  });

  it("keeps saved-section paging accessible with Previously Seen collapsed", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => JSON.stringify(["previouslySeen"]) } });
    const $ = render({ ...imbox([row("active", false)]), nextPage: "later-cursor" }, false, [], { sectioned: true, hasSectionPages: true, onLoadMore: noop });
    expect($(".sectioned-imbox-sentinel")).toHaveLength(1);
    expect($("[data-section=previouslySeen] .sectioned-imbox-sentinel")).toHaveLength(0);
  });

  it("does not present an incomplete linked label as an empty split", () => {
    const result = imbox([]);
    const $ = render(result, false, [], { accountSplit: true, sectionMailboxes: { imbox: result }, membershipLoading: true });
    expect($("[role=status]").text()).toContain("Loading linked label");
    expect($("[data-section=active]").text()).toContain("Checking linked label");
    expect($("[data-section=active]").text()).not.toContain("Nothing is asking");
  });

  it("describes the bounded Reply Later overview as a lower bound", () => {
    const $ = render(imbox([row("active", false)]), false, [], { overview: { screener: { status: "ready", entries: [] }, replyLater: { count: 25, partial: true } } });
    expect($(".imbox-reply-later button").attr("data-tooltip")).toBe("Open at least 25 Reply Later conversations");
    expect($(".reply-later-copy small").text()).toBe("25+ conversations");
  });

  afterEach(() => vi.unstubAllGlobals());
  it("shows outgoing addressing, a readable thread count, and the sender's avatar", () => {
    vi.stubGlobal("window", { heyAgent: { profiles: { current: { active: { email: "alex@example.test" } } } } });
    const sender = { name: "Alex Example", email: "alex@example.test", avatarUrl: "https://app.hey.com/avatars/alex.png" };
    const recipients = [{ name: "Membership", email: "members@example.test" }, { name: "Maya", email: "maya@example.test" }, { name: "Sam", email: "sam@example.test" }];
    const $ = render(imbox([{ ...row("reply", true), sender, contacts: [sender, ...recipients], addressedContacts: recipients, visibleEntryCount: 2 }]), true);
    expect($(".sender-copy strong").text()).toBe("Me → Membership");
    expect($(".recipient-count").text()).toBe("+2");
    expect($(".sender-copy").attr("title")).toContain("Sam <sam@example.test>");
    expect($(".entry-count").text()).toBe("(2)");
    expect($(".entry-count").attr("aria-label")).toBe("2 messages");
    expect($(".sender-avatar img").attr("src")).toBe(sender.avatarUrl);
  });
  it("does not call another account's sender Me or invent recipient direction", () => {
    vi.stubGlobal("window", { heyAgent: { profiles: { current: { active: { email: "other@example.test" } } } } });
    const $ = render(imbox([{ ...row("incoming", true), sender: { name: "Alex", email: "alex@example.test" }, visibleEntryCount: 1 }]));
    expect($(".sender-copy strong").text()).toBe("Alex");
    expect($(".recipient-count, .entry-count")).toHaveLength(0);
  });
  it("adds day breaks to Feed and Paper Trail without adding focusable rows", () => {
    const rows = [row("one", true), { ...row("two", true), createdAt: "2026-08-31T12:00:00Z" }];
    for (const boxKey of ["feedbox", "trailbox"] as const) {
      const $ = render({ ...imbox(rows), boxKey });
      expect($(".mail-day-heading")).toHaveLength(2);
      expect($(".mail-day-heading button, .mail-day-heading[tabindex]")).toHaveLength(0);
      expect($(".mail-row").map((_, e) => $(e).attr("id")).get()).toEqual(["mail-row-one", "mail-row-two"]);
      expect($(".mail-row time[title]")).toHaveLength(2);
    }
    expect(render(imbox(rows))(".mail-day-heading")).toHaveLength(0);
    expect(render({ ...imbox([]), boxKey: "feedbox" })(".mail-day-heading")).toHaveLength(0);
  });
  it("uses the same sender-first layout with optional avatars in every mailbox", () => {
    for (const boxKey of ["imbox", "trailbox"]) {
      const result = { ...imbox([row("message", false)]), boxKey };
      const textOnly = render(result);
      const avatars = render(result, true);
      expect(textOnly(".mail-row .sender-avatar")).toHaveLength(0);
      expect(avatars(".mail-row .sender-avatar")).toHaveLength(1);
      for (const $ of [textOnly, avatars]) {
        expect($(".mail-row").children().map((_, e) => $(e).attr("class")).get()).toEqual(["mail-state-cell", "sender-cell", "conversation-cell", "updated-cell"]);
        expect($(".sender-copy strong").text()).toBe("Example");
        expect($(".subject-line strong").text()).toBe("message");
        expect($(".summary-line").text()).toBe("— Synthetic summary");
        expect($("[data-bulk-toggle]")).toHaveLength(1);
      }
    }
  });

  it("keeps bulk selection visible and independent of avatars", () => {
    const $ = render(imbox([row("message", false)]), false, ["message"]);
    expect($(".mail-row").attr("aria-selected")).toBe("true");
    expect($(".mail-selection-mark[data-checked=true] svg")).toHaveLength(1);
    expect($(".unseen-dot")).toHaveLength(0);
  });
  it("renders three distinct sections with counts, one row per conversation, and reminder markers instead of unread dots", () => {
    const $ = render(imbox([row("old", true), row("new", false), row("bubble", false, true), row("read-bubble", true, true)]));
    expect($(".imbox-section-heading").map((_, e) => $(e).text()).get()).toEqual(["Bubbled Up2", "New For You1", "Previously Seen1"]);
    expect($(".mail-row").map((_, e) => $(e).attr("data-posting-id")).get()).toEqual(["bubble", "read-bubble", "new", "old"]);
    expect($(".is-bubbled .bubbled-up-mark")).toHaveLength(2);
    expect($(".is-bubbled .unseen-dot")).toHaveLength(0);
    expect($(".mail-row[data-unseen=true]")).toHaveLength(1);
  });

  it("omits the returned-reminders section when no reminders have returned", () => {
    const $ = render(imbox([row("new", false), row("old", true)]));
    expect($(".imbox-section-heading").map((_, e) => $(e).text()).get()).toEqual(["New For You1", "Previously Seen1"]);
  });

  it("does not show misleading section headers for empty or unavailable mailboxes", () => {
    expect(render(imbox([]))(".imbox-section-heading")).toHaveLength(0);
    expect(render({ ...imbox([]), status: "error", detail: "Unavailable" })(".imbox-section-heading")).toHaveLength(0);
  });

  it("leaves other mailbox rows and their timestamps alone", () => {
    const $ = render({ ...imbox([row("scheduled", false, true)]), boxKey: "bubblebox", boxName: "Bubble Up" });
    expect($(".imbox-section-heading, .bubbled-up-mark")).toHaveLength(0);
    expect($(".mail-row time")).toHaveLength(1);
  });

  it("renders the optional layout in task order with compact Previously Seen rows", () => {
    const result = imbox([row("old", true), row("new", false), row("due", true, true)]);
    const $ = render(result, false, [], { sectioned: true, onLayoutChange: noop, sectionMailboxes: { laterbox: { ...imbox([row("later", true)]), boxKey: "laterbox" }, asidebox: { ...imbox([row("aside", true)]), boxKey: "asidebox" } } });
    expect($(".sectioned-imbox-heading button").map((_, e) => $(e).text()).get()).toEqual(["Active1", "Reply Later1", "Set Aside1", "Bubbled Up1", "Previously Seen1"]);
    expect($(".mail-row").map((_, e) => $(e).attr("data-posting-id")).get()).toEqual(["new", "later", "aside", "due", "old"]);
    expect($(".mail-row.is-compact .summary-line")).toHaveLength(0);
    expect($(".mail-row.is-compact .subject-line strong").text()).toBe("old");
    expect($(".imbox-layout-switch [aria-pressed=true]").text()).toBe("Sectioned");
    expect($(".sectioned-imbox-heading [aria-expanded=true]")).toHaveLength(5);
    expect($(".list-footer").text()).toContain("Done");
  });

  it("starts with 25 seen rows and reports that partial count honestly without a Load more button", () => {
    const result = { ...imbox(Array.from({ length: 52 }, (_, index) => row(`seen-${index}`, true))), nextPage: "2" };
    const $ = render(result, false, [], { sectioned: true, onLoadMore: noop });
    expect($(".mail-row")).toHaveLength(25);
    expect($("[data-section=previouslySeen] .sectioned-imbox-heading em").text()).toBe("25 shown");
    expect($(".sectioned-imbox-sentinel")).toHaveLength(1);
    expect($("button").filter((_, e) => /load more/i.test($(e).text()))).toHaveLength(0);
  });

  it("restores the previously revealed history batch when revisiting a split", () => {
    const result = imbox(Array.from({ length: 90 }, (_, index) => row(`seen-${index}`, true)));
    const viewState = { scrollTop: 900, seenLimit: 75, initialized: true, highlightedId: "seen-60" };
    const $ = render(result, false, [], { accountSplit: true, sectionMailboxes: { imbox: result }, viewState, selectedId: viewState.highlightedId });
    expect($(".mail-row")).toHaveLength(75);
    expect($(".mail-list").attr("aria-activedescendant")).toBe("mail-row-seen-60");
    expect(render(result, false, [], { accountSplit: true, sectionMailboxes: { imbox: result } })(".mail-row")).toHaveLength(25);
  });

  it("restores a split's search along with its list state", () => {
    const result = imbox([row("matching", false), row("other", false)]);
    const $ = render(result, false, [], { accountSplit: true, sectionMailboxes: { imbox: result }, viewState: { scrollTop: 0, seenLimit: 25, query: "matching", initialized: true } });
    expect($(".mail-search input").attr("value")).toBe("matching");
    expect($(".mail-row").map((_, element) => $(element).attr("data-posting-id")).get()).toEqual(["matching"]);
    expect($(".sectioned-imbox-sentinel")).toHaveLength(0);
  });

  it("keeps Active and Bubbled Up counts complete when older history has another page", () => {
    const $ = render({ ...imbox([row("active", false), row("due", false, true), row("seen", true)]), nextPage: "2" }, false, [], { sectioned: true });
    expect($("[data-section=active] .sectioned-imbox-heading em").text()).toBe("1");
    expect($("[data-section=bubbledUp] .sectioned-imbox-heading em").text()).toBe("1");
    expect($("[data-section=previouslySeen] .sectioned-imbox-heading em").text()).toBe("1 shown");
  });

  it("marks pending counts as partial until the Imbox history boundary is present", () => {
    const $ = render({ ...imbox([row("active", false), row("due", false, true)]), nextPage: "pending-more" }, false, [], { sectioned: true });
    expect($("[data-section=active] .sectioned-imbox-heading em").text()).toBe("1+");
    expect($("[data-section=bubbledUp] .sectioned-imbox-heading em").text()).toBe("1+");
  });

  it("only references an active descendant that is actually visible", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => JSON.stringify(["replyLater"]) } });
    const result = imbox([row("active", false), ...Array.from({ length: 26 }, (_, index) => row(`seen-${index}`, true))]);
    const extra = { sectioned: true, sectionMailboxes: { laterbox: { ...imbox([row("saved", true)]), boxKey: "laterbox" as const } } };
    for (const selectedId of ["saved", "seen-25", "missing"]) {
      expect(render(result, false, [], { ...extra, selectedId })(".mail-list").attr("aria-activedescendant")).toBeUndefined();
    }
    expect(render(result, false, [], { ...extra, selectedId: "active" })(".mail-list").attr("aria-activedescendant")).toBe("mail-row-active");
    expect(render(result, false, [], { ...extra, selectedId: "active", hidden: true })(".mail-list").attr("aria-activedescendant")).toBeUndefined();
  });

  it("restores collapsed sections for the active profile and does not render their sentinel or rows", () => {
    const getItem = vi.fn((key: string) => key === "hey-agent:imbox-sections:work" ? JSON.stringify(["previouslySeen", "replyLater", "unknown"]) : null);
    vi.stubGlobal("window", { localStorage: { getItem } });
    const result = { ...imbox([row("old", true), row("new", false)]), nextPage: "2" };
    const $ = render(result, false, [], { sectioned: true, profileKey: "work" });
    expect($("[data-section=previouslySeen] button[aria-expanded=false]")).toHaveLength(1);
    expect($(".mail-row")).toHaveLength(1);
    expect($(".sectioned-imbox-sentinel")).toHaveLength(0);
    expect(render(result, false, [], { sectioned: true, profileKey: "personal" })(".mail-row")).toHaveLength(2);
  });

  it("distinguishes loading and failed saved sections from empty sections", () => {
    const $ = render(imbox([]), false, [], { sectioned: true, sectionMailboxes: { asidebox: { ...imbox([]), boxKey: "asidebox", status: "unavailable", detail: "Offline" } }, loadMoreError: "Older conversations could not load.", onLoadMore: noop });
    expect($("[data-section=replyLater] .sectioned-imbox-notice").text()).toBe("Loading Reply Later…");
    expect($("[data-section=setAside] .sectioned-imbox-notice").text()).toContain("Set Aside unavailable. Offline");
    expect($(".sectioned-imbox-pagination-error button").text()).toBe("Retry");
  });

  it("offers Done directly for a sectioned selection and leaves other mailboxes unchanged", () => {
    const $ = render(imbox([row("new", false)]), false, ["new"], { sectioned: true });
    expect($(".sectioned-done-button").text()).toContain("Done");
    const feed = render({ ...imbox([row("feed", true)]), boxKey: "feedbox" }, false, [], { sectioned: true, onLayoutChange: noop });
    expect(feed(".sectioned-imbox-group, .imbox-layout-switch, .is-compact")).toHaveLength(0);
    expect(feed(".mail-row")).toHaveLength(1);
  });

  it("renders account split source sections and keeps scheduled reminders separate from returned reminders", () => {
    const result = { ...imbox([]), boxName: "Work", nextPage: "split-next" };
    const $ = render(result, false, ["feed"], { accountSplit: true, onLayoutChange: noop, onAddToSplit: noop, sectionMailboxes: {
      imbox: imbox([row("active", false), row("due", true, true), row("seen", true)]),
      laterbox: { ...imbox([row("later", true)]), boxKey: "laterbox" },
      asidebox: { ...imbox([row("aside", true)]), boxKey: "asidebox" },
      feedbox: { ...imbox([row("feed", false)]), boxKey: "feedbox" },
      trailbox: { ...imbox([row("trail", true)]), boxKey: "trailbox" },
      bubblebox: { ...imbox([row("scheduled", false, true)]), boxKey: "bubblebox" },
    } });
    expect($(".sectioned-imbox-heading button span").map((_, el) => $(el).text()).get()).toEqual(["Active", "Reply Later", "Set Aside", "Bubbled Up", "The Feed", "Paper Trail", "Scheduled Bubble Up", "Previously Seen"]);
    expect($(".mail-row").map((_, el) => $(el).attr("data-posting-id")).get()).toEqual(["active", "later", "aside", "due", "feed", "scheduled", "seen", "trail"]);
    expect($(".sectioned-imbox-heading em").map((_, el) => $(el).text()).get()).toEqual(["1 loaded", "1 loaded", "1 loaded", "1 loaded", "1 loaded", "0 loaded", "1 loaded", "2 loaded"]);
    expect($("[data-section=paperTrail] .mail-row")).toHaveLength(0);
    expect($("[data-section=previouslySeen] #mail-row-trail")).toHaveLength(1);
    expect($("[data-section=scheduledBubbleUp] .bubbled-up-mark")).toHaveLength(0);
    expect($("[data-section=bubbledUp] .bubbled-up-mark")).toHaveLength(1);
    expect($(".imbox-layout-switch")).toHaveLength(0);
    expect($(".bulk-action-bar button").filter((_, el) => $(el).text() === "Add to Split")).toHaveLength(1);
    expect($(".sectioned-imbox-sentinel").parent().hasClass("mail-list")).toBe(true);
  });

  it("keeps read split mail behind collapsed history while saved mail stays visible", () => {
    const sectionMailboxes = {
      imbox: imbox([row("seen", true)]),
      feedbox: { ...imbox([row("feed-read", true), row("feed-new", false)]), boxKey: "feedbox" as const },
      trailbox: { ...imbox([row("trail-read", true)]), boxKey: "trailbox" as const },
      laterbox: { ...imbox([row("kept", true)]), boxKey: "laterbox" as const },
    };
    const $ = render(imbox([]), false, [], { accountSplit: true, sectionMailboxes, initialHistoryCollapsed: true });
    expect($(".mail-row").map((_, el) => $(el).attr("data-posting-id")).get()).toEqual(["kept", "feed-new"]);
    expect($("[data-section=previouslySeen] button[aria-expanded=false]")).toHaveLength(1);
    expect($("[data-section=previouslySeen] em").text()).toBe("3 loaded");
  });

  it("shows available Feed and Paper Trail history even when Imbox is unavailable", () => {
    const $ = render(imbox([]), false, [], { accountSplit: true, sectionMailboxes: {
      imbox: { ...imbox([]), status: "unavailable", detail: "Offline" },
      trailbox: { ...imbox([row("trail-read", true)]), boxKey: "trailbox" },
    } });
    expect($("[data-section=previouslySeen] #mail-row-trail-read")).toHaveLength(1);
    expect($("[data-section=active]").text()).toContain("Offline");
  });

  it("keeps split paging and Retry outside collapsed history, including pages with no matches", () => {
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => key.endsWith("work:split-a") ? JSON.stringify(["previouslySeen", "feed"]) : null } });
    const extra = { accountSplit: true, profileKey: "work:split-a", sectionMailboxes: { imbox: imbox([]), feedbox: { ...imbox([row("feed", false)]), boxKey: "feedbox" as const } }, onLoadMore: noop, loadMoreError: "Split history could not load." };
    const $ = render({ ...imbox([]), nextPage: "empty-page-next" }, false, [], extra);
    expect($(".mail-row")).toHaveLength(0);
    expect($("[data-section=previouslySeen] button[aria-expanded=false], [data-section=feed] button[aria-expanded=false]")).toHaveLength(2);
    expect($(".sectioned-imbox-sentinel")).toHaveLength(1);
    expect($(".sectioned-imbox-pagination-error button").text()).toBe("Retry");
    expect($("button").filter((_, el) => /load more/i.test($(el).text()))).toHaveLength(0);
    const other = render(imbox([]), false, [], { ...extra, profileKey: "work:split-b", loadMoreError: undefined });
    expect(other("[data-section=feed] button[aria-expanded=true]")).toHaveLength(1);
    expect(other(".mail-row")).toHaveLength(1);
  });
});
