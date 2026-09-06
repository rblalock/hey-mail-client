import { describe, expect, it } from "vitest";
import { screenerPosting } from "./screener-posting";

describe("screenerPosting", () => {
  it("adapts an unscreened sender for the shared reader without using a mutable posting id", () => {
    expect(screenerPosting({
      id: "clearance-7",
      topicId: "topic-12",
      sender: { name: "Avery North", email: "avery@example.test", initials: "AN", avatarBackgroundColor: "#345678" },
      subject: "A short field note",
      summary: "Synthetic preview text.",
    })).toEqual({
      id: "screener-clearance-7",
      topicId: "topic-12",
      appUrl: "https://app.hey.com/topics/topic-12",
      subject: "A short field note",
      summary: "Synthetic preview text.",
      seen: true,
      createdAt: "",
      contacts: [{ name: "Avery North", email: "avery@example.test", initials: "AN", avatarBackgroundColor: "#345678" }],
      sender: { name: "Avery North", email: "avery@example.test", initials: "AN", avatarBackgroundColor: "#345678" },
      visibleEntryCount: 1,
    });
  });
});
