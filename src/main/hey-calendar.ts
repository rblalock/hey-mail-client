import type { CalendarEvent, CalendarEventCreateRequest, CalendarEventCreateResult, CalendarEventMutationResult, CalendarEventUpdateRequest, CalendarSummary, CalendarWindowRequest, CalendarWindowResult } from "../shared/contracts";
import { findExecutable, runFile } from "./profile-process";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseJson(stdout: string): JsonRecord {
  const parsed: unknown = JSON.parse(stdout);
  return record(parsed);
}

function envelopeData(payload: JsonRecord): JsonRecord {
  return record(payload.data ?? payload);
}

function collection(payload: JsonRecord, key: string): unknown[] {
  const data = envelopeData(payload);
  if (Array.isArray(data[key])) return data[key] as unknown[];
  if (Array.isArray(payload[key])) return payload[key] as unknown[];
  if (Array.isArray(payload.data)) return payload.data as unknown[];
  return [];
}

function calendarFrom(value: unknown): CalendarSummary {
  const calendar = record(value);
  const id = stringValue(calendar.id);
  const external = booleanValue(calendar.external);
  const owned = booleanValue(calendar.owned);
  const personal = booleanValue(calendar.personal);
  return {
    id,
    name: stringValue(calendar.name, "Calendar"),
    ...(stringValue(calendar.kind) ? { kind: stringValue(calendar.kind) } : {}),
    ...(stringValue(calendar.color) ? { color: stringValue(calendar.color) } : {}),
    ...(external === undefined ? {} : { external }),
    ...(owned === undefined ? {} : { owned }),
    ...(personal === undefined ? {} : { personal }),
    ...(stringValue(calendar.owner_email_address) ? { ownerEmailAddress: stringValue(calendar.owner_email_address) } : {}),
    writable: owned === true && external !== true && personal !== true,
  };
}

function eventFrom(value: unknown, calendars: Map<string, CalendarSummary>): CalendarEvent | undefined {
  const event = record(value);
  const id = stringValue(event.id);
  const startsAt = stringValue(event.starts_at);
  const endsAt = stringValue(event.ends_at);
  if (!id || !startsAt || !endsAt) return undefined;

  const inlineCalendar = calendarFrom(event.calendar);
  const calendar = calendars.get(inlineCalendar.id) ?? inlineCalendar;
  const attachedEntryId = stringValue(record(event.attached_entry).id);
  const reminders = arrayValue(event.reminders).map((value) => {
    const reminder = record(value);
    const durationSeconds = numberValue(reminder.duration);
    return {
      ...(stringValue(reminder.id) ? { id: stringValue(reminder.id) } : {}),
      label: stringValue(reminder.label, stringValue(reminder.summary, "Reminder")),
      ...(stringValue(reminder.summary) ? { summary: stringValue(reminder.summary) } : {}),
      ...(stringValue(reminder.remind_at) ? { remindAt: stringValue(reminder.remind_at) } : {}),
      ...(durationSeconds === undefined ? {} : { durationSeconds }),
    };
  });
  const personFrom = (value: unknown) => {
    const person = record(value);
    const name = stringValue(person.name, stringValue(person.email_address));
    return {
      name,
      ...(stringValue(person.email_address) ? { email: stringValue(person.email_address) } : {}),
      ...(stringValue(person.status) ? { status: stringValue(person.status) } : {}),
    };
  };
  const organizer = personFrom(event.organizer);
  const attendees = arrayValue(event.attendances).map(personFrom).filter((person) => person.name);
  const joinLink = record(event.join_link);

  return {
    id,
    ...(stringValue(event.occurrence_id) ? { occurrenceId: stringValue(event.occurrence_id) } : {}),
    title: stringValue(event.title, "Untitled event"),
    startsAt,
    endsAt,
    allDay: event.all_day === true,
    recurring: event.recurring === true || Boolean(stringValue(event.recurring)) || Boolean(event.recurrence_schedule) || Boolean(stringValue(event.occurrence_id)),
    ...(event.highlighted === true ? { highlighted: true } : {}),
    ...(stringValue(event.starts_at_time_zone) ? { timeZone: stringValue(event.starts_at_time_zone) } : {}),
    calendar,
    ...(stringValue(event.description, stringValue(event.summary)) ? { description: stringValue(event.description, stringValue(event.summary)) } : {}),
    ...(stringValue(event.location) ? { location: stringValue(event.location) } : {}),
    ...(stringValue(event.url) ? { linkUrl: stringValue(event.url) } : {}),
    ...(stringValue(event.edit_url) ? { editUrl: stringValue(event.edit_url) } : {}),
    ...(attachedEntryId && attachedEntryId !== "0" ? { attachedEntryId } : {}),
    reminders,
    ...(organizer.name ? { organizer } : {}),
    attendees,
    ...(stringValue(event.attendances_summary) ? { attendanceSummary: stringValue(event.attendances_summary) } : {}),
    ...(stringValue(joinLink.url) ? { joinLink: { ...(stringValue(joinLink.title) ? { title: stringValue(joinLink.title) } : {}), url: stringValue(joinLink.url) } } : {}),
  };
}

export function calendarListCommand(): string[] {
  return ["calendar", "list", "--json"];
}

export function isCalendarWindowRequest(value: unknown, maximumDays = 370): value is CalendarWindowRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Partial<CalendarWindowRequest>;
  if (!validDate(request.startsOn) || !validDate(request.endsOn) || request.startsOn > request.endsOn) return false;
  const days = Math.round((Date.parse(`${request.endsOn}T00:00:00Z`) - Date.parse(`${request.startsOn}T00:00:00Z`)) / 86_400_000);
  return days <= maximumDays && (request.calendarId === undefined || typeof request.calendarId === "string" && /^\d+$/.test(request.calendarId));
}

export function eventPeriodCommand(request: CalendarWindowRequest): string[] {
  if (request.startsOn === request.endsOn) return ["event", "day", request.startsOn, "--all", "--json"];
  const days = Math.round((Date.parse(`${request.endsOn}T12:00:00Z`) - Date.parse(`${request.startsOn}T12:00:00Z`)) / 86_400_000);
  if (days === 6) return ["event", "week", request.startsOn, "--all", "--json"];
  return ["event", "list", "--starts-on", request.startsOn, "--ends-on", request.endsOn, "--all", "--json"];
}

export function eventAddCommand(request: CalendarEventCreateRequest): string[] {
  return [
    "event", "add", request.title,
    "--calendar", request.calendarId,
    "--starts-on", request.startsOn,
    ...(request.endsOn ? ["--ends-on", request.endsOn] : []),
    ...(request.allDay ? ["--all-day"] : []),
    ...(request.startTime ? ["--start-time", request.startTime] : []),
    ...(request.endTime ? ["--end-time", request.endTime] : []),
    ...(request.timeZone ? ["--time-zone", request.timeZone] : []),
    ...(request.location ? ["--location", request.location] : []),
    ...(request.link ? ["--link", request.link] : []),
    ...(request.notes ? ["--notes", request.notes] : []),
    ...(request.invites ?? []).flatMap((email) => ["--invite", email]),
    ...(request.reminders ?? []).flatMap((reminder) => ["--remind", reminder]),
    ...(request.repeat ? ["--repeat", request.repeat] : []),
    ...(request.repeatUntil ? ["--repeat-until", request.repeatUntil] : []),
    ...(request.countdown ? ["--countdown", String(request.countdown), "--countdown-unit", request.countdownUnit ?? "days"] : []),
    ...(request.circle ? ["--circle"] : []),
    "--json",
  ];
}

export function eventEditCommand(request: CalendarEventUpdateRequest): string[] {
  return [
    "event", "edit", request.id, request.lookupDate,
    ...(request.title !== undefined ? ["--title", request.title] : []),
    ...(request.startsOn !== undefined ? ["--starts-on", request.startsOn] : []),
    ...(request.endsOn !== undefined ? ["--ends-on", request.endsOn] : []),
    ...(request.allDay !== undefined ? [`--all-day=${request.allDay}`] : []),
    ...(request.startTime !== undefined ? ["--start-time", request.startTime] : []),
    ...(request.endTime !== undefined ? ["--end-time", request.endTime] : []),
    ...(request.timeZone !== undefined ? ["--time-zone", request.timeZone] : []),
    ...(request.location !== undefined ? ["--location", request.location] : []),
    ...(request.link !== undefined ? ["--link", request.link] : []),
    ...(request.notes !== undefined ? ["--notes", request.notes] : []),
    ...(request.invites === undefined ? [] : request.invites.length > 0 ? request.invites.flatMap((email) => ["--invite", email]) : ["--invite", ""]),
    ...(request.reminders ?? []).flatMap((reminder) => ["--remind", reminder]),
    ...(request.repeat !== undefined ? ["--repeat", request.repeat] : []),
    ...(request.repeatUntil !== undefined ? ["--repeat-until", request.repeatUntil] : []),
    ...(request.countdown !== undefined ? ["--countdown", String(request.countdown), "--countdown-unit", request.countdownUnit ?? "days"] : []),
    ...(request.circle !== undefined ? [`--circle=${request.circle}`] : []),
    "--json",
  ];
}

export function eventDeleteCommand(id: string): string[] {
  return ["event", "delete", id, "--json"];
}

const validDate = (date: unknown): date is string => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`));
const validTime = (time: unknown): time is string => typeof time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
const validEmail = (email: unknown): email is string => typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320;
const validReminder = (reminder: unknown): reminder is string => typeof reminder === "string" && /^\d+[mhdw]$/.test(reminder);
const validRepeat = (repeat: unknown): boolean => typeof repeat === "string" && ["every_day", "every_weekday", "every_week", "every_other_week", "every_day_of_month", "every_year"].includes(repeat);

export function isCalendarEventCreateRequest(value: unknown): value is CalendarEventCreateRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Partial<CalendarEventCreateRequest>;
  const text = [request.location, request.notes, request.timeZone];
  const emails = request.invites ?? [];
  const reminders = request.reminders ?? [];
  if (typeof request.title !== "string" || !request.title.trim() || request.title.trim().startsWith("-") || request.title.length > 300) return false;
  if (typeof request.calendarId !== "string" || !/^\d+$/.test(request.calendarId)) return false;
  if (!validDate(request.startsOn) || request.endsOn !== undefined && !validDate(request.endsOn)) return false;
  if (request.endsOn && request.endsOn < request.startsOn) return false;
  if (typeof request.allDay !== "boolean") return false;
  if (!request.allDay && (!validTime(request.startTime) || request.endTime !== undefined && !validTime(request.endTime))) return false;
  if (!request.allDay && (!request.endsOn || request.endsOn === request.startsOn) && request.endTime && request.startTime && request.endTime <= request.startTime) return false;
  if (request.link !== undefined && (typeof request.link !== "string" || request.link.length > 2_000 || !/^https?:\/\//i.test(request.link))) return false;
  if (!text.every((item) => item === undefined || typeof item === "string" && item.length <= 10_000)) return false;
  if (!Array.isArray(emails) || emails.length > 100 || !emails.every(validEmail)) return false;
  if (!Array.isArray(reminders) || reminders.length > 10 || !reminders.every(validReminder)) return false;
  if (request.repeat !== undefined && !validRepeat(request.repeat)) return false;
  if (request.repeatUntil !== undefined && (!validDate(request.repeatUntil) || request.repeatUntil < request.startsOn || !request.repeat)) return false;
  if (request.countdown !== undefined && (!Number.isInteger(request.countdown) || request.countdown < 1 || request.countdown > 999)) return false;
  if (request.countdownUnit !== undefined && !["days", "weeks", "months"].includes(request.countdownUnit)) return false;
  return request.circle === undefined || typeof request.circle === "boolean";
}

export function isCalendarEventUpdateRequest(value: unknown): value is CalendarEventUpdateRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Partial<CalendarEventUpdateRequest>;
  if (typeof request.id !== "string" || !/^\d+$/.test(request.id) || !validDate(request.lookupDate)) return false;
  const changeKeys: Array<keyof CalendarEventUpdateRequest> = ["title", "startsOn", "endsOn", "allDay", "startTime", "endTime", "timeZone", "location", "link", "notes", "invites", "reminders", "repeat", "repeatUntil", "countdown", "countdownUnit", "circle"];
  if (!changeKeys.some((key) => Object.hasOwn(request, key))) return false;
  if (request.title !== undefined && (typeof request.title !== "string" || !request.title.trim() || request.title.trim().startsWith("-") || request.title.length > 300)) return false;
  if (request.startsOn !== undefined && !validDate(request.startsOn) || request.endsOn !== undefined && !validDate(request.endsOn)) return false;
  if (request.startsOn && request.endsOn && request.endsOn < request.startsOn) return false;
  if (request.allDay !== undefined && typeof request.allDay !== "boolean") return false;
  if (request.startTime !== undefined && !validTime(request.startTime) || request.endTime !== undefined && !validTime(request.endTime)) return false;
  if (request.allDay === false && !validTime(request.startTime)) return false;
  if (request.startTime && request.endTime && (!request.startsOn || !request.endsOn || request.startsOn === request.endsOn) && request.endTime <= request.startTime) return false;
  if ([request.timeZone, request.location, request.notes].some((item) => item !== undefined && (typeof item !== "string" || item.length > 10_000))) return false;
  if (request.link !== undefined && (typeof request.link !== "string" || request.link.length > 2_000 || request.link !== "" && !/^https?:\/\//i.test(request.link))) return false;
  if (request.invites !== undefined && (!Array.isArray(request.invites) || request.invites.length > 100 || !request.invites.every(validEmail))) return false;
  if (request.reminders !== undefined && (!Array.isArray(request.reminders) || request.reminders.length === 0 || request.reminders.length > 10 || !request.reminders.every(validReminder))) return false;
  if (request.repeat !== undefined && !validRepeat(request.repeat)) return false;
  if (request.repeatUntil !== undefined && (!validDate(request.repeatUntil) || !request.repeat || request.startsOn && request.repeatUntil < request.startsOn)) return false;
  if (request.countdown !== undefined && (!Number.isInteger(request.countdown) || request.countdown < 1 || request.countdown > 30)) return false;
  if (request.countdownUnit !== undefined && !["days", "weeks", "months"].includes(request.countdownUnit)) return false;
  return request.circle === undefined || typeof request.circle === "boolean";
}

export function parseCalendarWindow(
  calendarsStdout: string,
  eventsStdout: string,
  request: CalendarWindowRequest,
): CalendarWindowResult {
  const calendars = collection(parseJson(calendarsStdout), "calendars")
    .map(calendarFrom)
    .filter((calendar) => calendar.id);
  const calendarsById = new Map(calendars.map((calendar) => [calendar.id, calendar]));
  const events = collection(parseJson(eventsStdout), "events")
    .map((value) => eventFrom(value, calendarsById))
    .filter((event): event is CalendarEvent => Boolean(event))
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.endsAt.localeCompare(right.endsAt));
  return { status: "ready", startsOn: request.startsOn, endsOn: request.endsOn, calendars, events };
}

function authFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /auth|login|credential|token|unauthorized|forbidden/i.test(message);
}

export async function listCalendarWindow(
  request: CalendarWindowRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CalendarWindowResult> {
  const executable = await findExecutable("hey", env);
  if (!executable) {
    return { status: "unavailable", startsOn: request.startsOn, endsOn: request.endsOn, calendars: [], events: [], detail: "HEY CLI is not installed." };
  }
  try {
    const [calendars, events] = await Promise.all([
      runFile(executable, calendarListCommand(), { env, timeoutMs: 20_000 }),
      runFile(executable, eventPeriodCommand(request), { env, timeoutMs: 30_000 }),
    ]);
    return parseCalendarWindow(calendars.stdout, events.stdout, request);
  } catch (error) {
    return {
      status: authFailure(error) ? "needs-auth" : "unavailable",
      startsOn: request.startsOn,
      endsOn: request.endsOn,
      calendars: [],
      events: [],
      detail: error instanceof Error ? error.message : "Unable to read HEY Calendar.",
    };
  }
}

export async function createCalendarEvent(
  request: CalendarEventCreateRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CalendarEventCreateResult> {
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is not installed.");
  const output = await runFile(executable, eventAddCommand(request), { env, timeoutMs: 30_000 });
  let eventId = "";
  try {
    const payload = envelopeData(parseJson(output.stdout));
    eventId = stringValue(payload.id ?? record(payload.event).id);
  } catch {
    // Older HEY CLI releases may confirm creation without returning a JSON object.
  }
  return { message: `“${request.title}” was added to HEY Calendar.`, ...(eventId ? { eventId } : {}) };
}

export async function updateCalendarEvent(
  request: CalendarEventUpdateRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CalendarEventMutationResult> {
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is not installed.");
  await runFile(executable, eventEditCommand(request), { env, timeoutMs: 30_000 });
  return { message: "Event updated in HEY Calendar." };
}

export async function deleteCalendarEvent(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CalendarEventMutationResult> {
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is not installed.");
  await runFile(executable, eventDeleteCommand(id), { env, timeoutMs: 30_000 });
  return { message: "Event deleted from HEY Calendar." };
}
