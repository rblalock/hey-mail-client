import { useEffect, useMemo, useRef } from "react";
import type { CalendarEvent } from "../../../shared/contracts";
import { dateFromKey, dateKey, eventOccursOn, localeFirstDay } from "../calendar";

function monthDays(year: number, month: number): Array<string | undefined> {
  const first = new Date(year, month, 1, 12);
  const offset = (first.getDay() - localeFirstDay() + 7) % 7;
  const count = new Date(year, month + 1, 0, 12).getDate();
  return [...Array.from({ length: offset }, () => undefined), ...Array.from({ length: count }, (_, index) => dateKey(new Date(year, month, index + 1, 12)))];
}

export default function CalendarYear({ year, anchor, events, onSelectDay }: { year: number; anchor: string; events: CalendarEvent[]; onSelectDay: (date: string) => void }) {
  const today = dateKey(new Date());
  const anchorMonth = dateFromKey(anchor).getMonth();
  const anchorRef = useRef<HTMLElement>(null);
  useEffect(() => { requestAnimationFrame(() => anchorRef.current?.scrollIntoView({ block: "center" })); }, [anchorMonth, year]);
  const datedEvents = useMemo(() => events.filter((event) => !event.recurring), [events]);
  const weekdays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(2026, 7, 2 + ((localeFirstDay() + index) % 7), 12);
    return new Intl.DateTimeFormat(undefined, { weekday: "narrow" }).format(date);
  });
  return <div className="calendar-year" aria-label={`${year} calendar`}>
    {Array.from({ length: 12 }, (_, month) => <section key={month} ref={month === anchorMonth ? anchorRef : undefined} className="calendar-year-month">
      <h2>{new Intl.DateTimeFormat(undefined, { month: "long" }).format(new Date(year, month, 1, 12))}</h2>
      <div className="calendar-year-weekdays" aria-hidden="true">{weekdays.map((day, index) => <span key={`${day}:${index}`}>{day}</span>)}</div>
      <div className="calendar-year-days">{monthDays(year, month).map((day, index) => {
        if (!day) return <span key={`blank:${index}`} />;
        const dayEvents = datedEvents.filter((event) => eventOccursOn(event, day));
        const circled = dayEvents.some((event) => event.highlighted);
        const label = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(dateFromKey(day));
        return <button key={day} type="button" data-today={day === today || undefined} data-events={dayEvents.length > 0 || undefined} data-circle={circled || undefined} aria-label={`${label}${dayEvents.length ? `, ${dayEvents.length} ${dayEvents.length === 1 ? "event" : "events"}` : ""}`} onClick={() => onSelectDay(day)}><span>{dateFromKey(day).getDate()}</span>{dayEvents.length > 0 && <i>{Math.min(dayEvents.length, 3)}</i>}</button>;
      })}</div>
    </section>)}
  </div>;
}
