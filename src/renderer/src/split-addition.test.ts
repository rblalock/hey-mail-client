import { describe, expect, it } from "vitest";
import type { ImboxPosting } from "../../shared/contracts";
import { splitAdditionForPostings } from "./split-addition";

const posting = (id: string, email: string | undefined = "jamie@example.com", overrides: Partial<ImboxPosting> = {}): ImboxPosting => ({
  id, topicId: `topic-${id}`, subject: "Project plans", summary: "", seen: false, createdAt: "2026-09-27T12:00:00Z",
  sender: { name: "Jamie", email }, contacts: [], visibleEntryCount: 1, ...overrides,
});

describe("add conversations to a split", () => {
  it("defaults to explicit conversation IDs without adding person or domain rules", () => {
    const rows = [posting("1"), posting("2"), posting("1")];
    expect(splitAdditionForPostings("manual", rows, "conversation")).toEqual({ splitId: "manual", postingIds: ["1", "2"] });
    expect(splitAdditionForPostings("manual", [posting("1", undefined, { sender: { name: "Unknown" } })], "conversation")).toEqual({ splitId: "manual", postingIds: ["1"] });
  });

  it("normalizes and deduplicates people and exact domains across a bulk selection", () => {
    const rows = [posting("1", " Jamie@Example.COM "), posting("2", "jamie@example.com"), posting("3", "other@EXAMPLE.com"), posting("4", "person@mail.example.com")];
    expect(splitAdditionForPostings("team", rows, "person")).toEqual({ splitId: "team", postingIds: ["1", "2", "3", "4"], people: ["jamie@example.com", "other@example.com", "person@mail.example.com"] });
    expect(splitAdditionForPostings("team", rows, "domain")).toEqual({ splitId: "team", postingIds: ["1", "2", "3", "4"], domains: ["example.com", "mail.example.com"] });
  });

  it("finds the other participant when the selected message is your own reply", () => {
    const row = posting("1", " Me@Example.com ", { addressedContacts: [{ name: "Partner", email: "partner@studio.test" }] });
    expect(splitAdditionForPostings("team", [row], "person", " me@example.com ").people).toEqual(["partner@studio.test"]);
    expect(splitAdditionForPostings("team", [posting("1", "me@example.com", { sender: { name: "Me", email: "me@example.com", kind: "User" }, contacts: [{ name: "Partner", email: "partner@studio.test" }] })], "domain").domains).toEqual(["studio.test"]);
  });

  it("rejects the whole bulk request when any row is missing, bundled, or invalid", () => {
    expect(() => splitAdditionForPostings("team", [], "conversation")).toThrow("Choose individual mail conversations");
    for (const invalid of [posting("0"), posting("broken"), posting("9223372036854775808"), posting("2", undefined, { topicId: undefined }), posting("2", undefined, { kind: "bundle" })]) {
      expect(() => splitAdditionForPostings("team", [posting("1"), invalid], "conversation")).toThrow("Choose individual mail conversations");
    }
    expect(() => splitAdditionForPostings("all", [posting("1")], "conversation")).toThrow("Choose a valid split");
  });

  it("requires an available address for every selected future-mail rule", () => {
    const unknown = posting("2", undefined, { sender: { name: "Unknown" } });
    for (const mode of ["person", "domain"] as const) {
      expect(() => splitAdditionForPostings("team", [posting("1"), unknown], mode)).toThrow("Add only these conversations instead");
      expect(() => splitAdditionForPostings("team", [posting("1", "me@example.com")], mode, "me@example.com")).toThrow("no person’s email address");
    }
    expect(() => splitAdditionForPostings("team", [posting("1", "bad..name@example.com")], "person")).toThrow("complete email addresses");
    expect(() => splitAdditionForPostings("team", [posting("1", "person@*.example.com")], "domain")).toThrow("without a URL or wildcard");
  });

  it("bounds selected conversations and distinct rules without counting duplicate IDs", () => {
    const rows = Array.from({ length: 100 }, (_, index) => posting(String(index + 1)));
    expect(splitAdditionForPostings("team", [...rows, rows[0]!], "conversation").postingIds).toHaveLength(100);
    expect(() => splitAdditionForPostings("team", [...rows, posting("101")], "conversation")).toThrow("up to 100 conversations");
    expect(splitAdditionForPostings("team", rows, "person").people).toEqual(["jamie@example.com"]);
    expect(() => splitAdditionForPostings("team", rows.slice(0, 51).map((row, index) => ({ ...row, sender: { name: "Sender", email: `person${index}@example.com` } })), "person")).toThrow("at most 50 email addresses");
    expect(() => splitAdditionForPostings("team", rows.slice(0, 51).map((row, index) => ({ ...row, sender: { name: "Sender", email: `person@team${index}.example.com` } })), "domain")).toThrow("at most 50 domains");
  });
});
