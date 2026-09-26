import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { isAbsolute, join, parse, resolve, sep } from "node:path";
import type { MailAccountProfile, MailContact, MailThread, ThreadEntry } from "../shared/contracts";

export type MailDiskCachePolicy = { enabled: boolean; maxBytes: number; retentionMs: number };
export type MailDiskCacheProfile = Pick<MailAccountProfile, "key" | "server" | "accountId">;
export type CachedMailThread = { thread: MailThread; cachedAt: number };
export type MailDiskCacheStats = { entries: number; bytes: number };

const DEFAULT_POLICY: MailDiskCachePolicy = { enabled: false, maxBytes: 100 * 1024 * 1024, retentionMs: 7 * 86_400_000 };
const MAX_ENTRY_BYTES = 5 * 1024 * 1024;
const OWNED_FILE = /^[a-f0-9]{32}-\d{1,30}\.json$/;
const TEMP_FILE = /^\.[a-f0-9]{32}-\d{1,30}\.[a-f0-9-]{36}\.tmp$/;
const ID = /^\d{1,30}$/;

function profileKey(profile: MailDiskCacheProfile): string {
  const server = new URL(profile.server);
  if (!["http:", "https:"].includes(server.protocol) || server.origin !== profile.server || !ID.test(profile.accountId)) throw new Error("Invalid mail cache profile.");
  const key = createHash("sha256").update(`${profile.server}\n${profile.accountId}`).digest("hex").slice(0, 32);
  if (key !== profile.key) throw new Error("Invalid mail cache profile key.");
  return key;
}

function policyCopy(policy: MailDiskCachePolicy): MailDiskCachePolicy {
  if (typeof policy.enabled !== "boolean" || !Number.isSafeInteger(policy.maxBytes) || policy.maxBytes < 1
    || !Number.isSafeInteger(policy.retentionMs) || policy.retentionMs < 1) throw new Error("Invalid mail cache limits.");
  return { ...policy };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function contact(value: unknown): MailContact | undefined {
  const source = record(value);
  if (!source || typeof source.name !== "string") return undefined;
  const result: MailContact = { name: source.name };
  for (const key of ["id", "email", "kind", "avatarUrl", "avatarBackgroundColor", "initials"] as const) {
    if (source[key] !== undefined && typeof source[key] !== "string") return undefined;
    if (typeof source[key] === "string") result[key] = source[key];
  }
  return result;
}

// Explicitly copy the main-process mail contract, never paths, downloaded bytes, or arbitrary extra fields.
function validatedThread(value: unknown): MailThread | undefined {
  const source = record(value);
  if (!source || typeof source.topicId !== "string" || !ID.test(source.topicId) || typeof source.subject !== "string"
    || source.attachmentsError !== undefined || !Array.isArray(source.entries) || source.entries.length === 0) return undefined;
  const entries: ThreadEntry[] = [];
  for (const item of source.entries) {
    const entry = record(item);
    const sender = contact(entry?.sender);
    if (!entry || typeof entry.id !== "string" || !ID.test(entry.id) || !sender || typeof entry.body !== "string" || typeof entry.occurredAt !== "string") return undefined;
    const next: ThreadEntry = { id: entry.id, sender, body: entry.body, occurredAt: entry.occurredAt };
    for (const key of ["html", "remoteHtml"] as const) {
      if (entry[key] !== undefined && typeof entry[key] !== "string") return undefined;
      if (typeof entry[key] === "string") next[key] = entry[key];
    }
    if (entry.hasRemoteContent !== undefined) {
      if (typeof entry.hasRemoteContent !== "boolean") return undefined;
      next.hasRemoteContent = entry.hasRemoteContent;
    }
    if (entry.htmlPresentation !== undefined) {
      if (entry.htmlPresentation !== "card" && entry.htmlPresentation !== "document") return undefined;
      next.htmlPresentation = entry.htmlPresentation;
    }
    if (entry.receivedVia !== undefined) {
      if (!Array.isArray(entry.receivedVia) || entry.receivedVia.some((email) => typeof email !== "string")) return undefined;
      next.receivedVia = [...entry.receivedVia];
    }
    if (entry.recipients !== undefined) {
      const recipients = record(entry.recipients);
      if (!recipients) return undefined;
      next.recipients = { to: [], cc: [], bcc: [] };
      for (const key of ["to", "cc", "bcc"] as const) {
        const values = recipients[key];
        if (!Array.isArray(values)) return undefined;
        for (const value of values) {
          const recipient = contact(value);
          if (!recipient) return undefined;
          next.recipients[key].push(recipient);
        }
      }
    }
    if (entry.attachments !== undefined) {
      if (!Array.isArray(entry.attachments)) return undefined;
      next.attachments = [];
      for (const value of entry.attachments) {
        const file = record(value);
        if (!file || typeof file.id !== "string" || typeof file.messageId !== "string" || file.messageId !== next.id
          || typeof file.filename !== "string" || typeof file.contentType !== "string"
          || (file.byteSize !== undefined && (!Number.isSafeInteger(file.byteSize) || (file.byteSize as number) < 0))) return undefined;
        next.attachments.push({ id: file.id, messageId: file.messageId, filename: file.filename, contentType: file.contentType,
          ...(typeof file.byteSize === "number" ? { byteSize: file.byteSize } : {}) });
      }
    }
    entries.push(next);
  }
  return { topicId: source.topicId, subject: source.subject, entries };
}

type CacheFile = { name: string; bytes: number; cachedAt: number; accessedAt: number };

/** One instance owns the dedicated cache root and the aggregate budget for every account. */
export class MailDiskCache {
  private policy: MailDiskCachePolicy;
  private queue: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  private configured = false;
  private index?: Map<string, CacheFile>;
  private readonly root: string;

  constructor(root: string, policy: MailDiskCachePolicy = DEFAULT_POLICY, private readonly now = Date.now) {
    if (!isAbsolute(root) || resolve(root) === parse(root).root) throw new Error("A dedicated absolute mail cache directory is required.");
    this.root = resolve(root);
    this.policy = policyCopy(policy);
  }

  /** Capture this BEFORE a network request; pass it back to write after the result is verified. */
  get generation(): number { return this.epoch; }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async directory(create = false): Promise<boolean> {
    let current = parse(this.root).root;
    for (const component of this.root.slice(current.length).split(sep)) {
      current = join(current, component);
      try {
        const info = await lstat(current);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe mail cache directory.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (!create) return false;
        await mkdir(current, { mode: 0o700 });
      }
    }
    await chmod(this.root, 0o700);
    return true;
  }

  private async scanFiles(): Promise<CacheFile[]> {
    if (!await this.directory()) return [];
    const files: CacheFile[] = [];
    for (const name of await readdir(this.root)) {
      if (!OWNED_FILE.test(name) && !TEMP_FILE.test(name)) continue;
      const info = await lstat(join(this.root, name));
      // No write is active during this serialized scan. These are abandoned writes.
      if (TEMP_FILE.test(name)) {
        if (info.isFile() || info.isSymbolicLink()) await unlink(join(this.root, name));
        continue;
      }
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) continue;
      files.push({ name, bytes: info.size, cachedAt: info.mtimeMs, accessedAt: info.atimeMs });
    }
    return files;
  }

  private async ensureIndex(): Promise<Map<string, CacheFile>> {
    this.index ??= new Map((await this.scanFiles()).map((file) => [file.name, file]));
    return this.index;
  }

  private async removeFile(name: string): Promise<void> {
    try { await unlink(join(this.root, name)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    this.index?.delete(name);
  }

  private async prune(): Promise<void> {
    let bytes = 0;
    const retained: CacheFile[] = [];
    const now = this.now();
    const index = await this.ensureIndex();
    if (!await this.directory()) { index.clear(); return; }
    for (const file of index.values()) {
      if (file.bytes > MAX_ENTRY_BYTES || file.cachedAt > now + 1_000 || now - file.cachedAt >= this.policy.retentionMs) await this.removeFile(file.name);
      else { retained.push(file); bytes += file.bytes; }
    }
    if (bytes <= this.policy.maxBytes) return;
    for (const file of retained.sort((a, b) => a.accessedAt - b.accessedAt || a.cachedAt - b.cachedAt || a.name.localeCompare(b.name))) {
      if (bytes <= this.policy.maxBytes) break;
      await this.removeFile(file.name);
      bytes -= file.bytes;
    }
  }

  configure(policy: MailDiskCachePolicy): Promise<void> {
    const next = policyCopy(policy);
    if (this.configured && next.enabled === this.policy.enabled && next.maxBytes === this.policy.maxBytes && next.retentionMs === this.policy.retentionMs) return this.queue.then(() => undefined);
    const initial = !this.configured;
    this.configured = true;
    this.policy = next;
    this.epoch++;
    return this.serial(async () => {
      if (initial) this.index = undefined;
      if (next.enabled) await this.prune();
      else await this.clearFiles();
    });
  }

  read(profile: MailDiskCacheProfile, topicId: string): Promise<CachedMailThread | undefined> {
    const generation = this.epoch;
    return this.serial(async () => {
      if (!this.policy.enabled || generation !== this.epoch) return undefined;
      try {
        const key = profileKey(profile);
        if (!ID.test(topicId) || !await this.directory()) return undefined;
        const index = await this.ensureIndex();
        const name = `${key}-${topicId}.json`;
        const path = join(this.root, name);
        const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const info = await file.stat();
          if (!info.isFile() || info.nlink !== 1 || info.size > MAX_ENTRY_BYTES) return undefined;
          const now = this.now();
          if (info.mtimeMs > now + 1_000 || now - info.mtimeMs >= this.policy.retentionMs) {
            await this.removeFile(name);
            return undefined;
          }
          const envelope = record(JSON.parse(await file.readFile("utf8")));
          const thread = validatedThread(envelope?.thread);
          if (!envelope || envelope.version !== 1 || envelope.profileKey !== key || envelope.server !== profile.server
            || envelope.accountId !== profile.accountId || !Number.isSafeInteger(envelope.cachedAt)
            || (envelope.cachedAt as number) > now || now - (envelope.cachedAt as number) >= this.policy.retentionMs || thread?.topicId !== topicId) return undefined;
          if (generation !== this.epoch || !this.policy.enabled) return undefined;
          await file.utimes(new Date(now), info.mtime);
          if (generation !== this.epoch || !this.policy.enabled) return undefined;
          index.set(name, { name, bytes: info.size, cachedAt: info.mtimeMs, accessedAt: now });
          return { thread, cachedAt: envelope.cachedAt as number };
        } finally { await file.close(); }
      } catch { return undefined; } // Caching must never make an otherwise readable conversation fail.
    });
  }

  write(profile: MailDiskCacheProfile, thread: MailThread, generation: number): Promise<boolean> {
    return this.serial(async () => {
      if (!this.policy.enabled || generation !== this.epoch) return false;
      let temporary: string | undefined;
      try {
        const key = profileKey(profile);
        const validated = validatedThread(thread);
        if (!validated) return false;
        const cachedAt = this.now();
        const data = JSON.stringify({ version: 1, profileKey: key, server: profile.server, accountId: profile.accountId, cachedAt, thread: validated });
        const bytes = Buffer.byteLength(data);
        if (bytes > Math.min(MAX_ENTRY_BYTES, this.policy.maxBytes)) return false;
        await this.directory(true);
        const index = await this.ensureIndex();
        const name = `${key}-${validated.topicId}.json`;
        const path = join(this.root, name);
        temporary = join(this.root, `.${key}-${validated.topicId}.${randomUUID()}.tmp`);
        const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        try {
          await file.writeFile(data, "utf8");
          await file.utimes(new Date(cachedAt), new Date(cachedAt));
        } finally { await file.close(); }
        // clear/configure/remove advance the epoch synchronously, including during the awaited write.
        if (!this.policy.enabled || generation !== this.epoch) return false;
        await this.directory();
        await rename(temporary, path);
        temporary = undefined;
        index.set(name, { name, bytes, cachedAt, accessedAt: cachedAt });
        await this.prune();
        return generation === this.epoch && this.policy.enabled;
      } catch { return false; }
      finally { if (temporary) await unlink(temporary).catch(() => undefined); }
    });
  }

  remove(profile: MailDiskCacheProfile, topicId: string): Promise<void> {
    const key = profileKey(profile);
    if (!ID.test(topicId)) return Promise.reject(new Error("Invalid mail cache topic ID."));
    this.epoch++;
    return this.serial(async () => {
      if (!await this.directory()) return;
      await this.removeFile(`${key}-${topicId}.json`);
    });
  }

  private async clearFiles(profile?: string): Promise<void> {
    if (!await this.directory()) { this.index?.clear(); return; }
    for (const name of await readdir(this.root)) {
      if (!OWNED_FILE.test(name) && !TEMP_FILE.test(name)) continue;
      if (profile && !name.startsWith(`${profile}-`) && !name.startsWith(`.${profile}-`)) continue;
      const path = join(this.root, name);
      const info = await lstat(path);
      if (info.isFile() || info.isSymbolicLink()) await this.removeFile(name);
    }
    for (const name of this.index?.keys() ?? []) {
      if (!profile || name.startsWith(`${profile}-`)) this.index?.delete(name);
    }
  }

  clear(): Promise<void> {
    this.epoch++;
    return this.serial(() => this.clearFiles());
  }

  clearProfile(profile: MailDiskCacheProfile): Promise<void> {
    const key = profileKey(profile);
    this.epoch++;
    return this.serial(() => this.clearFiles(key));
  }

  stats(): Promise<MailDiskCacheStats> {
    return this.serial(async () => {
      // Settings' explicit usage check also reconciles external changes; regular opens do not scan.
      this.index = new Map((await this.scanFiles()).map((file) => [file.name, file]));
      await this.prune();
      const files = [...this.index.values()];
      return { entries: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
    });
  }
}
