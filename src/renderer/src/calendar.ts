import type { CalendarEvent } from "../../shared/contracts";

export type CalendarViewMode = "day" | "week" | "year";

export type CalendarTimedCluster = {
  id: string;
  startsAt: number;
  endsAt: number;
  events: CalendarEvent[];
};

export type CalendarAllDaySpan = {
  event: CalendarEvent;
  startDay: number;
  endDay: number;
  lane: number;
};

type CalendarWindow = { startsOn: string; endsOn: string };

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function calendarTargetDate(deepLink: string, subtitle?: string): string | undefined {
  try {
    const url = new URL(deepLink);
    const date = url.searchParams.get("date") ?? url.pathname.match(/^\/dates\/(\d{4}-\d{2}-\d{2})\/?$/)?.[1];
    if (date && DATE_KEY.test(date)) return date;
  } catch {
    // The object boundary already validates native links; retain a display-text
    // fallback for older saved sessions whose link did not carry a date.
  }
  return subtitle?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
}

export function dateFromKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12);
}

export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(key: string, days: number): string {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

export function addYears(key: string, years: number): string {
  const date = dateFromKey(key);
  const month = date.getMonth();
  date.setFullYear(date.getFullYear() + years);
  if (date.getMonth() !== month) date.setDate(0);
  return dateKey(date);
}

export function localeFirstDay(locale = navigator.language): number {
  const info = (new Intl.Locale(locale) as Intl.Locale & { weekInfo?: { firstDay: number } }).weekInfo;
  return info ? info.firstDay % 7 : 0;
}

export function calendarWindow(mode: CalendarViewMode, anchor: string, firstDay = localeFirstDay()): { startsOn: string; endsOn: string } {
  if (mode === "day") return { startsOn: anchor, endsOn: anchor };
  if (mode === "year") {
    const year = dateFromKey(anchor).getFullYear();
    return { startsOn: `${year}-01-01`, endsOn: `${year}-12-31` };
  }
  const date = dateFromKey(anchor);
  const offset = (date.getDay() - firstDay + 7) % 7;
  const startsOn = addDays(anchor, -offset);
  return { startsOn, endsOn: addDays(startsOn, 6) };
}

export function calendarPresentedWindow(mode: CalendarViewMode, requested: CalendarWindow, loaded: CalendarWindow): CalendarWindow & { mode: CalendarViewMode } {
  const loadedWindowExists = Boolean(loaded.startsOn && loaded.endsOn);
  const loadedWindowMatches = loaded.startsOn === requested.startsOn && loaded.endsOn === requested.endsOn;
  if (!loadedWindowExists || loadedWindowMatches) return { mode, ...requested };
  const loadedMode = loaded.startsOn === loaded.endsOn ? "day" : loaded.startsOn.endsWith("-01-01") && loaded.endsOn.endsWith("-12-31") ? "year" : "week";
  return { mode: loadedMode, ...loaded };
}

export function eventDayKey(event: CalendarEvent): string {
  if (event.allDay && /^\d{4}-\d{2}-\d{2}/.test(event.startsAt)) return event.startsAt.slice(0, 10);
  return dateKey(new Date(event.startsAt));
}

export function calendarEventKey(event: CalendarEvent): string {
  return event.occurrenceId ?? `${event.id}:${eventDayKey(event)}`;
}

export function eventOccursOn(event: CalendarEvent, day: string): boolean {
  const start = eventDayKey(event);
  if (event.allDay) {
    const end = /^\d{4}-\d{2}-\d{2}/.test(event.endsAt) ? event.endsAt.slice(0, 10) : addDays(start, 1);
    return day >= start && day < (end > start ? end : addDays(start, 1));
  }
  const endDate = new Date(event.endsAt);
  const end = dateKey(endDate);
  const endsAtMidnight = endDate.getHours() === 0 && endDate.getMinutes() === 0 && endDate.getSeconds() === 0;
  return day >= start && day <= end && !(day === end && day !== start && endsAtMidnight);
}

export function filterCalendarEvents(events: CalendarEvent[], calendarId: string, query: string): CalendarEvent[] {
  const needle = query.trim().toLocaleLowerCase();
  return events.filter((event) => {
    if (calendarId && event.calendar.id !== calendarId) return false;
    if (!needle) return true;
    return [event.title, event.location, event.description, event.calendar.name, event.organizer?.name, event.organizer?.email, ...event.attendees.flatMap((person) => [person.name, person.email])]
      .some((value) => value?.toLocaleLowerCase().includes(needle));
  });
}

function eventBoundsOnDay(event: CalendarEvent, day: string): { start: number; end: number } | undefined {
  const dayStart = dateFromKey(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const eventStart = new Date(event.startsAt).getTime();
  const eventEnd = new Date(event.endsAt).getTime();
  if (!Number.isFinite(eventStart)) return undefined;
  const start = Math.max(eventStart, dayStart.getTime());
  const safeEnd = Number.isFinite(eventEnd) && eventEnd > eventStart ? eventEnd : eventStart + 3_600_000;
  const end = Math.min(safeEnd, dayEnd.getTime());
  if (start >= dayEnd.getTime() || end <= dayStart.getTime()) return undefined;
  return { start, end: Math.min(dayEnd.getTime(), Math.max(end, start + 60_000)) };
}

function compareEvents(left: CalendarEvent, right: CalendarEvent): number {
  const start = new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime();
  if (start) return start;
  const end = new Date(right.endsAt).getTime() - new Date(left.endsAt).getTime();
  if (end) return end;
  const title = left.title.localeCompare(right.title);
  return title || calendarEventKey(left).localeCompare(calendarEventKey(right));
}

/** Groups the timed events on one day into transitive collision sets. */
export function calendarTimedClusters(events: CalendarEvent[], day: string): CalendarTimedCluster[] {
  const timed = events
    .filter((event) => !event.allDay && eventOccursOn(event, day))
    .map((event) => ({ event, bounds: eventBoundsOnDay(event, day) }))
    .filter((item): item is { event: CalendarEvent; bounds: { start: number; end: number } } => Boolean(item.bounds))
    .sort((left, right) => compareEvents(left.event, right.event));
  const clusters: CalendarTimedCluster[] = [];
  let current: CalendarTimedCluster | undefined;
  for (const item of timed) {
    if (!current || item.bounds.start >= current.endsAt) {
      current = {
        id: `${day}:${calendarEventKey(item.event)}`,
        startsAt: item.bounds.start,
        endsAt: item.bounds.end,
        events: [item.event],
      };
      clusters.push(current);
      continue;
    }
    current.events.push(item.event);
    current.endsAt = Math.max(current.endsAt, item.bounds.end);
  }
  return clusters;
}

/** Places unique all-day events into non-overlapping lanes across the visible days. */
export function calendarAllDaySpans(events: CalendarEvent[], days: string[]): CalendarAllDaySpan[] {
  const unique = new Map<string, CalendarEvent>();
  for (const event of events) {
    if (event.allDay) unique.set(calendarEventKey(event), event);
  }
  const spans = [...unique.values()].flatMap((event) => {
    const occupied = days.flatMap((day, index) => eventOccursOn(event, day) ? [index] : []);
    if (!occupied.length) return [];
    return [{ event, startDay: occupied[0]!, endDay: occupied[occupied.length - 1]!, lane: 0 }];
  }).sort((left, right) => {
    const length = (right.endDay - right.startDay) - (left.endDay - left.startDay);
    return length || left.startDay - right.startDay || compareEvents(left.event, right.event);
  });

  const lanes: boolean[][] = [];
  for (const span of spans) {
    let lane = lanes.findIndex((daysTaken) => {
      for (let day = span.startDay; day <= span.endDay; day += 1) if (daysTaken[day]) return false;
      return true;
    });
    if (lane < 0) {
      lane = lanes.length;
      lanes.push(Array.from({ length: days.length }, () => false));
    }
    span.lane = lane;
    for (let day = span.startDay; day <= span.endDay; day += 1) lanes[lane]![day] = true;
  }
  return spans.sort((left, right) => left.lane - right.lane || left.startDay - right.startDay);
}
