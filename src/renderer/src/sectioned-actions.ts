import type { ImboxPosting, MailCompletionState, MailMutationRequest } from "../../shared/contracts";
import type { MailboxCache } from "./optimistic-mail";
import { sectionedPostingSource } from "./sectioned-imbox";
import { bulkMutationRequest } from "./bulk-actions";
import type { ShortcutId } from "./shortcuts";

export function sectionedDoneRequest(postings: ImboxPosting[], mailboxes: MailboxCache, accountSplit = false): MailMutationRequest | undefined {
  if (!postings.length || postings.some((posting) => posting.kind === "bundle" || !posting.topicId)) return undefined;
  const completion: MailCompletionState[] = postings.map((posting) => {
    const sourceBox = sectionedPostingSource(mailboxes, posting, accountSplit);
    return { id: posting.id, sourceBox, seen: posting.seen, bubbledUp: sourceBox === "imbox" && posting.bubbledUp === true,
      ...(sourceBox === "asidebox" && posting.boxGroupId ? { boxGroupId: posting.boxGroupId } : {}) };
  });
  return { operation: "done", postingIds: completion.map((item) => item.id), completion };
}

export function sectionedActionRequests(id: ShortcutId, postings: ImboxPosting[], mailboxes: MailboxCache, accountSplit = false): MailMutationRequest[] {
  if (id === "seen") {
    const request = sectionedDoneRequest(postings, mailboxes, accountSplit);
    return request ? [request] : [];
  }
  const grouped = new Map<MailCompletionState["sourceBox"], ImboxPosting[]>();
  for (const posting of postings) {
    const source = sectionedPostingSource(mailboxes, posting, accountSplit);
    grouped.set(source, [...(grouped.get(source) ?? []), posting]);
  }
  const requests: MailMutationRequest[] = [];
  for (const [sourceBox, rows] of grouped) {
    const postingIds = rows.map((posting) => posting.id);
    if (id === "later" || id === "aside") {
      const target = id === "later" ? "laterbox" : "asidebox";
      const destination = grouped.size === 1 && grouped.has(target) ? "imbox" : target;
      if (sourceBox !== destination) requests.push({ operation: "move", postingIds, sourceBox, destination });
    } else if (id === "unread") {
      requests.push({ operation: postings.every((posting) => !posting.seen) ? "seen" : "unseen", postingIds });
    } else if (id === "bubble") {
      requests.push(postings.every((posting) => sectionedPostingSource(mailboxes, posting, accountSplit) === "bubblebox" || posting.bubbledUp)
        ? { operation: "bubble-pop", postingIds, sourceBox }
        : { operation: "bubble", postingIds, sourceBox, bubbleSchedule: "tomorrow" });
    } else {
      const request = bulkMutationRequest(id, postingIds, sourceBox, rows);
      if (request) requests.push(request);
    }
  }
  return requests;
}

/** Continue forward after clearing; only fall back to earlier rows at the end. */
export function cursorAfterRemoval(postings: ImboxPosting[], currentId: string | undefined, removed: ReadonlySet<string>): string | undefined {
  const index = postings.findIndex((posting) => posting.id === currentId);
  return postings.slice(Math.max(0, index + 1)).find((posting) => !removed.has(posting.id))?.id
    ?? postings.slice(0, Math.max(0, index)).reverse().find((posting) => !removed.has(posting.id))?.id;
}
