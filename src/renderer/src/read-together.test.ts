import { describe, expect, it } from "vitest";
import type { ImboxPosting } from "../../shared/contracts";
import { postingsForReadTogether, skippedReadTogetherCount } from "./read-together";

function posting(id: string, topicId?: string): ImboxPosting {
  return {
    id,
    topicId,
    subject: `Conversation ${id}`,
    summary: "Synthetic summary",
    seen: false,
    createdAt: "2026-09-01T12:00:00.000Z",
    contacts: [{ name: `Sender ${id}` }],
    sender: { name: `Sender ${id}` },
    visibleEntryCount: 1,
  };
}

describe("Read Together selection", () => {
  it("uses mailbox order instead of the order avatars were selected", () => {
    const postings = [posting("101", "201"), posting("102", "202"), posting("103", "203")];

    expect(postingsForReadTogether(postings, ["103", "101"]).map((item) => item.id)).toEqual(["101", "103"]);
  });

  it("keeps contact bundles out of the reader without guessing a topic ID", () => {
    const postings = [posting("101", "201"), posting("102")];

    expect(postingsForReadTogether(postings, ["101", "102"]).map((item) => item.id)).toEqual(["101"]);
    expect(skippedReadTogetherCount(postings, ["101", "102"])).toBe(1);
  });
});
