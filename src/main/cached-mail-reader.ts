import type { MailAccountProfile, MailThread } from "../shared/contracts";
import type { MailDiskCache } from "./mail-disk-cache";

// Network reads are still authoritative. Disk is a separate, immediate preview;
// opening it never marks mail seen or downloads attachments/remote images.
export class CachedMailReader {
  private readonly pending = new Map<string, { promise: Promise<MailThread>; listeners: Set<(thread: MailThread) => void>; preview?: MailThread }>();

  constructor(private readonly cache: MailDiskCache, private readonly fetch: (topicId: string, onPreview?: (thread: MailThread) => void) => Promise<MailThread>) {}

  async cached(profile: MailAccountProfile, topicId: string): Promise<MailThread | undefined> {
    try { return (await this.cache.read(profile, topicId))?.thread; }
    catch { return undefined; } // Cache failures must not prevent a live read.
  }

  read(profile: MailAccountProfile, topicId: string, onPreview?: (thread: MailThread) => void): Promise<MailThread> {
    const token = this.cache.token(profile, topicId);
    const key = `${profile.key}:${token}:${topicId}`;
    const existing = this.pending.get(key);
    if (existing) {
      if (onPreview) {
        existing.listeners.add(onPreview);
        if (existing.preview) { try { onPreview(existing.preview); } catch { /* Reader closed. */ } }
      }
      return existing.promise;
    }
    const entry: { promise: Promise<MailThread>; listeners: Set<(thread: MailThread) => void>; preview?: MailThread } = {
      promise: undefined!, listeners: new Set(onPreview ? [onPreview] : []),
    };
    this.pending.set(key, entry);
    const publish = (thread: MailThread) => {
      if (this.pending.get(key) !== entry || this.cache.token(profile, topicId) !== token) return;
      entry.preview = thread;
      for (const listener of entry.listeners) { try { listener(thread); } catch { /* One closed reader must not block the others. */ } }
    };
    let live: Promise<MailThread>;
    try { live = this.fetch(topicId, publish); } catch (error) { live = Promise.reject(error); }
    entry.promise = live.then((thread) => {
      void this.cache.write(profile, thread, token).catch(() => undefined);
      return thread;
    }).finally(() => { if (this.pending.get(key) === entry) this.pending.delete(key); });
    return entry.promise;
  }
}
