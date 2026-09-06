import type { AgentNativeAttachment, CalendarEvent } from "../../shared/contracts";
import type { HelperId } from "../../shared/helpers";
import { calendarWindow, eventDayKey } from "./calendar";

export type HelperCalendarWindow = { date: string; mode: "day" | "week" };

export function eventHelperAttachment(event: CalendarEvent): AgentNativeAttachment {
  const date = eventDayKey(event);
  return {
    kind: "hey-object", objectKind: "calendar-event", id: event.id, title: event.title,
    subtitle: `${date}${event.allDay ? " · All day" : ""}`,
    deepLink: `hey-agent://calendar/events/${encodeURIComponent(event.id)}?date=${date}`,
  };
}

export function calendarHelperInput(id: HelperId, window?: HelperCalendarWindow, now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const localDate = ["year", "month", "day"].map((part) => parts.find((item) => item.type === part)!.value).join("-");
  const date = window?.date ?? localDate;
  const mode = id === "daily-brief" ? "day" : window?.mode ?? "week";
  const range = calendarWindow(mode, date);
  const title = mode === "day" ? date : `${range.startsOn} – ${range.endsOn}`;
  const attachment: AgentNativeAttachment = {
    kind: "hey-object", objectKind: "calendar-date", id: date, title,
    subtitle: `${mode === "day" ? "Day" : "Week"} · ${timeZone}`,
    deepLink: `hey-agent://calendar/dates/${date}`,
  };
  const task = id === "daily-brief" ? `Prepare my Daily Brief for ${title}.` : id === "calendar-triage" ? `Review ${title} and suggest next steps. Don't change anything yet.` : `Use ${title} as the Calendar context for this Helper.`;
  const localTime = new Intl.DateTimeFormat("en", { timeZone, hour: "numeric", minute: "2-digit" }).format(now);
  // This is also the visible chat request: keep it readable, with instructions in the skill.
  const prompt = `${task}\n\n${timeZone} · As of ${localDate}, ${localTime}. Active HEY calendars.`;
  return { attachments: [attachment], prompt };
}
