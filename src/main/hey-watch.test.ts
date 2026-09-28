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

  it.each(["added", "updated"])("preserves explicit read and unread state for %s postings", (change) => {
    for (const seen of [true, false]) {
      expect(parseWatchLine(JSON.stringify({ change, new: seen, posting: { seen, summary: "private message text" } })))
        .toEqual({ change, isNew: seen, postingSeen: seen });
    }
  });

  it.each([undefined, null, {}, { seen: null }, { seen: "false" }, { seen: 0 }])("omits unknown read state without inferring it from new: %j", (posting) => {
    expect(parseWatchLine(JSON.stringify({ change: "updated", new: true, posting }))).toEqual({ change: "updated", isNew: true });
    expect(parseWatchLine(JSON.stringify({ change: "updated", new: false, posting }))).toEqual({ change: "updated", isNew: false });
  });

  it.each(["ready", "disconnected", "deleted", "resync"])("does not expose posting read state on %s events", (change) => {
    expect(parseWatchLine(JSON.stringify({ change, posting: { seen: true } }))).toEqual({ change });
  });
});
