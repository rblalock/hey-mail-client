import { describe, expect, it, vi } from "vitest";
import type { MailThread, ThreadEntry } from "../../shared/contracts";
import { hasNewThreadEntry, readThreadUntilAdvanced } from "./thread-reconciliation";

function entry(id: string): ThreadEntry {
  return {
    id,
    sender: { name: "Example Sender", email: "sender@example.test" },
    occurredAt: "2026-01-01T12:00:00.000Z",
    body: `Message ${id}`,
  };
}

function thread(...ids: string[]): MailThread {
  return { topicId: "101", subject: "Example conversation", entries: ids.map(entry) };
}

describe("thread reconciliation", () => {
  it("recognizes a newly appended or replaced entry", () => {
    expect(hasNewThreadEntry(thread("1"), thread("1", "2"))).toBe(true);
    expect(hasNewThreadEntry(thread("1", "2"), thread("1", "3"))).toBe(true);
    expect(hasNewThreadEntry(thread("1"), thread("1"))).toBe(false);
  });

  it("returns immediately when the first read contains the sent reply", async () => {
    const read = vi.fn().mockResolvedValue(thread("1", "2"));
    const wait = vi.fn();

    await expect(readThreadUntilAdvanced(thread("1"), read, { retryDelays: [10], wait })).resolves.toEqual(thread("1", "2"));
    expect(read).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("retries stale reads without retrying the send operation", async () => {
    const read = vi.fn()
      .mockResolvedValueOnce(thread("1"))
      .mockResolvedValueOnce(thread("1"))
      .mockResolvedValueOnce(thread("1", "2"));
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(readThreadUntilAdvanced(thread("1"), read, { retryDelays: [10, 20], wait })).resolves.toEqual(thread("1", "2"));
    expect(read).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenNthCalledWith(1, 10);
    expect(wait).toHaveBeenNthCalledWith(2, 20);
  });

  it("returns the latest authoritative snapshot after bounded retries", async () => {
    const read = vi.fn().mockResolvedValue(thread("1"));
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(readThreadUntilAdvanced(thread("1"), read, { retryDelays: [10, 20], wait })).resolves.toEqual(thread("1"));
    expect(read).toHaveBeenCalledTimes(3);
  });
});
