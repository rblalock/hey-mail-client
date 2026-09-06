import { describe, expect, it } from "vitest";
import { beginPaperTrailVisit, paperTrailVisitBoundary, paperTrailVisitKey } from "./mailbox-visits";

const storage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};
const rows = (...times: Array<number | string>) => times.map((time) => ({ createdAt: typeof time === "number" ? new Date(time).toISOString() : time }));

describe("account-scoped Paper Trail visits", () => {
  it("establishes a first-visit baseline without marking old mail new", () => {
    const store = storage();
    const visit = beginPaperTrailVisit(store, "personal", 1000);
    expect(visit).toEqual({ cutoff: 1000, saved: true });
    expect(paperTrailVisitBoundary(rows(900, 800), visit.cutoff)).toBeUndefined();
    expect(store.getItem(paperTrailVisitKey("personal"))).toBe("1000");
  });
  it("retains the previous cutoff for this visit while persisting the next one", () => {
    const store = storage();
    beginPaperTrailVisit(store, "personal", 1000);
    const visit = beginPaperTrailVisit(store, "personal", 2000);
    expect(visit.cutoff).toBe(1000);
    expect(paperTrailVisitBoundary(rows(1500, 1000, 900), visit.cutoff)).toBe(1);
    expect(paperTrailVisitBoundary(rows(2100, 1500, 900), visit.cutoff)).toBe(2);
    expect(beginPaperTrailVisit(store, "personal", 3000).cutoff).toBe(2000);
  });
  it("keeps accounts isolated and persists through a fresh reader", () => {
    const store = storage();
    beginPaperTrailVisit(store, "personal", 1000);
    expect(beginPaperTrailVisit(store, "work", 2000).cutoff).toBe(2000);
    expect(beginPaperTrailVisit({ ...store }, "personal", 3000).cutoff).toBe(1000);
  });
  it.each(["broken", "null", "{}", '"1000"', "-1", "0", "99999"])("replaces invalid or future metadata: %s", (raw) => {
    const store = storage();
    store.setItem(paperTrailVisitKey("personal"), raw);
    expect(beginPaperTrailVisit(store, "personal", 2000)).toEqual({ cutoff: 2000, saved: true });
    expect(store.getItem(paperTrailVisitKey("personal"))).toBe("2000");
  });
  it("reports blocked storage without throwing or losing a readable cutoff", () => {
    expect(beginPaperTrailVisit({ getItem: () => "1000", setItem: () => { throw Error("full"); } }, "personal", 2000)).toEqual({ cutoff: 1000, saved: false });
    expect(beginPaperTrailVisit({ getItem: () => { throw Error("blocked"); }, setItem: () => { throw Error("blocked"); } }, "personal", 2000)).toEqual({ cutoff: 2000, saved: false });
  });
});

describe("Paper Trail divider placement", () => {
  it("shows a line after all new rows, including when every loaded row is new", () => {
    expect(paperTrailVisitBoundary(rows(3000, 2000, 1000), 1500)).toBe(2);
    expect(paperTrailVisitBoundary(rows(3000, 2000), 1500)).toBe(2);
  });
  it("does not invent a boundary for empty, old, invalid or unordered results", () => {
    expect(paperTrailVisitBoundary([], 1500)).toBeUndefined();
    expect(paperTrailVisitBoundary(rows(1000), undefined)).toBeUndefined();
    expect(paperTrailVisitBoundary(rows(1500, 1000), 1500)).toBeUndefined();
    expect(paperTrailVisitBoundary(rows("not a date"), 1500)).toBeUndefined();
    expect(paperTrailVisitBoundary(rows(3000, 1000, 2000), 1500)).toBeUndefined();
  });
});
