import type { TextEdit } from "@pierre/diffs/edit";

// Transfer a plain-editor change into the diff's existing undo timeline.
export function draftTextEdit(before: string, after: string): TextEdit[] {
  if (before === after) return [];
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = before.length, nextEnd = after.length;
  while (end > start && nextEnd > start && before[end - 1] === after[nextEnd - 1]) { end--; nextEnd--; }
  const position = (offset: number) => {
    const lines = before.slice(0, offset).split("\n");
    return { line: lines.length - 1, character: lines.at(-1)!.length };
  };
  return [{ range: { start: position(start), end: position(end) }, newText: after.slice(start, nextEnd) }];
}
