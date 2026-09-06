import type { MailContact } from "../shared/contracts";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function cleanName(value: unknown): string | undefined {
  const name = stringValue(value).replace(/\s+/g, " ").trim();
  return name || undefined;
}

function heyAvatarUrl(value: unknown): string | undefined {
  const candidate = stringValue(value).trim();
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || (url.hostname !== "hey.com" && !url.hostname.endsWith(".hey.com"))) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function avatarColor(value: unknown): string | undefined {
  const candidate = stringValue(value).trim();
  return /^#[\da-f]{3,8}$/i.test(candidate) ? candidate : undefined;
}

function contactInitials(value: unknown): string | undefined {
  const candidate = stringValue(value).replace(/\s+/g, "").trim().slice(0, 4);
  return candidate || undefined;
}

export function mailContactFrom(value: unknown): MailContact {
  const item = record(value);
  const avatarUrl = heyAvatarUrl(item.avatar_url ?? item.avatarUrl);
  const avatarBackgroundColor = avatarColor(item.avatar_background_color ?? item.avatarBackgroundColor);
  const initials = contactInitials(item.initials);
  return {
    ...(item.id === undefined ? {} : { id: stringValue(item.id) }),
    name: stringValue(item.name, stringValue(item.email_address, stringValue(item.email, "Unknown sender"))),
    ...(item.email_address === undefined && item.email === undefined ? {} : { email: stringValue(item.email_address, stringValue(item.email)) }),
    ...(item.contactable_type === undefined && item.kind === undefined ? {} : { kind: stringValue(item.contactable_type, stringValue(item.kind)) }),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(avatarBackgroundColor ? { avatarBackgroundColor } : {}),
    ...(initials ? { initials } : {}),
  };
}

function actorFromSummary(summary: string): string | undefined {
  const match = summary.match(/^(.{1,80}?)\s+(?:left a comment|assigned|requested|mentioned|commented|replied|opened|closed|approved|reviewed|pushed|created|updated)\b/i);
  return cleanName(match?.[1]);
}

function invitationActorFromSummary(subject: string, summary: string): string | undefined {
  const invitationLanguage = /\b(?:invitation|want(?:s)? to connect|waiting for your response|invited you to connect)\b/i;
  if (!invitationLanguage.test(subject) && !invitationLanguage.test(summary)) return undefined;
  const candidate = cleanName(summary.match(/^([^,\n]{1,80}),\s+/)?.[1]);
  const direct = cleanName(summary.match(/^(.{1,80}?)\s+invited you to connect\b/i)?.[1]);
  if (direct) return direct;
  const afterWaiting = cleanName(summary.match(/\bwaiting for your response\s+([\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*)?)/iu)?.[1]);
  if (candidate && afterWaiting?.toLocaleLowerCase().startsWith(candidate.toLocaleLowerCase())) return afterWaiting;
  return candidate;
}

type ResolveMailSenderOptions = {
  fallback?: MailContact;
  summary?: string;
  subject?: string;
  explicitName?: string;
};

/**
 * The sole HEY actor-resolution boundary. Renderers consume the normalized
 * sender and never reinterpret contacts or relay accounts themselves.
 */
export function resolveMailSender(itemValue: unknown, options: ResolveMailSenderOptions = {}): MailContact {
  const item = record(itemValue);
  const raw = record(item.sender ?? item.creator ?? item.contact);
  const direct = Object.keys(raw).length > 0 ? mailContactFrom(raw) : undefined;
  const base = direct?.kind === "User" && options.fallback ? options.fallback : direct ?? options.fallback ?? mailContactFrom(undefined);
  const summary = options.summary ?? "";
  const subject = options.subject ?? "";
  const actor = cleanName(options.explicitName)
    ?? cleanName(item.alternative_sender_name)
    ?? invitationActorFromSummary(subject, summary)
    ?? actorFromSummary(summary);
  return actor ? { ...base, name: actor } : base;
}

export function applyExplicitSenderName(sender: MailContact, explicitName: string | undefined): MailContact {
  const name = cleanName(explicitName);
  return name ? { ...sender, name } : sender;
}
