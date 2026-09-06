import type { MailContact } from "../../shared/contracts";

export function contactInitials(contact: Pick<MailContact, "name" | "email" | "initials">): string {
  if (contact.initials?.trim()) return contact.initials.replace(/\s+/g, "").slice(0, 4).toUpperCase();
  const source = contact.name.trim() || contact.email?.split("@")[0]?.trim() || "?";
  return source.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

function normalizedEmail(value: string | undefined): string | undefined {
  const email = value?.trim().toLocaleLowerCase();
  return email || undefined;
}

export function enrichContactAvatar(contact: MailContact, candidates: MailContact[]): MailContact {
  const email = normalizedEmail(contact.email);
  const match = candidates.find((candidate) => Boolean(contact.id && candidate.id === contact.id))
    ?? candidates.find((candidate) => Boolean(email && normalizedEmail(candidate.email) === email));
  if (!match) return contact;
  return {
    ...contact,
    ...(contact.avatarUrl || !match.avatarUrl ? {} : { avatarUrl: match.avatarUrl }),
    ...(contact.avatarBackgroundColor || !match.avatarBackgroundColor ? {} : { avatarBackgroundColor: match.avatarBackgroundColor }),
    ...(contact.initials || !match.initials ? {} : { initials: match.initials }),
  };
}

export function contactIdentityKey(contact: MailContact): string {
  return contact.id ? `id:${contact.id}` : contact.email ? `email:${contact.email.toLocaleLowerCase()}` : `name:${contact.name.toLocaleLowerCase()}`;
}
