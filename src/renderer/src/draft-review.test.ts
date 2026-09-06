import { describe, expect, it } from "vitest";
import { composeWritingSuggestion, draftReviewIssue } from "./draft-review";

describe("draft review boundaries", () => {
  it("proposes whole-body writing without mutating the original", () => {
    const original = "Friday, $5,000.";
    expect(composeWritingSuggestion(original, "Thank you! Friday, $5,000.")).toBe("Thank you! Friday, $5,000.");
    expect(original).toBe("Friday, $5,000.");
  });
  it("keeps unselected Markdown and whitespace byte-for-byte", () => {
    const original = "Hi 👋\n\n**Friday**, $5,000.  \nThanks!";
    const start = original.indexOf("Friday");
    expect(composeWritingSuggestion(original, "Thursday", { start, end: start + 6 })).toBe(original.replace("Friday", "Thursday"));
  });
  it("rejects invalid selections", () => {
    for (const selection of [{ start: -1, end: 2 }, { start: 2, end: 1 }, { start: 1, end: 100 }]) expect(() => composeWritingSuggestion("draft", "new", selection)).toThrow();
  });
  it("allows only the unchanged original and matching context", () => {
    const suggestion = { original: "Friday", proposed: "Thursday", context: "account:thread-1" };
    expect(draftReviewIssue(suggestion, "Friday", "account:thread-1")).toBeUndefined();
    expect(draftReviewIssue(suggestion, "Actually Monday", "account:thread-1")).toContain("newer text is safe");
    expect(draftReviewIssue(suggestion, "Friday", "account:thread-2")).toContain("context changed");
  });
});
