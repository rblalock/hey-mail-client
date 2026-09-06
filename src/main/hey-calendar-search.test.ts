import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { calendarSearchCommands, isCalendarSearchRequest, searchCalendar } from "./hey-calendar-search";

describe("HEY Calendar search", () => {
  it("uses exhaustive read-only list commands and validates a bounded query", () => {
    expect(calendarSearchCommands).toEqual({
      events: ["event", "list", "--all", "--json"],
      todos: ["todo", "list", "--all", "--json"],
      journal: ["journal", "list", "--all", "--json"],
      time: ["timetrack", "list", "--all", "--json"],
    });
    expect(isCalendarSearchRequest({ query: "launch" })).toBe(true);
    expect(isCalendarSearchRequest({ query: "   " })).toBe(false);
    expect(isCalendarSearchRequest({ query: "x".repeat(301) })).toBe(false);
  });

  it("returns one typed result surface across Calendar recordings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hey-agent-calendar-search-"));
    const executable = join(directory, "hey");
    await writeFile(executable, `#!/usr/bin/env node
const [group] = process.argv.slice(2);
const data = group === "calendar"
  ? [{ id: 10, name: "Work", owned: true, external: false, personal: false }]
  : group === "event"
    ? { events: [{ id: 1, title: "Launch review", starts_at: "2026-09-03T14:00:00Z", ends_at: "2026-09-03T15:00:00Z", calendar: { id: 10, name: "Work" } }] }
    : group === "todo"
      ? [{ id: 2, title: "Review launch notes", starts_at: "2026-09-04T00:00:00Z" }]
      : group === "journal"
        ? [{ id: 3, starts_at: "2026-09-02T00:00:00Z", content: "Launch felt calm today." }]
        : [{ id: 4, starts_at: "2026-09-01T13:00:00Z", ends_at: "2026-09-01T14:00:00Z", category: "Launch", notes: "Review" }];
process.stdout.write(JSON.stringify({ data }));
`);
    await chmod(executable, 0o755);
    try {
      const result = await searchCalendar({ query: "launch" }, { ...process.env, HEY_AGENT_HEY_PATH: executable });
      expect(result.status).toBe("ready");
      expect(result.unavailableSources).toEqual([]);
      expect(result.items.map((item) => item.kind).sort()).toEqual(["event", "journal", "time", "todo"]);
      expect(result.items.find((item) => item.kind === "event")).toMatchObject({ id: "1", title: "Launch review", date: "2026-09-03" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
