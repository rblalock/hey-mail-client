import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from "react";
import { ArrowLeft, Bell, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Clock3, ExternalLink, ListFilter, LoaderCircle, Mail, MapPin, Pencil, Plus, RefreshCw, Repeat2, Search, Sparkles, Trash2, Users, Video, X } from "lucide-react";
import { BookOpen as BookOpenData, Calendar as CalendarData, CalendarDays as CalendarDaysData, Clock3 as ClockData, Flame as FlameData, FlameKindling as FlameKindlingData, NotebookPen as NotebookPenData, Timer as TimerData } from "lucide";
import type { IconInput } from "morphicons/react";
import type { AgentObjectLink, CalendarEvent, CalendarSearchItem, CalendarWindowResult } from "../../../shared/contracts";
import { addDays, addYears, calendarAllDaySpans, calendarEventKey, calendarPresentedWindow, calendarTimedClusters, calendarWindow, dateFromKey, dateKey, eventDayKey, eventOccursOn, filterCalendarEvents, type CalendarAllDaySpan, type CalendarTimedCluster, type CalendarViewMode } from "../calendar";
import { appSound } from "../sound";
import { isShortcutEvent } from "../../../shared/shortcut-binding";
import CalendarEventComposer from "./CalendarEventComposer";
import { CalendarRecordingsPage, CalendarScheduleRecordings, type CalendarSection } from "./CalendarRecordings";
import CalendarSearch from "./CalendarSearch";
import CalendarYear from "./CalendarYear";
import MorphingIcon from "./MorphingIcon";
import HelperMenu from "./HelperMenu";
import type { HelperDefinition, HelperId } from "../../../shared/helpers";
import type { HelperCalendarWindow } from "../helper-context";

type CalendarViewProps = { onReturnMail: () => void; onNotice?: (message: string) => void; target?: { object: AgentObjectLink; eventId?: string; date?: string; section?: CalendarSection; revision: number }; onTargetMissing?: (object: AgentObjectLink) => void; onActiveEvent?: (event?: CalendarEvent) => void; onMeetingPrep?: (event: CalendarEvent) => void; meetingPrepEnabled?: boolean; meetingPrepBusy?: boolean; refreshToken?: number; onHelperWindow?: (window?: HelperCalendarWindow) => void; helpers?: HelperDefinition[]; onRunHelper?: (id: HelperId) => void };

const EMPTY_RESULT: CalendarWindowResult = { status: "ready", startsOn: "", endsOn: "", calendars: [], events: [] };
const todayKey = () => dateKey(new Date());
const CALENDAR_SECTION_ICONS = {
  schedule: [CalendarData, CalendarDaysData],
  habits: [FlameData, FlameKindlingData],
  journal: [BookOpenData, NotebookPenData],
  time: [ClockData, TimerData],
} satisfies Record<CalendarSection, readonly [IconInput, IconInput]>;

function calendarSectionIcon(section: CalendarSection, engaged: boolean): IconInput {
  return CALENDAR_SECTION_ICONS[section][engaged ? 1 : 0];
}

function initialMode(): CalendarViewMode {
  const stored = localStorage.getItem("hey-agent:calendar-view");
  return stored === "day" || stored === "year" ? stored : "week";
}

function initialAnchor(): string {
  const stored = localStorage.getItem("hey-agent:calendar-date");
  return stored && /^\d{4}-\d{2}-\d{2}$/.test(stored) ? stored : todayKey();
}

function initialSection(): CalendarSection {
  const stored = localStorage.getItem("hey-agent:calendar-section");
  return stored === "habits" || stored === "journal" || stored === "time" ? stored : "schedule";
}

function formatRange(mode: CalendarViewMode, startsOn: string, endsOn: string): string {
  const start = dateFromKey(startsOn);
  if (mode === "day") return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(start);
  if (mode === "year") return String(start.getFullYear());
  const end = dateFromKey(endsOn);
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  const short = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  if (sameMonth) return `${new Intl.DateTimeFormat(undefined, { month: "short" }).format(start)} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
  if (sameYear) return `${short.format(start)} – ${short.format(end)}, ${end.getFullYear()}`;
  const full = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${full.format(start)} – ${full.format(end)}`;
}

function formatTime(event: CalendarEvent): string {
  if (event.allDay) return "All day";
  const format = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  return `${format.format(new Date(event.startsAt))} – ${format.format(new Date(event.endsAt))}`;
}

function formatClock(value: Date | number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(value);
}

function formatTimedRange(event: CalendarEvent): string {
  return `${formatClock(new Date(event.startsAt))}–${formatClock(new Date(event.endsAt))}`;
}

function formatAllDayRange(event: CalendarEvent, days: string[]): string {
  const format = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
  const eventStart = eventDayKey(event);
  const exclusiveEnd = /^\d{4}-\d{2}-\d{2}/.test(event.endsAt) ? event.endsAt.slice(0, 10) : addDays(eventStart, 1);
  const eventEnd = exclusiveEnd > eventStart ? addDays(exclusiveEnd, -1) : eventStart;
  if (days.length === 1 && eventStart === eventEnd) return "All day";
  const start = format.format(dateFromKey(eventStart));
  const end = format.format(dateFromKey(eventEnd));
  return start === end ? start : `${start}–${end}`;
}

function formatReminder(reminder: CalendarEvent["reminders"][number]): string {
  if (!reminder.durationSeconds) return reminder.label;
  const seconds = reminder.durationSeconds;
  if (seconds % 86_400 === 0) return `${seconds / 86_400} day${seconds === 86_400 ? "" : "s"} before`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} hour${seconds === 3_600 ? "" : "s"} before`;
  return `${Math.round(seconds / 60)} minutes before`;
}

function safeCalendarColor(color?: string): string | undefined {
  return color && /^(#[\da-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%/-]+\))$/i.test(color) ? color : undefined;
}

export default function CalendarView({ onReturnMail, onNotice, target, onTargetMissing, onActiveEvent, onMeetingPrep, meetingPrepEnabled = false, meetingPrepBusy = false, refreshToken = 0, onHelperWindow, helpers = [], onRunHelper }: CalendarViewProps) {
  const [mode, setMode] = useState<CalendarViewMode>(initialMode);
  const [section, setSection] = useState<CalendarSection>(initialSection);
  const [previewedSection, setPreviewedSection] = useState<CalendarSection>();
  const [anchor, setAnchor] = useState(initialAnchor);
  const [result, setResult] = useState(EMPTY_RESULT);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>();
  const [highlightedId, setHighlightedId] = useState<string>();
  const [calendarId, setCalendarId] = useState("");
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [internalTarget, setInternalTarget] = useState<AgentObjectLink>();
  const [composerDate, setComposerDate] = useState<string>();
  const [editingEvent, setEditingEvent] = useState<CalendarEvent>();
  const [recordingsRefreshToken, setRecordingsRefreshToken] = useState(0);
  const requestSequence = useRef(0);
  const panelRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const eventRefs = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocusId = useRef<string | undefined>(undefined);
  const newEventRef = useRef<HTMLButtonElement>(null);
  const composerTriggerRef = useRef<HTMLElement | null>(null);
  const handledTargetRevision = useRef<number | undefined>(undefined);
  const pendingTarget = useRef<{ eventId: string; date?: string } | undefined>(undefined);
  const range = useMemo(() => calendarWindow(mode, anchor), [anchor, mode]);
  const presented = calendarPresentedWindow(mode, range, result);
  useEffect(() => {
    onHelperWindow?.({ date: anchor >= presented.startsOn && anchor <= presented.endsOn ? anchor : presented.startsOn || anchor, mode: presented.mode === "day" ? "day" : "week" });
  }, [anchor, onHelperWindow, presented.startsOn, presented.endsOn, presented.mode]);
  useEffect(() => () => onHelperWindow?.(undefined), [onHelperWindow]);

  const load = useCallback(async (preserve = false) => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    try {
      const next = await globalThis.window.heyAgent.calendar.list(range);
      if (sequence !== requestSequence.current) return;
      setResult(next);
      const pending = pendingTarget.current;
      if (pending && next.status === "ready") {
        pendingTarget.current = undefined;
        const event = next.events.find((item) => item.id === pending.eventId && (!pending.date || eventDayKey(item) === pending.date))
          ?? next.events.find((item) => item.id === pending.eventId);
        if (event) {
          const key = calendarEventKey(event);
          setHighlightedId(key);
          setSelectedId(key);
        } else if (target?.object) onTargetMissing?.(target.object);
      }
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      if (!preserve || result.events.length === 0) setResult({ status: "unavailable", ...range, calendars: [], events: [], detail: error instanceof Error ? error.message : "Unable to read HEY Calendar." });
      else onNotice?.("Calendar could not refresh. Your last loaded view is still shown.");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [onNotice, onTargetMissing, range, result.events.length, target?.object]);

  useEffect(() => { void load(); }, [range.startsOn, range.endsOn]);
  useEffect(() => { if (refreshToken > 0) void load(true); }, [refreshToken]);
  useEffect(() => { localStorage.setItem("hey-agent:calendar-view", mode); }, [mode]);
  useEffect(() => { localStorage.setItem("hey-agent:calendar-section", section); }, [section]);
  useEffect(() => { localStorage.setItem("hey-agent:calendar-date", anchor); }, [anchor]);
  useEffect(() => {
    const refreshVisible = () => { if (document.visibilityState === "visible") void load(true); };
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => { window.removeEventListener("focus", refreshVisible); document.removeEventListener("visibilitychange", refreshVisible); };
  }, [load]);

  const visibleEvents = useMemo(() => filterCalendarEvents(result.events, calendarId, query), [calendarId, query, result.events]);
  const selected = useMemo(() => result.events.find((event) => calendarEventKey(event) === selectedId), [result.events, selectedId]);
  useEffect(() => { onActiveEvent?.(selected); }, [onActiveEvent, selected]);
  useEffect(() => () => onActiveEvent?.(undefined), [onActiveEvent]);
  const days = useMemo(() => presented.mode === "year" ? [] : Array.from({ length: presented.mode === "day" ? 1 : 7 }, (_, index) => addDays(presented.startsOn, index)), [presented.mode, presented.startsOn]);
  const recordingDays = useMemo(() => Array.from({ length: mode === "day" ? 1 : 7 }, (_, index) => addDays(range.startsOn, index)), [mode, range.startsOn]);
  const timedClustersByDay = useMemo(() => new Map(days.map((day) => [day, calendarTimedClusters(visibleEvents, day)])), [days, visibleEvents]);
  const allDaySpans = useMemo(() => calendarAllDaySpans(visibleEvents, days), [days, visibleEvents]);
  const placedEventIds = useMemo(() => new Set(days.flatMap((day) => visibleEvents.filter((event) => eventOccursOn(event, day)).map(calendarEventKey))), [days, visibleEvents]);
  const unplacedRecurring = useMemo(() => visibleEvents.filter((event) => event.recurring && !placedEventIds.has(calendarEventKey(event))), [placedEventIds, visibleEvents]);
  const navigableEvents = useMemo(() => {
    const ordered = new Map<string, CalendarEvent>();
    for (const event of unplacedRecurring) ordered.set(calendarEventKey(event), event);
    for (const [dayIndex, day] of days.entries()) {
      for (const span of allDaySpans) if (span.startDay <= dayIndex && span.endDay >= dayIndex) ordered.set(calendarEventKey(span.event), span.event);
      for (const cluster of timedClustersByDay.get(day) ?? []) for (const event of cluster.events) ordered.set(calendarEventKey(event), event);
    }
    return [...ordered.values()];
  }, [allDaySpans, days, timedClustersByDay, unplacedRecurring]);

  useEffect(() => {
    if (!target || handledTargetRevision.current === target.revision) return;
    handledTargetRevision.current = target.revision;
    if (target.section) { setSection(target.section); if (target.section !== "schedule" && mode === "year") setMode("week"); }
    if (!target.eventId) {
      if (target.object.kind === "calendar-date" && mode !== "day") setMode("day");
      if (target.date && target.date !== anchor) setAnchor(target.date);
      return;
    }
    pendingTarget.current = { eventId: target.eventId, ...(target.date ? { date: target.date } : {}) };
    if (target.date && (target.date !== anchor || mode !== "day")) {
      setMode("day");
      setAnchor(target.date);
    } else {
      void load(true);
    }
  }, [anchor, load, mode, target]);

  useEffect(() => {
    if (highlightedId && navigableEvents.some((event) => calendarEventKey(event) === highlightedId)) return;
    setHighlightedId(navigableEvents[0] ? calendarEventKey(navigableEvents[0]) : undefined);
  }, [highlightedId, navigableEvents]);

  const moveHighlight = useCallback((delta: number) => {
    if (!navigableEvents.length) return;
    const current = navigableEvents.findIndex((event) => calendarEventKey(event) === highlightedId);
    const index = current < 0 ? 0 : Math.max(0, Math.min(navigableEvents.length - 1, current + delta));
    const id = calendarEventKey(navigableEvents[index]!);
    setHighlightedId(id);
    const node = eventRefs.current.get(id);
    node?.focus();
    node?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [highlightedId, navigableEvents]);

  const shiftWindow = useCallback((direction: -1 | 1) => {
    if (section === "time") return;
    if (mode === "year" && section === "schedule") { setAnchor((current) => addYears(current, direction)); return; }
    const distance = section === "journal" ? 1 : mode === "day" ? 1 : 7;
    setAnchor((current) => addDays(current, direction * distance));
  }, [mode, section]);
  const openComposer = useCallback((day: string, trigger?: HTMLElement) => {
    const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : undefined;
    composerTriggerRef.current = trigger ?? active ?? newEventRef.current;
    setComposerDate(day);
  }, []);
  const closeComposer = useCallback(() => {
    const trigger = composerTriggerRef.current;
    setComposerDate(undefined);
    requestAnimationFrame(() => trigger?.focus());
  }, []);
  const openEditor = useCallback((event: CalendarEvent, trigger?: HTMLElement) => {
    composerTriggerRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setEditingEvent(event);
  }, []);
  const closeEditor = useCallback(() => {
    const trigger = composerTriggerRef.current;
    setEditingEvent(undefined);
    requestAnimationFrame(() => trigger?.focus());
  }, []);
  const openEvent = useCallback((id: string) => { setHighlightedId(id); setSelectedId(id); }, []);
  const selectSection = useCallback((value: CalendarSection) => {
    if (section !== value) appSound.play("press", "interface");
    if (value !== "schedule" && mode === "year") setMode("week");
    setSearchOpen(false);
    setSection(value);
  }, [mode, section]);
  const openSearchResult = useCallback((item: CalendarSearchItem) => {
    const kind = item.kind === "event" ? "calendar-event" : item.kind === "todo" ? "calendar-todo" : item.kind === "journal" ? "calendar-journal" : "calendar-time-track";
    const path = item.kind === "event" ? "events" : item.kind === "todo" ? "todos" : item.kind === "journal" ? "journal" : "time";
    const object: AgentObjectLink = { kind, id: item.id, title: item.title, subtitle: item.date, deepLink: `hey-agent://calendar/${path}/${item.id}?date=${item.date}` };
    setInternalTarget(object);
    setSearchOpen(false);
    setFilterOpen(false);
    if (item.kind === "event") {
      setSection("schedule");
      pendingTarget.current = { eventId: item.id, date: item.date };
      if (mode === "day" && anchor === item.date) void load(true);
      else { setMode("day"); setAnchor(item.date); }
    } else if (item.kind === "todo") {
      setSection("schedule"); setMode("week"); setAnchor(item.date);
    } else if (item.kind === "journal") {
      setSection("journal"); setMode("day"); setAnchor(item.date);
    } else setSection("time");
  }, [anchor, load, mode]);
  const closeEvent = useCallback(() => {
    restoreFocusId.current = selectedId;
    setSelectedId(undefined);
  }, [selectedId]);
  useEffect(() => {
    if (selectedId || !restoreFocusId.current) return;
    const id = restoreFocusId.current;
    requestAnimationFrame(() => {
      eventRefs.current.get(id)?.focus();
      restoreFocusId.current = undefined;
    });
  }, [selectedId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const repeatable = ["j", "k", "h", "l", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key);
      if (event.defaultPrevented || !isShortcutEvent(event, repeatable) || composerDate || editingEvent || searchOpen) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-helper-controls], [role='dialog'], [role='alertdialog']")) return;
      if (event.key === "Enter" && target?.closest("button, a")) return;
      if (target !== document.body && !panelRef.current?.contains(target)) return;
      const editable = target?.matches("input, textarea, select, [contenteditable='true']");
      if (editable) {
        if (event.key === "Escape") { event.preventDefault(); setQuery(""); setFilterOpen(false); searchRef.current?.blur(); }
        return;
      }
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey || event.altKey) && !((event.ctrlKey || event.metaKey) && key === "f")) return;
      let handled = true;
      if (event.key === "Escape" && selectedId) closeEvent();
      else if (event.key === "Escape" && filterOpen) { setFilterOpen(false); setQuery(""); }
      else if (key === "0") onReturnMail();
      else if (key === "n") { setSection("schedule"); openComposer(anchor); }
      else if (key === "t") setAnchor(todayKey());
      else if (key === "d" && (section === "schedule" || section === "habits")) setMode("day");
      else if ((key === "w" || key === "u") && (section === "schedule" || section === "habits")) setMode("week");
      else if (key === "y" && section === "schedule") setMode("year");
      else if (key === "b") selectSection("habits");
      else if (key === "g") selectSection("journal");
      else if (key === "r") selectSection("time");
      else if (section === "schedule" && (event.key === "ArrowDown" || key === "j")) moveHighlight(1);
      else if (section === "schedule" && (event.key === "ArrowUp" || key === "k")) moveHighlight(-1);
      else if (event.key === "ArrowLeft" || key === "h") shiftWindow(-1);
      else if (event.key === "ArrowRight" || key === "l") shiftWindow(1);
      else if (event.key === "Enter" && highlightedId) openEvent(highlightedId);
      else if ((event.ctrlKey || event.metaKey) && key === "f") { setFilterOpen(true); requestAnimationFrame(() => searchRef.current?.focus()); }
      else if (key === "/" && section === "schedule") { setSearchOpen(true); setFilterOpen(false); appSound.play("open", "interface"); }
      else handled = false;
      if (handled) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [anchor, closeEvent, composerDate, editingEvent, filterOpen, highlightedId, moveHighlight, onReturnMail, openComposer, openEvent, searchOpen, section, selectSection, selectedId, shiftWindow]);

  if (selected) return <><EventDetail event={selected} onBack={closeEvent} onEdit={openEditor} onMeetingPrep={meetingPrepEnabled ? onMeetingPrep : undefined} meetingPrepBusy={meetingPrepBusy} onDeleted={(id, message) => { setResult((current) => ({ ...current, events: current.events.filter((event) => event.id !== id) })); setSelectedId(undefined); setHighlightedId(undefined); onNotice?.(message); void load(true); }} />{editingEvent && <CalendarEventComposer calendars={result.calendars} startsOn={eventDayKey(editingEvent)} event={editingEvent} onClose={closeEditor} onSaved={(message) => { closeEditor(); onNotice?.(message); void load(true); }} />}</>;

  const noResults = result.status === "ready" && visibleEvents.length === 0;
  return <section ref={panelRef} className="panel calendar-panel" aria-label="HEY Calendar">
    <header className="panel-header calendar-header">
      <div className="calendar-title"><CalendarDays size={16} /><h1>Calendar</h1>{(window.heyAgent.profiles?.current.accounts.length ?? 0) > 1 && <span className="calendar-account-scope" title="Calendar is shared by your linked HEY accounts">Shared</span>}{section === "schedule" && <button ref={newEventRef} type="button" className="calendar-new" data-tooltip="New event" data-shortcut="N" onClick={(event) => openComposer(anchor, event.currentTarget)}><CalendarPlus size={14} />New event</button>}</div>
      <div className="calendar-date-nav">{section !== "time" && !searchOpen && <><button type="button" className="calendar-today" data-tooltip="Go to today" data-shortcut="T" onClick={() => setAnchor(todayKey())}>Today</button><button type="button" className="icon-button" aria-label={`Previous ${section === "journal" || mode === "day" ? "day" : mode}`} data-tooltip="Previous date range" data-shortcut="H / ←" onClick={() => shiftWindow(-1)}><ChevronLeft size={16} /></button><strong>{section === "journal" ? formatRange("day", anchor, anchor) : formatRange(presented.mode, presented.startsOn, presented.endsOn)}</strong><button type="button" className="icon-button" aria-label={`Next ${section === "journal" || mode === "day" ? "day" : mode}`} data-tooltip="Next date range" data-shortcut="L / →" onClick={() => shiftWindow(1)}><ChevronRight size={16} /></button></>}</div>
      <div className="calendar-actions">{onRunHelper && <HelperMenu helpers={helpers} onRun={onRunHelper} disabled={loading} />}{(section === "schedule" || section === "habits") && !searchOpen && <div className="calendar-mode" role="group" aria-label={section === "habits" ? "Habit completion view" : "Calendar view"}><button type="button" aria-pressed={presented.mode === "day"} data-tooltip="Day view" data-shortcut="D" onClick={() => setMode("day")}>Day</button><button type="button" aria-pressed={presented.mode === "week"} data-tooltip="Week view" data-shortcut="W" onClick={() => setMode("week")}>Week</button>{section === "schedule" && <button type="button" aria-pressed={presented.mode === "year"} data-tooltip="Year view" data-shortcut="Y" onClick={() => setMode("year")}>Year</button>}</div>}{section === "schedule" && <><button type="button" className="icon-button" aria-label={searchOpen ? "Close Calendar search" : "Search Calendar"} data-tooltip={searchOpen ? "Close Calendar search" : "Search Calendar"} data-shortcut={searchOpen ? "Esc" : "/"} aria-pressed={searchOpen} onClick={() => { setSearchOpen((open) => !open); setFilterOpen(false); appSound.play(searchOpen ? "close" : "open", "interface"); }}><Search size={15} /></button>{mode !== "year" && !searchOpen && <button type="button" className="icon-button" aria-label="Filter this view" data-tooltip="Filter this view" data-shortcut="Ctrl+F" onClick={() => { setFilterOpen((open) => !open); requestAnimationFrame(() => searchRef.current?.focus()); }}><ListFilter size={15} /></button>}</>}<button type="button" className="icon-button" aria-label="Reload Calendar" disabled={section === "schedule" && loading} onClick={() => { if (section === "schedule") void load(true); else setRecordingsRefreshToken((value) => value + 1); }}><RefreshCw size={15} className={section === "schedule" && loading ? "is-spinning" : undefined} /></button></div>
    </header>
    <nav className="calendar-section-nav" aria-label="Calendar sections">{([
      ["schedule", "Schedule"], ["habits", "Habits"], ["journal", "Journal"], ["time", "Time"],
    ] as const).map(([value, label]) => <button key={value} type="button" data-tooltip={label} data-shortcut={{ schedule: undefined, habits: "B", journal: "G", time: "R" }[value]} aria-current={section === value ? "page" : undefined} onPointerEnter={() => { setPreviewedSection(value); appSound.play("hover", "interface", { cooldownMs: 70, retrigger: "restart" }); }} onPointerLeave={() => setPreviewedSection(undefined)} onFocus={() => setPreviewedSection(value)} onBlur={() => setPreviewedSection(undefined)} onClick={() => selectSection(value)}><MorphingIcon icon={calendarSectionIcon(value, section === value || previewedSection === value)} size={14} /><span>{label}</span></button>)}</nav>
    {section === "schedule" && !searchOpen && mode !== "year" && <div className="calendar-filterbar" data-open={filterOpen || undefined}><label><Search size={14} /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Filter this ${mode}`} aria-label={`Filter events in this ${mode}`} />{query && <button type="button" className="icon-button" aria-label="Clear event filter" onClick={() => setQuery("")}><X size={13} /></button>}</label><select aria-label="Calendar" value={calendarId} onChange={(event) => setCalendarId(event.target.value)}><option value="">All calendars</option>{result.calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</select></div>}
    <div className="calendar-scroll" aria-busy={loading}>
      {searchOpen ? <CalendarSearch onClose={() => setSearchOpen(false)} onOpen={openSearchResult} /> : section !== "schedule" ? <CalendarRecordingsPage section={section} anchor={anchor} days={recordingDays} range={range} refreshToken={refreshToken + recordingsRefreshToken} target={target?.object ?? internalTarget} onTargetMissing={target?.object ? onTargetMissing : undefined} onSelectDate={setAnchor} onNotice={onNotice} /> : loading && !result.startsOn ? <CalendarLoading days={mode === "day" ? 1 : mode === "year" ? 12 : 7} /> : result.status !== "ready" ? <CalendarUnavailable result={result} onRetry={() => void load()} /> : presented.mode === "year" ? <CalendarYear year={dateFromKey(presented.startsOn).getFullYear()} anchor={anchor} events={visibleEvents} onSelectDay={(day) => { appSound.play("open", "interface"); setMode("day"); setAnchor(day); }} /> : <>
        {noResults ? query || calendarId ? <div className="calendar-range-empty"><Search size={18} /><h2>No matching events</h2><p>Nothing in this {presented.mode} matches the current filter.</p><button type="button" className="secondary-button" onClick={() => { setQuery(""); setCalendarId(""); }}>Clear filters</button></div> : <CalendarRangeEmpty mode={presented.mode} days={days} onCreate={openComposer} /> : <>
        {unplacedRecurring.length > 0 && <section className="calendar-series" aria-label="Recurring series"><span><Repeat2 size={13} />Recurring series</span>{unplacedRecurring.map((event) => { const key = calendarEventKey(event); return <EventButton key={key} event={event} highlighted={key === highlightedId} onHighlight={setHighlightedId} onOpen={openEvent} eventRefs={eventRefs} compact />; })}</section>}
        <div className="calendar-board" data-mode={presented.mode}>{days.map((day, dayIndex) => {
          const events = visibleEvents.filter((event) => eventOccursOn(event, day));
          const allDay = allDaySpans.filter((span) => span.startDay <= dayIndex && span.endDay >= dayIndex);
          const timedClusters = timedClustersByDay.get(day) ?? [];
          const isToday = day === todayKey();
          const circled = events.some((event) => event.highlighted && eventDayKey(event) === day);
          return <section className="calendar-day" key={day} data-today={isToday || undefined} data-circle={circled || undefined} onDoubleClick={(event) => { if ((event.target as HTMLElement).closest("button")) return; openComposer(day); }}><header><time dateTime={day}><span>{new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(dateFromKey(day))}</span><strong>{dateFromKey(day).getDate()}</strong></time><div><h2>{new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(dateFromKey(day))}</h2>{isToday && <span>Today</span>}</div><button type="button" className="calendar-day-add" aria-label={`Add event on ${day}`} onClick={(event) => openComposer(day, event.currentTarget)}><Plus size={13} /></button></header><div className="calendar-day-events">{allDay.length > 0 && <CalendarDayAllDay spans={allDay} day={day} dayIndex={dayIndex} days={days} highlightedId={highlightedId} onHighlight={setHighlightedId} onOpen={openEvent} eventRefs={eventRefs} />}{timedClusters.map((cluster) => <TimedEventCluster key={cluster.id} cluster={cluster} highlightedId={highlightedId} onHighlight={setHighlightedId} onOpen={openEvent} eventRefs={eventRefs} />)}{timedClusters.length === 0 && <button type="button" className="calendar-day-empty" onClick={(event) => openComposer(day, event.currentTarget)}><Plus size={13} />Add timed event</button>}</div></section>;
        })}</div>
        </>}
        {mode !== "year" && <CalendarScheduleRecordings range={{ startsOn: presented.startsOn, endsOn: presented.endsOn }} anchor={anchor} refreshToken={refreshToken + recordingsRefreshToken} target={target?.object ?? internalTarget} onTargetMissing={target?.object ? onTargetMissing : undefined} onNotice={onNotice} />}
      </>}
    </div>
    {!searchOpen && <footer className="calendar-shortcuts" aria-label="Calendar keyboard shortcuts">{section === "schedule" && <><kbd>N</kbd><span>new</span>{mode !== "year" && <><kbd>J</kbd><kbd>K</kbd><span>events</span></>}<kbd>/</kbd><span>search</span></>}{section !== "time" && <><kbd>H</kbd><kbd>L</kbd><span>{section === "journal" || mode === "day" ? "day" : mode}</span></>}<kbd>T</kbd><span>today</span><kbd>0</kbd><span>mail</span></footer>}
    {composerDate && <CalendarEventComposer calendars={result.calendars} startsOn={composerDate} onClose={closeComposer} onSaved={(message) => { closeComposer(); onNotice?.(message); void load(true); }} />}
  </section>;
}

function EventButton({ event, highlighted, onHighlight, onOpen, eventRefs, compact = false, context, registerRef = true }: { event: CalendarEvent; highlighted: boolean; onHighlight: (id: string) => void; onOpen: (id: string) => void; eventRefs: MutableRefObject<Map<string, HTMLButtonElement>>; compact?: boolean; context?: string; registerRef?: boolean }) {
  const key = calendarEventKey(event);
  const color = safeCalendarColor(event.calendar.color) ?? "var(--accent)";
  return <button type="button" ref={(node) => { if (!registerRef) return; if (node) eventRefs.current.set(key, node); else eventRefs.current.delete(key); }} className="calendar-event" data-highlighted={highlighted || undefined} data-compact={compact || undefined} data-context={context || undefined} style={{ "--calendar-event-color": color } as CSSProperties} onFocus={() => onHighlight(key)} onClick={() => onOpen(key)}><span className="calendar-event-color" />{!compact && !context && <span className="calendar-event-time">{event.allDay ? "All day" : formatClock(new Date(event.startsAt))}</span>}<span className="calendar-event-copy"><strong>{event.title}</strong><small>{[context, event.calendar.name, event.location].filter(Boolean).join(" · ")}</small></span>{event.recurring && <Repeat2 size={12} aria-label="Recurring" />}</button>;
}

function TimedEventCluster({ cluster, highlightedId, onHighlight, onOpen, eventRefs }: { cluster: CalendarTimedCluster; highlightedId?: string; onHighlight: (id: string) => void; onOpen: (id: string) => void; eventRefs: MutableRefObject<Map<string, HTMLButtonElement>> }) {
  const overlap = cluster.events.length > 1;
  const label = formatClock(cluster.startsAt);
  return <section className="calendar-timed-cluster" data-overlap={overlap || undefined} aria-label={overlap ? `${cluster.events.length} overlapping events at ${label}` : `Event at ${label}`}><time dateTime={new Date(cluster.startsAt).toISOString()}>{label}</time><div className="calendar-collision-group">{cluster.events.map((event) => { const key = calendarEventKey(event); return <EventButton key={key} event={event} highlighted={key === highlightedId} onHighlight={onHighlight} onOpen={onOpen} eventRefs={eventRefs} context={formatTimedRange(event)} />; })}</div></section>;
}

function CalendarDayAllDay({ spans, day, dayIndex, days, highlightedId, onHighlight, onOpen, eventRefs }: { spans: CalendarAllDaySpan[]; day: string; dayIndex: number; days: string[]; highlightedId?: string; onHighlight: (id: string) => void; onOpen: (id: string) => void; eventRefs: MutableRefObject<Map<string, HTMLButtonElement>> }) {
  const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(dateFromKey(day));
  return <section className="calendar-day-all-day" aria-label={`All-day events on ${dayLabel}`}><span>All day</span><div>{spans.map((span) => { const key = calendarEventKey(span.event); return <EventButton key={`${key}:${day}`} event={span.event} highlighted={key === highlightedId} onHighlight={onHighlight} onOpen={onOpen} eventRefs={eventRefs} registerRef={span.startDay === dayIndex} compact context={formatAllDayRange(span.event, days)} />; })}</div></section>;
}

function CalendarRangeEmpty({ mode, days, onCreate }: { mode: CalendarViewMode; days: string[]; onCreate: (day: string, trigger?: HTMLElement) => void }) {
  return <div className="calendar-range-empty"><CalendarDays size={19} /><h2>Nothing scheduled {mode === "day" ? "today" : "this week"}</h2><p>Your calendar is clear. Add something here without leaving the flow.</p>{mode === "week" && <div className="calendar-empty-days">{days.map((day) => <button key={day} type="button" onClick={(event) => onCreate(day, event.currentTarget)}><span>{new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(dateFromKey(day))}</span><strong>{dateFromKey(day).getDate()}</strong></button>)}</div>}<button type="button" className="primary-button" onClick={(event) => onCreate(days[0]!, event.currentTarget)}><CalendarPlus size={14} />New event</button></div>;
}

function EventDetail({ event, onBack, onEdit, onMeetingPrep, meetingPrepBusy = false, onDeleted }: { event: CalendarEvent; onBack: () => void; onEdit: (event: CalendarEvent, trigger?: HTMLElement) => void; onMeetingPrep?: (event: CalendarEvent) => void; meetingPrepBusy?: boolean; onDeleted: (id: string, message: string) => void }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const startDate = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(event.allDay ? `${event.startsAt.slice(0, 10)}T12:00:00` : event.startsAt));
  const endKey = event.endsAt.slice(0, 10);
  const displayEndKey = event.allDay && endKey > event.startsAt.slice(0, 10) ? addDays(endKey, -1) : endKey;
  const endDate = displayEndKey && displayEndKey !== event.startsAt.slice(0, 10) ? new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(`${displayEndKey}T12:00:00`)) : "";
  const writable = event.calendar.writable === true;
  const peopleCount = event.attendees.length;
  const beginDelete = () => {
    setDeleteError(undefined);
    setConfirmingDelete(true);
    requestAnimationFrame(() => cancelDeleteRef.current?.focus());
  };
  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(undefined);
    try {
      const result = await window.heyAgent.calendar.delete(event.id);
      onDeleted(event.id, result.message);
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : "HEY could not delete this event.");
      setDeleting(false);
    }
  };
  return <section className="panel calendar-panel calendar-detail" onKeyDown={(keyboard) => {
    if (keyboard.defaultPrevented || !isShortcutEvent(keyboard.nativeEvent) || keyboard.ctrlKey || keyboard.metaKey || keyboard.altKey || keyboard.shiftKey) return;
    if ((keyboard.target as HTMLElement).closest("[role='dialog']")) return;
    if (keyboard.key === "Escape") {
      keyboard.preventDefault(); keyboard.stopPropagation();
      if (confirmingDelete) { setConfirmingDelete(false); setDeleteError(undefined); editButtonRef.current?.focus(); }
      else onBack();
      return;
    }
    if (!writable || confirmingDelete || deleting) return;
    if (keyboard.key.toLowerCase() === "e") { keyboard.preventDefault(); keyboard.stopPropagation(); onEdit(event, editButtonRef.current ?? undefined); }
    else if (keyboard.key === "Delete" || keyboard.key === "Backspace") { keyboard.preventDefault(); keyboard.stopPropagation(); beginDelete(); }
  }}><header className="panel-header"><button autoFocus type="button" className="calendar-back" data-tooltip="Back to Calendar" data-shortcut="Esc" onClick={onBack}><ArrowLeft size={15} />Calendar</button><span>{event.calendar.name}</span></header><div className="calendar-detail-scroll"><article><div className="calendar-detail-kicker"><span style={{ backgroundColor: safeCalendarColor(event.calendar.color) ?? "var(--accent)" }} />{event.calendar.name}</div><h1>{event.title}</h1><dl><div><dt><Clock3 size={16} />When</dt><dd><strong>{startDate}{endDate ? ` – ${endDate}` : ""}</strong><span>{formatTime(event)}{event.timeZone ? ` · ${event.timeZone.replaceAll("_", " ")}` : ""}</span></dd></div>{event.location && <div><dt><MapPin size={16} />Where</dt><dd>{event.location}</dd></div>}{event.recurring && <div><dt><Repeat2 size={16} />Repeats</dt><dd>Recurring event</dd></div>}{event.reminders.length > 0 && <div><dt><Bell size={16} />Reminders</dt><dd>{event.reminders.map(formatReminder).join(", ")}</dd></div>}{(event.organizer || event.attendees.length > 0) && <div><dt><Users size={16} />People</dt><dd>{event.organizer && <strong>Organized by {event.organizer.name}</strong>}<span>{event.attendanceSummary ?? event.attendees.map((attendee) => `${attendee.name}${attendee.status ? ` (${attendee.status})` : ""}`).join(", ")}</span></dd></div>}{event.attachedEntryId && <div><dt><Mail size={16} />Related email</dt><dd>Attached in HEY</dd></div>}{event.joinLink && <div><dt><Video size={16} />Join</dt><dd><button type="button" className="calendar-join" onClick={() => void window.heyAgent.system.openExternalUrl(event.joinLink!.url)}>{event.joinLink.title ?? "Open meeting link"}<ExternalLink size={13} /></button></dd></div>}</dl>{event.description && <section className="calendar-notes"><h2>Notes</h2><p>{event.description}</p></section>}<div className="calendar-detail-actions">{onMeetingPrep && <button type="button" className="primary-button calendar-helper" disabled={meetingPrepBusy} onClick={() => onMeetingPrep(event)}><Sparkles size={14} />{meetingPrepBusy ? "Starting…" : "Meeting Prep"}</button>}{writable && <button ref={editButtonRef} type="button" className="secondary-button calendar-edit" data-tooltip="Edit event" data-shortcut="E" onClick={(click) => onEdit(event, click.currentTarget)}><Pencil size={14} />Edit event</button>}{event.linkUrl && <button type="button" className="secondary-button calendar-external" onClick={() => void window.heyAgent.system.openExternalUrl(event.linkUrl!)}>Open link <ExternalLink size={14} /></button>}{event.editUrl && <button type="button" className="secondary-button calendar-external" onClick={() => void window.heyAgent.system.openExternalUrl(event.editUrl!)}>{writable ? "Open in HEY" : "Edit in HEY"} <ExternalLink size={14} /></button>}{writable && <button type="button" className="secondary-button calendar-delete" data-tooltip="Review event deletion" data-shortcut="Delete" onClick={beginDelete}><Trash2 size={14} />Delete event</button>}</div>{confirmingDelete && <section className="calendar-delete-confirm" role="alertdialog" aria-labelledby="calendar-delete-title" aria-describedby="calendar-delete-description"><div><strong id="calendar-delete-title">Delete “{event.title}”?</strong><p id="calendar-delete-description">This permanently removes it from {event.calendar.name}.{event.recurring ? " The entire recurring series will be deleted." : ""}{peopleCount > 0 ? ` HEY may notify ${peopleCount} ${peopleCount === 1 ? "person" : "people"} on this event.` : ""} This cannot be undone.</p>{deleteError && <p className="composer-error compact">{deleteError}</p>}</div><footer><button ref={cancelDeleteRef} type="button" className="secondary-button" disabled={deleting} onClick={() => { setConfirmingDelete(false); setDeleteError(undefined); editButtonRef.current?.focus(); }}>Cancel</button><button type="button" className="calendar-delete-primary" disabled={deleting} onClick={() => void remove()}><Trash2 size={14} />{deleting ? "Deleting…" : event.recurring ? "Delete series" : "Delete event"}</button></footer></section>}</article></div><footer className="calendar-shortcuts">{writable && <><kbd>E</kbd><span>edit</span><kbd>Del</kbd><span>delete</span></>}<kbd>Esc</kbd><span>back</span></footer></section>;
}

function CalendarLoading({ days }: { days: number }) {
  return <div className="calendar-loading" role="status"><div className="calendar-loading-heading"><LoaderCircle size={15} className="is-spinning" /><strong>Reading Calendar</strong></div><div className="calendar-loading-grid">{Array.from({ length: days }, (_, index) => <span key={index} />)}</div></div>;
}

function CalendarUnavailable({ result, onRetry }: { result: CalendarWindowResult; onRetry: () => void }) {
  return <div className="empty-state"><span className="empty-mark"><CalendarDays size={18} /></span><h2>{result.status === "needs-auth" ? "Reconnect HEY Calendar" : "Calendar is unavailable"}</h2><p>{result.detail ?? "HEY Calendar could not be read right now."}</p><button type="button" className="primary-button" onClick={onRetry}>Try again</button></div>;
}
