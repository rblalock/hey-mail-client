import type { MailThread } from "../../shared/contracts";

export type MailThreadReader = (topicId: string, onPreview?: (thread: MailThread) => void) => Promise<MailThread>;

type PendingThread = { promise: Promise<MailThread>; listeners: Set<(thread: MailThread) => void>; preview?: MailThread };

export class MailThreadCache {
  private readonly values = new Map<string, MailThread>();
  private readonly pending = new Map<string, PendingThread>();
  private readonly refreshed = new Map<string, number>();

  constructor(private readonly capacity = 10, private readonly now = Date.now, private readonly freshMs = 30_000) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Mail thread cache capacity must be positive.");
  }

  get(topicId: string): MailThread | undefined {
    const value = this.values.get(topicId);
    if (!value) return undefined;
    this.values.delete(topicId);
    this.values.set(topicId, value);
    return value;
  }

  isFresh(topicId: string): boolean {
    const at = this.refreshed.get(topicId);
    return at !== undefined && this.now() - at < this.freshMs;
  }

  private store(topicId: string, value: MailThread): void {
    this.values.delete(topicId);
    this.values.set(topicId, value);
    while (this.values.size > this.capacity) {
      const oldest = this.values.keys().next().value as string;
      this.values.delete(oldest);
      this.refreshed.delete(oldest);
    }
  }

  read(topicId: string, reader: MailThreadReader, force = false, disk?: (id: string) => Promise<MailThread | undefined>, onPreview?: (thread: MailThread) => void): Promise<MailThread> {
    // A forced refresh joins a running live read. Call invalidate first when a
    // write/watch event makes that running read obsolete.
    const pending = this.pending.get(topicId);
    if (pending) {
      if (onPreview) {
        pending.listeners.add(onPreview);
        if (pending.preview) { try { onPreview(pending.preview); } catch { /* Removed view. */ } }
      }
      return pending.promise;
    }
    if (!force) {
      const value = this.get(topicId);
      if (value && this.isFresh(topicId)) return Promise.resolve(value);
    }

    const entry: PendingThread = { promise: undefined!, listeners: new Set(onPreview ? [onPreview] : []) };
    this.pending.set(topicId, entry);
    const publish = (value: MailThread) => {
      if (this.pending.get(topicId) !== entry) return;
      entry.preview = value;
      this.store(topicId, value);
      this.refreshed.delete(topicId);
      for (const listener of entry.listeners) { try { listener(value); } catch { /* A removed view must not fail the read. */ } }
    };
    let preview: Promise<void> = Promise.resolve();
    let live: Promise<MailThread>;
    try { live = reader(topicId, publish); } catch (error) { live = Promise.reject(error); }
    entry.promise = live.then((value) => {
      if (this.pending.get(topicId) === entry) {
        this.store(topicId, value);
        if (!value.bodyLoading && !value.attachmentsLoading && !value.bodyError && !value.attachmentsError) this.refreshed.set(topicId, this.now());
        else this.refreshed.delete(topicId);
      }
      return value;
    }, async (error: unknown) => {
      // Even an immediate offline failure must allow the disk preview to arrive.
      await preview;
      if (entry.preview && (entry.preview.bodyLoading || entry.preview.attachmentsLoading)) {
        const { bodyLoading: _bodyLoading, attachmentsLoading: _attachmentsLoading, ...readable } = entry.preview;
        publish(readable);
      }
      throw error;
    }).finally(() => {
      if (this.pending.get(topicId) === entry) this.pending.delete(topicId);
    });

    if (!force && !this.values.has(topicId) && disk) {
      preview = disk(topicId).then((value) => {
        if (!value || this.pending.get(topicId) !== entry || this.values.has(topicId)) return;
        publish(value);
      }).catch(() => undefined);
    }
    return entry.promise;
  }

  invalidate(topicId?: string, preservePreview = false, except: Iterable<string> = []): void {
    if (topicId) {
      if (!preservePreview) this.values.delete(topicId);
      this.refreshed.delete(topicId);
      this.pending.delete(topicId);
      return;
    }
    const retained = new Set(except);
    for (const id of new Set([...this.values.keys(), ...this.pending.keys()])) {
      if (!retained.has(id)) this.invalidate(id, preservePreview);
    }
  }
}
