import type { ImboxPosting } from "../../shared/contracts";

export function groupImboxPostings(postings: ImboxPosting[]) {
  const bubbledUp: ImboxPosting[] = [];
  const newForYou: ImboxPosting[] = [];
  const previouslySeen: ImboxPosting[] = [];
  for (const posting of postings) {
    if (posting.bubbledUp) bubbledUp.push(posting);
    else if (posting.seen) previouslySeen.push(posting);
    else newForYou.push(posting);
  }
  return { bubbledUp, newForYou, previouslySeen };
}

export function moveMailboxCursor(postings: ImboxPosting[], currentId: string | undefined, delta: -1 | 1): string | undefined {
  if (postings.length === 0) return undefined;
  const current = postings.findIndex((posting) => posting.id === currentId);
  const start = current < 0 ? (delta > 0 ? -1 : postings.length) : current;
  return postings[Math.min(Math.max(start + delta, 0), postings.length - 1)]?.id;
}

export function postingAtCursor(postings: ImboxPosting[], currentId: string | undefined): ImboxPosting | undefined {
  return postings.find((posting) => posting.id === currentId) ?? postings[0];
}

export type MailSelectionRange = { anchor: string; edge: string; base: string[]; order: string };
export function extendMailboxSelection(ids: string[], current: string | undefined, delta: -1 | 1, selected: string[], previous?: MailSelectionRange) {
  if (!ids.length) return undefined;
  const cursor = ids.includes(current ?? "") ? current! : ids[0]!;
  const order = JSON.stringify(ids);
  const range = previous?.edge === cursor && previous.order === order ? previous : { anchor: cursor, edge: cursor, base: selected, order };
  const edgeIndex = Math.max(0, Math.min(ids.length - 1, ids.indexOf(cursor) + delta));
  const anchorIndex = ids.indexOf(range.anchor);
  const edge = ids[edgeIndex]!;
  return { edge, selected: [...new Set([...range.base, ...ids.slice(Math.min(anchorIndex, edgeIndex), Math.max(anchorIndex, edgeIndex) + 1)])], range: { ...range, edge } };
}
