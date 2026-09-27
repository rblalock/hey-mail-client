import type { ImboxPosting, ImboxResult, MailboxKey } from "../../shared/contracts";

export type SectionedMailboxes = Partial<Record<MailboxKey, ImboxResult>>;
export type ImboxSectionKey = "active" | "replyLater" | "setAside" | "bubbledUp" | "previouslySeen";
export type SectionedImbox = Record<ImboxSectionKey, ImboxPosting[]>;

export const IMBOX_SECTION_ORDER: ImboxSectionKey[] = ["active", "replyLater", "setAside", "bubbledUp", "previouslySeen"];
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

/** The physical mailbox of the winning row, used for read and membership actions. */
export function sectionedPostingSource(mailboxes: SectionedMailboxes, posting: ImboxPosting): MailboxKey {
  for (const box of ["laterbox", "asidebox", "imbox"] as const) {
    if (mailboxes[box]?.status === "ready" && mailboxes[box].postings.some((candidate) => candidate.id === posting.id || topicKey(candidate) === topicKey(posting))) return box;
  }
  return "imbox";
}

/** Mixed selections add to a saved section; only a complete shared membership toggles off. */
export function sectionedSelectionSource(mailboxes: SectionedMailboxes, postingIds: string[]): MailboxKey {
  if (!postingIds.length) return "imbox";
  const groups = groupSectionedImbox(mailboxes);
  const sources = new Map<string, MailboxKey>(IMBOX_SECTION_ORDER.flatMap((key) => groups[key].map((posting) => [posting.id, key === "replyLater" ? "laterbox" : key === "setAside" ? "asidebox" : "imbox"] as [string, MailboxKey])));
  const first = sources.get(postingIds[0]!);
  return first && postingIds.every((id) => sources.get(id) === first) ? first : "imbox";
}
