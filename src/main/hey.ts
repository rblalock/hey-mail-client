import type {
  BulkReplyPreview, BulkReplySendRequest, BulkReplySendResult, BulkReplyUndoResult, ImboxPosting, ImboxResult, MailContact, MailContactDetail, MailDraft, MailDraftUpdate, MailLibraryKind, MailLibraryResult, MailMutationRequest, MailMutationResult,
  MailLibrarySourceResult, MailOrganization, MailOrganizationItem, MailOrganizationMutationRequest, MailOrganizationTarget, MailOverview, MailReplyContext, MailSearchFilters, MailSearchOption, MailSearchRequest, MailSearchResult, MailSendRequest, MailSendResult, MailThread, MailThreadListing, MailboxKey, SetAsideGroupMutationRequest,
  ScreenerDecisionRequest, ScreenerResult, ThreadEntry, MailLibraryThreads,
} from "../shared/contracts";
import { parseThreadHtmlDocument } from "./email-html";
import { listMailAttachments, withMailAttachments } from "./mail-attachments";
import { applyExplicitSenderName, mailContactFrom, resolveMailSender } from "./mail-identity";
import { findExecutable, runFile, runFileWithInput } from "./profile-process";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function decodeEntity(entity: string): string {
  const names: Record<string, string> = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
  };
  if (entity.startsWith("#x") || entity.startsWith("#X")) {
    const code = Number.parseInt(entity.slice(2), 16);
    return Number.isFinite(code) ? String.fromCodePoint(code) : `&${entity};`;
  }
  if (entity.startsWith("#")) {
    const code = Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : `&${entity};`;
  }
  return names[entity.toLowerCase()] ?? `&${entity};`;
}

export function readableText(value: string, options: { preserveMarkdownBreaks?: boolean } = {}): string {
  const repeatedWhitespace = options.preserveMarkdownBreaks ? /[ \t]{2,}(?!\n)/g : /[ \t]{2,}/g;
  let result = value
    .replace(/<(https?:\/\/[^>\s]+|mailto:[^>\s]+)>/gi, "$1")
    .replace(/\\+(?=<\/?[a-z])/gi, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|li|blockquote|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/&(#x?[\da-f]+|[a-z]+);/gi, (_match, entity: string) => decodeEntity(entity));
  if (/&(?:#x?[\da-f]+|[a-z]+);/i.test(result)) {
    result = result.replace(/&(#x?[\da-f]+|[a-z]+);/gi, (_match, entity: string) => decodeEntity(entity));
  }
  return result
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, (whitespace) => options.preserveMarkdownBreaks && / {2,}\n$/.test(whitespace) ? "  \n" : "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(repeatedWhitespace, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeHeyTimestamp(value: string): string {
  const timestamp = value.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(timestamp)) return `${timestamp}Z`;
  return timestamp;
}

function newestItem(items: JsonRecord[]): JsonRecord {
  return items.reduce((newest, item) => {
    const itemTime = Date.parse(normalizeHeyTimestamp(stringValue(item.occurred_at, stringValue(item.created_at, stringValue(item.updated_at)))));
    const newestTime = Date.parse(normalizeHeyTimestamp(stringValue(newest.occurred_at, stringValue(newest.created_at, stringValue(newest.updated_at)))));
    if (!Number.isFinite(itemTime)) return newest;
    return !Number.isFinite(newestTime) || itemTime > newestTime ? item : newest;
  }, items[0] ?? {});
}

function parseJson(stdout: string): JsonRecord {
  const parsed: unknown = JSON.parse(stdout);
  return record(parsed);
}

function envelopeData(payload: JsonRecord): JsonRecord {
  return record(payload.data ?? payload);
}

function postingFrom(value: unknown): ImboxPosting {
  const posting = record(value);
  const contacts = Array.isArray(posting.contacts) ? posting.contacts.map(mailContactFrom) : [];
  const subject = readableText(stringValue(posting.name, "(No subject)")) || "(No subject)";
  const summary = readableText(stringValue(posting.summary));
  const external = contacts.find((contact) => contact.kind !== "User") ?? contacts[0];
  const sender = resolveMailSender(posting, { fallback: external, summary, subject });
  return {
    id: stringValue(posting.id),
    ...(posting.topic_id === undefined ? {} : { topicId: stringValue(posting.topic_id) }),
    ...(stringValue(posting.kind) ? { kind: stringValue(posting.kind) } : {}),
    ...(stringValue(posting.box_group_id) ? { boxGroupId: stringValue(posting.box_group_id) } : {}),
    ...(stringValue(posting.app_url) ? { appUrl: stringValue(posting.app_url) } : {}),
    subject,
    summary,
    seen: posting.seen === true,
    ...(posting.bubbled_up === true ? { bubbledUp: true } : {}),
    createdAt: normalizeHeyTimestamp(stringValue(posting.active_at, stringValue(posting.created_at))),
    contacts,
    ...(Array.isArray(posting.addressed_contacts) ? { addressedContacts: posting.addressed_contacts.map(mailContactFrom) } : {}),
    sender,
    visibleEntryCount: numberValue(posting.visible_entry_count, 1),
  };
}

function authFailure(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : String(error);
  return /auth|log[ -]?in|unauthori[sz]ed|credential/i.test(detail);
}

export async function listImbox(env: NodeJS.ProcessEnv = process.env): Promise<ImboxResult> {
  return listMailbox("imbox", env);
}

const MAILBOXES = new Set<MailboxKey>(["imbox", "feedbox", "trailbox", "asidebox", "laterbox", "bubblebox"]);
const MOVE_DESTINATIONS = new Set<MailboxKey>(["imbox", "feedbox", "trailbox", "asidebox", "laterbox"]);
const SCREENER_DESTINATIONS = new Set<MailboxKey>(["imbox", "feedbox", "trailbox"]);

export function mailboxCommand(box: MailboxKey): string[] {
  return box === "asidebox" ? ["set-aside", "view", "--all", "--json"] : ["box", "view", box, "--all", "--json"];
}

export async function listMailbox(box: MailboxKey, env: NodeJS.ProcessEnv = process.env): Promise<ImboxResult> {
  if (!MAILBOXES.has(box)) throw new Error("Invalid HEY mailbox.");
  const executable = await findExecutable("hey", env);
  if (!executable) {
    return {
      status: "unavailable",
      boxKey: box,
      boxName: "Imbox",
      postings: [],
      detail: "HEY CLI is not installed or is not visible to this graphical session.",
    };
  }

  try {
    const { stdout } = await runFile(executable, mailboxCommand(box), {
      env,
      timeoutMs: 30_000,
    });
    return parseImboxJson(stdout, box);
  } catch (error) {
    return {
      status: authFailure(error) ? "needs-auth" : "unavailable",
      boxKey: box,
      boxName: "Imbox",
      postings: [],
      detail: error instanceof Error ? error.message : "Unable to read the Imbox.",
    };
  }
}

export function parseImboxJson(stdout: string, boxKey: MailboxKey = "imbox"): ImboxResult {
  const data = envelopeData(parseJson(stdout));
  const postings = Array.isArray(data.postings) ? data.postings.map(postingFrom) : [];
  return {
    status: "ready",
    boxKey,
    boxName: stringValue(data.name, "Imbox"),
    ...(data.next_page === undefined ? {} : { nextPage: stringValue(data.next_page) }),
    postings,
  };
}

const SEARCH_PAGE_SIZE = 10;
const SEARCH_TEXT_FIELDS = ["query", "required", "any", "none", "exact", "from", "to", "subject", "label"] as const;
const SEARCH_BOXES = new Set(["imbox", "feed", "papertrail", "trash"]);
const SEARCH_ATTACHMENTS = new Set(["any", "images", "pdfs", "calendar_invites", "documents", "spreadsheets", "presentations", "media", "zip_files"]);

function cleanSearchValue(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`Invalid HEY search ${label}.`);
  if (value.length > 500 || /[\r\n\0]/.test(value)) throw new Error(`Invalid HEY search ${label}.`);
  const result = value.trim();
  if (!result) return undefined;
  return result;
}

export function normalizeSearchRequest(request: MailSearchRequest): MailSearchRequest {
  const normalized: MailSearchRequest = {};
  for (const field of SEARCH_TEXT_FIELDS) {
    const value = cleanSearchValue(request[field], field);
    if (value) normalized[field] = value;
  }
  const date = cleanSearchValue(request.date, "date");
  const box = cleanSearchValue(request.box, "box");
  const attachment = cleanSearchValue(request.attachment, "attachment");
  if (date) {
    if (!/^(last_(?:7|30|90)_days|\d{4})$/.test(date)) throw new Error("Invalid HEY search date.");
    normalized.date = date;
  }
  if (box) {
    if (!SEARCH_BOXES.has(box)) throw new Error("Invalid HEY search box.");
    normalized.box = box;
  }
  if (attachment) {
    if (!SEARCH_ATTACHMENTS.has(attachment)) throw new Error("Invalid HEY search attachment type.");
    normalized.attachment = attachment;
  }
  const page = request.page ?? 1;
  if (!Number.isInteger(page) || page < 1 || page > 10_000) throw new Error("Invalid HEY search page.");
  normalized.page = page;
  if (!Object.entries(normalized).some(([key, value]) => key !== "page" && Boolean(value))) throw new Error("Enter a HEY search or choose a filter.");
  return normalized;
}

export function searchCommand(request: MailSearchRequest): string[] {
  const normalized = normalizeSearchRequest(request);
  const args = ["search"];
  if (normalized.query) args.push(normalized.query);
  const flags: Array<[keyof MailSearchRequest, string]> = [
    ["required", "--required"], ["any", "--any"], ["none", "--none"], ["exact", "--exact"],
    ["from", "--from"], ["to", "--to"], ["subject", "--subject"], ["date", "--date"],
    ["box", "--in"], ["label", "--label"], ["attachment", "--attachment"],
  ];
  for (const [key, flag] of flags) {
    const value = normalized[key];
    if (typeof value === "string") args.push(flag, value);
  }
  if ((normalized.page ?? 1) > 1) args.push("--page", String(normalized.page));
  args.push("--json");
  return args;
}

export function parseSearchJson(request: MailSearchRequest, stdout: string): MailSearchResult {
  const payload = parseJson(stdout);
  const raw = payload.data ?? payload;
  const values = Array.isArray(raw) ? raw : [];
  const meta = record(payload.meta);
  return {
    query: request.query?.trim() ?? "",
    page: numberValue(meta.page, request.page ?? 1),
    hasMore: values.length >= SEARCH_PAGE_SIZE,
    postings: values.map((value, index) => {
      const item = record(value);
      const messages = Array.isArray(item.messages) ? item.messages.map(record) : [];
      const latest = newestItem(messages);
      const topicId = stringValue(item.topic_id);
      const subject = readableText(stringValue(item.subject, "(No subject)")) || "(No subject)";
      const summary = readableText(stringValue(latest.summary, stringValue(item.summary)));
      const sender = resolveMailSender(latest, { summary, subject });
      return {
        id: stringValue(item.id, `search-${topicId || index}`),
        ...(topicId ? { topicId } : {}),
        ...(stringValue(item.app_url) ? { appUrl: stringValue(item.app_url) } : {}),
        subject,
        summary,
        seen: true,
        createdAt: stringValue(item.updated_at, stringValue(latest.occurred_at, stringValue(latest.created_at))),
        contacts: [sender],
        sender,
        visibleEntryCount: messages.length || 1,
      };
    }),
  };
}

function searchOption(value: unknown): MailSearchOption | undefined {
  if (typeof value === "string") return { value, title: value };
  const item = record(value);
  const optionValue = stringValue(item.value, stringValue(item.name));
  if (!optionValue) return undefined;
  return { value: optionValue, title: readableText(stringValue(item.title, stringValue(item.name, optionValue))) };
}

export function parseSearchFiltersJson(stdout: string): MailSearchFilters {
  const data = envelopeData(parseJson(stdout));
  const options = (value: unknown): MailSearchOption[] => Array.isArray(value) ? value.map(searchOption).filter((item): item is MailSearchOption => Boolean(item)) : [];
  return {
    boxes: options(data.boxes),
    dates: options(data.dates),
    labels: options(data.labels),
    attachments: options(data.attachments),
  };
}

export async function listSearchFilters(env: NodeJS.ProcessEnv = process.env): Promise<MailSearchFilters> {
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable.");
  const { stdout } = await runFile(executable, ["search", "filters", "--json"], { env, timeoutMs: 20_000 });
  return parseSearchFiltersJson(stdout);
}

export async function searchMail(request: MailSearchRequest, env: NodeJS.ProcessEnv = process.env): Promise<MailSearchResult> {
  const normalized = normalizeSearchRequest(request);
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable.");
  const { stdout } = await runFile(executable, searchCommand(normalized), { env, timeoutMs: 30_000 });
  return parseSearchJson(normalized, stdout);
}

export function parseScreenerJson(stdout: string): ScreenerResult {
  const payload = parseJson(stdout);
  const raw = payload.data ?? payload;
  const values = Array.isArray(raw) ? raw : [];
  return {
    status: "ready",
    entries: values.map((value) => {
      const item = record(value);
      const subject = readableText(stringValue(item.subject, "(No subject)")) || "(No subject)";
      const summary = readableText(stringValue(item.summary));
      const fallback = mailContactFrom(item);
      const sender = resolveMailSender(item, { fallback, summary, subject });
      return {
        id: stringValue(item.id),
        topicId: stringValue(item.topic_id),
        sender,
        subject,
        summary,
      };
    }),
  };
}

export async function listScreener(env: NodeJS.ProcessEnv = process.env): Promise<ScreenerResult> {
  const executable = await findExecutable("hey", env);
  if (!executable) return { status: "unavailable", entries: [], detail: "HEY CLI is unavailable." };
  try {
    const { stdout } = await runFile(executable, ["screener", "list", "--json"], { env, timeoutMs: 20_000 });
    return parseScreenerJson(stdout);
  } catch (error) {
    return { status: authFailure(error) ? "needs-auth" : "unavailable", entries: [], detail: error instanceof Error ? error.message : "Unable to read The Screener." };
  }
}

export async function getMailOverview(env: NodeJS.ProcessEnv = process.env): Promise<MailOverview> {
  const [screener, later] = await Promise.all([
    listScreener(env),
    listMailbox("laterbox", env),
  ]);
  return {
    screener,
    replyLater: {
      count: later.status === "ready" ? later.postings.length : 0,
      ...(later.status === "ready" && later.postings[0] ? { latest: later.postings[0] } : {}),
    },
  };
}

export async function decideScreener(request: ScreenerDecisionRequest, env: NodeJS.ProcessEnv = process.env): Promise<{ message: string }> {
  if (!/^\d+$/.test(request.id)) throw new Error("Invalid HEY clearance ID.");
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable.");
  const args = ["screener", request.decision, request.id];
  if (request.decision === "approve" && request.destination) {
    if (!SCREENER_DESTINATIONS.has(request.destination)) throw new Error("Choose Imbox, The Feed, or Paper Trail for this sender.");
    args.push("--box", request.destination);
  }
  if (request.decision === "approve" && request.seen) args.push("--seen");
  if (request.decision === "deny" && request.spam) args.push("--spam");
  args.push("--json");
  const { stdout } = await runFile(executable, args, { env, timeoutMs: 20_000 });
  const payload = parseJson(stdout);
  return { message: stringValue(payload.summary, request.decision === "approve" ? "Sender approved." : "Sender denied.") };
}

export function parseLibraryJson(kind: MailLibraryKind, stdout: string): MailLibraryResult {
  const payload = parseJson(stdout);
  const raw = payload.data ?? payload;
  const values = Array.isArray(raw) ? raw : [];
  return {
    kind,
    items: values.map((value) => {
      const item = record(value);
      const title = kind === "contacts"
        ? stringValue(item.name, stringValue(item.email_address, "Unknown contact"))
        : stringValue(item.name, "Untitled");
      const subtitle = kind === "contacts" ? stringValue(item.email_address) : stringValue(item.summary);
      const count = item.total_count ?? item.thread_count ?? item.threads_count;
      return {
        id: stringValue(item.id),
        title: readableText(title),
        ...(subtitle ? { subtitle: readableText(subtitle) } : {}),
        ...(count !== undefined ? { detail: `${numberValue(count)} conversations` } : {}),
        ...(kind === "contacts" ? { contact: mailContactFrom(item) } : {}),
      };
    }),
  };
}

export function libraryCommand(kind: MailLibraryKind): string[] {
  const command: Record<MailLibraryKind, string[]> = {
    contacts: ["contact", "list", "--all", "--json"],
    labels: ["label", "list", "--json"],
    collections: ["collection", "list", "--json"],
  };
  return command[kind];
}

export async function listLibrary(kind: MailLibraryKind, env: NodeJS.ProcessEnv = process.env): Promise<MailLibraryResult> {
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable.");
  const { stdout } = await runFile(executable, libraryCommand(kind), { env, timeoutMs: 30_000 });
  return parseLibraryJson(kind, stdout);
}

export function librarySourceCommand(kind: MailLibrarySourceResult["kind"], id: string): string[] {
  if (!/^\d+$/.test(id)) throw new Error(`Invalid HEY ${kind} ID.`);
  return [kind === "labels" ? "label" : "collection", "view", id, "--limit", "4", "--json"];
}

export function parseLibrarySourceJson(kind: MailLibrarySourceResult["kind"], stdout: string, requestedId = ""): MailLibrarySourceResult {
  const data = envelopeData(parseJson(stdout));
  return {
    kind,
    id: stringValue(data.id, requestedId),
    title: readableText(stringValue(data.name, kind === "labels" ? "Label" : "Collection")),
    totalCount: numberValue(data.total_count, Array.isArray(data.postings) ? data.postings.length : 0),
    ...(stringValue(data.next_page) ? { nextPage: stringValue(data.next_page) } : {}),
    postings: Array.isArray(data.postings) ? data.postings.map(postingFrom) : [],
  };
}

export async function readLibrarySource(kind: MailLibrarySourceResult["kind"], id: string, env: NodeJS.ProcessEnv = process.env): Promise<MailLibrarySourceResult> {
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable.");
  const { stdout } = await runFile(executable, librarySourceCommand(kind, id), { env, timeoutMs: 20_000 });
  return parseLibrarySourceJson(kind, stdout, id);
}

export function libraryThreadsCommand(kind: MailLibraryKind, id: string, page?: string): string[] {
  if (!["contacts", "labels", "collections"].includes(kind) || !/^\d+$/.test(id)) throw new Error("Invalid HEY library source.");
  if (page !== undefined && (typeof page !== "string" || !page.trim() || page.length > 4096 || /[\x00-\x1f]/.test(page))) throw new Error("Invalid HEY library page.");
  const source = kind === "contacts" ? ["contact", "threads"] : [kind === "labels" ? "label" : "collection", "view"];
  return [...source, id, "--limit", "50", ...(page ? ["--page", page] : []), "--json"];
}

export function parseLibraryThreadsJson(kind: MailLibraryKind, stdout: string, id: string): MailLibraryThreads {
  if (kind !== "contacts") return parseLibrarySourceJson(kind, stdout, id);
  const listing = parseThreadListingJson("contact", stdout, id);
  return { kind, id: listing.id, title: listing.title, postings: listing.postings, nextPage: listing.nextPage };
}

export async function listLibraryThreads(kind: MailLibraryKind, id: string, page?: string, env: NodeJS.ProcessEnv = process.env): Promise<MailLibraryThreads> {
  const command = libraryThreadsCommand(kind, id, page);
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable.");
  const { stdout } = await runFile(executable, command, { env, timeoutMs: 30_000 });
  return parseLibraryThreadsJson(kind, stdout, id);
}

function numericTarget(value: string | undefined, label: string, required: boolean): string | undefined {
  if (!value && !required) return undefined;
  if (!value || !/^\d+$/.test(value)) throw new Error(`A valid HEY ${label} ID is required.`);
  return value;
}

function numericTargets(values: string[] | undefined, label: string, required: boolean): string[] {
  if ((!values || values.length === 0) && !required) return [];
  if (!values || values.length === 0 || values.length > 100 || new Set(values).size !== values.length || values.some((value) => !/^\d+$/.test(value))) {
    throw new Error(`One or more valid HEY ${label} IDs are required.`);
  }
  return values;
}

function outputIds(stdout: string): Set<string> {
  const values = stdout.split(/\r?\n/).map((line) => line.trim().replace(/^"|"$/g, "")).filter((line) => /^\d+$/.test(line));
  return new Set(values);
}

async function mapLimit<T, R>(values: T[], limit: number, task: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(values[index]!);
    }
  }));
  return results;
}

export function organizationViewCommand(kind: "labels" | "collections", id: string): string[] {
  if (!/^\d+$/.test(id)) throw new Error(`Invalid HEY ${kind === "labels" ? "label" : "Collection"} ID.`);
  return kind === "labels"
    ? ["label", "view", id, "--all", "--ids-only"]
    : ["collection", "view", id, "--all", "--quiet", "--jq", ".postings[].topic_id"];
}

async function organizationItems(executable: string, kind: "labels" | "collections", items: MailLibraryResult["items"], targetIds: string[], env: NodeJS.ProcessEnv): Promise<MailOrganizationItem[]> {
  if (targetIds.length === 0) return items.map((item) => ({ id: item.id, name: item.title, ...(item.subtitle ? { summary: item.subtitle } : {}), membership: "none", memberCount: 0 }));
  return mapLimit(items, 4, async (item) => {
    const { stdout } = await runFile(executable, organizationViewCommand(kind, item.id), { env, timeoutMs: 30_000 });
    const members = outputIds(stdout);
    const memberCount = targetIds.filter((targetId) => members.has(targetId)).length;
    const membership = memberCount === 0 ? "none" : memberCount === targetIds.length ? "all" : "some";
    return { id: item.id, name: item.title, ...(item.subtitle ? { summary: item.subtitle } : {}), membership, memberCount };
  });
}

export async function getMailOrganization(target: MailOrganizationTarget, env: NodeJS.ProcessEnv = process.env): Promise<MailOrganization> {
  const postingIds = numericTargets(target.postingIds, "posting", false);
  const topicIds = numericTargets(target.topicIds, "topic", false);
  if (postingIds.length === 0 && topicIds.length === 0) throw new Error("These conversations cannot be organized from the current HEY result.");
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable.");
  const [labels, collections] = await Promise.all([listLibrary("labels", env), listLibrary("collections", env)]);
  const [labelItems, collectionItems] = await Promise.all([
    organizationItems(executable, "labels", labels.items, postingIds, env),
    organizationItems(executable, "collections", collections.items, topicIds, env),
  ]);
  return { labels: labelItems, collections: collectionItems };
}

function organizationName(value: string | undefined, kind: "labels" | "collections"): string {
  const name = value?.trim() ?? "";
  if (!name || name.length > 120 || /[\r\n\0]/.test(name)) throw new Error(`Enter a valid ${kind === "labels" ? "label" : "Collection"} name.`);
  return name;
}

export function organizationMutationCommand(request: MailOrganizationMutationRequest): string[] {
  const noun = request.kind === "labels" ? "label" : "collection";
  const memberIds = request.kind === "labels"
    ? numericTargets(request.postingIds, "posting", true)
    : numericTargets(request.topicIds, "topic", true);
  if (request.action === "create") {
    const name = organizationName(request.name, request.kind);
    return request.kind === "labels" ? ["label", "create", name, ...memberIds, "--json"] : ["collection", "create", name, "--json"];
  }
  const targetId = numericTarget(request.targetId, noun, true)!;
  return request.action === "add"
    ? [noun, "add", ...memberIds, "--to", targetId, "--json"]
    : [noun, "remove", ...memberIds, "--from", targetId, "--json"];
}

function mutationSummary(stdout: string, fallback: string): string {
  const payload = parseJson(stdout);
  return readableText(stringValue(payload.summary, fallback));
}

function createdCollectionId(stdout: string): string {
  const payload = parseJson(stdout);
  const data = envelopeData(payload);
  const candidate = stringValue(data.id, stringValue(record(data.collection).id));
  if (!/^\d+$/.test(candidate)) throw new Error("HEY created the Collection but did not return its ID, so the conversation was not added.");
  return candidate;
}

export async function updateMailOrganization(request: MailOrganizationMutationRequest, env: NodeJS.ProcessEnv = process.env): Promise<{ message: string }> {
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable.");
  const command = organizationMutationCommand(request);
  const { stdout } = await runFile(executable, command, { env, timeoutMs: 30_000 });
  if (request.kind === "collections" && request.action === "create") {
    const collectionId = createdCollectionId(stdout);
    const topicIds = numericTargets(request.topicIds, "topic", true);
    try {
      const added = await runFile(executable, ["collection", "add", ...topicIds, "--to", collectionId, "--json"], { env, timeoutMs: 30_000 });
      return { message: mutationSummary(added.stdout, `Collection created and ${topicIds.length === 1 ? "conversation" : `${topicIds.length} conversations`} added.`) };
    } catch {
      throw new Error("HEY created the Collection, but could not add the selected conversations. Choose the new Collection and try adding them again.");
    }
  }
  const selectionCount = request.kind === "labels" ? request.postingIds?.length ?? 0 : request.topicIds?.length ?? 0;
  const conversations = selectionCount === 1 ? "Conversation" : `${selectionCount} conversations`;
  const fallback = request.action === "remove"
    ? `${conversations} removed from ${request.kind === "labels" ? "label" : "Collection"}.`
    : request.action === "create"
      ? `Label created and added to ${request.postingIds?.length === 1 ? "conversation" : `${request.postingIds?.length ?? 0} conversations`}.`
      : `${conversations} added to ${request.kind === "labels" ? "label" : "Collection"}.`;
  return { message: mutationSummary(stdout, fallback) };
}

export function parseContactJson(stdout: string): MailContactDetail {
  const item = envelopeData(parseJson(stdout));
  const contact = mailContactFrom(item);
  const clearance = record(item.clearance);
  const domain = record(item.domain);
  const aliases = Array.isArray(item.aliases)
    ? item.aliases.map((alias) => typeof alias === "string" ? alias : stringValue(record(alias).email_address)).filter(Boolean)
    : [];
  return {
    ...contact,
    id: stringValue(item.id),
    name: readableText(stringValue(item.name, stringValue(item.email_address, "Unknown contact"))),
    email: stringValue(item.email_address),
    aliases,
    note: readableText(stringValue(item.note)),
    ...(stringValue(clearance.status) ? { status: stringValue(clearance.status) } : {}),
    ...(stringValue(clearance.id) ? { clearanceId: stringValue(clearance.id) } : {}),
    ...(stringValue(domain.address) ? { domain: stringValue(domain.address) } : {}),
    ...(stringValue(item.edit_app_url) ? { editAppUrl: stringValue(item.edit_app_url) } : {}),
    ...(stringValue(domain.app_url) ? { domainAppUrl: stringValue(domain.app_url) } : {}),
    ...(stringValue(item.updated_at) ? { updatedAt: stringValue(item.updated_at) } : {}),
  };
}

export async function showContact(id: string, env: NodeJS.ProcessEnv = process.env): Promise<MailContactDetail> {
  if (!/^\d+$/.test(id)) throw new Error("Invalid HEY contact ID.");
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable.");
  const { stdout } = await runFile(executable, ["contact", "show", id, "--json"], { env, timeoutMs: 20_000 });
  return parseContactJson(stdout);
}

export function threadListingCommand(kind: MailThreadListing["kind"], id: string): string[] {
  if (!/^\d+$/.test(id)) throw new Error(`Invalid HEY ${kind === "bundle" ? "bundle" : "contact"} ID.`);
  return kind === "bundle" ? ["bundle", "view", id, "--all", "--json"] : ["contact", "threads", id, "--all", "--json"];
}

export function parseThreadListingJson(kind: MailThreadListing["kind"], stdout: string, requestedId = ""): MailThreadListing {
  const data = envelopeData(parseJson(stdout));
  const sourceContact = kind === "bundle" ? record(data.contact) : data;
  const contact = mailContactFrom(sourceContact);
  const title = kind === "bundle"
    ? `Unseen from ${contact.name}`
    : readableText(stringValue(data.entries_title, `All conversations with ${contact.name}`));
  return {
    kind,
    id: stringValue(data.id, requestedId),
    title,
    contact,
    ...(stringValue(data.next_page) ? { nextPage: stringValue(data.next_page) } : {}),
    postings: Array.isArray(data.postings) ? data.postings.map(postingFrom) : [],
  };
}

async function listThreadsFor(kind: MailThreadListing["kind"], id: string, env: NodeJS.ProcessEnv): Promise<MailThreadListing> {
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable.");
  const { stdout } = await runFile(executable, threadListingCommand(kind, id), { env, timeoutMs: 30_000 });
  return parseThreadListingJson(kind, stdout, id);
}

export function readBundle(id: string, env: NodeJS.ProcessEnv = process.env): Promise<MailThreadListing> {
  return listThreadsFor("bundle", id, env);
}

export function listContactThreads(id: string, env: NodeJS.ProcessEnv = process.env): Promise<MailThreadListing> {
  return listThreadsFor("contact", id, env);
}

export function setAsideGroupCommand(request: SetAsideGroupMutationRequest): string[] {
  const ids = numericTargets(request.postingIds, "posting", request.action !== "delete");
  const groupId = numericTarget(request.groupId, "Set Aside group", request.action === "add" || request.action === "delete");
  if (request.action === "create") return ["set-aside", "group", "create", ...ids, "--json"];
  if (request.action === "add") return ["set-aside", "group", "add", ...ids, "--to", groupId!, "--json"];
  if (request.action === "remove") return ["set-aside", "group", "remove", ...ids, "--json"];
  return ["set-aside", "group", "delete", groupId!, "--json"];
}

export async function updateSetAsideGroup(request: SetAsideGroupMutationRequest, env: NodeJS.ProcessEnv = process.env): Promise<{ message: string; groupId?: string }> {
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable.");
  const { stdout } = await runFile(executable, setAsideGroupCommand(request), { env, timeoutMs: 30_000 });
  const payload = parseJson(stdout);
  const data = envelopeData(payload);
  const groupId = stringValue(data.id, stringValue(data.group_id, request.groupId));
  const count = request.postingIds?.length ?? 0;
  const fallback = request.action === "create" ? `${count} ${count === 1 ? "conversation" : "conversations"} grouped in Set Aside.`
    : request.action === "add" ? `${count} ${count === 1 ? "conversation" : "conversations"} moved into the Set Aside group.`
      : request.action === "remove" ? `${count} ${count === 1 ? "conversation" : "conversations"} left ungrouped in Set Aside.`
        : "Set Aside group dissolved. Its conversations moved to Previously Seen.";
  return { message: readableText(stringValue(payload.summary, fallback)), ...(groupId ? { groupId } : {}) };
}

function addressList(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((entry) => {
    if (typeof entry === "string") return entry;
    const item = record(entry);
    return stringValue(item.email_address, stringValue(item.email));
  }).filter(Boolean).join(", ");
}

function draftFrom(value: unknown): MailDraft {
  const item = record(value);
  return {
    id: stringValue(item.id),
    ...(stringValue(item.from) ? { from: stringValue(item.from) } : {}),
    subject: readableText(stringValue(item.subject, "(No subject)")) || "(No subject)",
    to: addressList(item.to ?? item.to_recipients),
    cc: addressList(item.cc ?? item.cc_recipients),
    bcc: addressList(item.bcc ?? item.bcc_recipients),
    body: stringValue(item.body, stringValue(item.message, stringValue(item.content))),
    ...(stringValue(item.updated_at) ? { updatedAt: stringValue(item.updated_at) } : {}),
    ...(stringValue(item.scheduled_delivery_at) ? { scheduledAt: stringValue(item.scheduled_delivery_at) } : {}),
  };
}

export function parseDraftListJson(stdout: string): MailDraft[] {
  const payload = parseJson(stdout);
  const raw = payload.data ?? payload;
  return Array.isArray(raw) ? raw.map(draftFrom) : [];
}

export function parseDraftJson(stdout: string): MailDraft {
  const payload = parseJson(stdout);
  return draftFrom(payload.data ?? payload);
}

export function replyContextCommand(postingId: string): string[] {
  if (!/^\d+$/.test(postingId)) throw new Error("Invalid HEY posting ID.");
  return ["bulk-reply", "preview", postingId, "--json"];
}

export function parseReplyContextJson(stdout: string): MailReplyContext {
  const payload = parseJson(stdout);
  const raw = payload.data ?? payload;
  const preview = record(Array.isArray(raw) ? raw[0] : raw);
  const contacts = (value: unknown): MailContact[] => Array.isArray(value) ? value.map(mailContactFrom) : [];
  return {
    to: contacts(preview.to ?? record(preview.addressed).directly),
    cc: contacts(preview.cc ?? record(preview.addressed).copied),
    bcc: contacts(preview.bcc ?? record(preview.addressed).blindcopied),
  };
}

export async function getReplyContext(postingId: string, env: NodeJS.ProcessEnv = process.env): Promise<MailReplyContext> {
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable.");
  const { stdout } = await runFile(executable, replyContextCommand(postingId), { env, timeoutMs: 30_000 });
  const context = parseReplyContextJson(stdout);
  if (context.to.length + context.cc.length + context.bcc.length === 0) throw new Error("HEY could not determine this reply's recipients.");
  return context;
}

async function draftCommand(args: string[], env: NodeJS.ProcessEnv): Promise<{ message: string }> {
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable.");
  const { stdout } = await runFile(executable, [...args, "--json"], { env, timeoutMs: 30_000 });
  const payload = parseJson(stdout);
  return { message: stringValue(payload.summary, "Draft updated in HEY.") };
}

export async function listDrafts(env: NodeJS.ProcessEnv = process.env): Promise<MailDraft[]> {
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable.");
  const { stdout } = await runFile(executable, ["draft", "list", "--all", "--json"], { env, timeoutMs: 30_000 });
  return parseDraftListJson(stdout);
}

export async function showDraft(id: string, env: NodeJS.ProcessEnv = process.env): Promise<MailDraft> {
  if (!/^\d+$/.test(id)) throw new Error("Invalid HEY draft ID.");
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable.");
  const { stdout } = await runFile(executable, ["draft", "show", id, "--json"], { env, timeoutMs: 20_000 });
  return parseDraftJson(stdout);
}

export function draftEditCommand(request: MailDraftUpdate): string[] {
  if (!/^\d+$/.test(request.id)) throw new Error("Invalid HEY draft ID.");
  validateAddressField(request.to); validateAddressField(request.cc); validateAddressField(request.bcc);
  const args = ["draft", "edit", request.id];
  if (request.to !== undefined) args.push("--to", request.to);
  if (request.cc !== undefined) args.push("--cc", request.cc);
  if (request.bcc !== undefined) args.push("--bcc", request.bcc);
  if (request.subject !== undefined) args.push("--subject", request.subject);
  if (request.body !== undefined) args.push("--message", request.body);
  args.push("--json");
  return args;
}

export async function editDraft(request: MailDraftUpdate, env: NodeJS.ProcessEnv = process.env): Promise<{ message: string }> {
  const update = { ...request };
  if (update.body !== undefined) {
    const current = await showDraft(request.id, env);
    if (update.body === current.body) delete update.body; // Keep HEY's original HTML and uploads verbatim.
    else if (/📎|!\[|<img\b|<action-text-attachment\b/i.test(current.body)) {
      throw new Error("This draft contains images or attachments. Edit its body in HEY to preserve them; recipient and subject changes are supported here.");
    }
  }
  if (![update.to, update.cc, update.bcc, update.subject, update.body].some((field) => field !== undefined)) return { message: "Draft unchanged." };
  const args = draftEditCommand(update);
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable.");
  const { stdout } = await runFile(executable, args, { env, timeoutMs: 30_000 });
  const payload = parseJson(stdout);
  return { message: stringValue(payload.summary, "Draft saved in HEY.") };
}

export async function sendDraft(id: string, env: NodeJS.ProcessEnv = process.env): Promise<{ message: string }> {
  if (!/^\d+$/.test(id)) throw new Error("Invalid HEY draft ID.");
  return draftCommand(["draft", "send", id], env);
}

export async function deleteDraft(id: string, env: NodeJS.ProcessEnv = process.env): Promise<{ message: string }> {
  if (!/^\d+$/.test(id)) throw new Error("Invalid HEY draft ID.");
  return draftCommand(["draft", "delete", id], env);
}

function assertPostingIds(values: string[]): string[] {
  if (values.length < 1 || values.length > 100 || new Set(values).size !== values.length || values.some((value) => !/^\d+$/.test(value))) {
    throw new Error("Invalid HEY posting selection.");
  }
  return values;
}

function inverseMutation(request: MailMutationRequest): MailMutationRequest | undefined {
  if (request.operation === "move" && request.sourceBox) {
    return { operation: "move", postingIds: request.postingIds, destination: request.sourceBox, sourceBox: request.destination };
  }
  if (request.operation === "seen") return { operation: "unseen", postingIds: request.postingIds };
  if (request.operation === "unseen") return { operation: "seen", postingIds: request.postingIds };
  if (request.operation === "ignore") return { operation: "stop-ignoring", postingIds: request.postingIds };
  if (request.operation === "stop-ignoring") return { operation: "ignore", postingIds: request.postingIds };
  return undefined;
}

export async function mutateMail(request: MailMutationRequest, env: NodeJS.ProcessEnv = process.env): Promise<MailMutationResult> {
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable.");
  const args = mutationCommand(request);
  const { stdout } = await runFile(executable, args, { env, timeoutMs: 20_000 });
  const payload = parseJson(stdout);
  return {
    message: stringValue(payload.summary, "HEY updated the conversation."),
    ...(inverseMutation(request) ? { undo: inverseMutation(request) } : {}),
  };
}

export function mutationCommand(request: MailMutationRequest): string[] {
  const postingIds = assertPostingIds(request.postingIds);
  const args = request.operation === "bubble" ? ["bubble", "up", ...postingIds]
    : request.operation === "bubble-pop" ? ["bubble", "pop", ...postingIds] : [request.operation, ...postingIds];
  if (request.operation === "move") {
    if (!request.destination || !MOVE_DESTINATIONS.has(request.destination)) throw new Error("A valid HEY destination is required.");
    args.push("--to", request.destination);
  }
  if (request.operation === "bubble") args.push(`--${request.bubbleSchedule ?? "tomorrow"}`);
  args.push("--json");
  return args;
}

function recipientList(value: unknown): MailContact[] {
  return Array.isArray(value) ? value.map(mailContactFrom) : [];
}

export function bulkReplyPreviewCommand(postingIds: string[]): string[] {
  return ["bulk-reply", "preview", ...assertPostingIds(postingIds), "--json"];
}

export function parseBulkReplyPreviewJson(postingIds: string[], stdout: string): BulkReplyPreview {
  const payload = parseJson(stdout);
  const data = Array.isArray(payload.data) ? payload.data : [];
  return {
    postingIds: assertPostingIds(postingIds),
    items: data.map((value) => {
      const item = record(value);
      return {
        entryId: stringValue(item.id),
        topicId: stringValue(item.topic_id),
        subject: readableText(stringValue(item.topic_name, "(No subject)")) || "(No subject)",
        to: recipientList(item.to),
        cc: recipientList(item.cc),
        bcc: recipientList(item.bcc),
      };
    }),
  };
}

export async function previewBulkReply(postingIds: string[], env: NodeJS.ProcessEnv = process.env): Promise<BulkReplyPreview> {
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable.");
  const { stdout } = await runFile(executable, bulkReplyPreviewCommand(postingIds), { env, timeoutMs: 30_000 });
  return parseBulkReplyPreviewJson(postingIds, stdout);
}

function validateBulkReplyRequest(request: BulkReplySendRequest): void {
  if (assertPostingIds(request.postingIds).length < 2) throw new Error("Select at least two HEY conversations.");
  if (!request.body.trim() && request.attachments.length === 0) throw new Error("Write a reply or attach a file.");
  if (request.body.length > 500_000) throw new Error("Email content is too large.");
  if (request.attachments.length > 25 || request.attachments.some((path) => !path.startsWith("/") || path.length > 4_096)) throw new Error("Invalid attachment selection.");
}

export function bulkReplySendCommand(request: BulkReplySendRequest): string[] {
  validateBulkReplyRequest(request);
  const args = ["bulk-reply", "send", ...request.postingIds];
  for (const attachment of request.attachments) args.push("--attach", attachment);
  args.push("--json");
  return args;
}

export function parseBulkReplySendJson(stdout: string): BulkReplySendResult {
  const payload = parseJson(stdout);
  const data = envelopeData(payload);
  const delivery = record(data.bulk_reply ?? data.delivery);
  const scheduledDelivery = record(data.scheduled_delivery);
  const deliveryId = stringValue(delivery.id ?? scheduledDelivery.id ?? data.bulk_reply_id ?? data.delivery_id ?? data.id);
  const replyCount = numberValue(data.reply_count, numberValue(data.sent_count, numberValue(data.count)));
  return {
    message: stringValue(payload.summary, replyCount > 0 ? `${replyCount} separate replies are queued in HEY.` : "Replies are queued in HEY."),
    replyCount,
    ...(deliveryId ? { deliveryId } : {}),
    delayed: data.delayed === true || delivery.delayed === true || scheduledDelivery.delayed === true || Boolean(deliveryId),
  };
}

export async function sendBulkReply(request: BulkReplySendRequest, env: NodeJS.ProcessEnv = process.env): Promise<BulkReplySendResult> {
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable.");
  const { stdout } = await runFileWithInput(executable, bulkReplySendCommand(request), request.body, { env, timeoutMs: 90_000 });
  return parseBulkReplySendJson(stdout);
}

export function bulkReplyUndoCommand(deliveryId: string): string[] {
  if (!/^\d+$/.test(deliveryId)) throw new Error("Invalid HEY bulk reply ID.");
  return ["bulk-reply", "undo", deliveryId, "--json"];
}

export async function undoBulkReply(deliveryId: string, env: NodeJS.ProcessEnv = process.env): Promise<BulkReplyUndoResult> {
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable.");
  const { stdout } = await runFile(executable, bulkReplyUndoCommand(deliveryId), { env, timeoutMs: 30_000 });
  const payload = parseJson(stdout);
  return { message: stringValue(payload.summary, "Bulk reply recalled in HEY."), undone: true };
}

function validateAddressField(value: string | undefined): void {
  if (value !== undefined && (value.length > 4_000 || /[\r\n\0]/.test(value))) throw new Error("Invalid email recipients.");
}

function validateSendRequest(request: MailSendRequest): void {
  validateAddressField(request.from);
  if (request.mode !== "compose" && (request.from !== undefined || request.noNameTag !== undefined)) throw new Error("Sender and name tag options apply to new messages only.");
  validateAddressField(request.to);
  validateAddressField(request.cc);
  validateAddressField(request.bcc);
  if (request.body.length > 500_000 || request.subject && request.subject.length > 2_000) throw new Error("Email content is too large.");
  if (request.attachments.length > 25 || request.attachments.some((path) => !path.startsWith("/") || path.length > 4_096)) throw new Error("Invalid attachment selection.");
  if (request.mode !== "compose" && !/^\d+$/.test(request.topicId ?? "")) throw new Error("A valid HEY topic ID is required.");
  if (request.mode === "compose" && !request.subject?.trim()) throw new Error("A subject is required.");
  if (request.mode === "forward" && request.saveAsDraft) throw new Error("HEY cannot save a forwarded message as a draft yet.");
  if (request.mode === "forward" && request.attachments.length > 0) throw new Error("HEY cannot add attachments while forwarding yet.");
}

function findDraftId(payload: JsonRecord): string | undefined {
  const data = record(payload.data);
  const draft = record(data.draft);
  const candidate = draft.id ?? data.draft_id ?? data.id;
  return candidate === undefined ? undefined : stringValue(candidate);
}

export function addressedReplyDraftCommand(request: MailSendRequest): string[] {
  if (request.mode !== "reply" || !/^\d+$/.test(request.topicId ?? "")) throw new Error("A valid HEY reply is required.");
  const args = ["reply", request.topicId!];
  for (const attachment of request.attachments) args.push("--attach", attachment);
  args.push("--draft", "--json");
  return args;
}

export async function sendMail(request: MailSendRequest, env: NodeJS.ProcessEnv = process.env): Promise<MailSendResult> {
  validateSendRequest(request);
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable.");
  const customReplyRecipients = request.mode === "reply" && [request.to, request.cc, request.bcc].some((value) => value !== undefined);
  if (customReplyRecipients) {
    const args = addressedReplyDraftCommand(request);
    const { stdout } = await runFileWithInput(executable, args, request.body, { env, timeoutMs: 60_000 });
    const draftId = findDraftId(parseJson(stdout));
    if (!draftId) throw new Error("HEY created the addressed reply draft but did not return its ID.");
    try {
      const edited = await editDraft({ id: draftId, to: request.to, cc: request.cc, bcc: request.bcc }, env);
      if (request.saveAsDraft) return { disposition: "draft", message: edited.message, draftId };
      const sent = await sendDraft(draftId, env);
      return { disposition: "sent", message: sent.message };
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : "HEY could not finish the addressed reply.";
      throw new Error(`${detail} Check HEY Drafts before retrying; the reply was created there first.`);
    }
  }
  const args: string[] = request.mode === "compose"
    ? ["compose"]
    : [request.mode, request.topicId!];
  if (request.to?.trim()) args.push("--to", request.to.trim());
  if (request.cc?.trim()) args.push("--cc", request.cc.trim());
  if (request.bcc?.trim()) args.push("--bcc", request.bcc.trim());
  if (request.mode === "compose") args.push("--subject", request.subject!.trim());
  if (request.mode === "compose" && request.from) args.push("--from", request.from);
  if (request.mode === "compose" && request.noNameTag) args.push("--no-name-tag");
  for (const attachment of request.attachments) args.push("--attach", attachment);
  if (request.saveAsDraft) args.push("--draft");
  args.push("--json");
  const runner = request.mode === "forward" && request.body.length === 0
    ? runFile(executable, args, { env, timeoutMs: 60_000 })
    : runFileWithInput(executable, args, request.body, { env, timeoutMs: 60_000 });
  const { stdout } = await runner;
  const payload = parseJson(stdout);
  const disposition = request.saveAsDraft ? "draft" : "sent";
  return {
    disposition,
    message: stringValue(payload.summary, disposition === "draft" ? "Draft saved in HEY." : "Message sent."),
    ...(disposition === "draft" && findDraftId(payload) ? { draftId: findDraftId(payload) } : {}),
  };
}

export async function unbundleContact(contactId: string, env: NodeJS.ProcessEnv = process.env): Promise<{ message: string }> {
  if (!/^\d+$/.test(contactId)) throw new Error("Invalid HEY contact ID.");
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable.");
  const { stdout } = await runFile(executable, ["contact", "unbundle", contactId, "--json"], { env, timeoutMs: 20_000 });
  const payload = parseJson(stdout);
  return { message: stringValue(payload.summary, "Future mail from this contact will appear as individual conversations.") };
}

function entryFrom(value: unknown): ThreadEntry {
  const entry = record(value);
  const summary = readableText(stringValue(entry.summary));
  const sender = resolveMailSender(entry, { summary });
  return {
    id: stringValue(entry.id),
    sender,
    ...(entry.recipients && typeof entry.recipients === "object" ? { recipients: {
      to: recipientList(record(entry.recipients).to),
      cc: recipientList(record(entry.recipients).cc),
      bcc: recipientList(record(entry.recipients).bcc),
    } } : {}),
    ...(Array.isArray(entry.received_via) ? { receivedVia: entry.received_via.map((value) => stringValue(record(value).email_address)).filter(Boolean) } : {}),
    occurredAt: normalizeHeyTimestamp(stringValue(entry.occurred_at, stringValue(entry.created_at))),
    body: readableText(stringValue(entry.plain_text, stringValue(entry.body, stringValue(entry.content))), { preserveMarkdownBreaks: true }),
    ...(typeof entry.html === "string" ? { html: entry.html } : {}),
  };
}

export function threadCommand(topicId: string, format: "json" | "html" = "json"): string[] {
  return ["thread", "read", topicId, `--${format}`];
}

export async function readThread(topicId: string, env: NodeJS.ProcessEnv = process.env, options: { includeHtml?: boolean } = {}): Promise<MailThread> {
  if (!/^\d+$/.test(topicId)) throw new Error("Invalid HEY topic ID.");
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable.");

  const attachmentRequest = listMailAttachments(topicId, env).then(
    (attachments) => ({ attachments }),
    () => ({ attachmentsError: "Attachments couldn’t be loaded. Reload the conversation to try again." }),
  );
  const htmlRequest = options.includeHtml
    ? runFile(executable, threadCommand(topicId, "html"), { env, timeoutMs: 30_000 }).then((result) => result.stdout).catch(() => undefined)
    : undefined;
  const { stdout } = await runFile(executable, threadCommand(topicId), {
    env,
    timeoutMs: 20_000,
  });
  const parsedThread = parseThreadJson(topicId, stdout);
  const attachmentResult = await attachmentRequest;
  const thread = "attachments" in attachmentResult
    ? withMailAttachments(parsedThread, attachmentResult.attachments)
    : { ...parsedThread, ...attachmentResult };
  if (!htmlRequest) return thread;

  const html = await htmlRequest;
  if (!html) return thread;
  const rich = parseThreadHtmlDocument(html);
  return {
    ...thread,
    entries: thread.entries.map((entry) => {
      const parsed = rich.get(entry.id);
      if (!parsed) return entry;
      const { senderName, occurredAt, attachmentNames, ...body } = parsed;
      return {
        ...entry,
        ...body,
        sender: applyExplicitSenderName(entry.sender, senderName),
        ...(occurredAt ? { occurredAt: normalizeHeyTimestamp(occurredAt) } : {}),
      };
    }),
    ...([...rich.entries()].some(([id, parsed]) => parsed.attachmentNames?.some((name) =>
      !thread.entries.find((entry) => entry.id === id)?.attachments?.some((file) => file.filename === name)))
      ? { attachmentsError: thread.attachmentsError ?? "This message contains files that HEY CLI did not return. Update HEY CLI to 1.6.0 or newer, then reload. You can also open the conversation in HEY." } : {}),
  };
}

export function parseThreadJson(topicId: string, stdout: string): MailThread {
  const payload = parseJson(stdout);
  const rawData = payload.data ?? payload;
  const data = record(rawData);
  const rawEntries = Array.isArray(rawData)
    ? rawData
    : Array.isArray(data.entries)
      ? data.entries
      : Array.isArray(data.messages)
        ? data.messages
        : [];

  return {
    topicId,
    subject: readableText(stringValue(data.name, stringValue(data.subject, "(No subject)"))) || "(No subject)",
    entries: rawEntries.map(entryFrom),
  };
}
