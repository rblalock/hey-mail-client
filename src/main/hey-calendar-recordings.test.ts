import { describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  habitCompletionCommand, habitListCommand, habitWriteCommand, isCalendarHabitCompletionRequest, isCalendarHabitWriteRequest, isCalendarJournalWriteRequest, isCalendarTimeCategoryTitle, isCalendarTimeStopRequest, isCalendarTimeTrackUpdateRequest, isCalendarTodoCompletionRequest, isCalendarTodoCreateRequest, journalReadCommand, journalWriteCommand, listCalendarHabits, parseCurrentTimeTrack, parseHabitCompletions, parseHabits, parseJournalEntry, parseJournalEntries, parseTimeCategories, parseTimeTracks, parseTodos, timeCategoryRenameCommand, timeListCommand, timeStopCommand, timeUpdateCommand, todoCompletionCommand, todoCreateCommand, todoListCommand,
} from "./hey-calendar-recordings";

describe("HEY Calendar recordings bridge", () => {
  it("builds bounded argv-only todo and habit commands", () => {
    expect(todoListCommand({ startsOn: "2026-09-01", endsOn: "2026-09-07" })).toEqual(["todo", "list", "--starts-on", "2026-09-01", "--ends-on", "2026-09-07", "--all", "--json"]);
    expect(todoCreateCommand({ title: "Return books", date: "2026-09-02" })).toEqual(["todo", "add", "Return books", "--date", "2026-09-02", "--json"]);
    expect(todoCompletionCommand({ id: "12", completed: false })).toEqual(["todo", "uncomplete", "12", "--json"]);
    expect(habitListCommand("2026-09-02")).toEqual(["habit", "list", "--date", "2026-09-02", "--all", "--json"]);
    expect(habitWriteCommand({ id: "13", name: "Read", icon: "read", color: "gold", days: [1, 3, 5] })).toEqual(["habit", "edit", "13", "--name", "Read", "--icon", "read", "--color", "gold", "--days", "1,3,5", "--json"]);
    expect(habitCompletionCommand({ id: "13", date: "2026-09-02", completed: true })).toEqual(["habit", "complete", "13", "--date", "2026-09-02", "--json"]);
  });

  it("builds Journal and time tracking commands without a shell", () => {
    expect(journalReadCommand("2026-09-02")).toEqual(["journal", "read", "2026-09-02", "--json"]);
    expect(journalWriteCommand({ date: "2026-09-02", content: "A good day" })).toEqual(["journal", "write", "2026-09-02", "--content", "A good day", "--json"]);
    expect(timeListCommand("all")).toEqual(["timetrack", "list", "--all", "--json"]);
    expect(timeStopCommand({ category: "Client work" })).toEqual(["timetrack", "stop", "--category", "Client work", "--json"]);
    expect(timeUpdateCommand({ id: "21", start: "2026-09-02T09:00", end: "2026-09-02T10:15", notes: "Review" })).toEqual(["timetrack", "edit", "21", "--start", "2026-09-02T09:00", "--end", "2026-09-02T10:15", "--notes", "Review", "--json"]);
    expect(timeCategoryRenameCommand("7", "Planning")).toEqual(["timetrack", "category", "rename", "7", "Planning", "--json"]);
  });

  it("normalizes every recording shape returned by HEY CLI 1.4", () => {
    expect(parseTodos(JSON.stringify({ data: [{ id: 1, title: "Call Lee", starts_at: "2026-09-02T00:00:00Z", completed_at: "2026-09-02T12:00:00Z" }] }))).toEqual([{ id: "1", title: "Call Lee", startsOn: "2026-09-02", completedAt: "2026-09-02T12:00:00Z" }]);
    expect(parseHabits(JSON.stringify({ data: [{ id: 2, title: "Read", icon: "read", color: "gold", days: [1, 3, 5] }] }))).toEqual([{ id: "2", name: "Read", icon: "read", color: "gold", days: [1, 3, 5], completedDates: [] }]);
    expect(parseHabitCompletions({
      "Calendar::Habit::Completion": [
        { id: 7, parent_id: 2, starts_at: "2026-09-02T00:00:00Z", type: "Calendar::Habit::Completion" },
        { id: 8, parent: { id: 2 }, starts_at: "2026-09-04T00:00:00Z", type: "Calendar::Habit::Completion" },
      ],
      "Calendar::Event": [{ id: 9, starts_at: "2026-09-03T10:00:00Z" }],
    })).toEqual({ "2": ["2026-09-02", "2026-09-04"] });
    expect(parseHabitCompletions([
      { "Calendar::Habit::Completion": [{ parent_id: 2, starts_at: "2026-09-01T00:00:00Z" }] },
      { results: { "Calendar::Habit::Completion": [{ parent_id: 2, starts_at: "2026-09-03T00:00:00Z" }] }, next_page: "ignored-by-parser" },
    ])).toEqual({ "2": ["2026-09-01", "2026-09-03"] });
    expect(parseJournalEntries(JSON.stringify({ data: [{ id: 3, starts_at: "2026-09-02T00:00:00Z", content: "Hello" }] }))).toEqual([{ id: "3", date: "2026-09-02", content: "Hello" }]);
    expect(parseJournalEntry(JSON.stringify({ data: { id: 3, date: "2026-09-02", content: "Hello" } }), "2026-09-02")).toEqual({ id: "3", date: "2026-09-02", content: "Hello" });
    expect(parseJournalEntry(JSON.stringify({ data: null }), "2026-09-02")).toBeNull();
    expect(parseTimeTracks(JSON.stringify({ data: [{ id: 4, starts_at: "2026-09-02T13:00:00Z", ends_at: "2026-09-02T14:00:00Z", category: "Client", notes: "Review" }] }))).toEqual([{ id: "4", startsAt: "2026-09-02T13:00:00Z", endsAt: "2026-09-02T14:00:00Z", category: "Client", notes: "Review" }]);
    expect(parseCurrentTimeTrack(JSON.stringify({ data: { id: 5, starts_at: "2026-09-02T15:00:00Z" } }))).toEqual({ id: "5", startsAt: "2026-09-02T15:00:00Z" });
    expect(parseTimeCategories(JSON.stringify({ data: [{ id: 6, title: "Planning" }] }))).toEqual([{ id: "6", title: "Planning" }]);
  });

  it("joins habit definitions to authoritative Calendar completion recordings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hey-agent-habits-"));
    const executable = join(directory, "hey");
    await writeFile(executable, `#!/usr/bin/env node
const readline = require("node:readline");
const args = process.argv.slice(2);
if (args[0] === "habit") {
  process.stdout.write(JSON.stringify({ data: [{ id: 2, title: "Read", icon: "read", color: "gold", days: [1, 3, 5] }] }));
} else if (args[0] === "calendar") {
  process.stdout.write(JSON.stringify({ data: [{ id: 10, personal: true }] }));
} else if (args[0] === "mcp") {
  const lines = readline.createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (message.method === "initialize") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake", version: "1" } } }) + "\\n");
    if (message.method === "tools/call") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: JSON.stringify({ "Calendar::Habit::Completion": [{ parent_id: 2, starts_at: "2026-09-02T00:00:00Z", type: "Calendar::Habit::Completion" }] }) }] } }) + "\\n");
  });
}
`);
    await chmod(executable, 0o755);
    try {
      await expect(listCalendarHabits("2026-09-02", { ...process.env, HEY_AGENT_HEY_PATH: executable })).resolves.toEqual({
        status: "ready",
        data: [{ id: "2", name: "Read", icon: "read", color: "gold", days: [1, 3, 5], completedDates: ["2026-09-02"] }],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects invalid renderer requests at the IPC boundary", () => {
    expect(isCalendarTodoCreateRequest({ title: "Return books", date: "2026-09-02" })).toBe(true);
    expect(isCalendarTodoCreateRequest({ title: "", date: "tomorrow" })).toBe(false);
    expect(isCalendarTodoCreateRequest({ title: "--json" })).toBe(false);
    expect(isCalendarTodoCreateRequest({ title: " -x" })).toBe(false);
    expect(isCalendarTodoCompletionRequest({ id: "12", completed: true })).toBe(true);
    expect(isCalendarTodoCompletionRequest({ id: "todo-12", completed: true })).toBe(false);
    expect(isCalendarHabitWriteRequest({ name: "Read", icon: "read", color: "gold", days: [1, 3, 5] })).toBe(true);
    expect(isCalendarHabitWriteRequest({ name: "--json", icon: "read", color: "gold", days: [1] })).toBe(false);
    expect(isCalendarHabitWriteRequest({ name: " -x", icon: "read", color: "gold", days: [1] })).toBe(false);
    expect(isCalendarHabitWriteRequest({ name: "Read", icon: "unknown", color: "gold", days: [] })).toBe(false);
    expect(isCalendarHabitCompletionRequest({ id: "13", date: "2026-09-02", completed: true })).toBe(true);
    expect(isCalendarJournalWriteRequest({ date: "2026-09-02", content: "" })).toBe(true);
    expect(isCalendarJournalWriteRequest({ date: "2026-09-02", content: "--json" })).toBe(false);
    expect(isCalendarJournalWriteRequest({ date: "2026-09-02", content: " -x" })).toBe(false);
    expect(isCalendarTimeStopRequest({ category: "Client work" })).toBe(true);
    expect(isCalendarTimeStopRequest({ category: "" })).toBe(false);
    expect(isCalendarTimeStopRequest({ category: "--json" })).toBe(false);
    expect(isCalendarTimeStopRequest({ category: " -x" })).toBe(false);
    expect(isCalendarTimeTrackUpdateRequest({ id: "21", start: "2026-09-02T09:00" })).toBe(true);
    expect(isCalendarTimeTrackUpdateRequest({ id: "21" })).toBe(false);
    expect(isCalendarTimeTrackUpdateRequest({ id: "21", category: "--json" })).toBe(false);
    expect(isCalendarTimeTrackUpdateRequest({ id: "21", notes: " -x" })).toBe(false);
    expect(isCalendarTimeCategoryTitle("Planning")).toBe(true);
    expect(isCalendarTimeCategoryTitle("--json")).toBe(false);
    expect(isCalendarTimeCategoryTitle(" -x")).toBe(false);
  });
});
