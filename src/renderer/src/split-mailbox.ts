import type { ImboxPosting, MailboxKey } from "../../shared/contracts";
import { matchesMailSplit, splitTopicId, type MailSplitDraft, type MailSplitState } from "../../shared/mail-splits";
import { groupSectionedImbox, type SectionedMailboxes } from "./sectioned-imbox";

export function splitViewIds(state: MailSplitState): string[] {
  return ["all", ...state.splits.filter((split) => split.enabled).map((split) => split.id), "remaining"];
}

export function filterSplitMailboxes(mailboxes: SectionedMailboxes, state: MailSplitState, selectedId: string): SectionedMailboxes {
  const enabled = state.splits.filter((split) => split.enabled);
  const selected = enabled.find((split) => split.id === selectedId);
  if (selectedId === "all" || selectedId !== "remaining" && !selected) return mailboxes;
  const matchers = (selected ? [selected] : enabled).map((split) => {
    const topics = new Set(state.memberships[split.id]);
    return (posting: ImboxPosting) => topics.has(splitTopicId(posting)) || matchesMailSplit(posting, split, state.ownEmail);
  });
  const matches = (posting: ImboxPosting) => selected
    ? matchers[0]!(posting) : !matchers.some((match) => match(posting));
  return Object.fromEntries(Object.entries(mailboxes).map(([box, result]) => [box,
    result && ["imbox", "laterbox", "asidebox"].includes(box) ? { ...result, postings: result.postings.filter(matches) } : result,
  ])) as Partial<Record<MailboxKey, NonNullable<SectionedMailboxes[MailboxKey]>>>;
}

export function splitPendingCounts(mailboxes: SectionedMailboxes, state: MailSplitState): Record<string, number> {
  return Object.fromEntries(splitViewIds(state).map((id) => {
    const groups = groupSectionedImbox(filterSplitMailboxes(mailboxes, state, id));
    return [id, groups.active.length + groups.replyLater.length + groups.setAside.length + groups.bubbledUp.length];
  }));
}

export function splitDraftFromPosting(posting: ImboxPosting, kind: "person" | "domain", ownEmail?: string): Partial<MailSplitDraft> | undefined {
  const own = ownEmail?.toLowerCase();
  const contact = [posting.sender, ...posting.contacts, ...(posting.addressedContacts ?? [])].find((person) => person.kind?.toLowerCase() !== "user" && person.email?.includes("@") && person.email.toLowerCase() !== own);
  if (!contact?.email) return undefined;
  const email = contact.email.toLowerCase();
  const domain = email.slice(email.lastIndexOf("@") + 1);
  const name = kind === "person" ? contact.name || email : domain;
  return { name, labelName: name, people: kind === "person" ? [email] : [], domains: kind === "domain" ? [domain] : [], enabled: true };
}
