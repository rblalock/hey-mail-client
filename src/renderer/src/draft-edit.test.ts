import { describe, expect, it } from "vitest";
import { draftTextEdit } from "./draft-edit";

describe("draft editor synchronization", () => {
  it("does not echo unchanged editor notifications", () => {
    expect(draftTextEdit("same", "same")).toEqual([]);
  });
  it.each([
    ["", "Hello"], ["Hello", ""], ["Hi Friday", "Hi Thursday"],
    ["Hi\n\n**Friday**  \nThanks!", "Hi\n\n**Monday**  \nThanks!"],
    ["Hi 👋\nFriday", "Hi 🌞\nMonday\n"], ["a\r\nb", "a\r\nc"],
    ["one\ntwo\nthree", "one\nthree"], ["x", "x\n"],
  ])("preserves exact text: %j to %j", (before, after) => {
    const [edit] = draftTextEdit(before, after);
    const offset = ({ line, character }: { line: number; character: number }) => before.split("\n").slice(0, line).reduce((n, text) => n + text.length + 1, 0) + character;
    expect(before.slice(0, offset(edit!.range.start)) + edit!.newText + before.slice(offset(edit!.range.end))).toBe(after);
  });
});
