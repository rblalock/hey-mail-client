/** One speculative read at a time; a newer target replaces work not yet started. */
export class MailPrefetchQueue {
  private pending: string[] = [];
  private active?: string;

  constructor(private readonly load: (topicId: string) => Promise<unknown>) {}

  enqueue(topicId: string, neighbors: readonly string[] = []): void {
    this.pending = [...new Set([topicId, ...neighbors.slice(0, 2)])]
      .filter((id) => id && id !== this.active);
    this.drain();
  }

  /** Foreground reads start directly; discard speculative work competing with them. */
  clearPending(): void { this.pending = []; }

  private drain(): void {
    if (this.active || this.pending.length === 0) return;
    const topicId = this.pending.shift()!;
    this.active = topicId;
    void Promise.resolve().then(() => this.load(topicId)).catch(() => undefined).finally(() => {
      this.active = undefined;
      this.drain();
    });
  }
}
