import { useEffect, useMemo, useState } from "react";
import type { HeyAgentApi, MailboxKey, MailMutationRequest, MailWatchChange } from "../../shared/contracts";
import { SPLIT_MAILBOXES, type MailSplitPage } from "../../shared/mail-splits";
import { applyOptimisticMailMutation, type MailboxCache } from "./optimistic-mail";

type SourcePostingIds = Partial<Record<MailboxKey, ReadonlySet<string>>>;

/** Watch payloads can update loaded rows, but cannot establish split membership. */
export function applyWatchSeen(current: MailboxCache, change: MailWatchChange): MailboxCache {
  if ((change.change !== "added" && change.change !== "updated") || typeof change.postingSeen !== "boolean") return current;
  const source = change.box?.key as MailboxKey | undefined;
  if (!source || !SPLIT_MAILBOXES.includes(source)) return current;
  const { postingId, topicId } = change;
  if (![postingId, topicId].some((id) => id !== undefined)
    || [postingId, topicId].some((id) => id !== undefined && (typeof id !== "string" || !id.trim() || id !== id.trim()))) return current;
  const mailbox = current[source];
  if (!mailbox || mailbox.boxKey !== source) return current;
  const seen = change.postingSeen;
  let changed = false;
  const postings = mailbox.postings.map((posting) => {
    if ((postingId !== undefined && posting.id !== postingId) || (topicId !== undefined && posting.topicId !== topicId) || posting.seen === seen) return posting;
    changed = true;
    return { ...posting, seen };
  });
  return changed ? { ...current, [source]: { ...mailbox, postings } } : current;
}

export function mergeSplitPage(current: MailboxCache, page: MailSplitPage, replaceIds: ReadonlySet<string> | SourcePostingIds = new Set(), prepend = false): MailboxCache {
  const incoming = Object.values(page.mailboxes).filter((box) => box !== undefined);
  const next: MailboxCache = {};
  for (const old of Object.values(current)) {
    if (!old) continue;
    // Source membership can coexist across pages. Only explicit head replacement,
    // watch deletions, or local mutations retire a previously loaded membership.
    const replaced = "has" in replaceIds ? replaceIds : replaceIds[old.boxKey];
    next[old.boxKey] = { ...old, postings: old.postings.filter((row) => !replaced?.has(row.id)) };
  }
  for (const box of incoming) {
    const old = next[box.boxKey];
    const ordered = prepend ? [...box.postings, ...(old?.postings ?? [])] : [...(old?.postings ?? []), ...box.postings];
    const ids = new Set<string>();
    const topics = new Set<string>();
    const postings = ordered.filter((row) => {
      if (ids.has(row.id) || row.topicId && topics.has(row.topicId)) return false;
      ids.add(row.id);
      if (row.topicId) topics.add(row.topicId);
      return true;
    });
    next[box.boxKey] = { ...(prepend || !old ? box : old), postings };
  }
  return next;
}

type State = { key: string; mailboxes: MailboxCache; nextPage?: string; headComplete?: boolean; membershipLoading?: boolean; membershipError?: string; loading: boolean; loadingMore: boolean; error?: string };
type Source = Pick<HeyAgentApi["mail"], "listSplitMail" | "subscribe">;
type CacheOptions = { maxSessions?: number; staleAfterMs?: number; now?: () => number };
const empty = (key: string): State => ({ key, mailboxes: {}, loading: false, loadingMore: false });
const repeatedPage = "HEY repeated a split history page. Refresh this split to continue.";
const expiredPageErrors = new Set([
  "This split page has expired. Refresh to continue.",
  "This split changed or its page expired. Refresh to continue.",
]);
const STALE_AFTER_MS = 30_000;

/** Disposable request state for one split definition in one renderer/account. */
export class SplitMailSession {
  state: State;
  private generation = 0;
  private pending = false;
  private stopped = true;
  private active = false;
  private loaded = false;
  private stale = true;
  private refreshedAt = 0;
  private cursors = new Set<string>();
  private headIds: SourcePostingIds = {};
  private historyLoaded = false;
  private resumeHistory = false;
  private resetScheduled = false;
  private restartRequired = false;
  private preservedHistory?: { nextPage?: string };
  private transientRetries = 0;
  private seenRevision = 0;
  private seenOverrides = new Map<string, { seen: boolean; revision: number }>();
  private timer?: ReturnType<typeof setTimeout>;
  private unsubscribe?: () => void;
  private onChange?: (state: State) => void;

  constructor(private id: string | undefined, key: string, private source: Source, private options: CacheOptions = {}) { this.state = { ...empty(key), loading: Boolean(id) }; }

  get isActive(): boolean { return this.active && !this.stopped; }

  start(onChange: (state: State) => void): void {
    this.stopped = false;
    this.active = true;
    this.onChange = onChange;
    this.onChange(this.state);
    if (!this.id) return;
    this.unsubscribe ??= this.source.subscribe(this.changed);
    const expired = (this.options.now?.() ?? Date.now()) - this.refreshedAt >= (this.options.staleAfterMs ?? STALE_AFTER_MS);
    if (!this.pending && (!this.loaded || this.stale || expired)) void this.refresh();
    else if (!this.pending && (this.resumeHistory || this.state.headComplete === false) && this.state.nextPage) void this.read(true);
  }

  /** Switching tabs retains rows, cursors, and any already-started request. */
  deactivate(): void {
    this.active = false;
    this.onChange = undefined;
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; this.pending = false; }
  }

  stop(): void {
    this.stopped = true;
    this.active = false;
    this.invalidate();
    clearTimeout(this.timer);
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.onChange = undefined;
  }

  private update(change: Partial<State>): void { this.state = { ...this.state, ...change }; this.onChange?.(this.state); }
  private invalidate(): void {
    this.resumeHistory ||= this.state.loadingMore && this.state.headComplete !== false && Boolean(this.state.nextPage);
    this.generation++;
    this.pending = false;
  }

  private changed = (change: MailWatchChange): void => {
    if (this.stopped || change.change === "disconnected" || change.change === "ready") return;
    if (change.metadataOnly) {
      if (change.postingId && typeof change.postingSeen === "boolean") this.rememberSeen([change.postingId], change.postingSeen);
      this.update({ mailboxes: applyWatchSeen(this.state.mailboxes, change) });
      return;
    }
    if (change.postingId) this.seenOverrides.delete(change.postingId);
    else this.seenOverrides.clear();
    // Invalidate now: an old page must not resurrect mail during the debounce.
    this.invalidate();
    this.stale = true;
    const mailboxes = change.change === "deleted" && (change.postingId || change.topicId)
      ? Object.fromEntries(Object.entries(this.state.mailboxes).map(([box, result]) => [box,
        result && (!change.box || change.box.key === box) ? { ...result, postings: result.postings.filter((row) => row.id !== change.postingId && (!change.topicId || row.topicId !== change.topicId)) } : result,
      ])) : applyWatchSeen(this.state.mailboxes, change);
    this.update({ mailboxes, loading: false, loadingMore: false });
    this.resetScheduled ||= change.change === "resync";
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.active) return;
    this.pending = true;
    this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(); }, 300);
  };

  private async read(more = false, reset = false): Promise<void> {
    if (!this.id || this.stopped || !this.active || more && this.pending) return;
    const page = more ? this.state.nextPage : undefined;
    if (more && !page) return;
    if (page && this.cursors.has(page)) { this.update({ error: repeatedPage }); return; }
    const version = ++this.generation;
    this.pending = true;
    if (reset) {
      this.historyLoaded = false;
      this.resumeHistory = false;
      this.headIds = {};
      this.cursors.clear();
      this.preservedHistory = undefined;
    }
    // Preserve the next unread cursor (including exhaustion) with retained history.
    const preserveContinuation = !more && !reset && this.historyLoaded;
    if (preserveContinuation) this.preservedHistory ??= { nextPage: this.state.nextPage };
    const historyPage = more && this.state.headComplete !== false;
    if (more) this.resumeHistory = false;
    if (!more && !preserveContinuation) this.cursors.clear();
    this.update({ loading: !more && !this.loaded, loadingMore: more, error: undefined });
    let received = false;
    try {
      let seenAtRequest = this.seenRevision;
      let result = reset
        ? await this.source.listSplitMail(this.id, undefined, { refresh: true })
        : await this.source.listSplitMail(this.id, page);
      let responsePage = page;
      for (let heads = 0; ; heads++) {
        if (version !== this.generation || this.stopped) return;
        if (result.nextPage && (result.nextPage === responsePage || this.cursors.has(result.nextPage))) throw new Error(repeatedPage);
        if (reset || !this.loaded) this.restartRequired = false;
        if (responsePage) this.cursors.add(responsePage);
        const replace = historyPage || reset ? {} : Object.fromEntries(Object.keys(result.mailboxes).map((box) => [box, this.headIds[box as MailboxKey]]));
        const headComplete = result.headComplete !== false;
        const nextPage = headComplete && this.preservedHistory ? this.preservedHistory.nextPage : result.nextPage;
        const incoming = { ...result, mailboxes: Object.fromEntries(Object.entries(result.mailboxes).map(([key, box]) => [key, box && { ...box, postings: box.postings.map((row) => {
          const override = this.seenOverrides.get(row.id);
          return override && override.revision > seenAtRequest ? { ...row, seen: override.seen } : row;
        }) }])) };
        const mailboxes = mergeSplitPage(reset && heads === 0 ? {} : this.state.mailboxes, incoming, replace, !historyPage);
        this.update({ mailboxes, nextPage, headComplete, membershipLoading: result.membershipLoading, membershipError: result.membershipError, loading: false, loadingMore: !headComplete });
        if (headComplete) this.preservedHistory = undefined;
        if (historyPage) this.historyLoaded = true;
        else {
          for (const box of Object.values(result.mailboxes)) if (box) this.headIds[box.boxKey] = new Set(box.postings.map((row) => row.id));
          this.refreshedAt = this.options.now?.() ?? Date.now();
          this.stale = false;
          this.loaded = true;
        }
        received = true;
        this.transientRetries = 0;
        if (headComplete || !result.nextPage || !this.active) break;
        // Protocol protection: six source heads need at most two batches.
        if (heads >= 2) throw new Error("Split mailbox heads did not finish loading. Refresh to continue.");
        responsePage = result.nextPage;
        seenAtRequest = this.seenRevision;
        result = await this.source.listSplitMail(this.id, responsePage);
      }
    } catch (reason) {
      if (version === this.generation && !this.stopped) {
        const message = reason instanceof Error ? reason.message : "Could not load this split. Try again.";
        const underlying = message.replace(/^Error invoking remote method 'mail:list-split-mail': Error: /, "");
        if (underlying === "Mail changed while loading this split. Refresh to continue." && this.transientRetries++ < 2 && this.active) {
          this.update({ loading: !this.loaded, loadingMore: false });
          this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(); }, 300);
          return;
        }
        if (more && expiredPageErrors.has(underlying)) this.restartRequired = true;
        this.update({ loading: false, loadingMore: false, error: message });
      }
    } finally {
      if (version === this.generation) {
        this.pending = false;
        // The view has already requested this cursor once. Resume an interrupted
        // page after refresh without depending on a second observer intersection.
        if (received && !more && this.resumeHistory && this.active) { this.resumeHistory = false; if (this.state.nextPage) await this.read(true); }
      }
    }
  }

  apply = (request: MailMutationRequest): void => {
    if (!this.id || this.stopped) return;
    if (request.operation === "seen" || request.operation === "unseen") {
      this.rememberSeen(request.postingIds, request.operation === "seen");
      this.update({ mailboxes: applyOptimisticMailMutation(this.state.mailboxes, request.sourceBox ?? "imbox", undefined, request).mailboxes });
      return;
    }
    this.invalidate();
    this.stale = true;
    this.update({ mailboxes: applyOptimisticMailMutation(this.state.mailboxes, request.sourceBox ?? "imbox", undefined, request).mailboxes, loading: false, loadingMore: false });
  };

  private rememberSeen(ids: readonly string[], seen: boolean): void {
    const revision = ++this.seenRevision;
    for (const id of ids) { this.seenOverrides.delete(id); this.seenOverrides.set(id, { seen, revision }); }
    while (this.seenOverrides.size > 5_000) this.seenOverrides.delete(this.seenOverrides.keys().next().value!);
  }

  refresh = (reset = false): Promise<void> => {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.stale = true;
    this.resetScheduled ||= reset;
    if (!this.active) return Promise.resolve();
    const restart = this.resetScheduled;
    this.resetScheduled = false;
    return this.read(false, restart);
  };

  // Expired backend cursors need a fresh head, but only after an explicit retry.
  // Ordinary transport failures keep retrying the same unread history page.
  loadMore = (): Promise<void> => this.restartRequired ? this.refresh(true) : this.read(true);

  /** Inactive views stay stale without starting reads or retaining stale requests. */
  markStale(reset = false): void {
    if (this.stopped) return;
    this.invalidate();
    this.stale = true;
    this.resetScheduled ||= reset;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.update({ loading: false, loadingMore: false });
  }
}

/** One account's bounded working set. Native mailboxes never receive filtered rows. */
export class SplitMailCache {
  private sessions = new Map<string, { id: string | undefined; session: SplitMailSession }>();

  constructor(private source: Source, private options: CacheOptions = {}) {}

  get(id: string | undefined, definition: string): SplitMailSession {
    const key = id ? id + ":" + definition : "";
    for (const [oldKey, entry] of this.sessions) {
      if (entry.id === id && oldKey !== key) { entry.session.stop(); this.sessions.delete(oldKey); }
    }
    const entry = this.sessions.get(key) ?? { id, session: new SplitMailSession(id, key, this.source, this.options) };
    this.sessions.delete(key);
    this.sessions.set(key, entry);
    while (this.sessions.size > Math.max(1, this.options.maxSessions ?? 12)) {
      const oldest = this.sessions.keys().next().value!;
      this.sessions.get(oldest)!.session.stop();
      this.sessions.delete(oldest);
    }
    return entry.session;
  }

  apply = (request: MailMutationRequest): void => { for (const { session } of this.sessions.values()) session.apply(request); };

  refresh = (reset = false): Promise<void> => {
    // A write can finish after navigation. Refresh the currently visible split,
    // not the split captured by the initiating click's callback.
    const active = [...this.sessions.values()].find(({ session }) => session.isActive)?.session;
    for (const { session } of this.sessions.values()) session.markStale(reset);
    return active?.refresh(reset) ?? Promise.resolve();
  };

  // Keep entries restartable for React's effect replay. Account changes discard
  // the cache object itself; stopped requests cannot publish into the new one.
  stop(): void { for (const { session } of this.sessions.values()) session.stop(); }
}

/** Retain split views within an account; drop the entire working set on account change. */
export function useSplitMail(id: string | undefined, definition: string, accountKey: string) {
  const cache = useMemo(() => new SplitMailCache({
    listSplitMail: (splitId, page, options) => window.heyAgent.mail.listSplitMail(splitId, page, options),
    subscribe: (listener) => window.heyAgent.mail.subscribe(listener),
  }), [accountKey]);
  const session = useMemo(() => cache.get(id, definition), [cache, id, definition]);
  const [rendered, setRendered] = useState<{ session: SplitMailSession; state: State }>(() => ({ session, state: session.state }));
  useEffect(() => () => cache.stop(), [cache]);
  useEffect(() => { session.start((state) => setRendered({ session, state })); return () => session.deactivate(); }, [session]);
  return { ...(rendered.session === session ? rendered.state : session.state), apply: cache.apply, refresh: cache.refresh, loadMore: session.loadMore };
}
