import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Check, CheckCircle2, Circle, Clock3, Edit3, Flame, Plus, Save, Trash2, X } from "lucide-react";
import { ChevronDown as ChevronDownData, ChevronRight as ChevronRightData, MoreHorizontal as MoreHorizontalData, Play as PlayData, Square as SquareData, X as XData } from "lucide";
import { CALENDAR_HABIT_COLORS, CALENDAR_HABIT_ICONS, type AgentObjectLink, type CalendarHabit, type CalendarHabitColor, type CalendarHabitIcon, type CalendarJournalEntry, type CalendarTimeCategory, type CalendarTimeTrack, type CalendarTodo, type CalendarWindowRequest } from "../../../shared/contracts";
import { addDays, dateFromKey } from "../calendar";
import { appSound } from "../sound";
import MorphingIcon from "./MorphingIcon";

export type CalendarSection = "schedule" | "habits" | "journal" | "time";

const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const habitEmoji: Record<CalendarHabitIcon, string> = {
  weights: "🏋️", art: "🎨", baseball: "⚾", basketball: "🏀", bed: "🛏️", bicycle: "🚲", brain: "🧠", camera: "📷", cat: "🐈", church: "⛪", clean: "🧹", cook: "🍳", dog: "🐕", football: "🏈", fruit: "🍎", game: "🎮", garden: "🪴", guitar: "🎸", heart: "♥", hydrate: "💧", meditate: "🧘", money: "💰", music: "🎵", piano: "🎹", pill: "💊", plant: "🌱", read: "📖", run: "🏃", smoke: "🚭", soccer: "⚽", study: "🎓", swim: "🏊", tea: "🍵", toothbrush: "🪥", tree: "🌳", tv: "📺", vegetable: "🥕", walk: "🚶", water: "💧", write: "✍️", yoga: "🧘", heat: "🔥", ice: "❄️", lotus: "🪷", breathe: "🌬️", drink: "🥤", star: "★",
};

function messageOf(error: unknown, fallback: string): string { return error instanceof Error ? error.message : fallback; }
function dayLabel(date: string): string { return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(dateFromKey(date)); }
function clock(value: string): string { return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function duration(track: CalendarTimeTrack, now = Date.now()): string {
  const milliseconds = Math.max(0, (track.endsAt ? new Date(track.endsAt).getTime() : now) - new Date(track.startsAt).getTime());
  const minutes = Math.floor(milliseconds / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}
function localInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type RecordingTargetProps = { target?: AgentObjectLink; onTargetMissing?: (object: AgentObjectLink) => void };

export function CalendarScheduleRecordings({ range, anchor, refreshToken, target, onTargetMissing, onNotice }: { range: CalendarWindowRequest; anchor: string; refreshToken: number; onNotice?: (message: string) => void } & RecordingTargetProps) {
  const [todos, setTodos] = useState<CalendarTodo[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(target?.kind === "calendar-todo");
  const [loadedScope, setLoadedScope] = useState("");
  const [deleting, setDeleting] = useState<CalendarTodo>();
  const [error, setError] = useState<string>();
  const targetRef = useRef<HTMLElement | null>(null);
  const reportedMissing = useRef<string | undefined>(undefined);
  const load = useCallback(async () => {
    setLoadedScope("");
    const todoResult = await window.heyAgent.calendar.listTodos(range);
    if (todoResult.status === "ready") setTodos(todoResult.data);
    setError(todoResult.detail);
    setLoadedScope(todoResult.status === "ready" ? `${range.startsOn}:${range.endsOn}:${anchor}` : "");
  }, [anchor, range.endsOn, range.startsOn]);
  useEffect(() => { void load(); }, [load, refreshToken]);
  useEffect(() => {
    if (target?.kind !== "calendar-todo" || loadedScope !== `${range.startsOn}:${range.endsOn}:${anchor}`) return;
    setOpen(true);
    const found = todos.some((item) => item.id === target.id);
    if (!found) {
      if (reportedMissing.current !== `${target.kind}:${target.id}`) { reportedMissing.current = `${target.kind}:${target.id}`; onTargetMissing?.(target); }
      return;
    }
    reportedMissing.current = undefined;
    requestAnimationFrame(() => targetRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  }, [anchor, loadedScope, onTargetMissing, range.endsOn, range.startsOn, target, todos]);

  const add = async () => {
    const next = title.trim(); if (!next || busy) return;
    const optimistic: CalendarTodo = { id: `optimistic-${Date.now()}`, title: next, startsOn: anchor };
    setTitle(""); setTodos((items) => [...items, optimistic]); setBusy(true); setError(undefined);
    try { const result = await window.heyAgent.calendar.createTodo({ title: next, date: anchor }); appSound.play("success", "interface"); onNotice?.(result.message); await load(); }
    catch (reason) { setTodos((items) => items.filter((item) => item.id !== optimistic.id)); setTitle(next); setError(messageOf(reason, "HEY could not add that todo.")); appSound.play("error", "interface"); }
    finally { setBusy(false); }
  };
  const toggleTodo = async (todo: CalendarTodo) => {
    const completed = !todo.completedAt;
    setTodos((items) => items.map((item) => item.id === todo.id ? { ...item, completedAt: completed ? new Date().toISOString() : undefined } : item));
    appSound.play(completed ? "select" : "deselect", "interface");
    try { onNotice?.((await window.heyAgent.calendar.completeTodo({ id: todo.id, completed })).message); }
    catch (reason) { setTodos((items) => items.map((item) => item.id === todo.id ? todo : item)); setError(messageOf(reason, "HEY could not update that todo.")); appSound.play("error", "interface"); }
  };
  const removeTodo = async () => {
    if (!deleting) return;
    const result = await window.heyAgent.calendar.deleteTodo(deleting.id);
    setTodos((items) => items.filter((item) => item.id !== deleting.id));
    setDeleting(undefined);
    appSound.play("delete", "interface");
    onNotice?.(result.message);
  };
  const orderedTodos = [...todos].sort((left, right) => Number(Boolean(left.completedAt)) - Number(Boolean(right.completedAt)));
  const incomplete = todos.filter((todo) => !todo.completedAt).length;

  return <section className="calendar-sometime" aria-label="Sometime this week" data-open={open || undefined}>
    <button type="button" className="calendar-sometime-toggle" aria-expanded={open} onClick={() => { appSound.play(open ? "collapse" : "expand", "interface"); setOpen((value) => !value); }}><MorphingIcon icon={open ? ChevronDownData : ChevronRightData} size={13} /><strong>Sometime this week</strong>{incomplete > 0 && <span>{incomplete}</span>}</button>
    {open && <div className="calendar-sometime-body"><div className="calendar-todo-list">{orderedTodos.map((todo) => <div key={todo.id} ref={target?.kind === "calendar-todo" && target.id === todo.id ? (node) => { targetRef.current = node; } : undefined} data-agent-target={target?.kind === "calendar-todo" && target.id === todo.id || undefined}><button type="button" data-complete={Boolean(todo.completedAt) || undefined} onClick={() => void toggleTodo(todo)}>{todo.completedAt ? <CheckCircle2 size={15} /> : <Circle size={15} />}<span>{todo.title}</span></button><button type="button" className="calendar-todo-delete" aria-label={`Delete ${todo.title}`} onClick={() => setDeleting(todo)}><Trash2 size={12} /></button></div>)}</div><form onSubmit={(event) => { event.preventDefault(); void add(); }}><Plus size={13} /><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Add something" aria-label="New Sometime This Week todo" /><button type="submit" disabled={!title.trim() || busy}>Add</button></form></div>}
    {error && <p className="composer-error compact">{error}</p>}
    {deleting && <Confirm title={`Delete “${deleting.title}”?`} copy="This permanently removes it from Sometime This Week." confirm="Delete todo" onCancel={() => setDeleting(undefined)} onConfirm={removeTodo} />}
  </section>;
}

function HabitCheck({ habit, date, compact = false, label, onError, onNotice }: { habit: CalendarHabit; date: string; compact?: boolean; label?: string; onError: (value: string | undefined) => void; onNotice?: (message: string) => void }) {
  const initiallyComplete = habit.completedDates.includes(date);
  const [complete, setComplete] = useState(initiallyComplete);
  useEffect(() => setComplete(initiallyComplete), [date, habit.id, initiallyComplete]);
  const toggle = async () => {
    const next = !complete; setComplete(next); onError(undefined); appSound.play(next ? "select" : "deselect", "interface");
    try { onNotice?.((await window.heyAgent.calendar.completeHabit({ id: habit.id, date, completed: next })).message); }
    catch (reason) { setComplete(!next); onError(messageOf(reason, "HEY could not update that habit.")); appSound.play("error", "interface"); }
  };
  return <button type="button" className="calendar-habit-check" data-complete={complete || undefined} data-compact={compact || undefined} data-color={habit.color} aria-label={`${complete ? "Uncomplete" : "Complete"} ${habit.name} for ${dayLabel(date)}`} onClick={() => void toggle()}>{!compact && <span>{habitEmoji[habit.icon] ?? "✦"}</span>}<strong>{compact ? label : habit.name}</strong>{complete ? <Check size={13} /> : <Plus size={13} />}</button>;
}

export function CalendarRecordingsPage({ section, anchor, days, range, refreshToken, target, onTargetMissing, onSelectDate, onNotice }: { section: Exclude<CalendarSection, "schedule">; anchor: string; days: string[]; range: CalendarWindowRequest; refreshToken: number; onSelectDate: (date: string) => void; onNotice?: (message: string) => void } & RecordingTargetProps) {
  if (section === "habits") return <HabitsPage anchor={anchor} days={days} refreshToken={refreshToken} target={target} onTargetMissing={onTargetMissing} onNotice={onNotice} />;
  if (section === "journal") return <JournalPage anchor={anchor} range={range} refreshToken={refreshToken} target={target} onTargetMissing={onTargetMissing} onSelectDate={onSelectDate} onNotice={onNotice} />;
  return <TimePage refreshToken={refreshToken} target={target} onTargetMissing={onTargetMissing} onNotice={onNotice} />;
}

function HabitsPage({ anchor, days, refreshToken, target, onTargetMissing, onNotice }: { anchor: string; days: string[]; refreshToken: number; onNotice?: (message: string) => void } & RecordingTargetProps) {
  const [habits, setHabits] = useState<CalendarHabit[]>([]);
  const [editing, setEditing] = useState<CalendarHabit | "new">();
  const [deleting, setDeleting] = useState<CalendarHabit>();
  const [error, setError] = useState<string>();
  const [loadedDate, setLoadedDate] = useState("");
  const targetRef = useRef<HTMLElement | null>(null);
  const reportedMissing = useRef<string | undefined>(undefined);
  const load = useCallback(async () => { setLoadedDate(""); const result = await window.heyAgent.calendar.listHabits(anchor); if (result.status === "ready") { setHabits(result.data); setLoadedDate(anchor); } setError(result.detail); }, [anchor]);
  useEffect(() => { void load(); }, [load, refreshToken]);
  useEffect(() => { if (target?.kind !== "calendar-habit" || loadedDate !== anchor) return; if (!habits.some((item) => item.id === target.id)) { if (reportedMissing.current !== target.id) { reportedMissing.current = target.id; onTargetMissing?.(target); } return; } reportedMissing.current = undefined; requestAnimationFrame(() => targetRef.current?.scrollIntoView({ block: "center" })); }, [anchor, habits, loadedDate, onTargetMissing, target]);
  return <div className="calendar-recordings-page"><header className="calendar-recordings-heading"><div><Flame size={18} /><h2>Habits</h2></div><button type="button" className="primary-button" onClick={() => { appSound.play("open", "interface"); setEditing("new"); }}><Plus size={14} />New habit</button></header>
    {error && <p className="composer-error">{error}</p>}
    <div className="calendar-habits-grid">{habits.map((habit) => <article key={habit.id} ref={target?.kind === "calendar-habit" && target.id === habit.id ? (node) => { targetRef.current = node; } : undefined} data-color={habit.color} data-agent-target={target?.kind === "calendar-habit" && target.id === habit.id || undefined}><div className="habit-symbol">{habitEmoji[habit.icon] ?? "✦"}</div><div><h3>{habit.name}</h3><p>{habit.days.length === 7 ? "Every day" : habit.days.map((day) => weekdayNames[day]).join(" · ")}</p></div><div className="habit-actions"><button type="button" className="icon-button" aria-label={`Edit ${habit.name}`} onClick={() => { appSound.play("open", "interface"); setEditing(habit); }}><Edit3 size={14} /></button><button type="button" className="icon-button" aria-label={`Delete ${habit.name}`} onClick={() => setDeleting(habit)}><Trash2 size={14} /></button></div><div className="habit-completions">{days.filter((day) => habit.days.includes(dateFromKey(day).getDay())).map((day) => <HabitCheck key={day} habit={habit} date={day} compact={days.length > 1} label={new Intl.DateTimeFormat(undefined, { weekday: "narrow" }).format(dateFromKey(day))} onError={setError} onNotice={onNotice} />)}{!habit.days.includes(dateFromKey(anchor).getDay()) && days.length === 1 && <small>Not scheduled today</small>}</div></article>)}{habits.length === 0 && <EmptyRecording icon={<Flame size={19} />} title="No habits" />}</div>
    {editing && <HabitEditor value={editing === "new" ? undefined : editing} onClose={() => setEditing(undefined)} onSaved={(message) => { appSound.play("success", "interface"); setEditing(undefined); onNotice?.(message); void load(); }} />}
    {deleting && <Confirm title={`Delete “${deleting.name}”?`} copy="This removes the habit and its completion history from HEY. It cannot be undone." confirm="Delete habit" onCancel={() => setDeleting(undefined)} onConfirm={async () => { const result = await window.heyAgent.calendar.deleteHabit(deleting.id); appSound.play("delete", "interface"); setDeleting(undefined); onNotice?.(result.message); await load(); }} />}
  </div>;
}

function HabitEditor({ value, onClose, onSaved }: { value?: CalendarHabit; onClose: () => void; onSaved: (message: string) => void }) {
  const [name, setName] = useState(value?.name ?? ""); const [icon, setIcon] = useState<CalendarHabitIcon>(value?.icon ?? "weights"); const [color, setColor] = useState<CalendarHabitColor>(value?.color ?? "blue"); const [days, setDays] = useState(value?.days ?? [0, 1, 2, 3, 4, 5, 6]); const [saving, setSaving] = useState(false); const [error, setError] = useState<string>();
  const save = async () => { if (!name.trim() || !days.length || saving) return; setSaving(true); try { onSaved((await window.heyAgent.calendar.writeHabit({ ...(value ? { id: value.id } : {}), name: name.trim(), icon, color, days })).message); } catch (reason) { setError(messageOf(reason, "HEY could not save that habit.")); appSound.play("error", "interface"); setSaving(false); } };
  return <div className="calendar-recording-modal" role="dialog" aria-modal="true" aria-labelledby="habit-editor-title" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}><form onSubmit={(event) => { event.preventDefault(); void save(); }}><header><div><span className="habit-symbol">{habitEmoji[icon] ?? "✦"}</span><h2 id="habit-editor-title">{value ? "Edit habit" : "New habit"}</h2></div><button type="button" className="icon-button" aria-label="Close" data-tooltip="Close editor" data-shortcut="Esc" onClick={onClose}><X size={16} /></button></header><label>Name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="What do you want to keep doing?" /></label><div className="recording-form-pair"><label>Icon<select value={icon} onChange={(event) => setIcon(event.target.value as CalendarHabitIcon)}>{CALENDAR_HABIT_ICONS.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></label><label>Color<select value={color} onChange={(event) => setColor(event.target.value as CalendarHabitColor)}>{CALENDAR_HABIT_COLORS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label></div><fieldset><legend>Days</legend><div className="habit-days">{weekdayNames.map((day, index) => <button key={day} type="button" aria-pressed={days.includes(index)} onClick={() => setDays((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index].sort())}>{day}</button>)}</div></fieldset>{error && <p className="composer-error">{error}</p>}<footer><button type="button" className="secondary-button" data-tooltip="Cancel editing" data-shortcut="Esc" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={!name.trim() || !days.length || saving}><Save size={14} />{saving ? "Saving…" : "Save habit"}</button></footer></form></div>;
}

function JournalPage({ anchor, range, refreshToken, target, onTargetMissing, onSelectDate, onNotice }: { anchor: string; range: CalendarWindowRequest; refreshToken: number; onSelectDate: (date: string) => void; onNotice?: (message: string) => void } & RecordingTargetProps) {
  const [entry, setEntry] = useState<CalendarJournalEntry | null>(); const [history, setHistory] = useState<CalendarJournalEntry[]>([]); const [content, setContent] = useState(""); const [status, setStatus] = useState<"idle" | "dirty" | "saving" | "saved">("idle"); const [confirmRemove, setConfirmRemove] = useState(false); const [error, setError] = useState<string>(); const loadedDate = useRef("");
  const reportedMissing = useRef<string | undefined>(undefined);
  const load = useCallback(async () => { setEntry(undefined); const [current, entries] = await Promise.all([window.heyAgent.calendar.readJournal(anchor), window.heyAgent.calendar.listJournal(range)]); if (current.status === "ready") { setEntry(current.data); setContent(current.data?.content ?? ""); loadedDate.current = anchor; setStatus("idle"); } if (entries.status === "ready") setHistory(entries.data); setError(current.detail ?? entries.detail); }, [anchor, range.endsOn, range.startsOn]);
  useEffect(() => { void load(); }, [load, refreshToken]);
  useEffect(() => {
    if (target?.kind !== "calendar-journal" || entry === undefined || loadedDate.current !== anchor) return;
    if (!entry) { if (reportedMissing.current !== target.id) { reportedMissing.current = target.id; onTargetMissing?.(target); } }
    else reportedMissing.current = undefined;
  }, [entry, onTargetMissing, target]);
  const save = useCallback(async (date: string, value: string) => { if (!value.trim()) return; setStatus("saving"); try { const result = await window.heyAgent.calendar.writeJournal({ date, content: value }); setEntry((current) => current ?? { date, content: value }); setStatus("saved"); onNotice?.(result.message); } catch (reason) { setStatus("dirty"); setError(messageOf(reason, "HEY could not save this Journal entry.")); appSound.play("error", "interface"); } }, [onNotice]);
  useEffect(() => { if (loadedDate.current !== anchor || status !== "dirty" || !content.trim()) return; const timer = window.setTimeout(() => { void save(anchor, content); }, 900); return () => window.clearTimeout(timer); }, [anchor, content, save, status]);
  const remove = async () => { try { const result = await window.heyAgent.calendar.writeJournal({ date: anchor, content: "" }); setContent(""); setEntry(null); setStatus("idle"); setConfirmRemove(false); appSound.play("delete", "interface"); onNotice?.(result.message); await load(); } catch (reason) { setError(messageOf(reason, "HEY could not remove this Journal entry.")); appSound.play("error", "interface"); } };
  return <div className="calendar-recordings-page calendar-journal-page" data-agent-target={target?.kind === "calendar-journal" && Boolean(entry) || undefined}><header className="calendar-recordings-heading"><div><BookOpen size={18} /><span><h2>Journal</h2><p>{dayLabel(anchor)} · private to you</p></span></div><div className="journal-heading-actions"><span className="journal-save-state" data-state={status}>{status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "dirty" ? "Unsaved" : ""}</span>{entry && <button type="button" className="secondary-button journal-remove" onClick={() => setConfirmRemove(true)}><Trash2 size={13} />Remove entry</button>}</div></header><div className="journal-layout"><aside><strong>This week</strong>{Array.from({ length: 7 }, (_, index) => addDays(range.startsOn, index)).map((day) => <button type="button" key={day} data-has-entry={history.some((item) => item.date === day) || undefined} data-current={day === anchor || undefined} onClick={() => onSelectDate(day)}>{new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric" }).format(dateFromKey(day))}</button>)}</aside><section><textarea autoFocus value={content} onChange={(event) => { setContent(event.target.value); setStatus("dirty"); }} onBlur={() => { if (status === "dirty" && content.trim()) void save(anchor, content); }} placeholder="What do you want to remember about this day?" aria-label={`Journal entry for ${dayLabel(anchor)}`} /></section></div>{error && <p className="composer-error">{error}</p>}{confirmRemove && <Confirm title="Remove this Journal entry?" copy={`The entry for ${dayLabel(anchor)} will be permanently removed from HEY.`} confirm="Remove entry" onCancel={() => setConfirmRemove(false)} onConfirm={remove} />}</div>;
}

function TimePage({ refreshToken, target, onTargetMissing, onNotice }: { refreshToken: number; onNotice?: (message: string) => void } & RecordingTargetProps) {
  const [current, setCurrent] = useState<CalendarTimeTrack | null>(); const [tracks, setTracks] = useState<CalendarTimeTrack[]>([]); const [categories, setCategories] = useState<CalendarTimeCategory[]>([]); const [stopCategory, setStopCategory] = useState(""); const [editing, setEditing] = useState<CalendarTimeTrack>(); const [deleting, setDeleting] = useState<CalendarTimeTrack>(); const [manageCategories, setManageCategories] = useState(false); const [now, setNow] = useState(Date.now()); const [error, setError] = useState<string>(); const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false); const targetRef = useRef<HTMLElement | null>(null); const reportedMissing = useRef<string | undefined>(undefined);
  const [actionsOpen, setActionsOpen] = useState(false);
  const load = useCallback(async () => { setLoaded(false); const [active, history, categoryList] = await Promise.all([window.heyAgent.calendar.currentTimeTrack(), window.heyAgent.calendar.listTimeTracks(target?.kind === "calendar-time-track" ? "all" : 100), window.heyAgent.calendar.listTimeCategories()]); if (active.status === "ready") setCurrent(active.data); if (history.status === "ready") setTracks(history.data); if (categoryList.status === "ready") setCategories(categoryList.data); setError(active.detail ?? history.detail ?? categoryList.detail); setLoaded(active.status === "ready" && history.status === "ready" && categoryList.status === "ready"); }, [target?.id, target?.kind]);
  useEffect(() => { void load(); }, [load, refreshToken]); useEffect(() => { if (!current) return; const timer = window.setInterval(() => setNow(Date.now()), 1_000); return () => window.clearInterval(timer); }, [current]);
  useEffect(() => { if (target?.kind !== "calendar-time-track" || !loaded) return; const found = current?.id === target.id || tracks.some((item) => item.id === target.id); if (!found) { if (reportedMissing.current !== target.id) { reportedMissing.current = target.id; onTargetMissing?.(target); } return; } reportedMissing.current = undefined; requestAnimationFrame(() => targetRef.current?.scrollIntoView({ block: "center" })); }, [current, loaded, onTargetMissing, target, tracks]);
  const toggle = async () => { if (busy) return; const previous = current; setBusy(true); setError(undefined); try { if (current) { setCurrent(null); onNotice?.((await window.heyAgent.calendar.stopTimeTrack({ ...(stopCategory ? { category: stopCategory } : {}) })).message); appSound.play("stop", "interface"); setStopCategory(""); } else { const optimistic = { id: "starting", startsAt: new Date().toISOString() }; setCurrent(optimistic); onNotice?.((await window.heyAgent.calendar.startTimeTrack()).message); appSound.play("start", "interface"); } await load(); } catch (reason) { setCurrent(previous); setError(messageOf(reason, "HEY could not update time tracking.")); appSound.play("error", "interface"); } finally { setBusy(false); } };
  const exportTracks = async () => { try { const result = await window.heyAgent.calendar.exportTimeTracks(); if (!result.cancelled && result.path) { appSound.play("success", "interface"); onNotice?.(`Tracked time exported to ${result.path}.`); } } catch (reason) { setError(messageOf(reason, "HEY could not export tracked time.")); appSound.play("error", "interface"); } };
  return <div className="calendar-recordings-page calendar-time-page"><header className="calendar-recordings-heading"><div><Clock3 size={18} /><h2>Time tracking</h2></div><div className="calendar-heading-menu"><button type="button" className="icon-button" aria-label="Time tracking options" aria-expanded={actionsOpen} onClick={() => { appSound.play(actionsOpen ? "collapse" : "expand", "interface"); setActionsOpen((value) => !value); }}><MorphingIcon icon={actionsOpen ? XData : MoreHorizontalData} size={16} /></button>{actionsOpen && <div role="menu"><button type="button" role="menuitem" onClick={() => { appSound.play("open", "interface"); setActionsOpen(false); setManageCategories(true); }}>Categories</button><button type="button" role="menuitem" onClick={() => { setActionsOpen(false); void exportTracks(); }}>Export</button></div>}</div></header><section ref={target?.kind === "calendar-time-track" && current?.id === target.id ? (node) => { targetRef.current = node; } : undefined} className="time-current" data-running={Boolean(current) || undefined} data-agent-target={target?.kind === "calendar-time-track" && current?.id === target.id || undefined}><div><div className="time-current-clock">{current ? duration(current, now) : "No timer running"}</div>{current && <small>Since {clock(current.startsAt)}</small>}</div>{current && <select value={stopCategory} onChange={(event) => setStopCategory(event.target.value)} aria-label="Category when stopping"><option value="">No category</option>{categories.map((category) => <option key={category.id} value={category.title}>{category.title}</option>)}</select>}<button type="button" className={current ? "time-stop" : "time-start"} disabled={busy} onClick={() => void toggle()}><MorphingIcon icon={current ? SquareData : PlayData} size={15} />{busy ? "Working…" : current ? "Stop" : "Start"}</button></section>{error && <p className="composer-error">{error}</p>}<section className="time-history"><header><h3>History</h3>{tracks.length > 0 && <span>{tracks.length}</span>}</header>{tracks.map((track) => <article key={track.id} ref={target?.kind === "calendar-time-track" && target.id === track.id ? (node) => { targetRef.current = node; } : undefined} data-agent-target={target?.kind === "calendar-time-track" && target.id === track.id || undefined}><div className="time-track-duration">{duration(track)}</div><div><strong>{new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date(track.startsAt))} · {clock(track.startsAt)}{track.endsAt ? `–${clock(track.endsAt)}` : ""}</strong><p>{[track.category, track.notes].filter(Boolean).join(" · ") || "Unfiled"}</p></div><button type="button" className="icon-button" aria-label="Edit time track" onClick={() => { appSound.play("open", "interface"); setEditing(track); }}><Edit3 size={14} /></button><button type="button" className="icon-button" aria-label="Delete time track" onClick={() => setDeleting(track)}><Trash2 size={14} /></button></article>)}{tracks.length === 0 && <p className="time-history-empty">No tracked time.</p>}</section>{editing && <TimeEditor track={editing} categories={categories} onClose={() => setEditing(undefined)} onSaved={(message) => { appSound.play("success", "interface"); setEditing(undefined); onNotice?.(message); void load(); }} />}{deleting && <Confirm title="Delete this time track?" copy={`${duration(deleting)} from ${dayLabel(deleting.startsAt.slice(0, 10))} will be permanently removed.`} confirm="Delete time track" onCancel={() => setDeleting(undefined)} onConfirm={async () => { const result = await window.heyAgent.calendar.deleteTimeTrack(deleting.id); appSound.play("delete", "interface"); setDeleting(undefined); onNotice?.(result.message); await load(); }} />}{manageCategories && <CategoryManager categories={categories} onClose={() => setManageCategories(false)} onChanged={load} onNotice={onNotice} />}</div>;
}

function TimeEditor({ track, categories, onClose, onSaved }: { track: CalendarTimeTrack; categories: CalendarTimeCategory[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [start, setStart] = useState(localInput(track.startsAt)); const [end, setEnd] = useState(localInput(track.endsAt ?? track.startsAt)); const [category, setCategory] = useState(track.category ?? ""); const [notes, setNotes] = useState(track.notes ?? ""); const [error, setError] = useState<string>();
  const save = async () => { if (!start || !end) return; if (new Date(end).getTime() <= new Date(start).getTime()) { setError("The end needs to be after the start."); return; } if (track.category && !category.trim() || track.notes && !notes.trim()) { setError("HEY can change a category or note, but cannot clear one yet."); return; } try { onSaved((await window.heyAgent.calendar.updateTimeTrack({ id: track.id, start, end, ...(category ? { category } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) })).message); } catch (reason) { setError(messageOf(reason, "HEY could not update this time track.")); appSound.play("error", "interface"); } };
  return <div className="calendar-recording-modal" role="dialog" aria-modal="true" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}><form onSubmit={(event) => { event.preventDefault(); void save(); }}><header><h2>Edit tracked time</h2><button type="button" className="icon-button" aria-label="Close" data-tooltip="Close editor" data-shortcut="Esc" onClick={onClose}><X size={16} /></button></header><div className="recording-form-pair"><label>Started<input autoFocus type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} /></label><label>Ended<input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} /></label></div><label>Category<input list="time-categories" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Optional category" /><datalist id="time-categories">{categories.map((item) => <option key={item.id} value={item.title} />)}</datalist></label><label>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What did you work on?" /></label>{error && <p className="composer-error">{error}</p>}<footer><button type="button" className="secondary-button" data-tooltip="Cancel editing" data-shortcut="Esc" onClick={onClose}>Cancel</button><button type="submit" className="primary-button"><Save size={14} />Save</button></footer></form></div>;
}

function CategoryManager({ categories, onClose, onChanged, onNotice }: { categories: CalendarTimeCategory[]; onClose: () => void; onChanged: () => Promise<void>; onNotice?: (message: string) => void }) {
  const [title, setTitle] = useState(""); const [renaming, setRenaming] = useState<CalendarTimeCategory>(); const [remove, setRemove] = useState<CalendarTimeCategory>(); const [error, setError] = useState<string>();
  const create = async () => { if (!title.trim()) return; try { const result = await window.heyAgent.calendar.createTimeCategory(title.trim()); setTitle(""); appSound.play("success", "interface"); onNotice?.(result.message); await onChanged(); } catch (reason) { setError(messageOf(reason, "HEY could not create that category.")); appSound.play("error", "interface"); } };
  return <div className="calendar-recording-modal" role="dialog" aria-modal="true" onKeyDown={(event) => { if (event.key === "Escape" && !remove) { event.preventDefault(); event.stopPropagation(); onClose(); } }}><form onSubmit={(event) => { event.preventDefault(); void create(); }}><header><h2>Time categories</h2><button type="button" className="icon-button" aria-label="Close" data-tooltip="Close editor" data-shortcut="Esc" onClick={onClose}><X size={16} /></button></header><div className="category-list">{categories.map((category) => <div key={category.id}>{renaming?.id === category.id ? <input autoFocus value={renaming.title} onChange={(event) => setRenaming({ ...renaming, title: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter" && renaming.title.trim()) { event.preventDefault(); void window.heyAgent.calendar.renameTimeCategory(category.id, renaming.title.trim()).then(async (result) => { appSound.play("success", "interface"); onNotice?.(result.message); setRenaming(undefined); await onChanged(); }).catch((reason: unknown) => { setError(messageOf(reason, "HEY could not rename that category.")); appSound.play("error", "interface"); }); } }} /> : <strong>{category.title}</strong>}<button type="button" className="icon-button" aria-label={`Rename ${category.title}`} onClick={() => setRenaming(category)}><Edit3 size={13} /></button><button type="button" className="icon-button" aria-label={`Delete ${category.title}`} onClick={() => setRemove(category)}><Trash2 size={13} /></button></div>)}</div><label>New category<div className="recording-inline-input"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Category name" /><button type="submit" className="secondary-button" disabled={!title.trim()}>Add</button></div></label>{error && <p className="composer-error">{error}</p>}</form>{remove && <Confirm title={`Delete “${remove.title}”?`} copy="This removes the category. Existing tracked time remains in HEY." confirm="Delete category" onCancel={() => setRemove(undefined)} onConfirm={async () => { const result = await window.heyAgent.calendar.deleteTimeCategory(remove.id); appSound.play("delete", "interface"); setRemove(undefined); onNotice?.(result.message); await onChanged(); }} />}</div>;
}

function Confirm({ title, copy, confirm, onCancel, onConfirm }: { title: string; copy: string; confirm: string; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  return <div className="calendar-recording-confirm" role="alertdialog" aria-modal="true" onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.preventDefault(); event.stopPropagation(); onCancel(); } }}><div><h2>{title}</h2><p>{copy}</p>{error && <p className="composer-error">{error}</p>}<footer><button autoFocus type="button" className="secondary-button" disabled={busy} data-tooltip="Cancel deletion" data-shortcut="Esc" onClick={onCancel}>Cancel</button><button type="button" className="calendar-delete-primary" disabled={busy} onClick={() => { setBusy(true); void onConfirm().catch((reason: unknown) => { setError(messageOf(reason, "HEY could not complete that action.")); setBusy(false); }); }}><Trash2 size={14} />{busy ? "Working…" : confirm}</button></footer></div></div>;
}

function EmptyRecording({ icon, title, copy }: { icon: React.ReactNode; title: string; copy?: string }) { return <div className="calendar-recording-empty">{icon}<h3>{title}</h3>{copy && <p>{copy}</p>}</div>; }
