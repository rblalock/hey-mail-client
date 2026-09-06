import type { CalendarEvent } from "../../shared/contracts";
import { describe, expect, it } from "vitest";
import { addDays, addYears, calendarAllDaySpans, calendarEventKey, calendarPresentedWindow, calendarTargetDate, calendarTimedClusters, calendarWindow, eventDayKey, eventOccursOn, filterCalendarEvents } from "./calendar";

const event = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "1",
  title: "Design review",
  startsAt: "2026-09-01T14:00:00-04:00",
  endsAt: "2026-09-01T15:00:00-04:00",
  allDay: false,
  recurring: false,
  calendar: { id: "10", name: "Work" },
  reminders: [],
  attendees: [],
  ...overrides,
});

describe("calendar view utilities", () => {
  it("builds day and locale-aware week windows", () => {
    expect(calendarWindow("day", "2026-09-02", 0)).toEqual({ startsOn: "2026-09-02", endsOn: "2026-09-02" });
    expect(calendarWindow("week", "2026-09-02", 1)).toEqual({ startsOn: "2026-08-31", endsOn: "2026-09-06" });
    expect(addDays("2026-08-31", 6)).toBe("2026-09-06");
  });

  it("keeps the loaded calendar window intact until the requested window arrives", () => {
    const loaded = { startsOn: "2026-08-30", endsOn: "2026-09-05" };
    const nextWeek = { startsOn: "2026-09-06", endsOn: "2026-09-12" };
    expect(calendarPresentedWindow("week", nextWeek, loaded)).toEqual({ mode: "week", ...loaded });
    expect(calendarPresentedWindow("week", nextWeek, nextWeek)).toEqual({ mode: "week", ...nextWeek });

    const nextDay = { startsOn: "2026-09-06", endsOn: "2026-09-06" };
    expect(calendarPresentedWindow("day", nextDay, loaded)).toEqual({ mode: "week", ...loaded });
    expect(calendarPresentedWindow("day", nextDay, nextDay)).toEqual({ mode: "day", ...nextDay });
  });

  it("builds stable year windows and year navigation", () => {
    expect(calendarWindow("year", "2026-09-03")).toEqual({ startsOn: "2026-01-01", endsOn: "2026-12-31" });
    expect(addYears("2024-02-29", 1)).toBe("2025-02-28");
    expect(calendarPresentedWindow("year", { startsOn: "2027-01-01", endsOn: "2027-12-31" }, { startsOn: "2026-01-01", endsOn: "2026-12-31" })).toEqual({ mode: "year", startsOn: "2026-01-01", endsOn: "2026-12-31" });
  });

  it("reads event dates from native deep links before legacy display text", () => {
    expect(calendarTargetDate("hey-agent://calendar/events/42?date=2026-09-03", "2026-09-01 · 2:00 PM")).toBe("2026-09-03");
    expect(calendarTargetDate("hey-agent://calendar/dates/2026-09-05")).toBe("2026-09-05");
    expect(calendarTargetDate("hey-agent://calendar/events/42", "Event on 2026-09-04")).toBe("2026-09-04");
    expect(calendarTargetDate("hey-agent://calendar/events/42?date=not-a-date")).toBeUndefined();
  });

  it("places multi-day and cross-midnight events on every day they occupy", () => {
    const allDay = event({ allDay: true, startsAt: "2026-09-01", endsAt: "2026-09-04" });
    expect(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"].map((day) => eventOccursOn(allDay, day))).toEqual([true, true, true, false]);
    const overnight = event({ startsAt: "2026-09-01T23:00:00-04:00", endsAt: "2026-09-02T01:00:00-04:00" });
    expect(eventOccursOn(overnight, "2026-09-02")).toBe(true);
  });

  it("keeps all-day dates stable and localizes timed events", () => {
    expect(eventDayKey(event({ allDay: true, startsAt: "2026-09-01", endsAt: "2026-09-02" }))).toBe("2026-09-01");
    expect(eventDayKey(event())).toMatch(/^2026-09-0[12]$/);
  });

  it("uses occurrence identity for repeated series in the same view", () => {
    expect(calendarEventKey(event({ id: "204", occurrenceId: "204_2026-09-02" }))).toBe("204_2026-09-02");
    expect(calendarEventKey(event({ id: "204", startsAt: "2026-09-04T09:15:00-04:00" }))).toMatch(/^204:2026-09-04$/);
  });

  it("groups exact and partial overlaps without merging adjacent events", () => {
    const events = [
      event({ id: "a", title: "A", startsAt: "2026-09-02T09:00:00-04:00", endsAt: "2026-09-02T10:00:00-04:00" }),
      event({ id: "b", title: "B", startsAt: "2026-09-02T09:00:00-04:00", endsAt: "2026-09-02T09:30:00-04:00" }),
      event({ id: "c", title: "C", startsAt: "2026-09-02T09:45:00-04:00", endsAt: "2026-09-02T10:15:00-04:00" }),
      event({ id: "d", title: "D", startsAt: "2026-09-02T10:15:00-04:00", endsAt: "2026-09-02T11:00:00-04:00" }),
    ];
    expect(calendarTimedClusters(events, "2026-09-02").map((cluster) => cluster.events.map(({ id }) => id))).toEqual([["a", "b", "c"], ["d"]]);
  });

  it("gives zero-duration events a safe layout span", () => {
    const clusters = calendarTimedClusters([event({ id: "zero", startsAt: "2026-09-02T09:00:00-04:00", endsAt: "2026-09-02T09:00:00-04:00" })], "2026-09-02");
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.endsAt).toBeGreaterThan(clusters[0]!.startsAt);
  });

  it("deduplicates all-day spans and assigns non-overlapping lanes", () => {
    const multiDay = event({ id: "span", allDay: true, startsAt: "2026-09-01", endsAt: "2026-09-04" });
    const collision = event({ id: "single", allDay: true, startsAt: "2026-09-02", endsAt: "2026-09-02" });
    const later = event({ id: "later", allDay: true, startsAt: "2026-09-04", endsAt: "2026-09-04" });
    const spans = calendarAllDaySpans([multiDay, multiDay, collision, later], ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]);
    expect(spans.map(({ event: item, startDay, endDay, lane }) => ({ id: item.id, startDay, endDay, lane }))).toEqual([
      { id: "span", startDay: 0, endDay: 2, lane: 0 },
      { id: "later", startDay: 3, endDay: 3, lane: 0 },
      { id: "single", startDay: 1, endDay: 1, lane: 1 },
    ]);
  });

  it("filters the current view by calendar and visible event fields", () => {
    const events = [event(), event({ id: "2", title: "Dinner", calendar: { id: "20", name: "Personal" }, location: "Clover House" })];
    expect(filterCalendarEvents(events, "10", "").map(({ id }) => id)).toEqual(["1"]);
    expect(filterCalendarEvents(events, "", "clover").map(({ id }) => id)).toEqual(["2"]);
  });
});
