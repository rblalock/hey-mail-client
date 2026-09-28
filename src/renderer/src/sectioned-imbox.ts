import type { ImboxPosting, ImboxResult, MailboxKey } from "../../shared/contracts";

export type SectionedMailboxes = Partial<Record<MailboxKey, ImboxResult>>;
export type ImboxSectionKey = "active" | "replyLater" | "setAside" | "bubbledUp" | "previouslySeen";
export type SectionedImbox = Record<ImboxSectionKey, ImboxPosting[]>;
export type AccountSplitSectionKey = ImboxSectionKey | "feed" | "paperTrail" | "scheduledBubbleUp";
export type AccountSplitMailboxes = Record<AccountSplitSectionKey, ImboxPosting[]>;

export const IMBOX_SECTION_ORDER: ImboxSectionKey[] = ["active", "replyLater", "setAside", "bubbledUp", "previouslySeen"];
export const ACCOUNT_SPLIT_SECTION_ORDER: AccountSplitSectionKey[] = ["active", "replyLater", "setAside", "bubbledUp", "feed", "paperTrail", "scheduledBubbleUp", "previouslySeen"];
export const SECTION_MAILBOX: Record<AccountSplitSectionKey, MailboxKey> = { active: "imbox", replyLater: "laterbox", setAside: "asidebox", bubbledUp: "imbox", previouslySeen: "imbox", feed: "feedbox", paperTrail: "trailbox", scheduledBubbleUp: "bubblebox" };
export const PREVIOUSLY_SEEN_BATCH = 25;

function topicKey(posting: ImboxPosting): string {
  return posting.topicId ? `topic:${posting.topicId}` : `posting:${posting.id}`;
}

/** Saved memberships win over Imbox state; Bubble Up's scheduled mailbox is not due mail. */
export function groupSectionedImbox(mailboxes: SectionedMailboxes, retainedActiveId?: string): SectionedImbox {
  const sections: SectionedImbox = { active: [], replyLater: [], setAside: [], bubbledUp: [], previouslySeen: [] };
  const topics = new Set<string>();
  const ids = new Set<string>();
  const add = (section: ImboxSectionKey, posting: ImboxPosting) => {
    const key = topicKey(posting);
    if (topics.has(key) || ids.has(posting.id)) return;
    topics.add(key);
    ids.add(posting.id);
    sections[section].push(posting);
  };
  for (const [box, section] of [["laterbox", "replyLater"], ["asidebox", "setAside"]] as const) {
    if (mailboxes[box]?.status === "ready") for (const posting of mailboxes[box].postings) add(section, posting);
  }
  const imbox = mailboxes.imbox?.status === "ready" ? mailboxes.imbox.postings : [];
  // Establish membership before display order so duplicate topic versions cannot
  // hide a returned reminder or an unread conversation behind a seen version.
  for (const posting of imbox) if (posting.bubbledUp) add("bubbledUp", posting);
  for (const posting of imbox) if (!posting.seen || posting.id === retainedActiveId) add("active", posting);
  for (const posting of imbox) add("previouslySeen", posting);
  return sections;
}

/** An account split keeps each source's workflow; a scheduled reminder is not due. */
export function groupAccountSplitMailboxes(mailboxes: SectionedMailboxes, retainedActiveId?: string): AccountSplitMailboxes {
  const imbox = groupSectionedImbox(mailboxes, retainedActiveId);
  const sections: AccountSplitMailboxes = { active: [], replyLater: [], setAside: [], bubbledUp: [], previouslySeen: [], feed: [], paperTrail: [], scheduledBubbleUp: [] };
  const topics = new Set<string>();
  const ids = new Set<string>();
  const add = (section: AccountSplitSectionKey, rows: ImboxPosting[]) => {
    for (const posting of rows) {
      const key = topicKey(posting);
      if (topics.has(key) || ids.has(posting.id)) continue;
      topics.add(key);
      ids.add(posting.id);
      sections[section].push(posting);
    }
  };
  const rows = (box: MailboxKey) => mailboxes[box]?.status === "ready" ? mailboxes[box].postings : [];
  add("replyLater", imbox.replyLater);
  add("setAside", imbox.setAside);
  add("scheduledBubbleUp", rows("bubblebox"));
  for (const key of ["bubbledUp", "active", "previouslySeen"] as const) add(key, imbox[key]);
  add("feed", rows("feedbox"));
  add("paperTrail", rows("trailbox"));
  return sections;
}

/** The physical mailbox of the winning row, used for read and membership actions. */
export function sectionedPostingSource(mailboxes: SectionedMailboxes, posting: ImboxPosting, accountSplit = false): MailboxKey {
  const sources: MailboxKey[] = accountSplit ? ["laterbox", "asidebox", "bubblebox", "imbox", "feedbox", "trailbox"] : ["laterbox", "asidebox", "imbox"];
  for (const box of sources) {
    if (mailboxes[box]?.status === "ready" && mailboxes[box].postings.some((candidate) => candidate.id === posting.id || topicKey(candidate) === topicKey(posting))) return box;
  }
  return "imbox";
}

/** Mixed selections add to a saved section; only a complete shared membership toggles off. */
export function sectionedSelectionSource(mailboxes: SectionedMailboxes, postingIds: string[], accountSplit = false): MailboxKey {
  if (!postingIds.length) return "imbox";
  const groups = accountSplit ? groupAccountSplitMailboxes(mailboxes) : { ...groupSectionedImbox(mailboxes), feed: [], paperTrail: [], scheduledBubbleUp: [] };
  const order = accountSplit ? ACCOUNT_SPLIT_SECTION_ORDER : IMBOX_SECTION_ORDER;
  const sources = new Map<string, MailboxKey>(order.flatMap((key) => groups[key].map((posting) => [posting.id, SECTION_MAILBOX[key]] as [string, MailboxKey])));
  const first = sources.get(postingIds[0]!);
  return first && postingIds.every((id) => sources.get(id) === first) ? first : "imbox";
}
