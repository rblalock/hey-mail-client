import { describe, expect, it } from "vitest";
import type { ImboxPosting } from "./contracts";
import { matchesMailSplit, normalizeAddToSplit, normalizeMailSplitDraft, splitContainsPosting, type MailSplitDraft } from "./mail-splits";

const draft: MailSplitDraft = { name: "Team", enabled: true, people: ["friend@example.net"], domains: ["company.com"], labelName: "Team" };
const row: ImboxPosting = { id: "10", topicId: "20", subject: "Hello", summary: "", seen: false, createdAt: "2026-09-27", visibleEntryCount: 1, contacts: [], sender: { name: "Someone", email: "one@company.com" } };

describe("split rules", () => {
  it("normalizes explicit people and domains without a query language", () => {
    expect(normalizeMailSplitDraft({ ...draft, name: " Team ", people: [" Friend@EXAMPLE.net ", "friend@example.net"], domains: ["@Company.com", "company.com"] })).toEqual(draft);
  });

  it("permits manual-only splits with deferred label creation", () => {
    expect(normalizeMailSplitDraft({ ...draft, people: [], domains: [] })).toMatchObject({ people: [], domains: [] });
    expect(matchesMailSplit(row, { people: [], domains: [] })).toBe(false);
  });

  it("validates bounded manual additions and optional future rules", () => {
    expect(normalizeAddToSplit({ splitId: "team", postingIds: ["10"], domains: ["@COMPANY.com"] })).toEqual({ splitId: "team", postingIds: ["10"], domains: ["company.com"] });
    for (const change of [{ splitId: "../bad" }, { postingIds: [] }, { postingIds: ["0"] }, { postingIds: ["10", "10"] }, { postingIds: Array.from({ length: 101 }, (_, index) => `${index + 1}`) }, { people: ["invalid"] }]) {
      expect(() => normalizeAddToSplit({ splitId: "team", postingIds: ["10"], ...change })).toThrow();
    }
  });

  it("matches people OR exact domains and retains membership after an own reply", () => {
    expect(matchesMailSplit(row, draft)).toBe(true);
    expect(matchesMailSplit({ ...row, sender: { name: "Friend", email: "FRIEND@example.net" } }, draft)).toBe(true);
    for (const email of ["one@notcompany.com", "one@company.com.attacker.net", "one@sub.company.com", "company.com@elsewhere.com"]) {
      expect(matchesMailSplit({ ...row, sender: { name: "Other", email } }, draft)).toBe(false);
    }
    expect(matchesMailSplit({ ...row, sender: { name: "Me", email: "me@home.net" }, contacts: [{ name: "Coworker", email: "one@company.com" }] }, draft)).toBe(true);
    expect(matchesMailSplit({ ...row, sender: { name: "Me" }, addressedContacts: [{ name: "Friend", email: "friend@example.net" }] }, draft)).toBe(true);
  });

  it("includes manually labeled conversations and permits overlapping splits", () => {
    const other = { ...row, sender: { name: "Other", email: "other@elsewhere.net" } };
    expect(splitContainsPosting(other, { ...draft, id: "split-a" }, { "split-a": ["20"] })).toBe(true);
    expect(splitContainsPosting(other, { ...draft, id: "split-b" }, { "split-a": ["20"] })).toBe(false);
    expect(splitContainsPosting(row, { ...draft, id: "split-a" }, {})).toBe(true);
    expect(splitContainsPosting(row, { ...draft, id: "split-b" }, {})).toBe(true);
  });

  it("does not match every incoming conversation through the user's own work domain", () => {
    const incoming = { ...row, sender: { name: "Stranger", email: "stranger@elsewhere.net" }, addressedContacts: [{ name: "Me", email: "me@company.com" }] };
    expect(matchesMailSplit(incoming, draft, "ME@company.com")).toBe(false);
    expect(matchesMailSplit({ ...incoming, addressedContacts: [{ name: "Me", email: "alias@company.com", kind: "User" }] }, draft)).toBe(false);
    const ownReply = { ...incoming, sender: { name: "Me", email: "me@company.com" }, contacts: [{ name: "Colleague", email: "colleague@company.com" }] };
    expect(matchesMailSplit(ownReply, draft, "me@company.com")).toBe(true);
    expect(matchesMailSplit(incoming, { people: ["me@company.com"], domains: [] }, "me@company.com")).toBe(true);
  });

  it.each([
    { people: ["not-an-email"] }, { people: ["A Person <person@company.com>"] },
    { people: ["person\n@company.com"] }, { people: [".person@company.com"] }, { people: ["per..son@company.com"] },
    { domains: ["*.company.com"] }, { domains: ["https://company.com"] }, { domains: ["company.com --account 123"] },
    { domains: ["localhost"] }, { domains: ["-company.com"] }, { domains: ["company..com"] },
    { name: "" }, { name: "A".repeat(81) }, { name: "A\nB" }, { labelName: "" }, { labelName: "--json" },
    { labelId: "0" }, { labelId: "--all" }, { labelId: "9223372036854775808" }, { id: "../other" }, { id: "__proto__" }, { id: "constructor" }, { id: "all" }, { id: "remaining" },
    { enabled: "true" }, { people: Array.from({ length: 51 }, (_, index) => `person${index}@company.com`) },
  ])("rejects invalid rules: %j", (change) => {
    expect(() => normalizeMailSplitDraft({ ...draft, ...change })).toThrow();
  });
});
