import type { MailAccountProfile, MailThread } from "../shared/contracts";
import type { MailDiskCache } from "./mail-disk-cache";

// Network reads are still authoritative. Disk is a separate, immediate preview;
// opening it never marks mail seen or downloads attachments/remote images.
export class CachedMailReader {
  private readonly pending = new Map<string, Promise<MailThread>>();

  constructor(private readonly cache: MailDiskCache, private readonly fetch: (topicId: string) => Promise<MailThread>) {}

  async cached(profile: MailAccountProfile, topicId: string): Promise<MailThread | undefined> {
    try { return (await this.cache.read(profile, topicId))?.thread; }
    catch { return undefined; } // Cache failures must not prevent a live read.
  }

  read(profile: MailAccountProfile, topicId: string): Promise<MailThread> {
    const generation = this.cache.generation;
    const key = `${profile.key}:${generation}:${topicId}`;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const operation = this.fetch(topicId).then((thread) => {
      void this.cache.write(profile, thread, generation).catch(() => undefined);
      return thread;
    }).finally(() => { if (this.pending.get(key) === operation) this.pending.delete(key); });
    this.pending.set(key, operation);
    return operation;
  }
}
