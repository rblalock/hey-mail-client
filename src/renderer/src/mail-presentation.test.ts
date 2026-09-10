import { describe, expect, it } from "vitest";
import type { ImboxPosting, ThreadEntry } from "../../shared/contracts";
import { addressedContacts, contactLabel, entryAddressedContacts, isOwnMail } from "./mail-presentation";

const sender = { name: "Alex", email: "alex@example.test" };
const recipient = { name: "Membership", email: "members@example.test" };
const posting: ImboxPosting = { id: "1", subject: "Re: Plans", summary: "Thanks", createdAt: "2026-09-10T14:18:21Z", contacts: [sender, recipient], sender, addressedContacts: [recipient], seen: true, visibleEntryCount: 2 };
const entry: ThreadEntry = { id: "2", sender, body: "Thanks", occurredAt: "2026-09-10T14:18Z" };

describe("mail direction and addressing", () => {
  it("identifies Me by the active account address, never by name or Re: subject", () => {
    expect(contactLabel(sender, " ALEX@example.test ")).toBe("Me");
    expect(isOwnMail(sender, "other@example.test")).toBe(false);
    expect(isOwnMail({ name: "Alex", kind: "User" }, "alex@example.test")).toBe(false);
    expect(isOwnMail(sender, undefined)).toBe(false);
  });
  it("does not invent recipients from participants", () => {
    expect(addressedContacts({ ...posting, addressedContacts: undefined })).toEqual([]);
    expect(addressedContacts({ ...posting, addressedContacts: [recipient, recipient] })).toEqual([recipient]);
  });
  it("matches HEY's minute precision thread date with the list's precise timestamp", () => {
    expect(entryAddressedContacts(posting, entry, true, 2)).toEqual([recipient]);
  });
  it("never attaches current addressing to earlier or stale entries", () => {
    expect(entryAddressedContacts(posting, entry, false, 2)).toEqual([]);
    expect(entryAddressedContacts(posting, entry, true, 3)).toEqual([]);
    expect(entryAddressedContacts(posting, { ...entry, occurredAt: "2026-09-10T14:19:00Z" }, true, 2)).toEqual([]);
    expect(entryAddressedContacts(posting, { ...entry, sender: recipient }, true, 2)).toEqual([]);
    expect(entryAddressedContacts(posting, { ...entry, occurredAt: "invalid" }, true, 2)).toEqual([]);
  });
});
