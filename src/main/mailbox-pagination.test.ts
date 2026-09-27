import { beforeEach, describe, expect, it, vi } from "vitest";
import { listMailbox, mailboxCommand, mailboxListOptions, mutateMail, mutationCommand, parseImboxJson } from "./hey";
import { findExecutable, runFile } from "./profile-process";

vi.mock("./profile-process", () => ({ findExecutable: vi.fn(async () => "/synthetic/hey"), runFile: vi.fn(), runFileWithInput: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

describe("optional Imbox pagination", () => {
  it("preserves complete listings by default and requests one untruncated server page when enabled", () => {
    expect(mailboxCommand("imbox")).toEqual(["box", "view", "imbox", "--all", "--json"]);
    expect(mailboxCommand("imbox", { paginated: true })).toEqual(["box", "view", "imbox", "--json"]);
    expect(mailboxCommand("imbox", { paginated: true, page: "cursor=a&b=2" })).toEqual(["box", "view", "imbox", "--page", "cursor=a&b=2", "--json"]);
    expect(mailboxCommand("laterbox")).toEqual(["box", "view", "laterbox", "--all", "--json"]);
    expect(mailboxCommand("asidebox", { paginated: false })).toEqual(["set-aside", "view", "--all", "--json"]);
    expect(() => mailboxCommand("feedbox", { paginated: true })).toThrow();
  });

  it("allows the CLI's full history URL and does not interpret opaque cursor values", () => {
    const page = "https://app.hey.com/imbox.json?page=opaque%2Bcursor%3D";
    expect(mailboxCommand("imbox", { paginated: true, page })).toContain(page);
  });

  it.each([null, [], "page", { paginated: "true" }, { page: "cursor" }, { paginated: false, page: "cursor" },
    ...[0, "", "  ", "line\nfeed", "null\0byte", "delete\x7f", "x".repeat(4097)].map((page) => ({ paginated: true, page })),
  ])("rejects malformed pagination options: %j", (options) => {
    expect(() => mailboxListOptions(options)).toThrow();
  });

  it("returns the opaque continuation and keeps read/bubble state", async () => {
    vi.mocked(runFile).mockResolvedValue({ stdout: JSON.stringify({ ok: true, data: { name: "Imbox", next_page: "cursor-2", postings: [{ id: 11, topic_id: 99, seen: true, bubbled_up: true }, { id: 12, seen: true }] } }), stderr: "" });
    const env = { PATH: "/synthetic" };
    const result = await listMailbox("imbox", env, { paginated: true });
    expect(runFile).toHaveBeenCalledExactlyOnceWith("/synthetic/hey", ["box", "view", "imbox", "--json"], { env, timeoutMs: 30_000 });
    expect(result.nextPage).toBe("cursor-2");
    expect(result.postings[0]).toMatchObject({ id: "11", topicId: "99", seen: true, bubbledUp: true });
    expect(parseImboxJson(JSON.stringify({ data: { next_page: "", postings: [] } }))).not.toHaveProperty("nextPage");
    expect(parseImboxJson(JSON.stringify({ data: { next_page: null, postings: [] } }))).not.toHaveProperty("nextPage");
  });

  it("rejects invalid cursor input before resolving a CLI", async () => {
    await expect(listMailbox("imbox", {}, { page: "\0", paginated: true })).rejects.toThrow();
    expect(findExecutable).not.toHaveBeenCalled();
    expect(runFile).not.toHaveBeenCalled();
  });

  it("reads all pending mail across native pages and stops on the first history page", async () => {
    const page = (postings: unknown[], next_page?: string) => ({ stdout: JSON.stringify({ ok: true, data: { name: "Imbox", postings, next_page } }), stderr: "" });
    vi.mocked(runFile)
      .mockResolvedValueOnce(page([{ id: 11, seen: true, bubbled_up: true }], "page-2"))
      .mockResolvedValueOnce(page([{ id: 12, seen: false }], "page-3"))
      .mockResolvedValueOnce(page([{ id: 12, seen: false }, { id: 13, seen: false }, { id: 14, seen: true }], "history-4"));
    const result = await listMailbox("imbox", {}, { paginated: true });
    expect(result.status).toBe("ready");
    expect(result.postings.map((posting) => posting.id)).toEqual(["11", "12", "13", "14"]);
    expect(result.nextPage).toBe("history-4");
    expect(vi.mocked(runFile).mock.calls.map((call) => call[1])).toEqual([
      ["box", "view", "imbox", "--json"],
      ["box", "view", "imbox", "--page", "page-2", "--json"],
      ["box", "view", "imbox", "--page", "page-3", "--json"],
    ]);
  });

  it("fails honestly instead of returning incomplete Active mail on a repeated cursor", async () => {
    vi.mocked(runFile).mockResolvedValue({ stdout: JSON.stringify({ ok: true, data: { next_page: "same", postings: [{ id: 11, seen: false }] } }), stderr: "" });
    const result = await listMailbox("imbox", {}, { paginated: true });
    expect(result).toMatchObject({ status: "unavailable", postings: [], detail: expect.stringContaining("all pending Imbox") });
    expect(runFile).toHaveBeenCalledTimes(2);
  });

  it("loads only one explicitly requested history page even if it contains newly unread mail", async () => {
    vi.mocked(runFile).mockResolvedValue({ stdout: JSON.stringify({ ok: true, data: { next_page: "later", postings: [{ id: 11, seen: false }] } }), stderr: "" });
    expect((await listMailbox("imbox", {}, { paginated: true, page: "history" })).nextPage).toBe("later");
    expect(runFile).toHaveBeenCalledTimes(1);
  });

  it("rejects changing cursors that repeatedly return the same pending postings", async () => {
    let page = 0;
    vi.mocked(runFile).mockImplementation(async () => ({ stdout: JSON.stringify({ ok: true, data: { next_page: `page-${++page}`, postings: [{ id: 11, seen: false }] } }), stderr: "" }));
    expect(await listMailbox("imbox", {}, { paginated: true })).toMatchObject({ status: "unavailable", postings: [], detail: expect.stringContaining("stopped making progress") });
    expect(runFile).toHaveBeenCalledTimes(2);
  });

  it("caps an unbounded pending prefix without reporting it as complete", async () => {
    let page = 0;
    vi.mocked(runFile).mockImplementation(async () => ({ stdout: JSON.stringify({ ok: true, data: { next_page: `page-${++page}`, postings: [{ id: page, seen: false }] } }), stderr: "" }));
    expect(await listMailbox("imbox", {}, { paginated: true })).toMatchObject({ status: "unavailable", postings: [] });
    expect(runFile).toHaveBeenCalledTimes(101);
  });

  it("does not report empty Active mail when HEY returns an error envelope", async () => {
    vi.mocked(runFile).mockResolvedValue({ stdout: '{"ok":false,"error":{"message":"Read failed"}}', stderr: "" });
    expect(await listMailbox("imbox", {}, { paginated: true })).toMatchObject({ status: "unavailable", detail: "Read failed" });
  });
});

describe("Done CLI integration", () => {
  const request = { operation: "done" as const, postingIds: ["11"], completion: [{ id: "11", sourceBox: "laterbox" as const, seen: false, bubbledUp: false }] };
  it("runs every completion step through the profile-scoped executor", async () => {
    vi.mocked(runFile).mockResolvedValue({ stdout: '{"ok":true}', stderr: "" });
    const env = { PATH: "/synthetic" };
    const result = await mutateMail(request, env);
    expect(runFile).toHaveBeenNthCalledWith(1, "/synthetic/hey", ["move", "11", "--to", "imbox", "--json"], { env, timeoutMs: 20_000 });
    expect(runFile).toHaveBeenNthCalledWith(2, "/synthetic/hey", ["seen", "11", "--json"], { env, timeoutMs: 20_000 });
    expect(result.undo).toEqual({ ...request, operation: "undo-done" });
    expect(() => mutationCommand(request)).toThrow("completion workflow");
  });

  it("rejects a CLI error envelope even when the process exits successfully", async () => {
    vi.mocked(runFile).mockResolvedValue({ stdout: '{"ok":false,"error":{"message":"Permission denied"}}', stderr: "" });
    await expect(mutateMail(request)).rejects.toThrow("Done was not completed");
  });

  it("leaves a normal mail mutation's command and undo behavior intact", async () => {
    vi.mocked(runFile).mockResolvedValue({ stdout: '{"ok":true,"summary":"Marked read"}', stderr: "" });
    expect(await mutateMail({ operation: "seen", postingIds: ["11"] })).toEqual({ message: "Marked read", undo: { operation: "unseen", postingIds: ["11"] } });
    expect(runFile).toHaveBeenCalledTimes(1);
  });
});
