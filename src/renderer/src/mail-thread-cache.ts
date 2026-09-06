import type { MailThread } from "../../shared/contracts";

export type MailThreadReader = (topicId: string) => Promise<MailThread>;

export class MailThreadCache {
  private readonly values = new Map<string, MailThread>();
  private readonly pending = new Map<string, Promise<MailThread>>();

  constructor(private readonly capacity = 10) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Mail thread cache capacity must be positive.");
  }

  get(topicId: string): MailThread | undefined {
    const value = this.values.get(topicId);
    if (!value) return undefined;
    this.values.delete(topicId);
    this.values.set(topicId, value);
    return value;
  }

  read(topicId: string, reader: MailThreadReader, force = false): Promise<MailThread> {
    if (!force) {
      const value = this.get(topicId);
      if (value) return Promise.resolve(value);
      const pending = this.pending.get(topicId);
      if (pending) return pending;
    }

    let request!: Promise<MailThread>;
    request = reader(topicId).then((value) => {
      if (this.pending.get(topicId) === request) {
        this.values.delete(topicId);
        this.values.set(topicId, value);
        while (this.values.size > this.capacity) {
          const oldest = this.values.keys().next().value as string | undefined;
          if (!oldest) break;
          this.values.delete(oldest);
        }
      }
      return value;
    }).finally(() => {
      if (this.pending.get(topicId) === request) this.pending.delete(topicId);
    });

    this.pending.set(topicId, request);
    return request;
  }

  invalidate(topicId?: string): void {
    if (topicId) {
      this.values.delete(topicId);
      this.pending.delete(topicId);
      return;
    }
    this.values.clear();
    this.pending.clear();
  }
}
