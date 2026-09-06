import { describe, expect, it } from "vitest";
import type { ImboxPosting, MailOrganizationItem } from "../../shared/contracts";
import { filterOrganizationItems, organizationTargets, organizationToggleAction } from "./mail-organization";

const posting = (id: string, topicId?: string): ImboxPosting => ({
  id,
  topicId,
  subject: `Conversation ${id}`,
  summary: "",
  seen: true,
  createdAt: "2026-09-01T12:00:00Z",
  contacts: [],
  sender: { name: "Example Sender" },
  visibleEntryCount: 1,
});

describe("bulk mail organization", () => {
  it("keeps posting IDs for labels and only authoritative topic IDs for Collections", () => {
    expect(organizationTargets([posting("101", "201"), posting("102"), posting("not-an-id", "202")])).toEqual({
      postingIds: ["101", "102"],
      topicIds: ["201", "202"],
    });
  });

  it("adds mixed membership to the whole selection and removes only all-membership", () => {
    const item = (membership: MailOrganizationItem["membership"]): MailOrganizationItem => ({ id: "1", name: "Project", membership, memberCount: membership === "none" ? 0 : 1 });
    expect(organizationToggleAction(item("none"))).toBe("add");
    expect(organizationToggleAction(item("some"))).toBe("add");
    expect(organizationToggleAction(item("all"))).toBe("remove");
  });

  it("filters names and summaries without changing the source order", () => {
    const items: MailOrganizationItem[] = [
      { id: "1", name: "Launch", summary: "Final decisions", membership: "none", memberCount: 0 },
      { id: "2", name: "Receipts", membership: "all", memberCount: 2 },
    ];
    expect(filterOrganizationItems(items, "decision").map((item) => item.id)).toEqual(["1"]);
  });
});
