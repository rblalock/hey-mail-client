import { beforeEach, describe, expect, it, vi } from "vitest";
import { HeyAccountScope } from "../../resources/hey-account-scope.mjs";
import { listLibrary } from "./hey";
import { findExecutable, profileRequest, runFile } from "./profile-process";
import { createSplitLabel } from "./split-label";

vi.mock("./profile-process", async (importOriginal) => ({ ...await importOriginal<typeof import("./profile-process")>(), findExecutable: vi.fn(), runFile: vi.fn() }));
vi.mock("./hey", async (importOriginal) => ({ ...await importOriginal<typeof import("./hey")>(), listLibrary: vi.fn() }));

const result = (data: unknown = null) => ({ stdout: JSON.stringify({ ok: true, data }), stderr: "" });
const labels = (...items: { id: string; title: string }[]) => ({ kind: "labels" as const, items });
const context = () => ({ scope: new HeyAccountScope("7", "https://app.hey.com"), env: { PATH: "/profile/bin", HEY_AGENT_HEY_PATH: "/profile/bin/hey" } });
const create = (name = "Team", ids = ["101", "102"]) => profileRequest.run(context(), () => createSplitLabel(name, ids));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(findExecutable).mockResolvedValue("/profile/bin/hey");
  vi.mocked(runFile).mockResolvedValue(result());
});

describe("split label creation adapter", () => {
  it("confirms the current CLI's data:null result by unique exact-name read-back", async () => {
    vi.mocked(listLibrary).mockResolvedValueOnce(labels()).mockResolvedValueOnce(labels({ id: "23", title: "Team" }));
    expect(await create(" Team ")).toEqual({ id: "23", name: "Team" });
    expect(runFile).toHaveBeenCalledExactlyOnceWith("/profile/bin/hey", ["label", "create", "Team", "101", "102", "--json"], { env: context().env, timeoutMs: 30_000 });
    expect(listLibrary).toHaveBeenCalledTimes(2);
  });

  it.each([{ id: 23 }, { id: "23" }, { label: { id: 23 } }])("prefers a returned ID over another label with the same name: %j", async (data) => {
    vi.mocked(runFile).mockResolvedValue(result(data));
    vi.mocked(listLibrary).mockResolvedValueOnce(labels()).mockResolvedValueOnce(labels({ id: "24", title: "Team" }, { id: "23", title: "Team" }));
    expect(await create()).toEqual({ id: "23", name: "Team" });
  });

  it("reuses a pre-existing exact-name label instead of creating a duplicate", async () => {
    vi.mocked(listLibrary).mockResolvedValue(labels({ id: "23", title: "Team" }));
    expect(await create()).toEqual({ id: "23", name: "Team" });
    expect(runFile).toHaveBeenCalledExactlyOnceWith("/profile/bin/hey", ["label", "add", "101", "102", "--to", "23", "--json"], { env: context().env, timeoutMs: 30_000 });
  });

  it("refuses ambiguous existing labels before making a write", async () => {
    vi.mocked(listLibrary).mockResolvedValue(labels({ id: "23", title: "Team" }, { id: "24", title: "Team" }));
    await expect(create()).rejects.toThrow("ambiguous");
    expect(runFile).not.toHaveBeenCalled();
  });

  it.each([
    labels(),
    labels({ id: "23", title: "Team" }, { id: "24", title: "Team" }),
    labels({ id: "--help", title: "Team" }),
    labels({ id: "23", title: "Teamwork" }),
  ])("does not infer a newly created ID from missing, ambiguous or invalid read-back: %j", async (after) => {
    vi.mocked(listLibrary).mockResolvedValueOnce(labels()).mockResolvedValueOnce(after);
    await expect(create()).rejects.toThrow("creation could not be confirmed");
    expect(runFile).toHaveBeenCalledTimes(1);
  });

  it("never replaces a returned ID with a different same-name label", async () => {
    vi.mocked(runFile).mockResolvedValue(result({ id: 23 }));
    vi.mocked(listLibrary).mockResolvedValueOnce(labels()).mockResolvedValueOnce(labels({ id: "24", title: "Team" }));
    await expect(create()).rejects.toThrow("creation could not be confirmed");
  });

  it.each([0, -2, "--account=4", "90071992547409930000", Number.MAX_SAFE_INTEGER + 1])("rejects a malformed returned ID without falling back to names: %s", async (id) => {
    vi.mocked(runFile).mockResolvedValue(result({ id }));
    vi.mocked(listLibrary).mockResolvedValueOnce(labels()).mockResolvedValueOnce(labels({ id: "23", title: "Team" }));
    await expect(create()).rejects.toThrow("creation could not be confirmed");
    expect(listLibrary).toHaveBeenCalledTimes(1);
  });

  it("does not repeat an uncertain creation and safely reuses it on a later visible retry", async () => {
    vi.mocked(listLibrary).mockResolvedValueOnce(labels()).mockResolvedValueOnce(labels({ id: "23", title: "Team" }));
    vi.mocked(runFile).mockRejectedValueOnce(new Error("Timeout with private CLI output"));
    await expect(create()).rejects.toThrow("Refresh and choose the existing HEY label");
    expect(runFile).toHaveBeenCalledTimes(1);
    expect(await create()).toEqual({ id: "23", name: "Team" });
    expect(vi.mocked(runFile).mock.calls.map(([, args]) => args[1])).toEqual(["create", "add"]);
  });

  it.each(["", "not json", JSON.stringify({ ok: false, error: "Private failure details" })])("rejects unconfirmed command output: %j", async (stdout) => {
    vi.mocked(listLibrary).mockResolvedValue(labels());
    vi.mocked(runFile).mockResolvedValue({ stdout, stderr: "" });
    await expect(create()).rejects.toThrow("creation could not be confirmed");
    expect(runFile).toHaveBeenCalledTimes(1);
  });

  it.each(["--base-url=https://evil.test", " -n", "\n", "Team\nWork", "\u0000Team", "a".repeat(121)])("rejects invalid or flag-shaped names before reads or writes: %j", async (name) => {
    await expect(create(name)).rejects.toThrow("Split label names");
    expect(listLibrary).not.toHaveBeenCalled();
    expect(runFile).not.toHaveBeenCalled();
  });

  it.each([[], ["0"], ["-1"], ["101", "101"], ["--help"]])("rejects invalid posting IDs: %j", async (...ids) => {
    await expect(create("Team", ids)).rejects.toThrow("posting IDs");
    expect(runFile).not.toHaveBeenCalled();
  });

  it("requires an account context before reading or changing labels", async () => {
    await expect(createSplitLabel("Team", ["101"])).rejects.toThrow("active account");
    expect(listLibrary).not.toHaveBeenCalled();
    expect(runFile).not.toHaveBeenCalled();
  });

  it("keeps lookup, create and confirmation in the captured profile and environment", async () => {
    const original = context();
    const contexts: unknown[] = [];
    vi.mocked(listLibrary).mockImplementation(async (_kind, env) => {
      contexts.push(profileRequest.getStore());
      expect(env).toBe(original.env);
      return contexts.length === 1 ? labels() : labels({ id: "23", title: "Team" });
    });
    vi.mocked(runFile).mockImplementation(async (_executable, _args, options) => {
      expect(profileRequest.getStore()).toBe(original);
      expect(options?.env).toBe(original.env);
      return result();
    });
    const pending = profileRequest.run(original, () => createSplitLabel("Team", ["101"]));
    await profileRequest.run(context(), () => pending);
    expect(contexts).toEqual([original, original]);
    expect(findExecutable).toHaveBeenCalledWith("hey", original.env);
  });
});
