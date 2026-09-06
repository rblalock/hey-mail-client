import type { ImboxPosting } from "../../shared/contracts";

export function postingsForReadTogether(postings: ImboxPosting[], selectedIds: string[]): ImboxPosting[] {
  if (selectedIds.length === 0) return [];
  const selected = new Set(selectedIds);
  return postings.filter((posting) => selected.has(posting.id) && Boolean(posting.topicId));
}

export function skippedReadTogetherCount(postings: ImboxPosting[], selectedIds: string[]): number {
  if (selectedIds.length === 0) return 0;
  const selected = new Set(selectedIds);
  return postings.filter((posting) => selected.has(posting.id) && !posting.topicId).length;
}
