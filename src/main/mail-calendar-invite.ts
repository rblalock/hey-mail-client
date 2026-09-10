import { readFile, stat } from "node:fs/promises";
import ICAL from "ical.js";
import type { MailCalendarInvite } from "../shared/contracts";
import { isCalendarAttachment } from "../shared/mail-attachments";
import { downloadMailAttachment, resolveMailAttachment } from "./mail-attachments";

export function parseCalendarInvite(source: string, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): MailCalendarInvite {
  if (Buffer.byteLength(source) > 1_000_000) throw new Error("This calendar file is too large to preview. Save it or open it in HEY.");
  try {
    const calendar = new ICAL.Component(ICAL.parse(source));
    const events = calendar.getAllSubcomponents("vevent");
    if (calendar.name !== "vcalendar" || events.length !== 1) throw new Error("unsupported");
    const component = events[0]!;
    const event = new ICAL.Event(component);
    const start = event.startDate;
    const end = event.endDate;
    if (!start || !end) throw new Error("missing dates");
    const title = event.summary || "Calendar invitation";
    const organizer = component.getFirstProperty("organizer");
    const result: MailCalendarInvite = {
      title,
      when: `${start.toString()} – ${end.toString()}`,
      ...(event.location ? { location: event.location } : {}),
      ...(organizer ? { organizer: String(organizer.getParameter("cn") || organizer.getFirstValue()).replace(/^mailto:/i, "") } : {}),
    };
    const method = String(calendar.getFirstPropertyValue("method") ?? "PUBLISH").toUpperCase();
    if (method === "CANCEL" || String(component.getFirstPropertyValue("status")).toUpperCase() === "CANCELLED") {
      return { ...result, notice: "This event was cancelled. Open HEY to review the cancellation." };
    }
    if (!["REQUEST", "PUBLISH"].includes(method) || event.isRecurring() || event.isRecurrenceException()) {
      return { ...result, notice: "Manage this recurring event or invitation update in HEY." };
    }
    for (const name of ["dtstart", "dtend"]) {
      const property = component.getFirstProperty(name);
      const value = property?.getFirstValue() as ICAL.Time | undefined;
      if (property?.getParameter("tzid") && value?.zone.tzid === "floating") {
        return { ...result, notice: "The invitation’s time zone could not be resolved. Open HEY to keep its time accurate." };
      }
    }
    const startDate = start.toJSDate();
    const endDate = end.toJSDate();
    if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || endDate < startDate) throw new Error("invalid dates");
    const parts = (date: Date) => {
      const values = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
      const part = (name: Intl.DateTimeFormatPartTypes) => values.find((value) => value.type === name)!.value;
      return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
    };
    const from = parts(startDate), to = parts(endDate);
    const inclusiveEnd = end.clone();
    if (start.isDate) inclusiveEnd.adjust(-1, 0, 0, 0);
    result.when = start.isDate ? `${start.toString()} · All day` : `${new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(startDate)} – ${new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(endDate)} (${timeZone})`;
    result.copy = {
      title, calendarId: "", allDay: start.isDate,
      startsOn: start.isDate ? start.toString() : from.date,
      endsOn: start.isDate ? inclusiveEnd.toString() : to.date,
      ...(!start.isDate ? { startTime: from.time, endTime: to.time, timeZone } : {}),
      ...(event.location ? { location: event.location } : {}),
      ...(event.description ? { notes: event.description } : {}),
      // Deliberately no attendees: this is a personal copy, not an RSVP or re-invite.
    };
    return result;
  } catch {
    throw new Error("This calendar file could not be previewed safely. Save it or open the invitation in HEY.");
  }
}

export async function previewCalendarInvite(topicId: unknown, attachmentId: unknown): Promise<MailCalendarInvite> {
  const file = await resolveMailAttachment(topicId, attachmentId);
  if (!isCalendarAttachment(file)) throw new Error("This attachment is not a calendar invitation.");
  if ((file.byteSize ?? 0) > 1_000_000) throw new Error("This calendar file is too large to preview.");
  const downloaded = await downloadMailAttachment(file);
  try {
    if ((await stat(downloaded.path)).size > 1_000_000) throw new Error("This calendar file is too large to preview.");
    return parseCalendarInvite(await readFile(downloaded.path, "utf8"));
  } finally { await downloaded.cleanup(); }
}
