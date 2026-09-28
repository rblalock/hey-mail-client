import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ImboxPosting } from "../shared/contracts";
import { isHeyId, isMailSplitId, matchesMailSplit, MAX_MAIL_SPLITS, normalizeAddToSplit, normalizeMailSplitDraft, splitTopicId, type MailSplit, type MailSplitPreview, type MailSplitState } from "../shared/mail-splits";

export type MailSplitDependencies = {
  /** All dependencies must close over one immutable account/profile context. */
  ownEmail?: string;
  listLabels: () => Promise<{ id: string; name: string }[]>;
  listLabelPage: (labelId: string, page?: string) => Promise<{ postings: ImboxPosting[]; nextPage?: string }>;
  createLabel: (name: string, postingIds: string[]) => Promise<{ id: string; name: string }>;
  addLabel: (labelId: string, postingIds: string[]) => Promise<unknown>;
  onChange?: (state: MailSplitState) => void;
  now?: () => number;
};

const MAX_OBSERVED = 5_000;
const MAX_MEMBERSHIP_PAGES = 200;
const BATCH_SIZE = 25;
const RETRY_DELAY_MS = 30_000;
type Membership = { topics: Set<string>; postings: Set<string> };

/** A profile-local configuration file, plus disposable in-memory labeling state. */
export class MailSplits {
  private splits: MailSplit[] = [];
  private errors: Record<string, string> = {};
  private labels = new Map<string, Membership>();
  private observed = new Map<string, ImboxPosting>();
  private revisions = new Map<string, number>();
  private retryAfter = new Map<string, number>();
  private pendingLabels = new Map<string, { id: string; name: string }>();
  private creationIntents: Record<string, string> = {};
  private configQueue: Promise<unknown> = Promise.resolve();
  private workQueue: Promise<unknown> = Promise.resolve();
  private syncQueued = false;
  private dirty = false;
  private stopped = false;
  private readonly ready: Promise<void>;

  constructor(private readonly file: string, private readonly dependencies: MailSplitDependencies) {
    this.ready = this.load();
    // Consumers still receive the load error through get/save/observe; avoid an
    // unhandled rejection if profile initialization has not requested state yet.
    void this.ready.catch(() => undefined);
  }

  async get(): Promise<MailSplitState> {
    await this.ready;
    await this.configQueue;
    return this.snapshot();
  }

  async save(value: unknown): Promise<MailSplitState> {
    const draft = normalizeMailSplitDraft(value);
    await this.ready;
    const operation = this.configure(async () => {
      this.assertRunning();
      const old = draft.id ? this.splits.find((split) => split.id === draft.id) : undefined;
      if (draft.id && !old) throw new Error("This split no longer exists.");
      if (!old && this.splits.length >= MAX_MAIL_SPLITS) throw new Error(`Use at most ${MAX_MAIL_SPLITS} splits per account.`);
      if (this.splits.some((split) => split.id !== draft.id && split.name.toLowerCase() === draft.name.toLowerCase())) throw new Error("A split with that name already exists.");
      let labelName = draft.labelName;
      if (draft.labelId && draft.enabled) {
        // Do not accept a label ID from another account or silently recreate a deleted label.
        const label = (await this.dependencies.listLabels()).find((item) => item.id === draft.labelId);
        if (!label) throw new Error("That HEY label is unavailable in this account. Choose another label.");
        labelName = label.name;
      }
      this.assertRunning();
      const split: MailSplit = { ...normalizeMailSplitDraft({ ...draft, labelName }), id: old?.id ?? randomUUID() };
      const next = old ? this.splits.map((item) => item.id === split.id ? split : item) : [...this.splits, split];
      await this.persist(next);
      this.splits = next;
      this.revisions.set(split.id, (this.revisions.get(split.id) ?? 0) + 1);
      this.retryAfter.delete(split.id);
      this.pendingLabels.delete(split.id);
      if (split.labelId || this.creationIntents[split.id] && this.creationIntents[split.id] !== split.labelName) {
        delete this.creationIntents[split.id];
        await this.persistIntents();
      }
      delete this.errors[split.id];
      this.emit();
    });
    await operation;
    this.scheduleSync();
    return this.snapshot();
  }

  async remove(id: string): Promise<MailSplitState> {
    if (!isMailSplitId(id)) throw new Error("Invalid split ID.");
    await this.ready;
    await this.configure(async () => {
      this.assertRunning();
      const next = this.splits.filter((split) => split.id !== id);
      await this.persist(next);
      this.splits = next;
      this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
      this.retryAfter.delete(id);
      this.pendingLabels.delete(id);
      delete this.creationIntents[id];
      await this.persistIntents();
      delete this.errors[id];
      this.emit();
    });
    // Deleting a split deliberately does not delete or remove any HEY labels.
    return this.snapshot();
  }

  /** Loads an existing link once; listing does not enqueue rule writes. */
  async listingState(id: string): Promise<MailSplitState> {
    if (!isMailSplitId(id)) throw new Error("Choose a valid split.");
    await this.ready;
    await this.configQueue;
    this.assertRunning();
    const current = this.splits.find((item) => item.id === id);
    if (!current) throw new Error("This split no longer exists.");
    // Rendering already-known membership must not wait behind unrelated label
    // writes. Cold memberships stay serialized with writes to avoid overwriting
    // a newer confirmed membership with a read begun before the write.
    if (!current.labelId || this.labels.has(current.labelId)) return this.snapshot();
    await this.enqueue(async () => {
      await this.configQueue;
      this.assertRunning();
      const split = this.splits.find((item) => item.id === id);
      if (!split) throw new Error("This split no longer exists.");
      if (split.labelId && !this.labels.has(split.labelId)) {
        let membership: Membership;
        try { membership = await this.readMembership(split.labelId); }
        catch { throw new Error("Could not load this split's linked label. Refresh and check its HEY label before continuing."); }
        this.assertRunning();
        if (this.splits.find((item) => item.id === id)?.labelId !== split.labelId) throw new Error("This split changed. Refresh to continue.");
        this.labels.set(split.labelId, membership);
        this.emit();
      }
    });
    return this.snapshot();
  }

  /** Explicit manual filing also works for paused splits; future rules are additive. */
  async addToSplit(value: unknown): Promise<MailSplitState> {
    const request = normalizeAddToSplit(value);
    await this.ready;
    await this.enqueue(async () => {
      await this.configQueue;
      this.assertRunning();
      let split = this.splits.find((item) => item.id === request.splitId);
      if (!split) throw new Error("This split no longer exists.");
      const revision = this.revisions.get(split.id) ?? 0;
      // Validate the combined rule limits before any external mutation.
      const merged = normalizeMailSplitDraft({ ...split,
        people: [...new Set([...split.people, ...(request.people ?? [])])],
        domains: [...new Set([...split.domains, ...(request.domains ?? [])])],
      });
      const check = () => {
        const current = this.current(request.splitId, revision);
        if (!current) throw new Error("Split settings changed. Refresh before continuing.");
        return current;
      };
      let labelId = split.labelId;
      const createdPostings = new Set<string>();
      try {
        let membership = labelId ? this.labels.get(labelId) : undefined;
        if (!labelId) {
          const matches = (await this.dependencies.listLabels()).filter((item) => item.name.toLowerCase() === split!.labelName.toLowerCase());
          check();
          if (matches.length > 1) throw new Error("Split label name is ambiguous. Choose the existing label explicitly.");
          let label = matches[0] ?? this.pendingLabels.get(split.id);
          if (!label) {
            if (this.creationIntents[split.id] === split.labelName) throw new Error("Split label creation could not be confirmed. Choose its existing HEY label in split settings before retrying.");
            await this.configure(async () => {
              const current = check();
              this.creationIntents[current.id] = current.labelName;
              await this.persistIntents();
            });
            check();
            const firstBatch = request.postingIds.slice(0, BATCH_SIZE);
            label = await this.dependencies.createLabel(split.labelName, firstBatch);
            firstBatch.forEach((id) => createdPostings.add(id));
          }
          if (!isHeyId(label.id)) throw new Error("Split label returned an invalid ID. Choose the label in split settings.");
          labelId = label.id;
          this.pendingLabels.set(split.id, label);
          const linked = label;
          await this.configure(async () => {
            const current = check();
            const next = this.splits.map((item) => item.id === current.id ? { ...item, labelId: linked.id, labelName: linked.name } : item);
            await this.persist(next);
            this.splits = next;
            this.pendingLabels.delete(current.id);
            delete this.creationIntents[current.id];
            await this.persistIntents();
            this.emit();
          });
          split = check();
        }
        if (!membership) {
          membership = await this.readMembership(labelId);
          check();
          this.labels.set(labelId, membership);
        }
        const missing = request.postingIds.filter((id) => !membership!.postings.has(id) && !createdPostings.has(id));
        for (let index = 0; index < missing.length; index += BATCH_SIZE) {
          check();
          const ids = missing.slice(index, index + BATCH_SIZE);
          await this.dependencies.addLabel(labelId, ids);
          for (const id of ids) {
            membership.postings.add(id);
            const posting = this.observed.get(id);
            if (posting) membership.topics.add(splitTopicId(posting));
          }
        }
        // Source rows may come from search or a library, so resolve authoritative
        // topic IDs instead of assuming selected posting IDs are conversation IDs.
        const confirmed = await this.readMembership(labelId);
        check();
        this.labels.set(labelId, confirmed);
        if (request.postingIds.some((id) => !confirmed.postings.has(id))) throw new Error("Split labeling could not be confirmed. Refresh before retrying.");
        await this.configure(async () => {
          const current = check();
          const next = this.splits.map((item) => item.id === current.id ? { ...item, people: merged.people, domains: merged.domains } : item);
          await this.persist(next);
          this.splits = next;
          this.revisions.set(current.id, revision + 1);
          this.retryAfter.delete(current.id);
          delete this.errors[current.id];
          this.emit();
        });
      } catch (cause) {
        // A failed batch may have committed. Read back before any subsequent retry;
        // never repeat an unconfirmed create or save broader rules on partial success.
        if (labelId) {
          this.labels.delete(labelId);
          try { this.labels.set(labelId, await this.readMembership(labelId)); } catch { /* Retry must reload membership. */ }
        }
        const error = new Error(cause instanceof Error && cause.message.startsWith("Split ") ? cause.message
          : "Split add could not be completed. Some conversations may already have been added. Refresh and check the linked label before retrying.");
        this.fail(request.splitId, error);
        throw error;
      }
    });
    this.scheduleSync();
    return this.snapshot();
  }

  async preview(value: unknown, postings?: readonly ImboxPosting[]): Promise<MailSplitPreview> {
    const draft = normalizeMailSplitDraft(value);
    await this.ready;
    const matches: ImboxPosting[] = [];
    const topics = new Set<string>();
    const matchedTopics = new Set<string>();
    for (const posting of postings ?? this.observed.values()) {
      const topic = splitTopicId(posting);
      topics.add(topic);
      if (matchedTopics.has(topic) || !matchesMailSplit(posting, draft, this.dependencies.ownEmail) && !this.labels.get(draft.labelId ?? "")?.topics.has(topic)) continue;
      matchedTopics.add(topic);
      matches.push(posting);
    }
    return structuredClone({
      count: matches.length,
      scannedCount: topics.size,
      samples: matches.slice(0, 8),
      scope: `Matches among ${topics.size} conversations currently loaded from Imbox, Feed, Paper Trail, Set Aside, Reply Later, and Bubble Up. Older mail is checked as it loads.`,
    });
  }

  /** Observe any of the six supported mailboxes, excluding Trash, Spam, and Screener. */
  async observe(postings: ImboxPosting[]): Promise<void> {
    await this.ready;
    if (this.stopped) return;
    for (const posting of postings) {
      if (!isHeyId(posting.id) || posting.topicId !== undefined && !isHeyId(posting.topicId)) continue;
      this.observed.delete(posting.id);
      this.observed.set(posting.id, structuredClone(posting));
    }
    while (this.observed.size > MAX_OBSERVED) this.observed.delete(this.observed.keys().next().value!);
    this.scheduleSync();
    await this.idle();
  }

  /** Drop moved/deleted rows, or invalidate a stale mailbox snapshot before a fresh scan. */
  forget(postingIds?: readonly string[]): void {
    if (postingIds) postingIds.forEach((id) => this.observed.delete(id));
    else this.observed.clear();
  }

  async replaceObserved(postings: ImboxPosting[]): Promise<void> {
    await this.ready;
    this.forget();
    await this.observe(postings);
  }

  /** Paginated read-only refresh. An incomplete response never authorizes writes. */
  async refreshMemberships(): Promise<MailSplitState> {
    await this.ready;
    await this.enqueue(async () => {
      if (this.stopped) return;
      const refreshed = new Set<string>();
      for (const split of [...this.splits]) {
        if (!split.labelId) {
          // Explicit Retry may reconcile a label that became visible after an
          // uncertain create. The durable intent still prevents another create.
          if (split.enabled) this.retryAfter.delete(split.id);
          continue;
        }
        if (refreshed.has(split.labelId)) continue;
        const revision = this.revisions.get(split.id) ?? 0;
        try {
          const membership = await this.readMembership(split.labelId);
          if (this.stopped) return;
          if (!this.current(split.id, revision)) continue;
          this.labels.set(split.labelId, membership);
          refreshed.add(split.labelId);
          this.retryAfter.delete(split.id);
          delete this.errors[split.id];
        } catch (error) {
          this.fail(split.id, error);
        }
      }
      this.emit();
    });
    this.scheduleSync();
    return this.snapshot();
  }

  stop(): void {
    this.stopped = true;
    this.dirty = false;
  }

  /** Used for orderly shutdown and deterministic tests; never starts background timers. */
  async idle(): Promise<void> {
    await this.ready;
    let queue: Promise<unknown>;
    do { queue = this.workQueue; await queue; await this.configQueue; } while (queue !== this.workQueue);
  }

  private snapshot(): MailSplitState {
    return structuredClone({
      splits: this.splits,
      errors: this.errors,
      ...(this.dependencies.ownEmail ? { ownEmail: this.dependencies.ownEmail } : {}),
      memberships: Object.fromEntries(this.splits.map((split) => [split.id, split.labelId ? [...(this.labels.get(split.labelId)?.topics ?? [])] : []])),
    });
  }

  private emit(): void {
    if (!this.stopped) this.dependencies.onChange?.(this.snapshot());
  }

  private async load(): Promise<void> {
    try {
      const saved = JSON.parse(await readFile(`${this.file}.pending-labels.json`, "utf8")) as unknown;
      if (!saved || typeof saved !== "object" || Array.isArray(saved) || Object.keys(saved).length > MAX_MAIL_SPLITS
        || Object.entries(saved).some(([id, name]) => !isMailSplitId(id) || typeof name !== "string" || !name || name.length > 120)) throw new Error("Invalid pending split label state.");
      this.creationIntents = saved as Record<string, string>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Could not read pending split label state. No labels were created.", { cause: error });
    }
    let raw: unknown;
    try { raw = JSON.parse(await readFile(this.file, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw new Error("Could not read split settings. Your existing file was left unchanged.", { cause: error }); }
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || (raw as { version?: unknown }).version !== 1 || !Array.isArray((raw as { splits?: unknown }).splits)) {
      throw new Error("Invalid split settings. Your existing file was left unchanged.");
    }
    const values = (raw as { splits: unknown[] }).splits;
    if (values.length > MAX_MAIL_SPLITS) throw new Error("Too many saved splits.");
    const ids = new Set<string>();
    this.splits = values.map((value) => {
      const draft = normalizeMailSplitDraft(value);
      if (!draft.id || ids.has(draft.id)) throw new Error("Invalid saved split ID.");
      ids.add(draft.id);
      return { ...draft, id: draft.id };
    });
  }

  private configure<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.configQueue.then(operation);
    this.configQueue = result.catch(() => undefined);
    return result;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.workQueue.then(operation);
    this.workQueue = result.catch(() => undefined);
    return result;
  }

  private async persist(splits: MailSplit[]): Promise<void> {
    await this.writeAtomic(this.file, { version: 1, splits });
  }

  private async persistIntents(): Promise<void> {
    await this.writeAtomic(`${this.file}.pending-labels.json`, this.creationIntents);
  }

  private async writeAtomic(file: string, value: unknown): Promise<void> {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(temporary, file);
  }

  private assertRunning(): void {
    if (this.stopped) throw new Error("This account is no longer active. Reopen split settings and try again.");
  }

  private current(id: string, revision: number): MailSplit | undefined {
    if (this.stopped || (this.revisions.get(id) ?? 0) !== revision) return undefined;
    return this.splits.find((split) => split.id === id);
  }

  private scheduleSync(): void {
    if (this.stopped) return;
    this.dirty = true;
    if (this.syncQueued) return;
    this.syncQueued = true;
    void this.enqueue(async () => {
      try {
        while (this.dirty && !this.stopped) {
          this.dirty = false;
          await this.sync();
        }
      } finally { this.syncQueued = false; }
    }).catch(() => undefined);
  }

  private fail(id: string, error: unknown): void {
    if (this.stopped || !this.splits.some((split) => split.id === id)) return;
    // Do not expose raw CLI output, which can contain mail data or authentication details.
    this.errors[id] = error instanceof Error && error.message.startsWith("Split ")
      ? error.message
      : "Could not sync this split with HEY. Check the connection and its linked label, then retry.";
    this.retryAfter.set(id, (this.dependencies.now?.() ?? Date.now()) + RETRY_DELAY_MS);
    this.emit();
  }

  private async readMembership(labelId: string): Promise<Membership> {
    const membership: Membership = { topics: new Set(), postings: new Set() };
    const cursors = new Set<string>();
    let page: string | undefined;
    for (let count = 0; count < MAX_MEMBERSHIP_PAGES; count += 1) {
      if (this.stopped) throw new Error("Split sync stopped.");
      const result = await this.dependencies.listLabelPage(labelId, page);
      for (const posting of result.postings) {
        if (!isHeyId(posting.id) || posting.topicId !== undefined && !isHeyId(posting.topicId)) throw new Error("Split label returned invalid conversation IDs.");
        membership.topics.add(splitTopicId(posting));
        membership.postings.add(posting.id);
      }
      if (!result.nextPage) return membership;
      if (cursors.has(result.nextPage)) throw new Error("Split label history could not finish loading. Retry before syncing.");
      cursors.add(result.nextPage);
      page = result.nextPage;
    }
    throw new Error("Split label has too much history to load safely. Choose a smaller label; no automatic labels were applied.");
  }

  private async sync(): Promise<void> {
    await this.configQueue;
    for (const initial of [...this.splits]) {
      if (!initial.enabled || this.stopped || (this.retryAfter.get(initial.id) ?? 0) > (this.dependencies.now?.() ?? Date.now())) continue;
      const revision = this.revisions.get(initial.id) ?? 0;
      let split = this.current(initial.id, revision);
      if (!split?.enabled) continue;
      try {
        let membership = split.labelId ? this.labels.get(split.labelId) : undefined;
        if (split.labelId && !membership) {
          membership = await this.readMembership(split.labelId);
          if (!this.current(split.id, revision)?.enabled) continue;
          this.labels.set(split.labelId, membership);
          this.emit();
        }
        let candidates = [...this.observed.values()].filter((posting) => matchesMailSplit(posting, split!, this.dependencies.ownEmail) && !membership?.postings.has(posting.id));
        if (!candidates.length) continue;
        if (!split.labelId) {
          let label = this.pendingLabels.get(split.id);
          if (!label) {
            const sameName = (await this.dependencies.listLabels()).filter((item) => item.name.toLowerCase() === split!.labelName.toLowerCase());
            if (!this.current(split.id, revision)?.enabled) continue;
            if (sameName.length > 1) throw new Error("Split label name is ambiguous. Choose the existing label explicitly.");
            if (sameName.length === 1) {
              label = sameName[0]!;
              if (!isHeyId(label.id)) throw new Error("Split label returned an invalid ID.");
              membership = await this.readMembership(label.id);
            } else {
              if (!this.current(split.id, revision)?.enabled) continue;
              if (this.creationIntents[split.id] === split.labelName) throw new Error("Split label creation could not be confirmed. Choose its existing HEY label in split settings before retrying.");
              const creating = split;
              await this.configure(async () => {
                if (!this.current(creating.id, revision)?.enabled) return;
                this.creationIntents[creating.id] = creating.labelName;
                await this.persistIntents();
              });
              if (!this.current(split.id, revision)?.enabled) continue;
              const firstBatch = this.currentCandidates(candidates, split).slice(0, BATCH_SIZE);
              if (!firstBatch.length) {
                await this.configure(async () => {
                  delete this.creationIntents[creating.id];
                  await this.persistIntents();
                });
                continue;
              }
              label = await this.dependencies.createLabel(split.labelName, firstBatch.map((posting) => posting.id));
              if (!isHeyId(label.id)) throw new Error("Split label was created without a valid ID. Choose the label in split settings before retrying.");
              membership = { postings: new Set(firstBatch.map((posting) => posting.id)), topics: new Set(firstBatch.map(splitTopicId)) };
            }
            this.pendingLabels.set(split.id, label);
          }
          const linked = label;
          this.labels.set(linked.id, membership ?? { topics: new Set(), postings: new Set() });
          await this.configure(async () => {
            // Persist a newly created ID even if the split was disabled while HEY
            // was responding. Never replace an explicitly changed/deleted link.
            const current = this.splits.find((item) => item.id === initial.id);
            if (!current || current.labelId || current.labelName !== initial.labelName) return;
            const normalized = normalizeMailSplitDraft({ ...current, labelId: linked.id, labelName: linked.name });
            const next = this.splits.map((item) => item.id === current.id ? { ...normalized, id: current.id } : item);
            await this.persist(next);
            this.splits = next;
            this.pendingLabels.delete(current.id);
            delete this.creationIntents[current.id];
            await this.persistIntents();
            this.emit();
          });
          split = this.current(initial.id, revision);
          if (!split?.enabled || split.labelId !== linked.id) continue;
          membership = this.labels.get(linked.id)!;
          candidates = candidates.filter((posting) => !membership!.postings.has(posting.id));
        }
        for (let index = 0; index < candidates.length; index += BATCH_SIZE) {
          if (!this.current(split.id, revision)?.enabled) break;
          const batch = this.currentCandidates(candidates.slice(index, index + BATCH_SIZE), split);
          if (!batch.length) continue;
          await this.dependencies.addLabel(split.labelId!, batch.map((posting) => posting.id));
          for (const posting of batch) { membership!.postings.add(posting.id); membership!.topics.add(splitTopicId(posting)); }
        }
        if (this.current(initial.id, revision)) { delete this.errors[initial.id]; this.retryAfter.delete(initial.id); }
        this.emit();
      } catch (error) {
        // The server may have completed a write before a transport error. Fetch
        // authoritative membership before retrying so watcher echoes cannot loop.
        if (split?.labelId) this.labels.delete(split.labelId);
        if (this.current(initial.id, revision)) this.fail(initial.id, error);
      }
    }
  }

  private currentCandidates(candidates: ImboxPosting[], split: MailSplit): ImboxPosting[] {
    return candidates.flatMap((candidate) => {
      const current = this.observed.get(candidate.id);
      return current && matchesMailSplit(current, split, this.dependencies.ownEmail) ? [current] : [];
    });
  }
}
