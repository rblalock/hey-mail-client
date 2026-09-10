import { describe, expect, it } from "vitest";
import { mailDayHeaders } from "./mail-days";
import { paperTrailVisitBoundary } from "./mailbox-visits";
import { extendMailboxSelection, moveMailboxCursor } from "./mailbox-navigation";
const now = new Date(2026, 8, 10, 15);
const row = (id: string, day: number, hour = 12) => ({ id, createdAt: new Date(2026, 8, day, hour).toISOString(), subject: "Example", summary: "", seen: true, sender: { name: "Maya" }, contacts: [], visibleEntryCount: 1 });
describe("mail day boundaries", () => {
  it("marks local day boundaries without changing order, navigation or selection", () => {
    const rows = [row("1", 10), row("2", 10, 9), row("3", 9), row("4", 8)];
    const original = structuredClone(rows);
    const headers = mailDayHeaders(rows, now);
    expect([...headers.keys()]).toEqual(["1", "3", "4"]);
    expect(headers.get("1")).toBe("Today");
    expect(headers.get("3")).toBe("Yesterday");
    expect(headers.get("4")).toContain("8");
    expect(rows).toEqual(original);
    expect(moveMailboxCursor(rows, "2", 1)).toBe("3");
    expect(extendMailboxSelection(rows.map((r) => r.id), "2", 1, [])?.selected).toEqual(["2", "3"]);
  });
  it("keeps the visit marker independent, including a mid-day cutoff", () => {
    const rows = [row("1", 10, 14), row("2", 10, 8), row("3", 9)];
    expect(paperTrailVisitBoundary(rows, new Date(2026, 8, 10, 10).getTime())).toBe(1);
    expect([...mailDayHeaders(rows, now).keys()]).toEqual(["1", "3"]);
  });
  it("handles missing dates, empty lists, and year changes", () => {
    expect(mailDayHeaders([], now).size).toBe(0);
    expect([...mailDayHeaders([{ id: "1", createdAt: "bad" }, { id: "2", createdAt: "" }], now).values()]).toEqual(["Date unavailable"]);
    expect(mailDayHeaders([{ id: "1", createdAt: new Date(2025, 1, 1).toISOString() }], now).get("1")).toContain("2025");
    expect(mailDayHeaders([{ id: "1", createdAt: new Date(2025, 11, 31, 12).toISOString() }], new Date(2026, 0, 1, 12)).get("1")).toBe("Yesterday");
  });
  it("uses calendar days across daylight-saving boundaries", () => {
    expect(mailDayHeaders([{ id: "1", createdAt: new Date(2026, 2, 8, 0, 15).toISOString() }], new Date(2026, 2, 9, 0, 5)).get("1")).toBe("Yesterday");
  });
  it("does not relocate out-of-order mail", () => {
    expect([...mailDayHeaders([row("1", 10), row("2", 9), row("3", 10)], now).keys()]).toEqual(["1", "2", "3"]);
  });
});
