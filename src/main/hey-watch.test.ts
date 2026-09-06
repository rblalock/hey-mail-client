import { describe, expect, it } from "vitest";
import { parseWatchLine } from "./hey-watch";

describe("HEY watch parsing", () => {
  it("normalizes a posting update without exposing the raw posting", () => {
    expect(parseWatchLine(JSON.stringify({
      change: "updated",
      at: "2026-08-28T18:00:00Z",
      box: { id: 12, kind: "imbox", name: "Imbox" },
      posting_id: 34,
      thread_id: 56,
      new: true,
      posting: { summary: "private message text" },
    }))).toEqual({
      change: "updated",
      at: "2026-08-28T18:00:00Z",
      box: { id: "12", key: "imbox", name: "Imbox" },
      postingId: "34",
      topicId: "56",
      isNew: true,
    });
  });

  it("accepts lifecycle lines and ignores malformed input", () => {
    expect(parseWatchLine('{"change":"ready"}')).toEqual({ change: "ready" });
    expect(parseWatchLine("not json")).toBeUndefined();
  });
});
