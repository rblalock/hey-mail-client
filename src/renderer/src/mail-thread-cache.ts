import type { MailThread } from "../../shared/contracts";

export type MailThreadReader = (topicId: string) => Promise<MailThread>;

export class MailThreadCache {
  private readonly values = new Map<string, MailThread>();
  private readonly pending = new Map<string, Promise<MailThread>>();
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
    if (pending) return pending;
    if (!force) {
      const value = this.get(topicId);
      if (value && this.isFresh(topicId)) return Promise.resolve(value);
    }

    let request!: Promise<MailThread>;
    let preview: Promise<void> = Promise.resolve();
    request = reader(topicId).then((value) => {
      if (this.pending.get(topicId) === request) {
        this.store(topicId, value);
        this.refreshed.set(topicId, this.now());
      }
      return value;
    }, async (error: unknown) => {
      // Even an immediate offline failure must allow the disk preview to arrive.
      await preview;
      throw error;
    }).finally(() => {
      if (this.pending.get(topicId) === request) this.pending.delete(topicId);
    });

    this.pending.set(topicId, request);
    if (!force && !this.values.has(topicId) && disk) {
      preview = disk(topicId).then((value) => {
        if (!value || this.pending.get(topicId) !== request || this.values.has(topicId)) return;
        this.store(topicId, value);
        onPreview?.(value);
      }).catch(() => undefined);
    }
    return request;
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
