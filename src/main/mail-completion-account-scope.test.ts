import { beforeEach, describe, expect, it, vi } from "vitest";
import { HeyAccountScope } from "../../resources/hey-account-scope.mjs";
import { listMailbox, mutateMail } from "./hey";
import { profileRequest } from "./profile-process";
import { runFile } from "./process";

vi.mock("./process", () => ({ findExecutable: vi.fn(async () => "/synthetic/hey"), runFile: vi.fn(), runFileWithInput: vi.fn() }));
const result = (data: unknown) => ({ stdout: JSON.stringify({ ok: true, data }), stderr: "" });
const context = (accountId = "101") => ({ scope: new HeyAccountScope(accountId, "https://app.hey.com"), env: { PATH: "/synthetic", HEY_ACCOUNT_ID: accountId } });
const request = { operation: "done" as const, postingIds: ["11"], completion: [{ id: "11", sourceBox: "imbox" as const, seen: false, bubbledUp: true }] };
beforeEach(() => vi.clearAllMocks());

describe("sectioned Imbox account scoping", () => {
  it("pins every prefix page, Done step, and Undo step to the selected account", async () => {
    const profile = context();
    vi.mocked(runFile)
      .mockResolvedValueOnce(result({ postings: [{ id: 11, account_id: 101, bubbled_up: true }], next_page: "cursor" }))
      .mockResolvedValueOnce(result({ postings: [{ id: 12, account_id: 101, seen: true }], next_page: "history" }))
      .mockResolvedValue(result({}));
    await profileRequest.run(profile, async () => {
      expect((await listMailbox("imbox", {}, { paginated: true })).postings).toHaveLength(2);
      const completed = await mutateMail(request);
      await mutateMail(completed.undo!);
    });
    const calls = vi.mocked(runFile).mock.calls;
    expect(calls).toHaveLength(6);
    for (const [, args, options] of calls) {
      expect(args.slice(0, 4)).toEqual(["--account", "101", "--base-url", "https://app.hey.com"]);
      expect(options?.env).toBe(profile.env);
    }
    expect(calls.map(([, args]) => args.slice(4))).toEqual([
      ["box", "view", "imbox", "--json"], ["box", "view", "imbox", "--page", "cursor", "--json"],
      ["bubble", "pop", "11", "--json"], ["seen", "11", "--json"],
      ["bubble", "up", "11", "--now", "--json"], ["unseen", "11", "--json"],
    ]);
  });

  it("rejects another account's postings on a later prefix page", async () => {
    vi.mocked(runFile)
      .mockResolvedValueOnce(result({ postings: [{ id: 11, account_id: 101 }], next_page: "cursor" }))
      .mockResolvedValueOnce(result({ postings: [{ id: 12, account_id: 202, seen: true }] }));
    const listing = await profileRequest.run(context(), () => listMailbox("imbox", {}, { paginated: true }));
    expect(listing).toMatchObject({ status: "unavailable", postings: [], detail: expect.stringContaining("different account") });
  });

  it("cannot reuse another account's Done snapshot to execute a write", async () => {
    vi.mocked(runFile).mockResolvedValue(result({ postings: [] }));
    await expect(profileRequest.run(context("202"), () => mutateMail(request))).rejects.toThrow("not been verified");
    expect(vi.mocked(runFile).mock.calls.every(([, args]) => ["box", "set-aside", "search"].includes(args[4]!))).toBe(true);
    expect(vi.mocked(runFile).mock.calls.every(([, args]) => args[1] === "202")).toBe(true);
  });

  it("verifies a returning Set Aside group in the same account before restoring membership", async () => {
    const profile = context();
    profile.scope.learn(["set-aside", "view", "--all", "--json"], result({ postings: [{ id: 11, account_id: 101, box_group_id: 77 }] }).stdout);
    vi.mocked(runFile).mockImplementation(async (_executable, args) => {
      if (args.slice(4, 7).join(" ") === "set-aside group list") return result([{ id: 77 }]);
      return result({});
    });
    await profileRequest.run(profile, () => mutateMail({ operation: "undo-done", postingIds: ["11"], completion: [{ id: "11", sourceBox: "asidebox", seen: false, bubbledUp: false, boxGroupId: "77" }] }));
    expect(vi.mocked(runFile).mock.calls.map(([, args]) => args)).toContainEqual(["--account", "101", "--base-url", "https://app.hey.com", "set-aside", "group", "add", "11", "--to", "77", "--json"]);
    expect(vi.mocked(runFile).mock.calls.filter(([, args]) => args.includes("list"))).toHaveLength(1);
    expect(vi.mocked(runFile).mock.calls.every(([, args]) => args[1] === "101")).toBe(true);
  });
});
