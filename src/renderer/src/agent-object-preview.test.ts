import { describe, expect, it, vi } from "vitest";
import type { AgentObjectLink, CalendarEvent, HeyAgentApi } from "../../shared/contracts";
import { createLazyAgentObjectResolver, resolveAgentContactByEmail, resolveAgentObjectPreview, resolveLazyAgentObjectAction } from "./agent-object-preview";

const event: CalendarEvent = {
  id: "42",
  title: "Planning",
  startsAt: "2026-09-03T14:00:00-04:00",
  endsAt: "2026-09-03T14:30:00-04:00",
  allDay: false,
  recurring: false,
  calendar: { id: "9", name: "Work" },
  description: "Decide the launch sequence.",
  location: "Studio",
  reminders: [],
  attendees: [],
};

function api(events = [event]) {
  return {
    mail: {
      readThread: async () => ({ topicId: "7", subject: "Launch notes", entries: [{ id: "1", sender: { name: "Maya" }, occurredAt: "2026-09-03T12:00:00-04:00", body: "The launch sequence is ready for review." }] }),
      showContact: async () => ({ id: "8", name: "Maya Chen", email: "maya@example.com", aliases: [], note: "Product lead" }),
      readBundle: async () => ({ kind: "bundle" as const, id: "9", title: "Maya Chen", contact: { name: "Maya Chen", email: "maya@example.com" }, postings: [{ id: "1", topicId: "7", subject: "Launch notes", sender: { name: "Maya Chen" }, contacts: [], summary: "Ready", seen: false, createdAt: "2026-09-03T12:00:00-04:00", visibleEntryCount: 1, kind: "thread" as const }] }),
      readLibrarySource: async (kind: "labels" | "collections", id: string) => ({ kind, id, title: kind === "labels" ? "Launch" : "Fall launch", totalCount: 1, postings: [{ id: "1", topicId: "7", subject: "Launch notes", sender: { name: "Maya Chen" }, contacts: [], summary: "Ready", seen: false, createdAt: "2026-09-03T12:00:00-04:00", visibleEntryCount: 1 }] }),
    },
    calendar: {
      list: async (request: { startsOn: string; endsOn: string }) => ({ status: "ready" as const, ...request, calendars: [], events }),
      search: async () => ({ status: "ready" as const, query: "", items: [], unavailableSources: [] }),
    },
  } satisfies { mail: Pick<HeyAgentApi["mail"], "readThread" | "showContact" | "readBundle" | "readLibrarySource">; calendar: Pick<HeyAgentApi["calendar"], "list" | "search"> };
}

describe("agent object previews", () => {
  it("summarizes referenced mail without invoking the agent", async () => {
    const result = await resolveAgentObjectPreview({ kind: "mail-thread", id: "7", title: "Mail", deepLink: "hey-agent://mail/threads/7" }, api());
    expect(result).toMatchObject({ state: "ready", title: "Launch notes", label: "Email conversation · 1 message", detail: "The launch sequence is ready for review." });
  });

  it("shows authoritative event and day details", async () => {
    const eventResult = await resolveAgentObjectPreview({ kind: "calendar-event", id: "42", title: "Planning", deepLink: "hey-agent://calendar/events/42?date=2026-09-03" }, api());
    const dateResult = await resolveAgentObjectPreview({ kind: "calendar-date", id: "2026-09-03", title: "Thursday", deepLink: "hey-agent://calendar/dates/2026-09-03" }, api());
    expect(eventResult).toMatchObject({ state: "ready", title: "Planning", label: "Work", detail: "Decide the launch sequence." });
    expect(eventResult.meta).toContain("Studio");
    expect(dateResult).toMatchObject({ state: "ready", label: "1 event" });
    expect(dateResult.items?.[0]).toContain("Planning");
  });

  it("shows a compact contact and a useful stale-event state", async () => {
    const contact = await resolveAgentObjectPreview({ kind: "contact", id: "8", title: "Maya", deepLink: "hey-agent://mail/contacts/8" }, api());
    const missing = await resolveAgentObjectPreview({ kind: "calendar-event", id: "404", title: "Old event", deepLink: "hey-agent://calendar/events/404?date=2026-09-03" }, api([]));
    expect(contact).toMatchObject({ state: "ready", title: "Maya Chen", meta: "maya@example.com", detail: "Product lead" });
    expect(missing).toMatchObject({ state: "unavailable", detail: "This event is no longer on that date." });
  });

  it("uses authoritative bundle and Library contents for richer previews", async () => {
    const bundle = await resolveAgentObjectPreview({ kind: "mail-bundle", id: "9", title: "Bundle", deepLink: "hey-agent://mail/bundles/9" }, api());
    const label = await resolveAgentObjectPreview({ kind: "label", id: "701", title: "Label", deepLink: "hey-agent://mail/labels/701" }, api());
    expect(bundle).toMatchObject({ state: "ready", title: "Maya Chen", label: "HEY bundle · 1 conversation", items: ["Launch notes"] });
    expect(label).toMatchObject({ state: "ready", title: "Launch", label: "HEY label", meta: "1 conversation", items: ["Launch notes"] });
  });

  it("resolves known email links to native contacts and leaves unknown addresses alone", async () => {
    const lookup = { mail: { listLibrary: async () => ({ kind: "contacts" as const, items: [{ id: "8", title: "Maya Chen", subtitle: "maya@example.com" }] }) } };
    await expect(resolveAgentContactByEmail("MAYA@example.com", "maya@example.com", lookup)).resolves.toEqual({
      kind: "contact",
      id: "8",
      title: "Maya Chen",
      subtitle: "maya@example.com",
      deepLink: "hey-agent://mail/contacts/8",
    });
    await expect(resolveAgentContactByEmail("unknown@example.com", "unknown@example.com", lookup)).resolves.toBeUndefined();
  });

  it("ignores a stale deferred contact and retains misses for the current email", async () => {
    const resolver = createLazyAgentObjectResolver();
    let finishFirst!: (value: AgentObjectLink) => void;
    const first = new Promise<AgentObjectLink>((resolve) => { finishFirst = resolve; });
    const contact = { kind: "contact" as const, id: "2", title: "Second", deepLink: "hey-agent://mail/contacts/2" };
    resolver.setKey("mailto:first@example.com");
    const stale = resolver.resolve("mailto:first@example.com", () => first);
    resolver.setKey("mailto:second@example.com");
    await expect(resolver.resolve("mailto:second@example.com", async () => contact)).resolves.toEqual(contact);
    finishFirst({ kind: "contact", id: "1", title: "First", deepLink: "hey-agent://mail/contacts/1" });
    await expect(stale).resolves.toBeUndefined();
    expect(resolver.peek("mailto:second@example.com")).toEqual({ state: "hit", object: contact });

    resolver.setKey("mailto:unknown@example.com");
    let loads = 0;
    await resolver.resolve("mailto:unknown@example.com", async () => { loads += 1; return undefined; });
    await resolver.resolve("mailto:unknown@example.com", async () => { loads += 1; return contact; });
    expect(loads).toBe(1);
    expect(resolver.peek("mailto:unknown@example.com")).toEqual({ state: "miss" });
  });

  it("drops a contact lookup that completes after disposal", async () => {
    const resolver = createLazyAgentObjectResolver();
    let finish!: (value: AgentObjectLink) => void;
    const deferred = new Promise<AgentObjectLink>((resolve) => { finish = resolve; });
    resolver.setKey("mailto:maya@example.com");
    const pending = resolver.resolve("mailto:maya@example.com", () => deferred);
    resolver.dispose();
    finish({ kind: "contact", id: "8", title: "Maya", deepLink: "hey-agent://mail/contacts/8" });
    await expect(pending).resolves.toBeUndefined();
    expect(resolver.peek("mailto:maya@example.com")).toBeUndefined();
  });

  it("waits for an exact contact lookup instead of prematurely opening mailto", async () => {
    let finish!: (value: AgentObjectLink | undefined) => void;
    const deferred = new Promise<AgentObjectLink | undefined>((resolve) => { finish = resolve; });
    const open = vi.fn();
    const fallback = vi.fn();
    const action = resolveLazyAgentObjectAction(() => deferred, () => true, open, fallback);
    await Promise.resolve();
    expect(open).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();

    const contact = { kind: "contact" as const, id: "8", title: "Maya", deepLink: "hey-agent://mail/contacts/8" };
    finish(contact);
    await action;
    expect(open).toHaveBeenCalledWith(contact);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("uses mailto only for a confirmed miss and ignores a stale lookup", async () => {
    const open = vi.fn();
    const fallback = vi.fn();
    await resolveLazyAgentObjectAction(async () => undefined, () => true, open, fallback);
    expect(fallback).toHaveBeenCalledOnce();

    fallback.mockClear();
    await resolveLazyAgentObjectAction(async () => undefined, () => false, open, fallback);
    expect(fallback).not.toHaveBeenCalled();
  });
});
