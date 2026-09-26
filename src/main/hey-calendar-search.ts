import type { CalendarSearchItem, CalendarSearchKind, CalendarSearchRequest, CalendarSearchResult } from "../shared/contracts";
import { findExecutable, runFile } from "./profile-process";
import { calendarListCommand, parseCalendarWindow } from "./hey-calendar";
import { parseJournalEntries, parseTimeTracks, parseTodos } from "./hey-calendar-recordings";
import { isHeyAuthenticationFailure as authFailure } from "./hey-errors";

type SourceRead = { kind: CalendarSearchKind; items: CalendarSearchItem[] };

const SEARCH_LIMIT = 250;

export const calendarSearchCommands = {
  events: ["event", "list", "--all", "--json"],
  todos: ["todo", "list", "--all", "--json"],
  journal: ["journal", "list", "--all", "--json"],
  time: ["timetrack", "list", "--all", "--json"],
} as const;

function matches(query: string, values: Array<string | undefined>): boolean {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const haystack = values.filter(Boolean).join(" ").toLocaleLowerCase();
  return words.length > 0 && words.every((word) => haystack.includes(word));
}

function firstLine(value: string): string {
  const line = value.split(/\r?\n/).find((candidate) => candidate.trim())?.trim() ?? "Journal entry";
  return line.length > 90 ? `${line.slice(0, 87)}…` : line;
}

export function isCalendarSearchRequest(value: unknown): value is CalendarSearchRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const query = (value as Partial<CalendarSearchRequest>).query;
  return typeof query === "string" && query.trim().length > 0 && query.length <= 300;
}

export async function searchCalendar(
  request: CalendarSearchRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CalendarSearchResult> {
  const query = request.query.trim();
  const hey = await findExecutable("hey", env);
  if (!hey) return { status: "unavailable", query, items: [], unavailableSources: ["event", "todo", "journal", "time"], detail: "HEY CLI is not installed." };

  const calendarRead = runFile(hey, calendarListCommand(), { env, timeoutMs: 30_000 });
  const reads = await Promise.allSettled([
    Promise.all([calendarRead, runFile(hey, [...calendarSearchCommands.events], { env, timeoutMs: 45_000 })]).then(([calendars, events]): SourceRead => ({
      kind: "event",
      items: parseCalendarWindow(calendars.stdout, events.stdout, { startsOn: "0001-01-01", endsOn: "9999-12-31" }).events
        .filter((event) => matches(query, [event.title, event.description, event.location, event.calendar.name, event.organizer?.name, event.organizer?.email, ...event.attendees.flatMap((person) => [person.name, person.email])]))
        .map((event) => ({ kind: "event", id: event.id, title: event.title, date: event.startsAt.slice(0, 10), detail: [event.calendar.name, event.location].filter(Boolean).join(" · ") })),
    })),
    runFile(hey, [...calendarSearchCommands.todos], { env, timeoutMs: 45_000 }).then((output): SourceRead => ({
      kind: "todo",
      items: parseTodos(output.stdout).filter((todo) => matches(query, [todo.title])).map((todo) => ({ kind: "todo", id: todo.id, title: todo.title, date: todo.startsOn, detail: todo.completedAt ? "Completed · Sometime This Week" : "Sometime This Week" })),
    })),
    runFile(hey, [...calendarSearchCommands.journal], { env, timeoutMs: 45_000 }).then((output): SourceRead => ({
      kind: "journal",
      items: parseJournalEntries(output.stdout).filter((entry) => matches(query, [entry.content])).map((entry) => ({ kind: "journal", id: entry.id ?? entry.date, title: firstLine(entry.content), date: entry.date, detail: "Journal" })),
    })),
    runFile(hey, [...calendarSearchCommands.time], { env, timeoutMs: 45_000 }).then((output): SourceRead => ({
      kind: "time",
      items: parseTimeTracks(output.stdout).filter((track) => matches(query, [track.notes, track.category])).map((track) => ({ kind: "time", id: track.id, title: track.notes || track.category || "Tracked time", date: track.startsAt.slice(0, 10), detail: [track.category, "Tracked time"].filter((value, index, values) => value && values.indexOf(value) === index).join(" · ") })),
    })),
  ]);

  const successful = reads.flatMap((read) => read.status === "fulfilled" ? [read.value] : []);
  const unavailableSources = reads.flatMap((read, index) => read.status === "rejected" ? [["event", "todo", "journal", "time"][index] as CalendarSearchKind] : []);
  const items = successful.flatMap((read) => read.items)
    .sort((left, right) => right.date.localeCompare(left.date) || left.kind.localeCompare(right.kind) || left.title.localeCompare(right.title))
    .slice(0, SEARCH_LIMIT);
  if (successful.length > 0) return { status: "ready", query, items, unavailableSources, ...(unavailableSources.length ? { detail: "Some Calendar sources could not be searched." } : {}) };

  const firstError = reads.find((read): read is PromiseRejectedResult => read.status === "rejected")?.reason;
  return { status: authFailure(firstError) ? "needs-auth" : "unavailable", query, items: [], unavailableSources, detail: firstError instanceof Error ? firstError.message : "HEY Calendar search is unavailable." };
}
