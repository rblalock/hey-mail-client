import { describe, expect, it, vi } from "vitest";
import { HeyAccountScope } from "../../resources/hey-account-scope.mjs";
const result = (data: unknown) => ({ stdout: JSON.stringify({ ok: true, data }) });
const create = () => new HeyAccountScope("101", "https://app.hey.com");
const own = (scope: HeyAccountScope) => scope.learn(["box", "view", "imbox", "--json"], result([{ id: 11, topic_id: 21, account_id: 101 }]).stdout);

describe("shared native and Pi account guard", () => {
  it("allows account-scoped senders but rejects cross-account results", async () => {
    const scope = create();
    expect(await scope.prepare(["account", "senders", "--json"], vi.fn())).toEqual(["--account", "101", "--base-url", "https://app.hey.com", "account", "senders", "--json"]);
    expect(() => scope.learn(["account", "senders", "--json"], result([{ id: 1, account_id: 202, email: "other@example.test" }]).stdout)).toThrow("different account");
  });
  it("guards the reverse directions of mail actions", async () => {
    const scope = create(); own(scope);
    for (const args of [["bubble", "pop", "11", "--json"], ["stop-ignoring", "11", "--json"], ["move", "11", "--to", "imbox", "--json"]]) {
      expect(await scope.prepare(args, vi.fn())).toEqual(["--account", "101", "--base-url", "https://app.hey.com", ...args]);
      await expect(new HeyAccountScope("202", "https://app.hey.com").prepare(args, async () => result([]))).rejects.toThrow("not been verified");
    }
  });
  it("scopes list, search, new mail and identity-wide Calendar without changing global selection", async () => {
    const scope = create(); const read = vi.fn();
    for (const args of [["box", "list", "--json"], ["search", "meeting", "--json"], ["compose", "--to", "friend@example.com"], ["event", "week", "2026-09-05"]]) {
      expect(await scope.prepare(args, read)).toEqual(["--account", "101", "--base-url", "https://app.hey.com", ...args]);
    }
    expect(read).not.toHaveBeenCalled();
  });
  it.each([["account", "use", "202"], ["search", "hi", "--account=all"], ["compose", "--base-url", "https://elsewhere.example"]])("rejects account/server overrides %j", async (...args) => {
    await expect(create().prepare(args, vi.fn())).rejects.toThrow(/overrides|Switch accounts/);
  });
  it("learns typed IDs from scoped results and permits native reply/preview/organization", async () => {
    const scope = create(); own(scope); const read = vi.fn();
    for (const args of [["thread", "read", "21", "--json"], ["bulk-reply", "preview", "11", "--json"], ["compose", "--thread-id=21", "-m", "Hello"], ["seen", "11"], ["label", "create", "Project", "11"]]) await scope.prepare(args, read);
    expect(read).not.toHaveBeenCalled();
  });
  it("still verifies thread ownership for reply recipient previews", async () => {
    const args = ["reply", "21", "--dry-run", "--replace-recipients", "--to", "person@example.test", "--json"];
    const scope = create(); own(scope);
    expect(await scope.prepare(args, vi.fn())).toEqual(["--account", "101", "--base-url", "https://app.hey.com", ...args]);
    await expect(new HeyAccountScope("202", "https://app.hey.com").prepare(args, async () => result([]))).rejects.toThrow("not been verified");
  });
  it("never trusts another profile's IDs or mixed-account output", async () => {
    const first = create(); own(first);
    const second = new HeyAccountScope("202", "https://app.hey.com");
    expect(() => second.learn(["box", "view", "imbox"], result([{ id: 11, account_id: 101 }]).stdout)).toThrow("different account");
    const empty = vi.fn(async () => result([]));
    await expect(second.prepare(["compose", "--thread-id=21", "-m", "--help"], empty)).rejects.toThrow("not been verified");
    expect(empty.mock.calls.length).toBeGreaterThan(0);
  });
  it("revalidates restored IDs through authoritative scoped listings, without empty search", async () => {
    const scope = create();
    const read = vi.fn(async (args: string[]) => { expect(args.slice(0, 4)).toEqual(["--account", "101", "--base-url", "https://app.hey.com"]); return result([{ id: 11, topic_id: 21, account_id: 101 }]); });
    await scope.prepare(["thread", "read", "21", "--json"], read);
    expect(read).toHaveBeenCalledOnce();
    expect(read.mock.calls[0]![0]).toContain("imbox");
  });
  it.each([
    ["-v", "42"],
    ["--count", "42"],
  ])("does not let %s hide a posting ID", async (flag, id) => {
    const scope = create();
    const read = vi.fn(async () => result([]));
    await expect(scope.prepare(["seen", flag, id], read)).rejects.toThrow("not been verified");
    expect(read).toHaveBeenCalled();
  });
  it("rejects unknown options before any ownership reads", async () => {
    const read = vi.fn();
    await expect(create().prepare(["seen", "--whatever", "42"], read)).rejects.toThrow("Unsupported HEY option");
    expect(read).not.toHaveBeenCalled();
  });
  it("preserves literal values and checks IDs with interleaved flags and separators", async () => {
    const scope = create(); own(scope);
    const read = vi.fn();
    for (const args of [
      ["compose", "--subject", "--thread-id=99", "--thread-id=21", "-m", "--account=all"],
      ["thread", "--json", "read", "21"],
      ["seen", "--json", "--", "11"],
    ]) expect(await scope.prepare(args, read)).toEqual(["--account", "101", "--base-url", "https://app.hey.com", ...args]);
    expect(read).not.toHaveBeenCalled();
    await expect(scope.prepare(["compose", "--thread-id=21", "--thread-id=99"], async () => result([]))).rejects.toThrow("not been verified");
    await expect(scope.prepare(["seen", "--", "99"], async () => result([]))).rejects.toThrow("not been verified");
  });
  it("consumes only the known value for a flag before checking posting IDs", async () => {
    const scope = create();
    const read = vi.fn(async () => result([{ id: 42, account_id: 101 }]));
    await scope.prepare(["seen", "--limit", "5", "42"], read);
    expect(read).toHaveBeenCalledOnce();
  });
  it("verifies contacts, saved drafts, snippets and attachments without mixing identifier types", async () => {
    const scope = create(); own(scope);
    scope.learn(["thread", "read", "21"], result([{ id: 31 }]).stdout);
    scope.learn(["attachment", "list", "21"], result([{ id: "31:1" }]).stdout);
    await scope.prepare(["attachment", "save", "31:1"], vi.fn());
    const embedded = `31:e-${Buffer.alloc(32, 1).toString("base64url")}`;
    scope.learn(["attachment", "list", "21"], result([{ id: embedded }]).stdout);
    await scope.prepare(["attachment", "save", embedded], vi.fn());
    await scope.prepare(["clip", "create", "31", "--content", "quote"], vi.fn());
    for (const kind of ["contact", "draft", "snippet"]) {
      const read = vi.fn(async () => result([{ id: 51, account_id: 101 }]));
      await scope.prepare([kind, kind === "contact" ? "show" : "delete", "51"], read);
      expect(read).toHaveBeenCalledOnce();
    }
    await expect(scope.prepare(["draft", "send", "31"], async () => result([]))).rejects.toThrow("not been verified");
  });
});
