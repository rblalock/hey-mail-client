import type { ImboxPosting, ImboxResult } from "../../shared/contracts";

function identity(posting: ImboxPosting): string {
  return posting.topicId ? `topic:${posting.topicId}` : `posting:${posting.id}`;
}

/** The current head wins over older pages, including locally changed read state. */
export function appendMailboxPage(current: ImboxResult, page: ImboxResult): ImboxResult {
  const known = new Set(current.postings.map(identity));
  return {
    ...current,
    nextPage: page.nextPage,
    postings: [...current.postings, ...page.postings.filter((posting) => {
      const key = identity(posting);
      if (known.has(key)) return false;
      known.add(key);
      return true;
    })],
  };
}

/** Refresh the live head without collapsing history the person already scrolled to. */
export function refreshMailboxHead(current: ImboxResult | undefined, head: ImboxResult, historyLoaded: boolean): ImboxResult {
  if (!current || current.status !== "ready" || head.status !== "ready" || !historyLoaded || !head.nextPage) return head;
  const headIds = new Set(head.postings.map(identity));
  const dates = head.postings.filter((posting) => posting.seen && !posting.bubbledUp)
    .map((posting) => Date.parse(posting.createdAt)).filter(Number.isFinite);
  const oldestHead = dates.length ? Math.min(...dates) : undefined;
  // Only retain older history, never stale active rows removed by a move/read on
  // another device. Watch deletion events remove older rows separately.
  const history = current.postings.filter((posting) => posting.seen && !posting.bubbledUp
    && !headIds.has(identity(posting))
    && (oldestHead === undefined || Date.parse(posting.createdAt) < oldestHead));
  return { ...head, nextPage: current.nextPage, postings: [...head.postings, ...history] };
}
