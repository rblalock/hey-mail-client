import { createHash } from "node:crypto";
import type { ImboxResult, MailWatchChange } from "../shared/contracts";

// Compare the complete posting, not just its read flag. Unknown or changed
// fields must trigger reconciliation: an update can also contain a new reply.
export function mailContentVersion(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const posting = value as Record<string, unknown>;
  if (!posting.id || !posting.topic_id || typeof posting.seen !== "boolean") return;
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : item;
  const { seen: _seen, ...content } = posting;
  return createHash("sha256").update(JSON.stringify(canonical(content))).digest("hex");
}

/** Bounded, per-account evidence for distinguishing read flags from new content. */
export class MailChangeTracker {
  private versions = new Map<string, { topicId: string; version: string }>();

  observe(result: ImboxResult): void {
    if (result.status !== "ready") return;
    for (const posting of result.postings) {
      if (posting.topicId && posting.contentVersion) this.remember(`${result.boxKey}:${posting.id}`, posting.topicId, posting.contentVersion);
    }
  }

  private remember(key: string, topicId: string, version: string): void {
    this.versions.delete(key);
    this.versions.set(key, { topicId, version });
    while (this.versions.size > 10_000) this.versions.delete(this.versions.keys().next().value!);
  }

  classify(change: MailWatchChange): MailWatchChange {
    const key = change.box && change.postingId ? `${change.box.key}:${change.postingId}` : undefined;
    const prior = key ? this.versions.get(key) : undefined;
    // Never accept a caller-supplied classification as evidence.
    const { metadataOnly: _metadataOnly, ...result } = change;
    if (change.change === "resync") {
      for (const id of this.versions.keys()) if (!change.box || id.startsWith(`${change.box.key}:`)) this.versions.delete(id);
    } else if (change.change === "deleted" && key) this.versions.delete(key);
    else if (key && change.topicId && change.contentVersion) this.remember(key, change.topicId, change.contentVersion);
    return change.change === "updated" && change.isNew !== true && typeof change.postingSeen === "boolean"
      && prior && prior.topicId === change.topicId && prior.version === change.contentVersion
      ? { ...result, metadataOnly: true } : result;
  }
}
