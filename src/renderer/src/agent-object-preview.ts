import type { AgentObjectKind, AgentObjectLink, CalendarEvent, HeyAgentApi } from "../../shared/contracts";
import { calendarTargetDate, dateFromKey } from "./calendar";

export type AgentObjectPreview = {
  state: "ready" | "unavailable";
  kind: AgentObjectKind;
  title: string;
  label: string;
  meta?: string;
  detail?: string;
  items?: string[];
};

type PreviewApi = {
  mail: Pick<HeyAgentApi["mail"], "readThread" | "showContact" | "readBundle" | "readLibrarySource">;
  calendar: Pick<HeyAgentApi["calendar"], "list" | "search">;
};

type ContactLookupApi = {
  mail: Pick<HeyAgentApi["mail"], "listLibrary">;
};

export type LazyAgentObjectResolution = { state: "hit"; object: AgentObjectLink } | { state: "miss" };

export async function resolveLazyAgentObjectAction(
  resolve: () => Promise<AgentObjectLink | undefined>,
  isCurrent: () => boolean,
  onObject: (object: AgentObjectLink) => void,
  onFallback: () => void,
): Promise<void> {
  const object = await resolve().catch(() => undefined);
  if (!isCurrent()) return;
  if (object) onObject(object);
  else onFallback();
}

export function createLazyAgentObjectResolver() {
  let active = true;
  let currentKey = "";
  let resolution: LazyAgentObjectResolution | undefined;
  let pending: { key: string; value: Promise<AgentObjectLink | undefined> } | undefined;

  return {
    setKey(key: string) {
      if (currentKey === key) return;
      currentKey = key;
      resolution = undefined;
      pending = undefined;
    },
    peek(key: string) {
      return active && currentKey === key ? resolution : undefined;
    },
    resolve(key: string, load: () => Promise<AgentObjectLink | undefined>) {
      if (!active || currentKey !== key) return Promise.resolve(undefined);
      if (resolution?.state === "hit") return Promise.resolve(resolution.object);
      if (resolution?.state === "miss") return Promise.resolve(undefined);
      if (pending?.key === key) return pending.value;
      const value = load().then((object) => {
        if (!active || currentKey !== key) return undefined;
        resolution = object ? { state: "hit", object } : { state: "miss" };
        return object;
      }).catch(() => {
        if (active && currentKey === key) resolution = { state: "miss" };
        return undefined;
      });
      pending = { key, value };
      void value.finally(() => { if (pending?.value === value) pending = undefined; });
      return value;
    },
    dispose() {
      active = false;
      pending = undefined;
      resolution = undefined;
    },
  };
}

const pendingPreviews = new Map<string, Promise<AgentObjectPreview>>();

function compact(value: string | undefined, limit = 180): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

function calendarDateLabel(date: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(dateFromKey(date));
}

function eventTime(event: CalendarEvent): string {
  if (event.allDay) return "All day";
  const format = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  return `${format.format(new Date(event.startsAt))}–${format.format(new Date(event.endsAt))}`;
}

function unavailable(object: AgentObjectLink, detail = "Preview unavailable. Open it to try again."): AgentObjectPreview {
  return { state: "unavailable", kind: object.kind, title: object.title, label: object.kind.replaceAll("-", " "), detail };
}

export async function resolveAgentObjectPreview(object: AgentObjectLink, api: PreviewApi): Promise<AgentObjectPreview> {
  try {
    if (object.kind === "mail-thread") {
      const thread = await api.mail.readThread(object.id);
      const latest = thread.entries.at(-1);
      return {
        state: "ready",
        kind: object.kind,
        title: thread.subject || object.title,
        label: thread.entries.length === 1 ? "Email conversation · 1 message" : `Email conversation · ${thread.entries.length} messages`,
        meta: latest ? `${latest.sender.name} · ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(latest.occurredAt))}` : undefined,
        detail: compact(latest?.body),
      };
    }

    if (object.kind === "contact") {
      const contact = await api.mail.showContact(object.id);
      return {
        state: "ready",
        kind: object.kind,
        title: contact.name || object.title,
        label: "HEY contact",
        meta: contact.email,
        detail: compact(contact.note) ?? (contact.status === "approved" ? "Approved sender" : contact.status ? `HEY status: ${contact.status}` : undefined),
      };
    }

    if (object.kind === "mail-bundle") {
      const bundle = await api.mail.readBundle(object.id);
      return {
        state: "ready",
        kind: object.kind,
        title: bundle.title || object.title,
        label: bundle.postings.length === 1 ? "HEY bundle · 1 conversation" : `HEY bundle · ${bundle.postings.length} conversations`,
        meta: bundle.contact.email,
        detail: bundle.postings.length === 0 ? "No conversations in this bundle." : undefined,
        items: bundle.postings.slice(0, 4).map((posting) => posting.subject),
      };
    }

    if (object.kind === "label" || object.kind === "collection") {
      const source = await api.mail.readLibrarySource(object.kind === "label" ? "labels" : "collections", object.id);
      return {
        state: "ready",
        kind: object.kind,
        title: source.title || object.title,
        label: object.kind === "label" ? "HEY label" : "HEY Collection",
        meta: source.totalCount === 1 ? "1 conversation" : `${source.totalCount} conversations`,
        detail: source.totalCount === 0 ? "No conversations here." : undefined,
        items: source.postings.slice(0, 4).map((posting) => posting.subject),
      };
    }

    if (object.kind === "calendar-date") {
      const date = calendarTargetDate(object.deepLink, object.subtitle) ?? object.id;
      const result = await api.calendar.list({ startsOn: date, endsOn: date });
      if (result.status !== "ready") return unavailable(object, result.detail);
      const events = result.events.slice(0, 4);
      return {
        state: "ready",
        kind: object.kind,
        title: calendarDateLabel(date),
        label: result.events.length === 1 ? "1 event" : `${result.events.length} events`,
        detail: result.events.length === 0 ? "Nothing scheduled." : undefined,
        items: events.map((event) => `${eventTime(event)} · ${event.title}`),
      };
    }

    if (object.kind === "calendar-event") {
      let date = calendarTargetDate(object.deepLink, object.subtitle);
      if (!date) {
        const match = (await api.calendar.search({ query: object.title })).items.find((item) => item.kind === "event" && item.id === object.id);
        date = match?.date;
      }
      if (!date) return unavailable(object, "This event needs a date before it can be previewed.");
      const result = await api.calendar.list({ startsOn: date, endsOn: date });
      if (result.status !== "ready") return unavailable(object, result.detail);
      const event = result.events.find((item) => item.id === object.id || item.occurrenceId === object.id);
      if (!event) return unavailable(object, "This event is no longer on that date.");
      const people = event.attendees.length || event.organizer ? [event.organizer?.name, ...event.attendees.map((person) => person.name)].filter(Boolean).join(", ") : undefined;
      return {
        state: "ready",
        kind: object.kind,
        title: event.title,
        label: event.calendar.name,
        meta: `${calendarDateLabel(date)} · ${eventTime(event)}${event.location ? ` · ${event.location}` : ""}`,
        detail: compact(event.description) ?? compact(people),
      };
    }

    return {
      state: "ready",
      kind: object.kind,
      title: object.title,
      label: object.kind.replaceAll("-", " "),
      meta: object.subtitle,
    };
  } catch {
    return unavailable(object);
  }
}

export function loadAgentObjectPreview(object: AgentObjectLink): Promise<AgentObjectPreview> {
  const pending = pendingPreviews.get(object.deepLink);
  if (pending) return pending;
  const value = resolveAgentObjectPreview(object, window.heyAgent).finally(() => pendingPreviews.delete(object.deepLink));
  pendingPreviews.set(object.deepLink, value);
  return value;
}

export async function resolveAgentContactByEmail(email: string, title: string, api: ContactLookupApi): Promise<AgentObjectLink | undefined> {
  try {
    const normalized = email.trim().toLocaleLowerCase();
    if (!normalized) return undefined;
    const result = await api.mail.listLibrary("contacts");
    const contact = result.items.find((item) => {
      const address = item.contact?.email ?? item.subtitle;
      return address?.trim().toLocaleLowerCase() === normalized;
    });
    if (!contact?.id) return undefined;
    return {
      kind: "contact",
      id: contact.id,
      title: contact.title || title || email,
      subtitle: contact.contact?.email ?? contact.subtitle ?? email,
      deepLink: `hey-agent://mail/contacts/${encodeURIComponent(contact.id)}`,
    };
  } catch {
    return undefined;
  }
}
