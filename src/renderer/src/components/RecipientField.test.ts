import { describe, expect, it } from "vitest";
import { filterContacts, invalidRecipientAddresses, parseRecipients, shouldOpenRecipientSuggestions } from "./RecipientField";

const contacts = [
  { id: "1", title: "Maya Chen", subtitle: "maya@example.com" },
  { id: "2", title: "Jordan Bell", subtitle: "jordan@example.com" },
  { id: "3", title: "Maya Ruiz", subtitle: "ruiz@example.com" },
];

describe("recipient typeahead", () => {
  it("parses comma and semicolon separated addresses without duplicates", () => {
    expect(parseRecipients("maya@example.com; jordan@example.com, maya@example.com")).toEqual(["maya@example.com", "jordan@example.com"]);
  });

  it("matches every loaded contact by name or address and excludes selected recipients", () => {
    expect(filterContacts(contacts, "maya", ["maya@example.com"]).map((contact) => contact.id)).toEqual(["3"]);
    expect(filterContacts(contacts, "jordan@", []).map((contact) => contact.id)).toEqual(["2"]);
  });

  it("ranks name prefixes ahead of incidental address matches", () => {
    const results = filterContacts([
      { id: "1", title: "Morgan Example", subtitle: "notes-alex@example.com" },
      { id: "2", title: "Alex Example", subtitle: "contact@example.com" },
    ], "alex", []);
    expect(results.map((contact) => contact.id)).toEqual(["2", "1"]);
  });

  it("keeps suggestions closed on focus until the first character is typed", () => {
    expect(shouldOpenRecipientSuggestions("")).toBe(false);
    expect(shouldOpenRecipientSuggestions("   ")).toBe(false);
    expect(shouldOpenRecipientSuggestions("a")).toBe(true);
  });

  it("identifies freeform values that cannot be invitation addresses", () => {
    expect(invalidRecipientAddresses("maya@example.com, Maya, missing@example")).toEqual(["Maya", "missing@example"]);
    expect(invalidRecipientAddresses("maya@example.com; jordan@example.org")).toEqual([]);
  });
});
