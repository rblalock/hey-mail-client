import type { ImboxPosting } from "../../shared/contracts";
import type { KeyboardEvent } from "react";
import { isEditingEvent } from "../../shared/keyboard-scope";

export function mergeLibraryPostings(current: ImboxPosting[], next: ImboxPosting[]): ImboxPosting[] {
  const postings = new Map(current.map((posting) => [posting.topicId || posting.id, posting]));
  for (const posting of next) postings.set(posting.topicId || posting.id, posting);
  return [...postings.values()];
}

// Keep navigation local to this list. Native Enter activation remains with its button.
export function navigateLibraryRows(event: KeyboardEvent<HTMLElement>): void {
  if (event.defaultPrevented || event.nativeEvent?.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target as HTMLElement;
  if (isEditingEvent({ target: event.target, composedPath: () => event.nativeEvent?.composedPath?.() ?? [] })) return;
  const direction = ["ArrowDown", "j"].includes(event.key) ? 1 : ["ArrowUp", "k"].includes(event.key) ? -1 : 0;
  if (!direction) return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-library-row]")];
  if (!rows.length) return;
  const index = rows.findIndex((row) => row === target || row.contains(target));
  const next = index < 0 ? (direction > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, index + direction));
  event.preventDefault();
  event.stopPropagation();
  rows[next]?.focus();
}
