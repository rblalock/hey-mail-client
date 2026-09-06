import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../../shared/contracts";
import { calendarWindow } from "./calendar";
import { calendarHelperInput, eventHelperAttachment } from "./helper-context";

describe("Helper Calendar launch context", () => {
  const now = new Date("2026-09-05T02:30:00Z");

  it("captures the requested local day, not the UTC date or the later model start", () => {
    const input = calendarHelperInput("daily-brief", undefined, now, "America/New_York");
    expect(input.attachments[0]).toMatchObject({ objectKind: "calendar-date", id: "2026-09-04", deepLink: "hey-agent://calendar/dates/2026-09-04" });
    expect(input.prompt).toContain("Daily Brief for 2026-09-04");
    expect(input.prompt).toContain("As of 2026-09-04, 10:30 PM");
    expect(input.prompt).toContain("America/New_York");
    expect(calendarHelperInput("daily-brief", undefined, now, "Asia/Tokyo").attachments[0]?.id).toBe("2026-09-05");
  });

  it("briefs one selected day even when launched from a week", () => {
    const input = calendarHelperInput("daily-brief", { date: "2027-01-01", mode: "week" }, now, "UTC");
    expect(input.prompt).toContain("Daily Brief for 2027-01-01");
    expect(input.prompt).toContain("Active HEY calendars");
    expect(input.prompt.length).toBeLessThan(250);
  });

  it("triages the displayed day or exact locale week across year and DST boundaries", () => {
    const day = calendarHelperInput("calendar-triage", { date: "2026-11-01", mode: "day" }, now, "America/New_York");
    expect(day.prompt).toContain("Review 2026-11-01 and suggest next steps");
    for (const date of ["2027-01-01", "2026-11-01"]) {
      const week = calendarHelperInput("calendar-triage", { date, mode: "week" }, now, "America/New_York");
      const range = calendarWindow("week", date);
      expect(week.prompt).toContain(`Review ${range.startsOn} – ${range.endsOn}`);
      expect(week.prompt).toContain("Don't change anything yet");
    }
    expect(calendarHelperInput("calendar-triage", undefined, now, "America/New_York").attachments[0]?.subtitle).toContain("Week");
  });

  it("attaches dates to personal Calendar Helpers without imposing a built-in task", () => {
    const input = calendarHelperInput("custom-project", { date: "2026-09-04", mode: "day" }, now, "UTC");
    expect(input.prompt).toContain("Calendar context for this Helper");
    expect(input.prompt).not.toContain("Prepare my Daily Brief");
  });

  it("keeps the exact occurrence date and safely encodes an event's stable ID", () => {
    const event = { id: "series:42", title: "All-day note", startsAt: "2026-09-04", allDay: true } as CalendarEvent;
    expect(eventHelperAttachment(event)).toEqual({ kind: "hey-object", objectKind: "calendar-event", id: "series:42", title: "All-day note", subtitle: "2026-09-04 · All day", deepLink: "hey-agent://calendar/events/series%3A42?date=2026-09-04" });
  });
});
