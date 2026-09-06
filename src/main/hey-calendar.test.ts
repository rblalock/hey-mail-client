import { describe, expect, it } from "vitest";
import { calendarListCommand, eventAddCommand, eventDeleteCommand, eventEditCommand, eventPeriodCommand, isCalendarEventCreateRequest, isCalendarEventUpdateRequest, isCalendarWindowRequest, parseCalendarWindow } from "./hey-calendar";

const request = { startsOn: "2026-09-01", endsOn: "2026-09-07" };

describe("HEY Calendar bridge", () => {
  it("builds bounded read-only CLI commands", () => {
    expect(calendarListCommand()).toEqual(["calendar", "list", "--json"]);
    expect(eventPeriodCommand({ ...request, calendarId: "42" })).toEqual([
      "event", "week", "2026-09-01", "--all", "--json",
    ]);
  });

  it("uses HEY's period reads so recurring events are expanded like the app", () => {
    expect(eventPeriodCommand({ startsOn: "2026-09-02", endsOn: "2026-09-02" })).toEqual([
      "event", "day", "2026-09-02", "--all", "--json",
    ]);
    expect(eventPeriodCommand({ startsOn: "2026-08-31", endsOn: "2026-09-06", calendarId: "42" })).toEqual([
      "event", "week", "2026-08-31", "--all", "--json",
    ]);
    expect(eventPeriodCommand({ startsOn: "2026-01-01", endsOn: "2026-12-31" })).toEqual([
      "event", "list", "--starts-on", "2026-01-01", "--ends-on", "2026-12-31", "--all", "--json",
    ]);
  });

  it("accepts a bounded full-year event window without widening week-only reads", () => {
    const year = { startsOn: "2026-01-01", endsOn: "2026-12-31" };
    expect(isCalendarWindowRequest(year)).toBe(true);
    expect(isCalendarWindowRequest(year, 42)).toBe(false);
    expect(isCalendarWindowRequest({ startsOn: "2026-01-01", endsOn: "2027-12-31" })).toBe(false);
  });

  it("builds a complete argv-only create command", () => {
    expect(eventAddCommand({
      title: "Design review",
      calendarId: "42",
      startsOn: "2026-09-03",
      allDay: false,
      startTime: "14:00",
      endTime: "15:00",
      location: "Studio",
      link: "https://meet.example.com/room",
      notes: "Settle the launch plan.",
      invites: ["alex@example.com", "sam@example.com"],
      reminders: ["15m", "1h"],
      repeat: "every_week",
      circle: true,
    })).toEqual([
      "event", "add", "Design review", "--calendar", "42", "--starts-on", "2026-09-03",
      "--start-time", "14:00", "--end-time", "15:00", "--location", "Studio",
      "--link", "https://meet.example.com/room", "--notes", "Settle the launch plan.",
      "--invite", "alex@example.com", "--invite", "sam@example.com",
      "--remind", "15m", "--remind", "1h", "--repeat", "every_week", "--circle", "--json",
    ]);
  });

  it("builds scoped argv-only edit and delete commands", () => {
    expect(eventEditCommand({
      id: "4821",
      lookupDate: "2026-09-02",
      title: "Design review (moved)",
      startsOn: "2026-09-04",
      endsOn: "2026-09-04",
      allDay: false,
      startTime: "15:00",
      endTime: "16:00",
      timeZone: "America/New_York",
      invites: [],
      circle: false,
    })).toEqual([
      "event", "edit", "4821", "2026-09-02", "--title", "Design review (moved)",
      "--starts-on", "2026-09-04", "--ends-on", "2026-09-04", "--all-day=false",
      "--start-time", "15:00", "--end-time", "16:00", "--time-zone", "America/New_York",
      "--invite", "", "--circle=false", "--json",
    ]);
    expect(eventDeleteCommand("4821")).toEqual(["event", "delete", "4821", "--json"]);
  });

  it("rejects malformed or ambiguous create requests at the IPC boundary", () => {
    const valid = { title: "Design review", calendarId: "42", startsOn: "2026-09-03", allDay: false, startTime: "14:00", endTime: "15:00", invites: ["alex@example.com"], reminders: ["15m"] };
    expect(isCalendarEventCreateRequest(valid)).toBe(true);
    expect(isCalendarEventCreateRequest({ ...valid, calendarId: "work" })).toBe(false);
    expect(isCalendarEventCreateRequest({ ...valid, endTime: "13:00" })).toBe(false);
    expect(isCalendarEventCreateRequest({ ...valid, invites: ["not-an-email"] })).toBe(false);
    expect(isCalendarEventCreateRequest({ ...valid, link: "javascript:alert(1)" })).toBe(false);
    expect(isCalendarEventCreateRequest({ ...valid, repeatUntil: "2026-10-01" })).toBe(false);
  });

  it("accepts bounded edits and rejects ambiguous or empty updates", () => {
    const valid = { id: "4821", lookupDate: "2026-09-02", title: "Design review" };
    expect(isCalendarEventUpdateRequest(valid)).toBe(true);
    expect(isCalendarEventUpdateRequest({ id: "4821", lookupDate: "2026-09-02" })).toBe(false);
    expect(isCalendarEventUpdateRequest({ ...valid, id: "event-4821" })).toBe(false);
    expect(isCalendarEventUpdateRequest({ ...valid, lookupDate: "tomorrow" })).toBe(false);
    expect(isCalendarEventUpdateRequest({ ...valid, allDay: false })).toBe(false);
    expect(isCalendarEventUpdateRequest({ ...valid, allDay: false, startsOn: "2026-09-02", endsOn: "2026-09-02", startTime: "15:00", endTime: "14:00" })).toBe(false);
    expect(isCalendarEventUpdateRequest({ ...valid, invites: [] })).toBe(true);
    expect(isCalendarEventUpdateRequest({ ...valid, reminders: [] })).toBe(false);
    expect(isCalendarEventUpdateRequest({ ...valid, link: "" })).toBe(true);
  });

  it("normalizes HEY calendars and events in chronological order", () => {
    const result = parseCalendarWindow(
      JSON.stringify({ data: { calendars: [{ id: 42, name: "Work", kind: "primary", color: "#4f7cff", owned: true, personal: false, external: false, owner_email_address: "owner@example.com" }] } }),
      JSON.stringify({ data: { events: [
        { id: 2, title: "Later", starts_at: "2026-09-03T14:00:00-04:00", ends_at: "2026-09-03T15:00:00-04:00", calendar: { id: 42, name: "Work" }, location: "Studio", reminders: [{ id: 9, duration: 900 }], organizer: { name: "Alex", email_address: "alex@example.com" }, attendances: [{ name: "Sam", email_address: "sam@example.com", status: "accepted" }], attendances_summary: "1 attending", join_link: { title: "Call", url: "https://meet.example.com/room" }, attached_entry: { id: 0 } },
        { id: 1, title: "Launch day", starts_at: "2026-09-01", ends_at: "2026-09-02", all_day: true, recurring: true, highlighted: true, starts_at_time_zone: "America/New_York", calendar: { id: 42, name: "Work" }, description: "Ship it", url: "https://example.com/launch", edit_url: "https://calendar.hey.com/events/1/edit", attached_entry: { id: 77 } },
      ] } }),
      request,
    );

    expect(result.status).toBe("ready");
    expect(result.events.map((event) => event.id)).toEqual(["1", "2"]);
    expect(result.events[0]).toMatchObject({ allDay: true, recurring: true, highlighted: true, attachedEntryId: "77", linkUrl: "https://example.com/launch", editUrl: "https://calendar.hey.com/events/1/edit", calendar: { color: "#4f7cff", owned: true, writable: true, ownerEmailAddress: "owner@example.com" } });
    expect(result.events[1]?.reminders[0]).toMatchObject({ id: "9", durationSeconds: 900 });
    expect(result.events[1]).toMatchObject({ organizer: { name: "Alex" }, attendees: [{ name: "Sam", status: "accepted" }], attendanceSummary: "1 attending", joinLink: { title: "Call" } });
  });

  it("accepts a top-level array envelope and omits malformed events", () => {
    const result = parseCalendarWindow(
      JSON.stringify({ data: [{ id: "8", name: null }] }),
      JSON.stringify({ data: [{ id: "3", title: "Valid", starts_at: "2026-09-02", ends_at: "2026-09-03", calendar: { id: "8" } }, { id: "broken" }] }),
      request,
    );
    expect(result.calendars).toEqual([{ id: "8", name: "Calendar", writable: false }]);
    expect(result.events).toHaveLength(1);
  });

  it("preserves occurrence identity while keeping the series ID for edits", () => {
    const result = parseCalendarWindow(
      JSON.stringify({ data: [{ id: 8, name: "Work" }] }),
      JSON.stringify({ data: [
        { id: 204, occurrence_id: "204_2026-09-02", title: "Standup", recurring: true, starts_at: "2026-09-02T09:15:00Z", ends_at: "2026-09-02T09:30:00Z", calendar: { id: 8, name: "Work" } },
        { id: 204, occurrence_id: "204_2026-09-04", title: "Standup", starts_at: "2026-09-04T09:15:00Z", ends_at: "2026-09-04T09:30:00Z", calendar: { id: 8, name: "Work" }, summary: "Team sync" },
      ] }),
      request,
    );
    expect(result.events.map(({ id, occurrenceId, recurring }) => ({ id, occurrenceId, recurring }))).toEqual([
      { id: "204", occurrenceId: "204_2026-09-02", recurring: true },
      { id: "204", occurrenceId: "204_2026-09-04", recurring: true },
    ]);
    expect(result.events[1]?.description).toBe("Team sync");
  });
});
