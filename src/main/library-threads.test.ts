import { describe, expect, it } from "vitest";
import { librarySourceCommand, libraryThreadsCommand, parseLibraryThreadsJson } from "./hey";

describe("paginated Library conversations", () => {
  it.each([
    ["contacts", "contact", "threads"],
    ["labels", "label", "view"],
    ["collections", "collection", "view"],
  ] as const)("uses the %s CLI endpoint without crawling all pages", (kind, command, action) => {
    expect(libraryThreadsCommand(kind, "12")).toEqual([command, action, "12", "--limit", "50", "--json"]);
    expect(libraryThreadsCommand(kind, "12", "cursor=a&b=2")).toEqual([command, action, "12", "--limit", "50", "--page", "cursor=a&b=2", "--json"]);
  });

  it("keeps AI object previews at four conversations", () => {
    expect(librarySourceCommand("labels", "1")).toContain("4");
    expect(librarySourceCommand("collections", "1")).toContain("4");
  });

  it("rejects invalid targets and cursors", () => {
    for (const id of ["", "--all", "12; ls", "../12"]) expect(() => libraryThreadsCommand("labels", id)).toThrow();
    for (const page of ["", " ", "a\nb", "a\0b", "a".repeat(4097)]) expect(() => libraryThreadsCommand("labels", "12", page)).toThrow();
  });

  it.each(["labels", "collections"] as const)("keeps %s posting and topic IDs distinct with a continuation cursor", (kind) => {
    const result = parseLibraryThreadsJson(kind, JSON.stringify({ data: {
      id: 7, name: "Project &amp; plans", total_count: 102, next_page: "next-cursor",
      postings: [{ id: 31, topic_id: 99, name: "Final plan", created_at: "2026-09-01T12:00:00Z", contacts: [{ id: 5, name: "Sam" }] }],
    } }), "7");
    expect(result).toMatchObject({ kind, id: "7", title: "Project & plans", totalCount: 102, nextPage: "next-cursor", postings: [{ id: "31", topicId: "99", subject: "Final plan" }] });
  });

  it("reads contact history without fabricating a total from the first page", () => {
    const result = parseLibraryThreadsJson("contacts", JSON.stringify({ data: { id: 4, name: "Sam", entries_title: "All threads with Sam", next_page: "next", postings: [] } }), "4");
    expect(result).toEqual({ kind: "contacts", id: "4", title: "All threads with Sam", postings: [], nextPage: "next" });
    expect(result.totalCount).toBeUndefined();
  });

  it("represents an empty final page without a load-more cursor", () => {
    expect(parseLibraryThreadsJson("labels", JSON.stringify({ data: { id: 7, name: "Empty", postings: [], next_page: null } }), "7")).toMatchObject({ id: "7", postings: [] });
    expect(parseLibraryThreadsJson("labels", JSON.stringify({ data: { postings: [] } }), "7").nextPage).toBeUndefined();
  });
});
