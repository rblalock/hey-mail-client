import type { MailMutationResult } from "./contracts";

export const TRASH_UNDO_MS = 5_000;
type Result = MailMutationResult | { cancelled: true };
type Pending = {
  owner: string;
  remaining: number;
  started: number;
  timer?: ReturnType<typeof setTimeout>;
  running: boolean;
  result: Promise<Result>;
  resolve: (value: Result) => void;
  execute: () => Promise<MailMutationResult>;
};

// The renderer may disappear; the main process owns both the delay and the write.
export class DeferredTrash {
  private items = new Map<string, Pending>();
  private closing = false;
  get size() { return this.items.size; }

  enqueue(id: string, owner: string, execute: Pending["execute"]): Promise<Result> {
    if (this.closing) throw new Error("The app is finishing pending changes before closing.");
    if (this.items.has(id) || this.items.size >= 100) throw new Error("Too many pending trash actions. Let them finish first.");
    let resolve!: Pending["resolve"];
    let reject!: (reason: unknown) => void;
    const result = new Promise<Result>((yes, no) => { resolve = yes; reject = no; });
    const item: Pending = {
      owner, remaining: TRASH_UNDO_MS, started: Date.now(), running: false, result, resolve,
      execute: async () => {
        try { const value = await execute(); resolve(value); return value; }
        catch (error) { reject(error); throw error; }
        finally { this.items.delete(id); }
      },
    };
    this.items.set(id, item);
    this.arm(item);
    return result;
  }

  private arm(item: Pending) {
    item.started = Date.now();
    item.timer = setTimeout(() => {
      item.timer = undefined;
      item.running = true;
      void item.execute().catch(() => { /* Failure is delivered through result. */ });
    }, item.remaining);
  }

  resumeAll(): void {
    for (const item of this.items.values()) if (!item.running && !item.timer) this.arm(item);
  }

  cancel(id: string, owner: string): boolean {
    const item = this.items.get(id);
    if (!item || item.owner !== owner || item.running) return false;
    clearTimeout(item.timer);
    this.items.delete(id);
    item.resolve({ cancelled: true });
    return true;
  }

  pause(id: string, owner: string, paused: boolean): number | null {
    const item = this.items.get(id);
    if (!item || item.owner !== owner || item.running || this.closing) return null;
    if (paused && item.timer) {
      clearTimeout(item.timer);
      item.timer = undefined;
      item.remaining = Math.max(0, item.remaining - (Date.now() - item.started));
    } else if (!paused && !item.timer) this.arm(item);
    return item.timer ? Math.max(0, item.remaining - (Date.now() - item.started)) : item.remaining;
  }

  async finishBeforeClose(): Promise<boolean> {
    this.closing = true;
    const items = [...this.items.values()];
    this.resumeAll();
    const results = await Promise.allSettled(items.map((item) => item.result));
    this.closing = false;
    return results.every((result) => result.status === "fulfilled");
  }
}
