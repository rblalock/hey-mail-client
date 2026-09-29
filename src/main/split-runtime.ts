import { randomUUID } from "node:crypto";
import type { ImboxPosting, ImboxResult, MailboxKey, MailboxListOptions, MailWatchChange } from "../shared/contracts";
import { MailSplits } from "./mail-splits";
import { listLibrary, listLibraryThreads, listMailbox, updateMailOrganization } from "./hey";
import { profileRequest } from "./profile-process";
import { isMailSplitId, normalizeMailSplitDraft, SPLIT_MAILBOXES, splitContainsPosting, type MailSplitPage, type MailSplitState } from "../shared/mail-splits";
import { createSplitLabel } from "./split-label";

type Context = NonNullable<ReturnType<typeof profileRequest.getStore>>;
const BOXES = SPLIT_MAILBOXES;
const MAX_LIST_PAGES = 6;
const MAX_READS = 3;
const SOURCE_TTL_MS = 30_000;
const MAX_CACHED_PAGES = 96;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
type SplitCursor = { splitId: string; definition: string; progressive?: boolean; sources: { box: MailboxKey; page?: string; visited: string[] }[] };
type CachedSource = { result: ImboxResult; expires: number; bytes: number };

/** Mail mutations/deferred trash handle their narrower lifecycle separately. */
export function changesSplitSources(channel: string): boolean {
  return /^mail:(send|send-draft|bulk-reply-send|bulk-reply-undo|unbundle-contact|update-set-aside-group|update-organization)$/.test(channel);
}

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
  private cursors = new Map<string, SplitCursor>();
  private sourceCache = new Map<string, CachedSource>();
  private sourceReads = new Map<string, Promise<ImboxResult>>();
  private cacheBytes = 0;
  private generation = 0;
  private sourceVersions = new Map<MailboxKey, number>();
  private seenRevision = 0;
  private seenOverrides = new Map<string, { seen: boolean; revision: number }>();
  private membershipReads = new Map<string, Promise<void>>();
  private membershipErrors = new Map<string, string>();
  private activeReads = 0;
  private readWaiters: (() => void)[] = [];

  constructor(file: string, private context: Context, private onChange: (state: MailSplitState) => void, runWrite: <T>(task: () => Promise<T>) => Promise<T>, ownEmail?: string, private onSource?: (result: ImboxResult) => void) {
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
    const membershipKeys = new Set(state.splits.map((split) => `${split.id}:${split.labelId}`));
    for (const key of this.membershipErrors.keys()) if (!membershipKeys.has(key)) this.membershipErrors.delete(key);
    const loadingMemberships = state.splits.filter((split) => !this.store.hasLoadedMembership(split.id) && !this.membershipErrors.has(`${split.id}:${split.labelId}`)).map((split) => split.id);
    const errors: Record<string, string> = { ...state.errors, ...(this.error ? { _sync: this.error } : {}) };
    for (const split of state.splits) {
      const error = this.membershipErrors.get(`${split.id}:${split.labelId}`);
      if (error && !this.store.hasLoadedMembership(split.id)) errors[`membership:${split.id}`] = error;
    }
    return { ...state, errors, ...(loadingMemberships.length ? { loadingMemberships } : {}) };
  }

  async get(): Promise<MailSplitState> { return this.withError(await this.store.get()); }

  async addToSplit(request: unknown): Promise<MailSplitState> {
    this.assertRunning();
    await this.store.addToSplit(request);
    this.assertRunning();
    return this.get();
  }

  /** Account-wide lenses retain each row's real source for grouping and actions. */
  async listMail(id: unknown, page?: unknown, options?: { progressive?: boolean }): Promise<MailSplitPage> {
    this.assertRunning();
    if (!isMailSplitId(id)) throw new Error("Choose a valid split.");
    if (page !== undefined && (typeof page !== "string" || !/^[a-f0-9-]{36}$/.test(page))) throw new Error("This split page has expired. Refresh to continue.");
    const generation = this.generation;
    const progressive = options?.progressive || typeof page === "string" && this.cursors.get(page)?.progressive;
    const state = progressive ? await this.store.get() : await this.store.listingState(id);
    this.assertRunning();
    const split = state.splits.find((item) => item.id === id);
    if (!split) throw new Error("This split no longer exists.");
    const membershipKey = `${split.id}:${split.labelId}`;
    const membershipLoading = !this.store.hasLoadedMembership(id) && !this.membershipErrors.has(membershipKey);
    if (progressive && membershipLoading) this.loadMembership(id, membershipKey);
    const definition = JSON.stringify(split);
    const saved = typeof page === "string" ? this.cursors.get(page) : undefined;
    if (page !== undefined && (!saved || saved.splitId !== id || saved.definition !== definition)) throw new Error("This split changed or its page expired. Refresh to continue.");
    const cursor: SplitCursor = saved ? structuredClone(saved) : { splitId: id, definition, progressive: options?.progressive, sources: BOXES.map((box) => ({ box, visited: [] })) };
    const mailboxes: MailSplitPage["mailboxes"] = {};
    const observed: ImboxPosting[] = [];
    // Paint the first source group without waiting for the remaining mailboxes.
    // Only the bounded head continuation is automatic; history remains on demand.
    const limit = cursor.progressive && cursor.sources.some((source) => source.page === undefined) ? MAX_READS : MAX_LIST_PAGES;
    for (let count = 0; count < limit && cursor.sources.length;) {
      this.assertRunning();
      const sources = cursor.sources.splice(0, Math.min(MAX_READS, limit - count));
      count += sources.length;
      const results = await Promise.all(sources.map((source) => this.readSource(source.box, source.page)));
      this.assertRunning();
      if (generation !== this.generation) throw new Error("Mail changed while loading this split. Refresh to continue.");
      if (results.some((result) => result.status !== "ready")) throw new Error("Could not check all six mailboxes. Refresh and try again.");
      for (const [index, source] of sources.entries()) {
        const result = results[index]!;
        observed.push(...result.postings);
        const matches = result.postings.filter((posting) => splitContainsPosting(posting, split, state.memberships, state.ownEmail));
        const previous = mailboxes[source.box]?.postings ?? [];
        const { nextPage: sourceNext, ...metadata } = result;
        mailboxes[source.box] = { ...metadata, postings: [...new Map([...previous, ...matches].map((posting) => [posting.id, posting])).values()] };
        if (sourceNext) {
          if (sourceNext === source.page || source.visited.includes(sourceNext)) throw new Error("Split history stopped making progress. Refresh to continue.");
          cursor.sources.push({ box: source.box, page: sourceNext, visited: [...source.visited, sourceNext] });
        }
      }
    }
    const current = (await this.store.get()).splits.find((item) => item.id === id);
    this.assertRunning();
    if (generation !== this.generation) throw new Error("Mail changed while loading this split. Refresh to continue.");
    if (JSON.stringify(current) !== definition) throw new Error("This split changed. Refresh to continue.");
    let nextPage: string | undefined;
    if (cursor.sources.length) {
      nextPage = randomUUID();
      this.cursors.set(nextPage, cursor);
      while (this.cursors.size > 100) this.cursors.delete(this.cursors.keys().next().value!);
    }
    // Empty match pages intentionally keep a continuation: older sources may match.
    if (!membershipLoading && !this.scan && !this.timer) void this.store.observe(observed).catch(() => undefined);
    const membershipError = this.membershipErrors.get(membershipKey);
    return { mailboxes, ...(nextPage ? { nextPage } : {}), ...(cursor.progressive ? { headComplete: !cursor.sources.some((source) => source.page === undefined), membershipLoading: membershipLoading && !membershipError, ...(membershipError ? { membershipError } : {}) } : {}) };
  }

  private loadMembership(id: string, key: string): void {
    if (this.membershipReads.has(key)) return;
    const reading = this.store.listingState(id).then(() => { this.membershipErrors.delete(key); }).catch(() => {
      if (!this.stopped) this.membershipErrors.set(key, "Could not load this split’s linked label. Some conversations may be missing. Refresh to try again.");
    }).finally(async () => {
      if (this.membershipReads.get(key) === reading) this.membershipReads.delete(key);
      if (!this.stopped) {
        try { this.onChange(await this.get()); } catch { /* The next foreground read reports configuration failures. */ }
      }
    });
    this.membershipReads.set(key, reading);
  }

  /** Native views and split lenses share one account-scoped page cache. */
  async listMailbox(box: MailboxKey, options?: MailboxListOptions): Promise<ImboxResult> {
    this.assertRunning();
    if (options?.refresh) this.invalidate(box);
    if (options?.paginated && (options.singlePage || options.page !== undefined)) return this.readSource(box, options.page);
    const started = this.seenRevision;
    const result = await profileRequest.run(this.context, () => listMailbox(box, this.context.env, options));
    this.assertRunning();
    if (result.status === "ready") this.onSource?.(result);
    return this.withSeen(result, started);
  }

  /** Confirmed read-state writes must not discard bodies, lists, or split membership. */
  applySeen(postingIds: readonly string[], seen: boolean): void {
    const previous = this.seenRevision;
    const revision = ++this.seenRevision;
    for (const id of postingIds) { this.seenOverrides.delete(id); this.seenOverrides.set(id, { seen, revision }); }
    while (this.seenOverrides.size > 5_000) this.seenOverrides.delete(this.seenOverrides.keys().next().value!);
    for (const cached of this.sourceCache.values()) {
      this.cacheBytes -= cached.bytes;
      cached.result = this.withSeen(cached.result, previous);
      cached.bytes = Buffer.byteLength(JSON.stringify(cached.result));
      this.cacheBytes += cached.bytes;
    }
  }

  noteChange(change: MailWatchChange): void {
    if (change.change === "ready" || change.change === "disconnected") return;
    if (change.metadataOnly && change.postingId && typeof change.postingSeen === "boolean") {
      this.applySeen([change.postingId], change.postingSeen);
      return;
    }
    if (change.postingId) this.seenOverrides.delete(change.postingId);
    else this.seenOverrides.clear();
    const box = BOXES.find((box) => box === change.box?.key);
    this.schedule(box);
  }

  private withSeen(result: ImboxResult, started: number): ImboxResult {
    return { ...result, postings: result.postings.map((row) => {
      const override = this.seenOverrides.get(row.id);
      // Only reconcile writes newer than this request. An authoritative read
      // started afterward must win, including changes made on another device.
      return override && override.revision > started ? { ...row, seen: override.seen } : row;
    }) };
  }

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
    if (force) this.invalidate();
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

  schedule(box?: MailboxKey): void {
    if (this.stopped) return;
    this.store.forget();
    // A preview may already be reading. A watch-triggered refresh must not reuse
    // that pre-change snapshot merely because the read has not finished yet.
    this.invalidate(box);
    if (this.scan) { this.scanAgain = true; return; }
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(); }, 1000);
  }

  private readSnapshot(): Promise<ImboxPosting[]> {
    if (this.stopped) return Promise.reject(new Error("This account is no longer active."));
    if (this.snapshotRead) return this.snapshotRead;
    const reading = (async () => {
      const results = await Promise.all(BOXES.map((box) => this.readSource(box)));
      if (this.stopped) throw new Error("This account is no longer active.");
      if (results.some((result) => result.status !== "ready")) throw new Error("Mailbox unavailable.");
      return results.flatMap((result) => result.postings);
    })().catch((cause: unknown) => {
      throw new Error(this.stopped ? "This account is no longer active." : "Could not check all six mailboxes. Refresh and try again.", { cause });
    }).finally(() => { if (this.snapshotRead === reading) this.snapshotRead = undefined; });
    this.snapshotRead = reading;
    return reading;
  }

  private assertRunning(): void {
    if (this.stopped) throw new Error("This account is no longer active.");
  }

  /** In-flight reads may finish, but must never repopulate a post-change cache. */
  invalidate(box?: MailboxKey): void {
    this.generation += 1;
    if (!box) this.membershipErrors.clear();
    for (const source of box ? [box] : BOXES) this.sourceVersions.set(source, (this.sourceVersions.get(source) ?? 0) + 1);
    for (const [key, cached] of this.sourceCache) {
      if (box && (JSON.parse(key) as [MailboxKey])[0] !== box) continue;
      this.cacheBytes -= cached.bytes;
      this.sourceCache.delete(key);
    }
    for (const key of this.sourceReads.keys()) if (!box || (JSON.parse(key) as [MailboxKey])[0] === box) this.sourceReads.delete(key);
    this.snapshotRead = undefined;
    if (this.scan) this.scanAgain = true;
  }

  private readSource(box: MailboxKey, page?: string): Promise<ImboxResult> {
    this.assertRunning();
    const key = JSON.stringify([box, page ?? null]);
    const cached = this.sourceCache.get(key);
    if (cached && cached.expires > Date.now()) {
      this.sourceCache.delete(key);
      this.sourceCache.set(key, cached);
      return Promise.resolve(structuredClone(cached.result));
    }
    if (cached) { this.sourceCache.delete(key); this.cacheBytes -= cached.bytes; }
    const pending = this.sourceReads.get(key);
    if (pending) return pending.then((result) => structuredClone(result));
    const version = this.sourceVersions.get(box) ?? 0;
    const reading = this.withReadSlot(async () => {
      this.assertRunning();
      try {
        const started = this.seenRevision;
        const result = await profileRequest.run(this.context, () => listMailbox(box, this.context.env, { paginated: true, singlePage: true, ...(page ? { page } : {}) }));
        this.assertRunning();
        if (result.status !== "ready") return result;
        if (version === (this.sourceVersions.get(box) ?? 0)) {
          this.onSource?.(result);
          const reconciled = this.withSeen(result, started);
          const bytes = Buffer.byteLength(JSON.stringify(reconciled));
          if (bytes <= MAX_CACHE_BYTES) {
            this.sourceCache.set(key, { result: structuredClone(reconciled), expires: Date.now() + SOURCE_TTL_MS, bytes });
            this.cacheBytes += bytes;
            while (this.sourceCache.size > MAX_CACHED_PAGES || this.cacheBytes > MAX_CACHE_BYTES) {
              const oldest = this.sourceCache.keys().next().value!;
              this.cacheBytes -= this.sourceCache.get(oldest)!.bytes;
              this.sourceCache.delete(oldest);
            }
          }
        }
        return this.withSeen(result, started);
      } catch {
        this.assertRunning();
        throw new Error("Could not load this mailbox. Refresh and try again.");
      }
    }).finally(() => { if (this.sourceReads.get(key) === reading) this.sourceReads.delete(key); });
    this.sourceReads.set(key, reading);
    return reading.then((result) => structuredClone(result));
  }

  private async withReadSlot<T>(read: () => Promise<T>): Promise<T> {
    if (this.activeReads >= MAX_READS) await new Promise<void>((resolve) => this.readWaiters.push(resolve));
    else this.activeReads += 1;
    try { return await read(); }
    finally {
      const next = this.readWaiters.shift();
      if (next) next();
      else this.activeReads -= 1;
    }
  }

  stop(): void { this.stopped = true; clearTimeout(this.timer); this.invalidate(); this.cursors.clear(); this.store.stop(); }
}
