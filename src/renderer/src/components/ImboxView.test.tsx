import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ImboxPosting, ImboxResult } from "../../../shared/contracts";
import ImboxView from "./ImboxView";

const noop = () => {};
const row = (id: string, seen: boolean, bubbledUp?: boolean): ImboxPosting => ({
  id, subject: id, summary: "Synthetic summary", seen, bubbledUp,
  createdAt: "2026-09-01T12:00:00Z", contacts: [], sender: { name: "Example" }, visibleEntryCount: 1,
});
function render(result: ImboxResult, showSenderAvatars = false, bulkSelectedIds: string[] = []) {
  return load(renderToStaticMarkup(<ImboxView mailboxKey={result.boxKey} result={result} loading={false} searchRequest={0}
    showSenderAvatars={showSenderAvatars} bulkSelectedIds={bulkSelectedIds} bulkBusy={false} commandPaletteOpen={false}
    onSelect={noop} onToggleSelection={noop} onBulkAction={noop} onReadTogether={noop}
    onReplyTogether={noop} onOrganizeSelection={noop} onClearSelection={noop}
    onRefresh={noop} onNavigate={noop} onSetAsideGroup={noop} />));
}
const imbox = (postings: ImboxPosting[]): ImboxResult => ({ status: "ready", boxKey: "imbox", boxName: "Imbox", postings });

describe("Imbox section presentation", () => {
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
});
