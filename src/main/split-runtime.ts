import type { ImboxPosting, ImboxResult, MailboxKey } from "../shared/contracts";
import { MailSplits } from "./mail-splits";
import { listLibrary, listLibraryThreads, listMailbox, updateMailOrganization } from "./hey";
import { profileRequest } from "./profile-process";
import { normalizeMailSplitDraft, type MailSplitState } from "../shared/mail-splits";
import { createSplitLabel } from "./split-label";

type Context = NonNullable<ReturnType<typeof profileRequest.getStore>>;
const BOXES: MailboxKey[] = ["imbox", "laterbox", "asidebox"];

/** A runtime belongs to one immutable account context, including queued work. */
export class SplitRuntime {
  readonly store: MailSplits;
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private scan?: Promise<void>;
  private snapshotRead?: Promise<ImboxPosting[]>;
  private scanAgain = false;
  private forceScan = false;
  private error?: string;

  constructor(file: string, private context: Context, private onChange: (state: MailSplitState) => void, runWrite: <T>(task: () => Promise<T>) => Promise<T>, ownEmail?: string) {
    const scoped = <T>(task: () => Promise<T>) => profileRequest.run(context, task);
    this.store = new MailSplits(file, {
      ownEmail,
      listLabels: () => scoped(async () => (await listLibrary("labels", context.env)).items.map((item) => ({ id: item.id, name: item.title }))),
      listLabelPage: (id, page) => scoped(() => listLibraryThreads("labels", id, page, context.env)),
      addLabel: (id, postingIds) => runWrite(() => scoped(async () => { await updateMailOrganization({ kind: "labels", action: "add", targetId: id, postingIds }, context.env); })),
      createLabel: (name, postingIds) => runWrite(() => scoped(() => createSplitLabel(name, postingIds))),
      onChange: (state) => { if (!this.stopped) this.onChange(this.withError(state)); },
    });
  }

  private withError(state: MailSplitState): MailSplitState {
    return this.error ? { ...state, errors: { ...state.errors, _sync: this.error } } : state;
  }

  async get(): Promise<MailSplitState> { return this.withError(await this.store.get()); }

  observe(box: MailboxKey, result: ImboxResult): void {
    // A pending snapshot invalidates incremental reads that may have started
    // before a move/delete/watch event. The completed snapshot owns that refresh.
    if (!this.stopped && !this.scan && !this.timer && BOXES.includes(box) && result.status === "ready") void this.store.observe(result.postings).catch((reason: unknown) => {
      this.error = reason instanceof Error ? reason.message : "Split rules could not read the configuration.";
    });
  }

  async preview(draft: unknown) {
    const valid = normalizeMailSplitDraft(draft);
    // Preview is read-only even when previously enabled rules exist. Passing the
    // fresh rows directly avoids enqueuing sync work as a side effect of preview.
    return this.store.preview(valid, await this.readSnapshot());
  }

  async refresh(force = false): Promise<void> {
    if (this.stopped) return;
    this.forceScan ||= force;
    if (this.scan) return this.scan;
    this.scan = (async () => {
      do {
        this.scanAgain = false;
        const state = await this.store.get();
        const forced = this.forceScan;
        this.forceScan = false;
        if (!forced && !state.splits.some((split) => split.enabled)) return;
        this.store.forget();
        const postings = await this.readSnapshot();
        if (this.stopped) return;
        // A watch event invalidated this snapshot during the read. Fetch a new
        // one before labeling, rather than applying stale queued work first.
        if (this.scanAgain) continue;
        await this.store.replaceObserved(postings);
        this.error = undefined;
      } while (this.scanAgain && !this.stopped);
    })().catch((reason: unknown) => {
      this.store.forget();
      this.error = reason instanceof Error ? reason.message : "Split rules could not check for new mail. Refresh to retry.";
    }).finally(async () => {
      this.scan = undefined;
      this.forceScan = false;
      if (!this.stopped) {
        try { this.onChange(await this.get()); }
        catch { this.onChange({ splits: [], memberships: {}, errors: { _sync: this.error ?? "Split settings could not be loaded." } }); }
      }
    });
    return this.scan;
  }

  schedule(): void {
    if (this.stopped) return;
    this.store.forget();
    // A preview may already be reading. A watch-triggered refresh must not reuse
    // that pre-change snapshot merely because the read has not finished yet.
    this.snapshotRead = undefined;
    if (this.scan) { this.scanAgain = true; return; }
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(); }, 1000);
  }

  private readSnapshot(): Promise<ImboxPosting[]> {
    if (this.stopped) return Promise.reject(new Error("This account is no longer active."));
    if (this.snapshotRead) return this.snapshotRead;
    const reading = (async () => {
      const postings: ImboxPosting[] = [];
      for (const box of BOXES) {
        if (this.stopped) throw new Error("This account is no longer active.");
        const result = await profileRequest.run(this.context, () => listMailbox(box, this.context.env, box === "imbox" ? { paginated: true } : undefined));
        if (result.status !== "ready") throw new Error("Could not check Imbox, Reply Later, and Set Aside. Refresh and try again.");
        postings.push(...result.postings);
      }
      if (this.stopped) throw new Error("This account is no longer active.");
      return postings;
    })().catch((cause: unknown) => {
      throw new Error(this.stopped ? "This account is no longer active." : "Could not check Imbox, Reply Later, and Set Aside. Refresh and try again.", { cause });
    }).finally(() => { if (this.snapshotRead === reading) this.snapshotRead = undefined; });
    this.snapshotRead = reading;
    return reading;
  }

  stop(): void { this.stopped = true; clearTimeout(this.timer); this.store.stop(); }
}
