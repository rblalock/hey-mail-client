import { describe, expect, it } from "vitest";
import { MailChangeTracker, mailContentVersion } from "./mail-change-tracker";
import type { ImboxPosting, MailWatchChange } from "../shared/contracts";

const raw = { id: 7, topic_id: 9, seen: false, name: "Hello", active_at: "2026-09-29T12:00:00Z", visible_entry_count: 1 };
const update = (value = raw): MailWatchChange => ({ change: "updated", postingId: "7", topicId: "9", postingSeen: value.seen, contentVersion: mailContentVersion(value), box: { key: "imbox", id: "1", name: "Imbox" } });
function tracked() {
  const tracker = new MailChangeTracker();
  tracker.observe({ status: "ready", boxKey: "imbox", boxName: "Imbox", postings: [{ id: "7", topicId: "9", contentVersion: mailContentVersion(raw) } as ImboxPosting] });
  return tracker;
}
describe("mail change classification", () => {
  it("preserves content across a proven seen-only change", () => {
    expect(tracked().classify(update({ ...raw, seen: true })).metadataOnly).toBe(true);
    expect(mailContentVersion({ ...raw, contacts: [{ name: "A", id: 1 }] })).toBe(mailContentVersion({ contacts: [{ id: 1, name: "A" }], ...raw }));
  });
  it("does not mistake new mail, edits, moves, or incomplete evidence for read state", () => {
    for (const change of [update({ ...raw, name: "Changed" }), update({ ...raw, visible_entry_count: 2 }), { ...update(), isNew: true }, { ...update(), change: "added" as const }, { ...update(), contentVersion: undefined }, { ...update(), topicId: "10" }, { ...update(), box: { key: "feedbox", id: "2", name: "Feed" } }]) {
      expect(tracked().classify(change).metadataOnly).toBeUndefined();
    }
    expect(new MailChangeTracker().classify({ ...update(), metadataOnly: true }).metadataOnly).toBeUndefined();
    expect(new MailChangeTracker().classify({ change: "updated", postingSeen: true }).metadataOnly).toBeUndefined();
  });
  it("forgets deleted/resynced evidence and isolates accounts by instance", () => {
    for (const change of ["deleted", "resync"] as const) {
      const tracker = tracked(); tracker.classify({ ...update(), change });
      expect(tracker.classify(update()).metadataOnly).toBeUndefined();
    }
    expect(new MailChangeTracker().classify(update()).metadataOnly).toBeUndefined();
  });
});
