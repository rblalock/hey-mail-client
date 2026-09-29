import type { ImboxPosting, ImboxResult, MailboxKey } from "./contracts";

export type MailSplit = {
  id: string;
  name: string;
  enabled: boolean;
  people: string[];
  domains: string[];
  labelId?: string;
  labelName: string;
};

export type MailSplitDraft = Omit<MailSplit, "id"> & { id?: string };
export type MailSplitState = {
  splits: MailSplit[];
  errors: Record<string, string>;
  ownEmail?: string;
  /** Conversation IDs, keyed by split ID. These include existing HEY label members. */
  memberships: Record<string, string[]>;
  loadingMemberships?: string[];
};
export type MailSplitPreview = {
  count: number;
  scannedCount: number;
  samples: ImboxPosting[];
  scope: string;
};
export type MailSplitPage = {
  mailboxes: Partial<Record<MailboxKey, ImboxResult>>;
  nextPage?: string;
  /** False only while the bounded first page of each source is still arriving. */
  headComplete?: boolean;
  membershipLoading?: boolean;
  membershipError?: string;
};
export type AddToSplitRequest = {
  splitId: string;
  postingIds: string[];
  people?: string[];
  domains?: string[];
};

export const SPLIT_MAILBOXES: readonly MailboxKey[] = ["imbox", "feedbox", "trailbox", "asidebox", "laterbox", "bubblebox"];

export const MAX_MAIL_SPLITS = 20;
export const MAX_SPLIT_PEOPLE = 50;
export const MAX_SPLIT_DOMAINS = 50;

export function isMailSplitId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value) && !["all", "remaining", "constructor", "prototype"].includes(value);
}

export function isHeyId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
}

function domain(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, "");
}

function validDomain(value: string): boolean {
  return value.length <= 253 && value.includes(".") && value.split(".").every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part));
}

function validEmail(value: string): boolean {
  const parts = value.split("@");
  const local = parts[0] ?? "";
  return value.length <= 254 && parts.length === 2 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)
    && !local.startsWith(".") && !local.endsWith(".") && !local.includes("..") && validDomain(parts[1] ?? "");
}

function rules(value: unknown, kind: "people" | "domains", maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum || value.some((item) => typeof item !== "string")) {
    throw new Error(`Use at most ${maximum} ${kind === "people" ? "email addresses" : "domains"} per split.`);
  }
  const normalized = value.map((item: string) => kind === "domains" ? domain(item) : item.trim().toLowerCase());
  if (normalized.some((item) => kind === "domains" ? !validDomain(item) : !validEmail(item))) {
    throw new Error(kind === "domains" ? "Enter domains such as company.com, without a URL or wildcard." : "Enter complete email addresses, such as person@company.com.");
  }
  return [...new Set(normalized)];
}

/** Strict boundary validation; no user-authored regular expressions or CLI queries. */
export function normalizeMailSplitDraft(value: unknown): MailSplitDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid split.");
  const item = value as Record<string, unknown>;
  if (item.id !== undefined && !isMailSplitId(item.id)) throw new Error("Invalid split ID.");
  if (typeof item.name !== "string" || !item.name.trim() || item.name.trim().length > 80 || /[\x00-\x1f\x7f]/.test(item.name)) {
    throw new Error("Give the split a name of 80 characters or fewer.");
  }
  if (typeof item.enabled !== "boolean") throw new Error("Choose whether this split is enabled.");
  if (item.labelId !== undefined && !isHeyId(item.labelId)) throw new Error("Choose a valid HEY label.");
  if (typeof item.labelName !== "string" || !item.labelName.trim() || item.labelName.trim().length > 120 || /[\x00-\x1f\x7f]/.test(item.labelName)) {
    throw new Error("Choose a HEY label or enter a label name of 120 characters or fewer.");
  }
  if (!item.labelId && item.labelName.trim().startsWith("-")) throw new Error("New HEY label names cannot start with a dash.");
  const people = rules(item.people, "people", MAX_SPLIT_PEOPLE);
  const domains = rules(item.domains, "domains", MAX_SPLIT_DOMAINS);
  return {
    ...(item.id ? { id: item.id as string } : {}),
    name: item.name.trim(),
    enabled: item.enabled,
    people,
    domains,
    ...(item.labelId ? { labelId: item.labelId as string } : {}),
    labelName: item.labelName.trim(),
  };
}

export function normalizeAddToSplit(value: unknown): AddToSplitRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Choose conversations and a split.");
  const item = value as Record<string, unknown>;
  if (!isMailSplitId(item.splitId)) throw new Error("Choose a valid split.");
  if (!Array.isArray(item.postingIds) || !item.postingIds.length || item.postingIds.length > 100
    || item.postingIds.some((id) => !isHeyId(id)) || new Set(item.postingIds).size !== item.postingIds.length) {
    throw new Error("Choose 1–100 unique HEY conversations.");
  }
  return {
    splitId: item.splitId,
    postingIds: item.postingIds as string[],
    ...(item.people === undefined ? {} : { people: rules(item.people, "people", MAX_SPLIT_PEOPLE) }),
    ...(item.domains === undefined ? {} : { domains: rules(item.domains, "domains", MAX_SPLIT_DOMAINS) }),
  };
}

/** Participant matching keeps a conversation in its split after the user replies. */
export function matchesMailSplit(posting: ImboxPosting, split: Pick<MailSplit, "people" | "domains">, ownEmail?: string): boolean {
  const people = new Set(split.people);
  const domains = new Set(split.domains);
  return [posting.sender, ...posting.contacts, ...(posting.addressedContacts ?? [])].some((contact) => {
    const email = contact.email?.trim().toLowerCase();
    if (!email) return false;
    const parts = email.split("@");
    // Exact domain matching: company.com must not match notcompany.com or its subdomains.
    const isSelf = email === ownEmail?.trim().toLowerCase() || contact.kind?.toLowerCase() === "user";
    return people.has(email) || !isSelf && parts.length === 2 && domains.has(parts[1] ?? "");
  });
}

export function splitTopicId(posting: ImboxPosting): string {
  return posting.topicId ?? posting.id;
}

export function splitContainsPosting(posting: ImboxPosting, split: MailSplit, memberships: Record<string, readonly string[]>, ownEmail?: string): boolean {
  return matchesMailSplit(posting, split, ownEmail) || Boolean(memberships[split.id]?.includes(splitTopicId(posting)));
}
