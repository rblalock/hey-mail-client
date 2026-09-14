import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { acknowledgeHeyWrites, beginHeyWrite, completeHeyWrite, isMailWrite, pendingHeyWrites } from "../../resources/hey-write-receipts.mjs";

it("retains unknown outcomes across instances without storing bodies or erasing concurrent writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-write-receipts-"));
  try {
    const first = beginHeyWrite(directory, ["compose", "--to", "person@example.com", "-m", "private body"]);
    const second = beginHeyWrite(directory, ["draft", "send", "12"]);
    expect(pendingHeyWrites(directory)).toHaveLength(2);
    expect(await readFile(first!, "utf8")).not.toContain("private body");
    completeHeyWrite(second);
    expect(pendingHeyWrites(directory)).toHaveLength(1);
    acknowledgeHeyWrites(directory);
    expect(pendingHeyWrites(directory)).toEqual([]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
it("does not record read-only HEY calls as pending changes", () => {
  for (const args of [["thread", "read", "1"], ["search", "hi"], ["bulk-reply", "preview", "1"], ["contact", "threads", "1"], ["set-aside", "group", "view", "1"]]) expect(isMailWrite(args)).toBe(false);
  for (const args of [["reply", "1"], ["draft", "send", "1"], ["seen", "1"], ["set-aside", "group", "create", "1"]]) expect(isMailWrite(args)).toBe(true);
});
it("does not record Calendar mutations as mail writes", () => {
  expect(isMailWrite(["event", "add", "x"])).toBe(false);
});
