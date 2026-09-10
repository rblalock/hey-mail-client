import type { ImboxPosting, MailContact, ThreadEntry } from "../../shared/contracts";

export function currentMailEmail(): string | undefined {
  return typeof window === "undefined" ? undefined : window.heyAgent?.profiles?.current.active?.email;
}

export function isOwnMail(contact: MailContact, email: string | undefined): boolean {
  return Boolean(email?.trim() && contact.email?.trim().toLowerCase() === email.trim().toLowerCase());
}

export function contactLabel(contact: MailContact, email?: string): string {
  return isOwnMail(contact, email) ? "Me" : contact.name;
}

export function contactDetails(contact: MailContact): string {
  return contact.email ? `${contact.name} <${contact.email}>` : contact.name;
}

export function addressedContacts(posting: ImboxPosting): MailContact[] {
  const seen = new Set<string>();
  return (posting.addressedContacts ?? []).filter((contact) => {
    const key = contact.email?.toLowerCase() || contact.id || contact.name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// List addressing belongs to the latest activity only. Do not copy it onto
// historical entries, or onto a newer message when the list cache is stale.
export function entryAddressedContacts(posting: ImboxPosting, entry: ThreadEntry, latest: boolean, entryCount: number): MailContact[] {
  const time = Date.parse(entry.occurredAt);
  const postingTime = Date.parse(posting.createdAt);
  // HEY's thread command truncates message dates to minutes; mailbox dates
  // retain seconds. Count and author must also agree before sharing addressing.
  const minutePrecision = /T\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})?$/.test(entry.occurredAt);
  const sameTime = minutePrecision ? Math.floor(time / 60_000) === Math.floor(postingTime / 60_000) : time === postingTime;
  if (!latest || posting.kind === "bundle" || entryCount !== posting.visibleEntryCount || !Number.isFinite(time) || !sameTime
    || !entry.sender.email || entry.sender.email.toLowerCase() !== posting.sender.email?.toLowerCase()) return [];
  return addressedContacts(posting);
}
