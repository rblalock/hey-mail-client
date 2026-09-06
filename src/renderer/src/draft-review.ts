export type DraftSuggestion = { original: string; proposed: string; context: string };

export function composeWritingSuggestion(original: string, replacement: string, selection?: { start: number; end: number }): string {
  if (!selection || selection.start === selection.end) return replacement;
  if (selection.start < 0 || selection.end > original.length || selection.start > selection.end) throw new Error("The selected text is no longer available. Select it again and retry.");
  return original.slice(0, selection.start) + replacement + original.slice(selection.end);
}

export function draftReviewIssue(suggestion: DraftSuggestion, current: string, context: string): string | undefined {
  if (context !== suggestion.context) return "The message context changed. Discard this suggestion and request a new one for the current message.";
  if (current !== suggestion.original) return "Your draft changed after this suggestion was requested. Your newer text is safe. Discard this suggestion and try again.";
  return undefined;
}
