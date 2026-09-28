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

/** Splits show pending mail by source, with read mail in a shared history. Saved states persist. */
export function groupAccountSplitMailboxes(mailboxes: SectionedMailboxes, retainedActiveId?: string, retainedSourceBox?: MailboxKey): AccountSplitMailboxes {
  const sections: AccountSplitMailboxes = { active: [], replyLater: [], setAside: [], bubbledUp: [], previouslySeen: [], feed: [], paperTrail: [], scheduledBubbleUp: [] };
  const topics = new Set<string>();
  const ids = new Set<string>();
  const add = (section: AccountSplitSectionKey, sourceBox: MailboxKey, rows: ImboxPosting[]) => {
    for (const posting of rows) {
      const key = topicKey(posting);
      if (topics.has(key) || ids.has(posting.id)) continue;
      topics.add(key);
      ids.add(posting.id);
      sections[section].push({ ...posting, sourceBox });
    }
  };
  const rows = (box: MailboxKey) => mailboxes[box]?.status === "ready" ? mailboxes[box].postings : [];
  add("replyLater", "laterbox", rows("laterbox"));
  add("setAside", "asidebox", rows("asidebox"));
  add("scheduledBubbleUp", "bubblebox", rows("bubblebox"));
  add("bubbledUp", "imbox", rows("imbox").filter((posting) => posting.bubbledUp));
  const pendingSources = [["imbox", "active"], ["feedbox", "feed"], ["trailbox", "paperTrail"]] as const;
  const unread = pendingSources.flatMap(([box]) => rows(box).filter((posting) => !posting.seen));
  const unreadTopics = new Set(unread.map(topicKey));
  const unreadIds = new Set(unread.map((posting) => posting.id));
  // Keep retained rows in source order, but let any unread copy win over a read one.
  for (const [box, section] of pendingSources) {
    add(section, box, rows(box).filter((posting) => !posting.seen || (posting.id === retainedActiveId && (!retainedSourceBox || retainedSourceBox === box) && !unreadTopics.has(topicKey(posting)) && !unreadIds.has(posting.id))));
  }
  for (const [box] of pendingSources) add("previouslySeen", box, rows(box).filter((posting) => posting.seen));
  sections.previouslySeen.sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return rightTime - leftTime;
    if (Number.isFinite(leftTime)) return -1;
    if (Number.isFinite(rightTime)) return 1;
    return 0;
  });
  return sections;
}

/** The physical mailbox of the winning row, used for read and membership actions. */
export function sectionedPostingSource(mailboxes: SectionedMailboxes, posting: ImboxPosting, accountSplit = false): MailboxKey {
  const sources: MailboxKey[] = accountSplit ? ["laterbox", "asidebox", "bubblebox", "imbox", "feedbox", "trailbox"] : ["laterbox", "asidebox", "imbox"];
  if (accountSplit) {
    for (const box of ["laterbox", "asidebox", "bubblebox"] as const) {
      if (mailboxes[box]?.status === "ready" && mailboxes[box].postings.some((candidate) => candidate.id === posting.id || topicKey(candidate) === topicKey(posting))) return box;
    }
    const sourceBox = posting.sourceBox;
    const source = sourceBox && mailboxes[sourceBox];
    if (sourceBox && source?.status === "ready" && source.postings.some((candidate) => candidate.id === posting.id || topicKey(candidate) === topicKey(posting))) return sourceBox;
    // A seen copy in another source must not redirect the winning pending row.
    for (const match of [(candidate: ImboxPosting) => candidate === posting, (candidate: ImboxPosting) => candidate.id === posting.id]) {
      for (const box of sources) {
        if (mailboxes[box]?.status === "ready" && mailboxes[box].postings.some(match)) return box;
      }
    }
  }
  for (const box of sources) {
    if (mailboxes[box]?.status === "ready" && mailboxes[box].postings.some((candidate) => candidate.id === posting.id || topicKey(candidate) === topicKey(posting))) return box;
  }
  return "imbox";
}

/** Mixed selections add to a saved section; only a complete shared membership toggles off. */
export function sectionedSelectionSource(mailboxes: SectionedMailboxes, postingIds: string[], accountSplit = false, retainedActiveId?: string, retainedSourceBox?: MailboxKey): MailboxKey {
  if (!postingIds.length) return "imbox";
  const groups = accountSplit ? groupAccountSplitMailboxes(mailboxes, retainedActiveId, retainedSourceBox) : { ...groupSectionedImbox(mailboxes, retainedActiveId), feed: [], paperTrail: [], scheduledBubbleUp: [] };
  const order = accountSplit ? ACCOUNT_SPLIT_SECTION_ORDER : IMBOX_SECTION_ORDER;
  const sources = new Map<string, MailboxKey>(order.flatMap((key) => groups[key].map((posting) => [posting.id, accountSplit ? sectionedPostingSource(mailboxes, posting, true) : SECTION_MAILBOX[key]] as [string, MailboxKey])));
  const first = sources.get(postingIds[0]!);
  return first && postingIds.every((id) => sources.get(id) === first) ? first : "imbox";
}
