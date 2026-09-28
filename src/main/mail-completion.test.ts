import { describe, expect, it, vi } from "vitest";
import type { MailCompletionState, MailMutationRequest } from "../shared/contracts";
import { completeMail, completionState } from "./mail-completion";

const original: MailCompletionState[] = [
  { id: "11", sourceBox: "imbox", seen: false, bubbledUp: false },
  { id: "12", sourceBox: "laterbox", seen: false, bubbledUp: false },
  { id: "13", sourceBox: "asidebox", seen: true, bubbledUp: false },
  { id: "14", sourceBox: "imbox", seen: true, bubbledUp: true },
];
const request = (completion = original): MailMutationRequest => ({ operation: "done", postingIds: completion.map((state) => state.id), completion });

describe("Done workflow", () => {
  it.each(["feedbox", "trailbox", "bubblebox"] as const)("marks %s done in place and restores only its read state on Undo", async (sourceBox) => {
    const run = vi.fn(async (_args: string[]) => {});
    const done = await completeMail(request([{ id: "21", sourceBox, seen: false, bubbledUp: false }]), run);
    expect(run.mock.calls.map(([args]) => args)).toEqual([["seen", "21", "--json"]]);
    run.mockClear();
    await completeMail(done.undo!, run);
    expect(run.mock.calls.map(([args]) => args)).toEqual([["unseen", "21", "--json"]]);
  });
  it("marks original posting IDs read, removes due bubbles, and brings kept conversations to Imbox", async () => {
    const run = vi.fn(async (_args: string[]) => {});
    const result = await completeMail(request(), run);
    expect(run.mock.calls.map(([args]) => args)).toEqual([
      ["seen", "11", "--json"],
      ["move", "12", "--to", "imbox", "--json"], ["seen", "12", "--json"],
      ["move", "13", "--to", "imbox", "--json"], ["seen", "13", "--json"],
      ["bubble", "pop", "14", "--json"], ["seen", "14", "--json"],
    ]);
    expect(result.undo).toEqual({ ...request(), operation: "undo-done" });
    expect(result.undo?.completion).not.toBe(original);
  });

  it("Undo restores each source and read state, and restores a due bubble with --now", async () => {
    const run = vi.fn(async (_args: string[]) => {});
    expect(await completeMail({ ...request(), operation: "undo-done" }, run)).toEqual({ message: "Done undone." });
    expect(run.mock.calls.map(([args]) => args)).toEqual([
      ["unseen", "11", "--json"],
      ["move", "12", "--to", "laterbox", "--json"], ["unseen", "12", "--json"],
      ["move", "13", "--to", "asidebox", "--json"], ["seen", "13", "--json"],
      ["bubble", "up", "14", "--now", "--json"], ["seen", "14", "--json"],
    ]);
  });

  it("compensates an uncertain write and earlier completed conversations instead of reporting partial success", async () => {
    const run = vi.fn(async (_args: string[]) => {});
    run.mockResolvedValueOnce().mockRejectedValueOnce(new Error("Connection lost"));
    await expect(completeMail(request(), run)).rejects.toThrow("Done was not completed. Restoring the previous state was attempted.");
    expect(run.mock.calls.map(([args]) => args)).toEqual([
      ["seen", "11", "--json"], ["move", "12", "--to", "imbox", "--json"],
      ["move", "12", "--to", "laterbox", "--json"], ["unseen", "11", "--json"],
      ["unseen", "11", "--json"], ["unseen", "12", "--json"],
    ]);
    expect(run.mock.calls.flat(2)).not.toContain("13");
  });

  it("reapplies original read state after compensating a popped bubble", async () => {
    const run = vi.fn(async (_args: string[]) => {});
    run.mockResolvedValueOnce().mockRejectedValueOnce(new Error("read update failed"));
    await expect(completeMail(request([{ ...original[3]!, seen: false }]), run)).rejects.toThrow("Done was not completed");
    expect(run.mock.calls.map(([args]) => args).slice(-2)).toEqual([
      ["bubble", "up", "14", "--now", "--json"], ["unseen", "14", "--json"],
    ]);
  });

  it("keeps compensating other steps after a restore failure and reports that changes may remain", async () => {
    const run = vi.fn(async (_args: string[]) => {});
    run.mockResolvedValueOnce().mockRejectedValueOnce(new Error("failed"))
      .mockRejectedValueOnce(new Error("restore failed"));
    await expect(completeMail(request(), run)).rejects.toThrow("Some changes may remain; restoring the previous state also failed.");
    expect(run).toHaveBeenCalledWith(["unseen", "11", "--json"]);
    expect(run).toHaveBeenCalledWith(["unseen", "12", "--json"]);
  });

  it("a failed Undo restores the completed state, including clearing a re-added bubble", async () => {
    const run = vi.fn(async (_args: string[]) => {});
    run.mockResolvedValueOnce().mockRejectedValueOnce(new Error("failed"));
    await expect(completeMail({ ...request([original[3]!]), operation: "undo-done" }, run)).rejects.toThrow("Undo was not completed");
    expect(run.mock.calls.map(([args]) => args)).toEqual([
      ["bubble", "up", "14", "--now", "--json"], ["seen", "14", "--json"],
      ["seen", "14", "--json"], ["bubble", "pop", "14", "--json"], ["seen", "14", "--json"],
    ]);
  });
});

describe("Done snapshot validation", () => {
  it.each([
    { postingIds: [] }, { postingIds: ["0"] }, { postingIds: ["9223372036854775808"] },
    { postingIds: ["--all"] }, { postingIds: ["11", "11"] }, { postingIds: ["11"] },
    { completion: undefined }, { completion: [] }, { completion: [original[0], original[0], original[2], original[3]] },
    { completion: original.map((state) => ({ ...state, sourceBox: "bubblebox" })) },
    { completion: original.map((state) => ({ ...state, sourceBox: "feedbox" })) },
    { completion: original.map((state) => ({ ...state, seen: "true" })) },
    { completion: original.map((state) => ({ ...state, bubbledUp: undefined })) },
    { completion: original.map((state) => ({ ...state, bubbledUp: true })) },
    { sourceBox: "imbox" }, { destination: "imbox" }, { bubbleSchedule: "tomorrow" },
    { completion: original.map((state) => ({ ...state, boxGroupId: "77" })) },
    ...["0", "-1", "--all", "9223372036854775808", 77, null].map((boxGroupId) => ({ completion: original.map((state) => ({ ...state, sourceBox: "asidebox", bubbledUp: false, boxGroupId })) })),
  ])("rejects invalid snapshots before executing any write: %j", async (invalid) => {
    const run = vi.fn(async (_args: string[]) => {});
    await expect(completeMail({ ...request(), ...invalid } as MailMutationRequest, run)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it("accepts reordered metadata while preserving exact posting identities", () => {
    expect(completionState({ ...request(), completion: [...original].reverse() })).toEqual([...original].reverse());
  });
});

describe("Set Aside group restoration", () => {
  const grouped = (id = "13"): MailCompletionState => ({ id, sourceBox: "asidebox", seen: false, bubbledUp: false, boxGroupId: "77" });
  const undo = (states = [grouped()]): MailMutationRequest => ({ ...request(states), operation: "undo-done" });
  const runWithGroups = (groups: unknown[] = [{ id: 77 }]) => vi.fn(async (args: string[]): Promise<unknown> => args[2] === "list" ? groups : undefined);

  it("keeps the original group in the Done undo snapshot and restores membership in a surviving group", async () => {
    const run = runWithGroups();
    const done = await completeMail(request([grouped()]), run);
    expect(done.undo?.completion?.[0]?.boxGroupId).toBe("77");
    run.mockClear();
    expect(await completeMail(done.undo!, run)).toEqual({ message: "Done undone." });
    expect(run).toHaveBeenCalledWith(["move", "13", "--to", "asidebox", "--json"]);
    expect(run).toHaveBeenCalledWith(["set-aside", "group", "add", "13", "--to", "77", "--json"]);
    expect(run.mock.calls.at(-1)?.[0]).toEqual(["unseen", "13", "--json"]);
  });

  it("recreates a deleted group from multiple returning members and explicitly reports the replacement", async () => {
    const run = runWithGroups([]);
    const result = await completeMail(undo([grouped("13"), grouped("15")]), run);
    expect(run).toHaveBeenCalledWith(["set-aside", "group", "create", "13", "15", "--json"]);
    expect(run.mock.calls.some(([args]) => args[2] === "add")).toBe(false);
    expect(result.message).toContain("2 returning conversations were regrouped in a new group");
    expect(result.message).not.toContain("Done undone");
  });

  it("returns a lone member to Set Aside and reports that its deleted group could not be restored", async () => {
    const run = runWithGroups([]);
    const result = await completeMail(undo(), run);
    expect(run).toHaveBeenCalledWith(["move", "13", "--to", "asidebox", "--json"]);
    expect(result.message).toContain("returning conversation is ungrouped in Set Aside");
    expect(result.message).not.toContain("Done undone");
    expect(run.mock.calls.some(([args]) => ["create", "add"].includes(args[2]!))).toBe(false);
  });

  it("handles a group disappearing after the scoped list but before add", async () => {
    const run = runWithGroups();
    run.mockImplementation(async (args) => {
      if (args[2] === "list") return [{ id: 77 }];
      if (args[2] === "add") throw Object.assign(new Error("Group gone"), { stdout: '{"ok":false,"code":"not_found"}' });
      return undefined;
    });
    expect((await completeMail(undo([grouped("13"), grouped("15")]), run)).message).toContain("regrouped in a new group");
    expect(run).toHaveBeenCalledWith(["set-aside", "group", "create", "13", "15", "--json"]);
  });

  it("does not create replacement groups after an auth or uncertain group-add failure", async () => {
    const run = runWithGroups();
    run.mockImplementation(async (args) => {
      if (args[2] === "list") return [{ id: 77 }];
      if (args[2] === "add") throw Object.assign(new Error("Unauthorized"), { stdout: '{"ok":false,"code":"auth"}' });
      return undefined;
    });
    await expect(completeMail(undo([grouped("13"), grouped("15")]), run)).rejects.toThrow("Undo was not completed");
    expect(run.mock.calls.some(([args]) => args[2] === "create")).toBe(false);
    expect(run).toHaveBeenCalledWith(["move", "13", "--to", "imbox", "--json"]);
    expect(run).toHaveBeenCalledWith(["move", "15", "--to", "imbox", "--json"]);
  });

  it("restores surviving group membership during compensation and then reapplies original read state", async () => {
    const run = runWithGroups();
    run.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("seen failed"));
    await expect(completeMail(request([grouped()]), run)).rejects.toThrow("Done was not completed");
    expect(run).toHaveBeenCalledWith(["set-aside", "group", "add", "13", "--to", "77", "--json"]);
    expect(run.mock.calls.at(-1)?.[0]).toEqual(["unseen", "13", "--json"]);
  });

  it("reports a deleted singleton group's limitation even when Done failed and was compensated", async () => {
    const run = runWithGroups([]);
    run.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("seen failed"));
    await expect(completeMail(request([grouped()]), run)).rejects.toThrow("returning conversation is ungrouped in Set Aside");
  });

  it("does not claim a restored group after a later Undo failure rolls its members back to Imbox", async () => {
    let groupCreated = false;
    let failed = false;
    const run = runWithGroups([]);
    run.mockImplementation(async (args) => {
      if (args[2] === "list") return [];
      if (args[2] === "create") groupCreated = true;
      if (groupCreated && !failed && args[0] === "unseen") {
        failed = true;
        throw new Error("Final read-state write failed");
      }
      return undefined;
    });
    const outcome = completeMail(undo([grouped("13"), grouped("15")]), run);
    await expect(outcome).rejects.toThrow("Undo was not completed");
    await expect(outcome).rejects.not.toThrow("regrouped in a new group");
    expect(run).toHaveBeenCalledWith(["move", "13", "--to", "imbox", "--json"]);
    expect(run).toHaveBeenCalledWith(["move", "15", "--to", "imbox", "--json"]);
  });
});
