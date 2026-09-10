import type { ImboxPosting, ImboxResult, MailboxKey, MailMutationRequest } from "../../shared/contracts";

export type MailboxCache = Partial<Record<MailboxKey, ImboxResult>>;

// Pending trash is a view mask, not a destructive edit to the cache. Cancelling
// one action reveals its rows without rolling back unrelated mail changes.
export function hidePendingTrash(result: ImboxResult | undefined, ids: ReadonlySet<string>): ImboxResult | undefined {
  return result && ids.size ? { ...result, postings: result.postings.filter((posting) => !ids.has(posting.id)) } : result;
}

export type OptimisticMailResult = {
  mailboxes: MailboxCache;
  nextCursor?: string;
  removedFromActiveMailbox: boolean;
};

export function nextPostingInSequence(postings: ImboxPosting[], currentId: string): ImboxPosting | undefined {
  const index = postings.findIndex((posting) => posting.id === currentId);
  return index >= 0 ? postings[index + 1] : undefined;
}

function mutationDestination(request: MailMutationRequest): MailboxKey | undefined {
  if (request.operation === "move") return request.destination;
  if (request.operation === "bubble") return request.bubbleSchedule === "now" ? "imbox" : "bubblebox";
  if (request.operation === "bubble-pop" && request.sourceBox === "bubblebox") return "imbox";
  return undefined;
}

function removesFromSource(request: MailMutationRequest, source: MailboxKey): boolean {
  if (request.operation === "trash" || request.operation === "spam") return true;
  const destination = mutationDestination(request);
  return destination !== undefined && destination !== source;
}

export function applyOptimisticMailMutation(
  current: MailboxCache,
  activeMailbox: MailboxKey | undefined,
  currentCursor: string | undefined,
  request: MailMutationRequest,
): OptimisticMailResult {
  const postingIds = new Set(request.postingIds);
  let mailboxes = current;

  if (request.operation === "bubble-pop") {
    for (const key of Object.keys(current) as MailboxKey[]) {
      const mailbox = current[key];
      if (!mailbox || !mailbox.postings.some((posting) => postingIds.has(posting.id) && posting.bubbledUp)) continue;
      if (mailboxes === current) mailboxes = { ...current };
      mailboxes[key] = { ...mailbox, postings: mailbox.postings.map((posting) => postingIds.has(posting.id) ? { ...posting, bubbledUp: false } : posting) };
    }
  }

  if (request.operation === "seen" || request.operation === "unseen") {
    const seen = request.operation === "seen";
    for (const key of Object.keys(current) as MailboxKey[]) {
      const mailbox = current[key];
      if (!mailbox || !mailbox.postings.some((posting) => postingIds.has(posting.id) && posting.seen !== seen)) continue;
      if (mailboxes === current) mailboxes = { ...current };
      mailboxes[key] = {
        ...mailbox,
        postings: mailbox.postings.map((posting) => postingIds.has(posting.id) ? { ...posting, seen } : posting),
      };
    }
  }

  const source = request.sourceBox ?? activeMailbox;
  if (!source || !removesFromSource(request, source)) {
    return { mailboxes, removedFromActiveMailbox: false };
  }

  const sourceMailbox = mailboxes[source];
  if (!sourceMailbox) return { mailboxes, removedFromActiveMailbox: source === activeMailbox };
  const firstRemovedIndex = sourceMailbox.postings.findIndex((posting) => postingIds.has(posting.id));
  const remaining = sourceMailbox.postings.filter((posting) => !postingIds.has(posting.id));
  mailboxes = {
    ...mailboxes,
    [source]: { ...sourceMailbox, postings: remaining },
  };
  const removedFromActiveMailbox = source === activeMailbox;
  if (!removedFromActiveMailbox) return { mailboxes, removedFromActiveMailbox };

  const currentWasRemoved = currentCursor ? postingIds.has(currentCursor) : firstRemovedIndex >= 0;
  const nextCursor = currentWasRemoved && firstRemovedIndex >= 0
    ? remaining[Math.min(firstRemovedIndex, remaining.length - 1)]?.id
    : currentCursor;
  return { mailboxes, nextCursor, removedFromActiveMailbox };
}
