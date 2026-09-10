import { describe, expect, it } from "vitest";
import { parseCalendarInvite } from "./mail-calendar-invite";

const calendar = (fields: string, method = "REQUEST") => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:${method}\r\nBEGIN:VEVENT\r\nUID:example\r\nSUMMARY:Team dinner\r\n${fields}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
describe("calendar attachment previews", () => {
  it("handles UTC, local dates across midnight, folded text and escaped commas without re-inviting attendees", () => {
    const result = parseCalendarInvite(calendar("DTSTART:20260910T223000Z\r\nDTEND:20260911T010000Z\r\nLOCATION:Room A\\,\r\n  Main building\r\nORGANIZER;CN=Maya:mailto:maya@example.test\r\nATTENDEE:mailto:alex@example.test"), "America/New_York");
    expect(result.copy).toMatchObject({ title: "Team dinner", startsOn: "2026-09-10", endsOn: "2026-09-10", startTime: "18:30", endTime: "21:00", timeZone: "America/New_York", allDay: false, location: "Room A, Main building" });
    expect(result.copy?.invites).toBeUndefined();
    expect(result.organizer).toBe("Maya");
  });
  it("preserves all-day dates and converts exclusive ICS ends for the calendar editor", () => {
    const result = parseCalendarInvite(calendar("DTSTART;VALUE=DATE:20260910\r\nDTEND;VALUE=DATE:20260912"), "America/Los_Angeles");
    expect(result.copy).toMatchObject({ startsOn: "2026-09-10", endsOn: "2026-09-11", allDay: true });
  });
  it.each(["RRULE:FREQ=WEEKLY", "RECURRENCE-ID:20260910T223000Z", "STATUS:CANCELLED"])("does not flatten special invitation state: %s", (extra) => {
    expect(parseCalendarInvite(calendar(`DTSTART:20260910T223000Z\r\nDTEND:20260911T010000Z\r\n${extra}`)).copy).toBeUndefined();
  });
  it("does not turn a cancellation or reply into a new event", () => {
    for (const method of ["CANCEL", "REPLY"]) expect(parseCalendarInvite(calendar("DTSTART:20260910T223000Z\r\nDTEND:20260911T010000Z", method)).copy).toBeUndefined();
  });
  it("rejects invalid input and unresolved timezones instead of guessing", () => {
    expect(() => parseCalendarInvite("not a calendar")).toThrow("could not be previewed");
    expect(() => parseCalendarInvite("x".repeat(1_000_001))).toThrow("too large");
    expect(parseCalendarInvite(calendar("DTSTART;TZID=Unknown/Zone:20260910T183000\r\nDTEND;TZID=Unknown/Zone:20260910T210000")).copy).toBeUndefined();
  });
});
