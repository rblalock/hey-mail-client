import { describe, expect, it } from "vitest";
import { mailboxEmptyCopy } from "./ImboxView";

describe("mailbox empty-state copy", () => {
  it("reserves Imbox zero for Imbox", () => {
    expect(mailboxEmptyCopy("Imbox", true, false)).toEqual({
      title: "Imbox zero",
      detail: "Nothing is asking for your attention.",
    });
    expect(mailboxEmptyCopy("Reply Later", false, false)).toEqual({
      title: "Reply Later is empty",
      detail: "There are no conversations in Reply Later.",
    });
  });

  it("uses search-specific copy in every mailbox", () => {
    expect(mailboxEmptyCopy("The Feed", false, true).title).toBe("No matching conversations");
  });
});
