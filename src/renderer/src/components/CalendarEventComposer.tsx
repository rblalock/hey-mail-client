import { CalendarPlus, ChevronLeft, Pencil, Save, Send, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isShortcutEvent, matchesBindingStep } from "../../../shared/shortcut-binding";
import type { CalendarEvent, CalendarEventCreateRequest, CalendarEventUpdateRequest, CalendarRepeat, CalendarSummary, MailLibraryItem } from "../../../shared/contracts";
import { addDays } from "../calendar";
import { appSound } from "../sound";
import RecipientField, { invalidRecipientAddresses } from "./RecipientField";

type Props = {
  calendars: CalendarSummary[];
  startsOn: string;
  event?: CalendarEvent;
  initial?: CalendarEventCreateRequest;
  onClose: () => void;
  onSaved: (message: string) => void;
};

type RepeatChoice = "" | "current" | CalendarRepeat;

const repeatOptions: Array<{ value: "" | CalendarRepeat; label: string }> = [
  { value: "", label: "Does not repeat" },
  { value: "every_day", label: "Every day" },
  { value: "every_weekday", label: "Every weekday" },
  { value: "every_week", label: "Every week" },
  { value: "every_other_week", label: "Every other week" },
  { value: "every_day_of_month", label: "Every month" },
  { value: "every_year", label: "Every year" },
];

function splitValues(value: string): string[] {
  return value.split(/[;,\n]/).map((item) => item.trim()).filter(Boolean);
}

function describeWhen(request: CalendarEventCreateRequest): string {
  const dates = request.endsOn && request.endsOn !== request.startsOn ? `${request.startsOn} through ${request.endsOn}` : request.startsOn;
  return request.allDay ? `${dates} · All day` : `${dates} · ${request.startTime}${request.endTime ? `–${request.endTime}` : ""} · ${request.timeZone}`;
}

function isVisibleDialogControl(node: HTMLElement): boolean {
  if (node.offsetParent === null) return false;
  const closedDetails = node.closest<HTMLDetailsElement>("details:not([open])");
  return !closedDetails || (node.tagName === "SUMMARY" && node.parentElement === closedDetails);
}

function dateAndTime(value: string, timeZone?: string): { date: string; time: string } {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return { date: value.slice(0, 10), time: value.slice(11, 16) };
  const parts = new Intl.DateTimeFormat("en-CA", {
    ...(timeZone ? { timeZone } : {}),
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}

function reminderToken(event: CalendarEvent): string {
  return event.reminders.flatMap((reminder) => {
    const seconds = reminder.durationSeconds;
    if (seconds && seconds % 604_800 === 0) return [`${seconds / 604_800}w`];
    if (seconds && seconds % 86_400 === 0) return [`${seconds / 86_400}d`];
    if (seconds && seconds % 3_600 === 0) return [`${seconds / 3_600}h`];
    if (seconds && seconds % 60 === 0) return [`${seconds / 60}m`];
    const match = reminder.label.match(/(\d+)\s+(minute|hour|day|week)/i);
    return match ? [`${match[1]}${match[2]!.toLocaleLowerCase()[0]}`] : [];
  }).join(", ");
}

function editableInvites(event: CalendarEvent): string {
  const excluded = new Set([event.organizer?.email, event.calendar.ownerEmailAddress].filter(Boolean).map((email) => email!.toLocaleLowerCase()));
  return event.attendees.flatMap((person) => person.email && !excluded.has(person.email.toLocaleLowerCase()) ? [person.email] : []).join(", ");
}

export default function CalendarEventComposer({ calendars, startsOn, event, initial, onClose, onSaved }: Props) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const inviteErrorId = useId();
  const editing = Boolean(event);
  const writableCalendars = useMemo(() => calendars.filter((calendar) => calendar.writable === true), [calendars]);
  const start = event?.allDay ? { date: event.startsAt.slice(0, 10), time: "09:00" } : event ? dateAndTime(event.startsAt, event.timeZone) : { date: startsOn, time: "09:00" };
  const rawEnd = event?.allDay ? event.endsAt.slice(0, 10) : undefined;
  const end = event?.allDay
    ? { date: rawEnd && rawEnd > start.date ? addDays(rawEnd, -1) : start.date, time: "10:00" }
    : event ? dateAndTime(event.endsAt, event.timeZone) : { date: startsOn, time: "10:00" };
  const originalInvites = event ? editableInvites(event) : "";
  const originalReminders = event ? reminderToken(event) : "10m";
  const originalRepeat: RepeatChoice = event?.recurring ? "current" : "";
  const [title, setTitle] = useState(event?.title ?? initial?.title ?? "");
  const [calendarId, setCalendarId] = useState(event?.calendar.id ?? writableCalendars[0]?.id ?? "");
  const [startDate, setStartDate] = useState(initial?.startsOn ?? start.date);
  const [endDate, setEndDate] = useState(initial?.endsOn ?? end.date);
  const [allDay, setAllDay] = useState(event?.allDay ?? initial?.allDay ?? true);
  const [startTime, setStartTime] = useState(initial?.startTime ?? start.time);
  const [endTime, setEndTime] = useState(initial?.endTime ?? end.time);
  const [location, setLocation] = useState(event?.location ?? initial?.location ?? "");
  const [link, setLink] = useState(event?.linkUrl ?? initial?.link ?? "");
  const [notes, setNotes] = useState(event?.description ?? initial?.notes ?? "");
  const [invites, setInvites] = useState(originalInvites);
  const [contacts, setContacts] = useState<MailLibraryItem[]>([]);
  const [reminders, setReminders] = useState(originalReminders);
  const [repeat, setRepeat] = useState<RepeatChoice>(originalRepeat);
  const [repeatUntil, setRepeatUntil] = useState("");
  const [circle, setCircle] = useState(event?.highlighted ?? false);
  const [countdown, setCountdown] = useState("");
  const [countdownUnit, setCountdownUnit] = useState<"days" | "weeks" | "months">("days");
  const [moreOpen, setMoreOpen] = useState(editing && (Boolean(originalReminders) || event?.recurring === true));
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const timeZone = event?.timeZone ?? initial?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const request = useMemo<CalendarEventCreateRequest>(() => ({
    title: title.trim(), calendarId, startsOn: startDate,
    ...(endDate && endDate !== startDate ? { endsOn: endDate } : {}), allDay,
    ...(!allDay ? { startTime, endTime, timeZone } : {}),
    ...(location.trim() ? { location: location.trim() } : {}),
    ...(link.trim() ? { link: link.trim() } : {}),
    ...(notes.trim() ? { notes: notes.trim() } : {}),
    ...(splitValues(invites).length ? { invites: splitValues(invites) } : {}),
    ...(splitValues(reminders).length ? { reminders: splitValues(reminders) } : {}),
    ...(repeat && repeat !== "current" ? { repeat } : {}),
    ...(repeat && repeat !== "current" && repeatUntil ? { repeatUntil } : {}),
    ...(countdown ? { countdown: Number(countdown), countdownUnit } : {}),
    ...(circle ? { circle: true } : {}),
  }), [allDay, calendarId, circle, countdown, countdownUnit, endDate, endTime, invites, link, location, notes, reminders, repeat, repeatUntil, startDate, startTime, timeZone, title]);
  const update = useMemo<CalendarEventUpdateRequest | undefined>(() => {
    if (!event) return undefined;
    const next: CalendarEventUpdateRequest = { id: event.id, lookupDate: event.startsAt.slice(0, 10) };
    if (request.title !== event.title) next.title = request.title;
    const scheduleChanged = startDate !== start.date || endDate !== end.date || allDay !== event.allDay || !allDay && (startTime !== start.time || endTime !== end.time || timeZone !== event.timeZone);
    if (scheduleChanged) {
      next.startsOn = startDate; next.endsOn = endDate; next.allDay = allDay;
      if (!allDay) { next.startTime = startTime; next.endTime = endTime; next.timeZone = timeZone; }
    }
    if (location.trim() !== (event.location ?? "")) next.location = location.trim();
    if (link.trim() !== (event.linkUrl ?? "")) next.link = link.trim();
    if (notes.trim() !== (event.description ?? "")) next.notes = notes.trim();
    if (invites.trim() !== originalInvites) next.invites = splitValues(invites);
    if (reminders.trim() !== originalReminders && splitValues(reminders).length > 0) next.reminders = splitValues(reminders);
    if (repeat !== originalRepeat && repeat && repeat !== "current") next.repeat = repeat;
    if (next.repeat && repeatUntil) next.repeatUntil = repeatUntil;
    if (countdown) { next.countdown = Number(countdown); next.countdownUnit = countdownUnit; }
    if (circle !== (event.highlighted ?? false)) next.circle = circle;
    return next;
  }, [allDay, circle, countdown, countdownUnit, end.date, end.time, endDate, endTime, event, invites, link, location, notes, originalInvites, originalReminders, originalRepeat, reminders, repeat, repeatUntil, request.title, start.date, start.time, startDate, startTime, timeZone]);
  const selectedCalendar = calendars.find((calendar) => calendar.id === calendarId);
  const hasChanges = update ? Object.keys(update).length > 2 : true;
  const clearedReminders = editing && Boolean(originalReminders) && reminders.trim() === "";
  const invalidSchedule = endDate < startDate || !allDay && startDate === endDate && endTime <= startTime;
  const invalidCountdown = countdown !== "" && (!Number.isInteger(Number(countdown)) || Number(countdown) < 1 || Number(countdown) > 30);
  const invalidInvites = invalidRecipientAddresses(invites);

  useEffect(() => {
    const frame = requestAnimationFrame(() => titleRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.heyAgent.mail.listLibrary("contacts").then((result) => {
      if (!cancelled) setContacts(result.items);
    }).catch(() => {
      // Calendar guests can still be entered by address when contacts are unavailable.
    });
    return () => { cancelled = true; };
  }, []);

  const submit = async () => {
    if (submitting || !request.title || !request.calendarId || !hasChanges || clearedReminders || invalidSchedule || invalidCountdown || invalidInvites.length > 0) return;
    if (!editing && (request.invites?.length ?? 0) > 0 && !reviewing) { setReviewing(true); return; }
    setSubmitting(true); setError(undefined);
    try {
      const result = update ? await window.heyAgent.calendar.update(update) : await window.heyAgent.calendar.create(request);
      appSound.play("success", "interface"); onSaved(result.message);
    } catch (reason) {
      appSound.play("error", "interface");
      setError(reason instanceof Error ? reason.message : `HEY could not ${editing ? "update" : "create"} this event.`);
      setReviewing(false);
    } finally { setSubmitting(false); }
  };

  const titleText = editing ? "Edit event" : initial ? "Add personal copy" : "New event";
  return createPortal(<div className="dialog-scrim calendar-composer-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
    <section ref={dialogRef} className="calendar-composer" role="dialog" aria-modal="true" aria-label={reviewing ? "Review event invitations" : titleText} onKeyDown={(event) => {
      event.stopPropagation();
      if (!isShortcutEvent(event.nativeEvent)) { if (event.key === "Enter") event.preventDefault(); return; }
      if (event.key === "Escape" && !submitting) { event.preventDefault(); event.stopPropagation(); reviewing ? setReviewing(false) : onClose(); }
      if (matchesBindingStep(event.nativeEvent, "mod+enter")) { event.preventDefault(); void submit(); }
      if (event.key === "Tab") {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary') ?? []).filter(isVisibleDialogControl);
        const first = focusable[0]; const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus(); }
      }
    }}>
      <header><span>{reviewing ? <button type="button" className="calendar-composer-back" data-tooltip="Back to event details" data-shortcut="Esc" onClick={() => setReviewing(false)}><ChevronLeft size={15} />Back</button> : <>{editing ? <Pencil size={15} /> : <CalendarPlus size={15} />} {titleText}</>}</span><button type="button" className="icon-button" aria-label={`Close ${titleText.toLocaleLowerCase()}`} data-tooltip={`Close ${titleText.toLocaleLowerCase()}`} data-shortcut={reviewing ? undefined : "Esc"} onClick={onClose} disabled={submitting}><X size={15} /></button></header>
      {reviewing ? <div className="calendar-event-review">
        <p className="calendar-invite-warning"><strong>Creating this event sends invitations.</strong> Review the exact details before HEY notifies these guests.</p>
        <dl><div><dt>Event</dt><dd>{request.title}</dd></div><div><dt>Calendar</dt><dd>{selectedCalendar?.name}</dd></div><div><dt>When</dt><dd>{describeWhen(request)}</dd></div>{request.invites?.length ? <div><dt>Invited</dt><dd>{request.invites.join(", ")}</dd></div> : null}{request.reminders?.length ? <div><dt>Reminders</dt><dd>{request.reminders.join(", ")} before</dd></div> : null}{request.repeat ? <div><dt>Repeats</dt><dd>{repeatOptions.find((option) => option.value === request.repeat)?.label}</dd></div> : null}{request.repeatUntil ? <div><dt>Repeat until</dt><dd>{request.repeatUntil}</dd></div> : null}</dl>
      </div> : <div className="calendar-composer-body">
        {initial && <p className="calendar-invite-warning">This creates a separate calendar entry. Respond to the original invitation in HEY.</p>}
        {writableCalendars.length === 0 || editing && !event?.calendar.writable ? <div className="calendar-composer-unavailable"><strong>This event is read-only</strong><p>Subscribed and external calendars must be edited in their source calendar.</p></div> : <>
          <label className="calendar-field calendar-title-field"><span>Event name</span><input ref={titleRef} autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What’s happening?" /></label>
          <div className="calendar-form-row">{editing ? <div className="calendar-field calendar-fixed-field"><span>Calendar</span><strong>{selectedCalendar?.name}</strong></div> : <label className="calendar-field"><span>Calendar</span><select value={calendarId} onChange={(event) => setCalendarId(event.target.value)}>{writableCalendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}{calendar.ownerEmailAddress ? ` · ${calendar.ownerEmailAddress}` : ""}</option>)}</select></label>}<label className="calendar-check"><input type="checkbox" checked={circle} onChange={(event) => setCircle(event.target.checked)} /><span>Circle this day</span></label></div>
          <div className="calendar-form-row calendar-date-fields"><label className="calendar-field"><span>Starts</span><input type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); if (endDate < event.target.value) setEndDate(event.target.value); }} /></label><label className="calendar-field"><span>Ends</span><input type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label><label className="calendar-check"><input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} /><span>All day</span></label></div>
          {!allDay && <div className="calendar-form-row calendar-time-fields"><label className="calendar-field"><span>Start time</span><input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label><label className="calendar-field"><span>End time</span><input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label><small>{timeZone.replaceAll("_", " ")}</small></div>}
          <label className="calendar-field"><span>Location</span><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Add a place or room" /></label>
          <label className="calendar-field"><span>Link</span><input type="url" value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://" /></label>
          <div className="calendar-field calendar-invite-field"><span>Invite</span><RecipientField label="Invite" value={invites} onChange={setInvites} contacts={contacts} placeholder="Name or email" collapseAfter={3} invalid={invalidInvites.length > 0} describedBy={invalidInvites.length > 0 ? inviteErrorId : undefined} /></div>
          <label className="calendar-field"><span>Notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Add useful context" /></label>
          <details className="calendar-more-fields" open={moreOpen} onToggle={(toggle) => setMoreOpen(toggle.currentTarget.open)}><summary>More options</summary><div className="calendar-form-row"><label className="calendar-field"><span>Reminders</span><input value={reminders} onChange={(event) => setReminders(event.target.value)} placeholder="10m, 1h, 1d" /></label><label className="calendar-field"><span>Repeat</span><select value={repeat} onChange={(event) => { const value = event.target.value as RepeatChoice; setRepeat(value); if (!value || value === "current") setRepeatUntil(""); }}>{event?.recurring && <option value="current">Keep current schedule</option>}{repeatOptions.filter((option) => !event?.recurring || option.value !== "").map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div>{repeat && repeat !== "current" && <label className="calendar-field"><span>Repeat until (optional)</span><input type="date" min={startDate} value={repeatUntil} onChange={(event) => setRepeatUntil(event.target.value)} /></label>}{editing && <div className="calendar-form-row"><label className="calendar-field"><span>Countdown (optional)</span><input type="number" min="1" max="30" value={countdown} onChange={(event) => setCountdown(event.target.value)} placeholder="Number" /></label><label className="calendar-field"><span>Countdown unit</span><select value={countdownUnit} onChange={(event) => setCountdownUnit(event.target.value as typeof countdownUnit)}><option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option></select></label></div>}</details>
          {invalidInvites.length > 0 && <p id={inviteErrorId} className="composer-error" role="alert">Choose a contact or enter a complete email address for {invalidInvites.join(", ")}.</p>}{clearedReminders && <p className="composer-error">Removing every reminder is not supported by HEY CLI yet. Change the reminder or use HEY.</p>}{invalidSchedule && <p className="composer-error">The event must end after it starts.</p>}{invalidCountdown && <p className="composer-error">Countdowns must be a whole number from 1 to 30.</p>}
        </>}
      </div>}
      {error && <p className="composer-error">{error}</p>}
      <footer><small>Ctrl+Enter</small><span /><button type="button" className="send-button" data-tooltip={reviewing ? "Create and send invitations" : editing ? "Save changes" : (request.invites?.length ?? 0) > 0 ? "Review invitations" : "Create event"} data-shortcut="Ctrl+Enter" onClick={() => void submit()} disabled={submitting || !request.title || !request.calendarId || !hasChanges || clearedReminders || invalidSchedule || invalidCountdown || invalidInvites.length > 0}>{editing ? <Save size={14} /> : <Send size={14} />}{submitting ? "Saving…" : reviewing ? "Create and send invitations" : editing ? "Save changes" : (request.invites?.length ?? 0) > 0 ? "Review invitations" : "Create event"}</button></footer>
    </section>
  </div>, document.body);
}
