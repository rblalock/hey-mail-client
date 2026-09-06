import type {
  CalendarHabit,
  CalendarHabitCompletionRequest,
  CalendarHabitWriteRequest,
  CalendarJournalEntry,
  CalendarJournalWriteRequest,
  CalendarReadResult,
  CalendarTimeCategory,
  CalendarTimeStopRequest,
  CalendarTimeTrack,
  CalendarTimeTrackUpdateRequest,
  CalendarTodo,
  CalendarTodoCompletionRequest,
  CalendarTodoCreateRequest,
  CalendarWindowRequest,
} from "../shared/contracts";
import { CALENDAR_HABIT_COLORS, CALENDAR_HABIT_ICONS } from "../shared/contracts";
import { findExecutable, runFile } from "./process";
import { spawn } from "node:child_process";

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord => value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
const text = (value: unknown, fallback = ""): string => typeof value === "string" ? value : typeof value === "number" ? String(value) : fallback;
const numberList = (value: unknown): number[] => Array.isArray(value) ? value.filter((item): item is number => Number.isInteger(item) && Number(item) >= 0 && Number(item) <= 6) : [];
const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const validId = (value: unknown): value is string => typeof value === "string" && /^\d+$/.test(value);
const validTimestamp = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(value);

function parseEnvelope(stdout: string): unknown {
  const payload: unknown = JSON.parse(stdout);
  const envelope = record(payload);
  return Object.hasOwn(envelope, "data") ? envelope.data : payload;
}

function rows(stdout: string): unknown[] {
  const data = parseEnvelope(stdout);
  if (Array.isArray(data)) return data;
  const source = record(data);
  for (const key of ["todos", "habits", "entries", "time_tracks", "categories"]) if (Array.isArray(source[key])) return source[key] as unknown[];
  return [];
}

function dateOf(source: JsonRecord): string {
  const explicit = text(source.date);
  if (validDate(explicit)) return explicit;
  const timestamp = text(source.starts_at, text(source.created_at));
  return /^\d{4}-\d{2}-\d{2}/.test(timestamp) ? timestamp.slice(0, 10) : "";
}

export function parseTodos(stdout: string): CalendarTodo[] {
  return rows(stdout).flatMap((value) => {
    const source = record(value);
    const id = text(source.id);
    const title = text(source.title);
    const startsOn = dateOf(source);
    return id && title && startsOn ? [{ id, title, startsOn, ...(text(source.completed_at) ? { completedAt: text(source.completed_at) } : {}) }] : [];
  });
}

export function parseHabits(stdout: string): CalendarHabit[] {
  return rows(stdout).flatMap((value) => {
    const source = record(value);
    const id = text(source.id);
    const name = text(source.title, text(source.name));
    const rawIcon = text(source.icon, "weights");
    const rawColor = text(source.color, "blue");
    if (!id || !name) return [];
    const icon = CALENDAR_HABIT_ICONS.includes(rawIcon as CalendarHabit["icon"]) ? rawIcon as CalendarHabit["icon"] : "weights";
    const color = CALENDAR_HABIT_COLORS.includes(rawColor as CalendarHabit["color"]) ? rawColor as CalendarHabit["color"] : "blue";
    return [{ id, name, icon, color, days: numberList(source.days), completedDates: [] }];
  });
}

export function parseHabitCompletions(value: unknown): Record<string, string[]> {
  const completed = new Map<string, Set<string>>();
  const visit = (candidate: unknown, group = "") => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, group);
      return;
    }
    const source = record(candidate);
    if (Object.keys(source).length === 0) return;
    if (/habit::completion/i.test(text(source.type, group))) {
      const parentId = text(source.parent_id, text(record(source.parent).id));
      const date = dateOf(source);
      if (parentId && date) {
        const dates = completed.get(parentId) ?? new Set<string>();
        dates.add(date);
        completed.set(parentId, dates);
      }
      return;
    }
    for (const [key, nested] of Object.entries(source)) if (key !== "next_page") visit(nested, key);
  };
  visit(value);
  return Object.fromEntries([...completed].map(([id, dates]) => [id, [...dates].sort()]));
}

export function parseJournalEntries(stdout: string): CalendarJournalEntry[] {
  return rows(stdout).flatMap((value) => {
    const source = record(value);
    const date = dateOf(source);
    if (!date) return [];
    return [{ ...(text(source.id) ? { id: text(source.id) } : {}), date, content: text(source.content, text(source.description)) }];
  });
}

export function parseJournalEntry(stdout: string, date: string): CalendarJournalEntry | null {
  const value = parseEnvelope(stdout);
  if (value === null || value === undefined) return null;
  const source = record(value);
  if (Object.keys(source).length === 0) return null;
  return { ...(text(source.id) ? { id: text(source.id) } : {}), date: dateOf(source) || date, content: text(source.content, text(source.description)) };
}

export function parseTimeTracks(stdout: string): CalendarTimeTrack[] {
  return rows(stdout).flatMap((value) => {
    const source = record(value);
    const id = text(source.id);
    const startsAt = text(source.starts_at);
    if (!id || !startsAt) return [];
    const endsAt = text(source.ends_at);
    const stoppedAt = text(source.stopped_at);
    return [{ id, startsAt, ...(endsAt ? { endsAt } : {}), ...(stoppedAt ? { stoppedAt } : {}), ...(text(source.notes) ? { notes: text(source.notes) } : {}), ...(text(source.category) ? { category: text(source.category) } : {}) }];
  });
}

export function parseCurrentTimeTrack(stdout: string): CalendarTimeTrack | null {
  const value = parseEnvelope(stdout);
  if (value === null || value === undefined) return null;
  const source = record(value);
  const id = text(source.id);
  const startsAt = text(source.starts_at);
  if (!id || !startsAt) return null;
  return { id, startsAt, ...(text(source.ends_at) ? { endsAt: text(source.ends_at) } : {}), ...(text(source.notes) ? { notes: text(source.notes) } : {}), ...(text(source.category) ? { category: text(source.category) } : {}) };
}

export function parseTimeCategories(stdout: string): CalendarTimeCategory[] {
  return rows(stdout).flatMap((value) => {
    const source = record(value);
    const id = text(source.id);
    const title = text(source.title);
    return id && title ? [{ id, title }] : [];
  });
}

export const todoListCommand = (request: CalendarWindowRequest): string[] => ["todo", "list", "--starts-on", request.startsOn, "--ends-on", request.endsOn, "--all", "--json"];
export const todoCreateCommand = (request: CalendarTodoCreateRequest): string[] => ["todo", "add", request.title, ...(request.date ? ["--date", request.date] : []), "--json"];
export const todoCompletionCommand = (request: CalendarTodoCompletionRequest): string[] => ["todo", request.completed ? "complete" : "uncomplete", request.id, "--json"];
export const todoDeleteCommand = (id: string): string[] => ["todo", "delete", id, "--json"];
export const habitListCommand = (date: string): string[] => ["habit", "list", "--date", date, "--all", "--json"];
export const habitWriteCommand = (request: CalendarHabitWriteRequest): string[] => ["habit", request.id ? "edit" : "create", ...(request.id ? [request.id] : []), "--name", request.name, "--icon", request.icon, "--color", request.color, "--days", request.days.join(","), "--json"];
export const habitCompletionCommand = (request: CalendarHabitCompletionRequest): string[] => ["habit", request.completed ? "complete" : "uncomplete", request.id, "--date", request.date, "--json"];
export const habitDeleteCommand = (id: string): string[] => ["habit", "delete", id, "--json"];
export const journalListCommand = (request: CalendarWindowRequest): string[] => ["journal", "list", "--starts-on", request.startsOn, "--ends-on", request.endsOn, "--all", "--json"];
export const journalReadCommand = (date: string): string[] => ["journal", "read", date, "--json"];
export const journalWriteCommand = (request: CalendarJournalWriteRequest): string[] => ["journal", "write", request.date, "--content", request.content, "--json"];
export const timeListCommand = (limit: number | "all" = 100): string[] => ["timetrack", "list", ...(limit === "all" ? ["--all"] : ["--limit", String(limit)]), "--json"];
export const timeCurrentCommand = (): string[] => ["timetrack", "current", "--json"];
export const timeCategoriesCommand = (): string[] => ["timetrack", "categories", "--json"];
export const timeStartCommand = (): string[] => ["timetrack", "start", "--json"];
export const timeStopCommand = (request: CalendarTimeStopRequest): string[] => ["timetrack", "stop", ...(request.category ? ["--category", request.category] : []), "--json"];
export const timeUpdateCommand = (request: CalendarTimeTrackUpdateRequest): string[] => ["timetrack", "edit", request.id, ...(request.start ? ["--start", request.start] : []), ...(request.end ? ["--end", request.end] : []), ...(request.category ? ["--category", request.category] : []), ...(request.notes ? ["--notes", request.notes] : []), "--json"];
export const timeDeleteCommand = (id: string): string[] => ["timetrack", "delete", id, "--json"];
export const timeCategoryCreateCommand = (title: string): string[] => ["timetrack", "category", "create", title, "--json"];
export const timeCategoryRenameCommand = (id: string, title: string): string[] => ["timetrack", "category", "rename", id, title, "--json"];
export const timeCategoryDeleteCommand = (id: string): string[] => ["timetrack", "category", "delete", id, "--json"];
export const timeExportCommand = (path: string): string[] => ["timetrack", "export", "--output", path, "--json"];

async function executable(env: NodeJS.ProcessEnv): Promise<string> {
  const value = await findExecutable("hey", env);
  if (!value) throw new Error("HEY CLI is not installed.");
  return value;
}

function personalCalendarId(stdout: string): string | undefined {
  const data = parseEnvelope(stdout);
  const calendars = Array.isArray(data) ? data : Array.isArray(record(data).calendars) ? record(data).calendars as unknown[] : [];
  const id = text(calendars.map(record).find((calendar) => calendar.personal === true)?.id);
  return id || undefined;
}

function weekWindow(date: string): CalendarWindowRequest {
  const anchor = new Date(`${date}T12:00:00`);
  const start = new Date(anchor);
  start.setDate(anchor.getDate() - anchor.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const key = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return { startsOn: key(start), endsOn: key(end) };
}

async function readCalendarRecordingsViaMcp(
  hey: string,
  calendarId: string,
  window: CalendarWindowRequest,
  env: NodeJS.ProcessEnv,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(hey, ["mcp", "--read-only", "--domains", "calendar"], { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let initialized = false;
    let requestId = 2;
    const pages: unknown[] = [];
    let size = 0;
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGTERM");
      error ? reject(error) : resolve(value);
    };
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const readPage = (page?: string) => {
      send({
        jsonrpc: "2.0",
        id: requestId,
        method: "tools/call",
        params: {
          name: "hey_calendar",
          arguments: {
            action: "get_calendar_recordings",
            params: { calendarId: Number(calendarId), starts_on: window.startsOn, ends_on: window.endsOn, ...(page ? { page } : {}) },
          },
        },
      });
    };
    const timer = setTimeout(() => finish(new Error("HEY Calendar completion read timed out.")), 30_000);

    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (!settled) finish(new Error(stderr.trim() || `HEY Calendar completion read exited with ${code}.`));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 1024 * 1024) stderr = stderr.slice(-1024 * 1024);
    });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) return finish(new Error("HEY Calendar completion read returned too much data."));
      stdout += chunk.toString("utf8");
      for (;;) {
        const newline = stdout.indexOf("\n");
        if (newline < 0) break;
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        if (!line) continue;
        let message: JsonRecord;
        try { message = record(JSON.parse(line)); } catch { continue; }
        if (message.id === 1 && !initialized) {
          if (message.error) return finish(new Error(text(record(message.error).message, "HEY MCP initialization failed.")));
          initialized = true;
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          readPage();
        } else if (message.id === requestId) {
          if (message.error) return finish(new Error(text(record(message.error).message, "HEY Calendar completion read failed.")));
          const result = record(message.result);
          if (result.isError === true) return finish(new Error("HEY Calendar completion read failed."));
          const content = Array.isArray(result.content) ? result.content.map(record) : [];
          const value = content.find((item) => item.type === "text")?.text;
          if (typeof value !== "string") return finish(undefined, pages);
          try {
            const payload: unknown = JSON.parse(value);
            const wrapper = record(payload);
            pages.push(Object.hasOwn(wrapper, "results") ? wrapper.results : payload);
            const nextPage = text(wrapper.next_page);
            if (!nextPage) return finish(undefined, pages);
            requestId += 1;
            readPage(nextPage);
          } catch {
            finish(new Error("HEY Calendar completion read returned invalid JSON."));
          }
        }
      }
    });

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "hey-agent-app", version: "1" } },
    });
  });
}

function authFailure(error: unknown): boolean {
  return /auth|login|credential|token|unauthorized|forbidden/i.test(error instanceof Error ? error.message : String(error));
}

async function read<T>(args: string[], empty: T, parse: (stdout: string) => T, env: NodeJS.ProcessEnv): Promise<CalendarReadResult<T>> {
  try {
    const output = await runFile(await executable(env), args, { env, timeoutMs: 30_000 });
    return { status: "ready", data: parse(output.stdout) };
  } catch (error) {
    return { status: authFailure(error) ? "needs-auth" : "unavailable", data: empty, detail: error instanceof Error ? error.message : "Unable to read HEY Calendar." };
  }
}

async function mutate(args: string[], message: string, env: NodeJS.ProcessEnv): Promise<{ message: string; id?: string }> {
  const output = await runFile(await executable(env), args, { env, timeoutMs: 30_000 });
  let id = "";
  try { id = text(record(parseEnvelope(output.stdout)).id); } catch { /* Some mutation responses contain only a summary. */ }
  return { message, ...(id ? { id } : {}) };
}

export const listCalendarTodos = (request: CalendarWindowRequest, env: NodeJS.ProcessEnv = process.env) => read(todoListCommand(request), [], parseTodos, env);
export const createCalendarTodo = (request: CalendarTodoCreateRequest, env: NodeJS.ProcessEnv = process.env) => mutate(todoCreateCommand(request), `“${request.title}” was added to Sometime This Week.`, env);
export const completeCalendarTodo = (request: CalendarTodoCompletionRequest, env: NodeJS.ProcessEnv = process.env) => mutate(todoCompletionCommand(request), request.completed ? "Todo completed." : "Todo returned to Sometime This Week.", env);
export const deleteCalendarTodo = (id: string, env: NodeJS.ProcessEnv = process.env) => mutate(todoDeleteCommand(id), "Todo deleted.", env);
export async function listCalendarHabits(date: string, env: NodeJS.ProcessEnv = process.env): Promise<CalendarReadResult<CalendarHabit[]>> {
  try {
    const hey = await executable(env);
    const [habitsOutput, calendarsOutput] = await Promise.all([
      runFile(hey, habitListCommand(date), { env, timeoutMs: 30_000 }),
      runFile(hey, ["calendar", "list", "--json"], { env, timeoutMs: 30_000 }),
    ]);
    const habits = parseHabits(habitsOutput.stdout);
    const calendarId = personalCalendarId(calendarsOutput.stdout);
    if (!calendarId || habits.length === 0) return { status: "ready", data: habits };
    const completed = parseHabitCompletions(await readCalendarRecordingsViaMcp(hey, calendarId, weekWindow(date), env));
    return { status: "ready", data: habits.map((habit) => ({ ...habit, completedDates: completed[habit.id] ?? [] })) };
  } catch (error) {
    return { status: authFailure(error) ? "needs-auth" : "unavailable", data: [], detail: error instanceof Error ? error.message : "Unable to read HEY Calendar habits." };
  }
}
export const writeCalendarHabit = (request: CalendarHabitWriteRequest, env: NodeJS.ProcessEnv = process.env) => mutate(habitWriteCommand(request), request.id ? "Habit updated." : `“${request.name}” was added to your habits.`, env);
export const completeCalendarHabit = (request: CalendarHabitCompletionRequest, env: NodeJS.ProcessEnv = process.env) => mutate(habitCompletionCommand(request), request.completed ? "Habit completed for this day." : "Habit completion removed for this day.", env);
export const deleteCalendarHabit = (id: string, env: NodeJS.ProcessEnv = process.env) => mutate(habitDeleteCommand(id), "Habit and its history deleted.", env);
export const listCalendarJournal = (request: CalendarWindowRequest, env: NodeJS.ProcessEnv = process.env) => read(journalListCommand(request), [], parseJournalEntries, env);
export const readCalendarJournal = (date: string, env: NodeJS.ProcessEnv = process.env) => read(journalReadCommand(date), null, (stdout) => parseJournalEntry(stdout, date), env);
export const writeCalendarJournal = (request: CalendarJournalWriteRequest, env: NodeJS.ProcessEnv = process.env) => mutate(journalWriteCommand(request), request.content ? "Journal entry saved." : "Journal entry removed.", env);
export const listCalendarTimeTracks = (limit: number | "all" = 100, env: NodeJS.ProcessEnv = process.env) => read(timeListCommand(limit), [], parseTimeTracks, env);
export const currentCalendarTimeTrack = (env: NodeJS.ProcessEnv = process.env) => read(timeCurrentCommand(), null, parseCurrentTimeTrack, env);
export const listCalendarTimeCategories = (env: NodeJS.ProcessEnv = process.env) => read(timeCategoriesCommand(), [], parseTimeCategories, env);
export const startCalendarTimeTrack = (env: NodeJS.ProcessEnv = process.env) => mutate(timeStartCommand(), "Time tracking started.", env);
export const stopCalendarTimeTrack = (request: CalendarTimeStopRequest, env: NodeJS.ProcessEnv = process.env) => mutate(timeStopCommand(request), request.category ? `Time tracking stopped and filed under “${request.category}”.` : "Time tracking stopped.", env);
export const updateCalendarTimeTrack = (request: CalendarTimeTrackUpdateRequest, env: NodeJS.ProcessEnv = process.env) => mutate(timeUpdateCommand(request), "Time track updated.", env);
export const deleteCalendarTimeTrack = (id: string, env: NodeJS.ProcessEnv = process.env) => mutate(timeDeleteCommand(id), "Time track deleted.", env);
export const createCalendarTimeCategory = (title: string, env: NodeJS.ProcessEnv = process.env) => mutate(timeCategoryCreateCommand(title), `“${title}” was added to time tracking.`, env);
export const renameCalendarTimeCategory = (id: string, title: string, env: NodeJS.ProcessEnv = process.env) => mutate(timeCategoryRenameCommand(id, title), `Category renamed to “${title}”.`, env);
export const deleteCalendarTimeCategory = (id: string, env: NodeJS.ProcessEnv = process.env) => mutate(timeCategoryDeleteCommand(id), "Time tracking category deleted.", env);
export async function exportCalendarTimeTracks(path: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await runFile(await executable(env), timeExportCommand(path), { env, timeoutMs: 30_000 });
}

export function isCalendarTodoCreateRequest(value: unknown): value is CalendarTodoCreateRequest {
  const request = record(value);
  return typeof request.title === "string" && request.title.trim().length > 0 && request.title.length <= 300 && (request.date === undefined || validDate(request.date));
}
export function isCalendarTodoCompletionRequest(value: unknown): value is CalendarTodoCompletionRequest {
  const request = record(value); return validId(request.id) && typeof request.completed === "boolean";
}
export function isCalendarHabitWriteRequest(value: unknown): value is CalendarHabitWriteRequest {
  const request = record(value);
  return (request.id === undefined || validId(request.id)) && typeof request.name === "string" && request.name.trim().length > 0 && request.name.length <= 200
    && CALENDAR_HABIT_ICONS.includes(request.icon as CalendarHabit["icon"]) && CALENDAR_HABIT_COLORS.includes(request.color as CalendarHabit["color"])
    && Array.isArray(request.days) && request.days.length > 0 && request.days.length <= 7 && new Set(request.days).size === request.days.length && numberList(request.days).length === request.days.length;
}
export function isCalendarHabitCompletionRequest(value: unknown): value is CalendarHabitCompletionRequest {
  const request = record(value); return validId(request.id) && validDate(request.date) && typeof request.completed === "boolean";
}
export function isCalendarJournalWriteRequest(value: unknown): value is CalendarJournalWriteRequest {
  const request = record(value); return validDate(request.date) && typeof request.content === "string" && request.content.length <= 100_000;
}
export function isCalendarTimeStopRequest(value: unknown): value is CalendarTimeStopRequest {
  const request = record(value); return request.category === undefined || typeof request.category === "string" && request.category.trim().length > 0 && request.category.length <= 200;
}
export function isCalendarTimeTrackUpdateRequest(value: unknown): value is CalendarTimeTrackUpdateRequest {
  const request = record(value);
  const hasChange = ["start", "end", "category", "notes"].some((key) => Object.hasOwn(request, key));
  return validId(request.id) && hasChange && (request.start === undefined || validTimestamp(request.start)) && (request.end === undefined || validTimestamp(request.end))
    && (request.category === undefined || typeof request.category === "string" && request.category.trim().length > 0 && request.category.length <= 200)
    && (request.notes === undefined || typeof request.notes === "string" && request.notes.trim().length > 0 && request.notes.length <= 10_000);
}
