import { useEffect, useMemo, useState } from "react";
import type { HeyAgentApi, MailMutationRequest, MailWatchChange } from "../../shared/contracts";
import type { MailSplitPage } from "../../shared/mail-splits";
import { applyOptimisticMailMutation, type MailboxCache } from "./optimistic-mail";

export function mergeSplitPage(current: MailboxCache, page: MailSplitPage, replaceIds: ReadonlySet<string> = new Set(), prepend = false): MailboxCache {
  const incoming = Object.values(page.mailboxes).filter((box) => box !== undefined);
  const next: MailboxCache = {};
  for (const old of Object.values(current)) {
    if (!old) continue;
    // Source membership can coexist across pages. Only explicit head replacement,
    // watch deletions, or local mutations retire a previously loaded membership.
    next[old.boxKey] = { ...old, postings: old.postings.filter((row) => !replaceIds.has(row.id)) };
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

type State = { key: string; mailboxes: MailboxCache; nextPage?: string; loading: boolean; loadingMore: boolean; error?: string };
type Source = Pick<HeyAgentApi["mail"], "listSplitMail" | "subscribe">;
const empty = (key: string): State => ({ key, mailboxes: {}, loading: false, loadingMore: false });
const repeatedPage = "HEY repeated a split history page. Refresh this split to continue.";

/** Disposable request state for one split definition in one renderer/account. */
export class SplitMailSession {
  state: State;
  private generation = 0;
  private pending = false;
  private stopped = true;
  private cursors = new Set<string>();
  private headIds = new Set<string>();
  private historyLoaded = false;
  private resumeHistory = false;
  private resetScheduled = false;
  private timer?: ReturnType<typeof setTimeout>;
  private unsubscribe?: () => void;
  private onChange?: (state: State) => void;

  constructor(private id: string | undefined, private key: string, private source: Source) { this.state = empty(key); }

  start(onChange: (state: State) => void): void {
    this.stopped = false;
    this.onChange = onChange;
    if (!this.id) return;
    this.unsubscribe = this.source.subscribe(this.changed);
    void this.read(false, true);
  }

  stop(): void {
    this.stopped = true;
    this.invalidate();
    clearTimeout(this.timer);
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.onChange = undefined;
  }

  private update(change: Partial<State>): void { this.state = { ...this.state, ...change }; this.onChange?.(this.state); }
  private invalidate(): void {
    this.resumeHistory ||= this.state.loadingMore && Boolean(this.state.nextPage);
    this.generation++;
    this.pending = false;
  }

  private changed = (change: MailWatchChange): void => {
    if (this.stopped || change.change === "disconnected") return;
    // Invalidate now: an old page must not resurrect mail during the debounce.
    this.invalidate();
    const mailboxes = change.change === "deleted" && change.postingId
      ? Object.fromEntries(Object.entries(this.state.mailboxes).map(([box, result]) => [box,
        result && (!change.box || change.box.key === box) ? { ...result, postings: result.postings.filter((row) => row.id !== change.postingId) } : result,
      ])) : this.state.mailboxes;
    this.update({ mailboxes, loading: false, loadingMore: false });
    this.resetScheduled ||= change.change === "resync";
    clearTimeout(this.timer);
    this.pending = true;
    this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(); }, 300);
  };

  private async read(more = false, reset = false): Promise<void> {
    if (!this.id || this.stopped || more && this.pending) return;
    const page = more ? this.state.nextPage : undefined;
    if (more && !page) return;
    if (page && this.cursors.has(page)) { this.update({ error: repeatedPage }); return; }
    const version = ++this.generation;
    this.pending = true;
    if (reset) {
      this.historyLoaded = false;
      this.resumeHistory = false;
      this.headIds.clear();
      this.cursors.clear();
      this.state = empty(this.key);
    }
    // Preserve the next unread cursor (including exhaustion) with retained history.
    const preserveContinuation = !more && !reset && this.historyLoaded;
    if (more) this.resumeHistory = false;
    if (!more && !preserveContinuation) this.cursors.clear();
    this.update({ loading: !more, loadingMore: more, error: undefined });
    let received = false;
    try {
      const result = await this.source.listSplitMail(this.id, page);
      if (version !== this.generation || this.stopped) return;
      if (!preserveContinuation && result.nextPage && (result.nextPage === page || this.cursors.has(result.nextPage))) throw new Error(repeatedPage);
      if (page) this.cursors.add(page);
      const replace = more || reset ? new Set<string>() : this.headIds;
      this.update({
        mailboxes: mergeSplitPage(this.state.mailboxes, result, replace, !more),
        nextPage: preserveContinuation ? this.state.nextPage : result.nextPage,
        loading: false, loadingMore: false,
      });
      if (more) this.historyLoaded = true;
      else this.headIds = new Set(Object.values(result.mailboxes).flatMap((box) => box?.postings.map((row) => row.id) ?? []));
      received = true;
    } catch (reason) {
      if (version === this.generation && !this.stopped) this.update({ loading: false, loadingMore: false, error: reason instanceof Error ? reason.message : "Could not load this split. Try again." });
    } finally {
      if (version === this.generation) {
        this.pending = false;
        // The view has already requested this cursor once. Resume an interrupted
        // page after refresh without depending on a second observer intersection.
        if (received && !more && this.resumeHistory) { this.resumeHistory = false; if (this.state.nextPage) await this.read(true); }
      }
    }
  }

  apply = (request: MailMutationRequest): void => {
    if (!this.id || this.stopped) return;
    this.invalidate();
    this.update({ mailboxes: applyOptimisticMailMutation(this.state.mailboxes, request.sourceBox ?? "imbox", undefined, request).mailboxes, loading: false, loadingMore: false });
  };

  refresh = (reset = false): Promise<void> => {
    clearTimeout(this.timer);
    this.timer = undefined;
    const restart = reset || this.resetScheduled;
    this.resetScheduled = false;
    return this.read(false, restart);
  };

  loadMore = (): Promise<void> => this.read(true);
}

/** A separate view cache; opening a split never narrows a native mailbox. */
export function useSplitMail(id: string | undefined, definition: string) {
  const key = id ? id + ":" + definition : "";
  const session = useMemo(() => new SplitMailSession(id, key, {
    listSplitMail: (splitId, page) => window.heyAgent.mail.listSplitMail(splitId, page),
    subscribe: (listener) => window.heyAgent.mail.subscribe(listener),
  }), [id, key]);
  const [rendered, setRendered] = useState<{ session: SplitMailSession; state: State }>(() => ({ session, state: { ...empty(key), loading: Boolean(id) } }));
  useEffect(() => { session.start((state) => setRendered({ session, state })); return () => session.stop(); }, [session]);
  return { ...(rendered.session === session ? rendered.state : { ...empty(key), loading: Boolean(id) }), apply: session.apply, refresh: session.refresh, loadMore: session.loadMore };
}
