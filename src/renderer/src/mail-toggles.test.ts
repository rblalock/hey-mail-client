import { describe, expect, it } from "vitest";
import type { ImboxPosting } from "../../shared/contracts";
import { mailToggle } from "./mail-toggles";
import { bulkMutationRequest } from "./bulk-actions";
const posting = (id: string, seen = true, bubbledUp = false): ImboxPosting => ({ id, seen, bubbledUp, subject: "Example", summary: "", createdAt: "", sender: { name: "Maya" }, contacts: [], visibleEntryCount: 1 });
describe("shared mail toggles", () => {
  it.each([['aside', 'asidebox', 'Set Aside'], ['later', 'laterbox', 'Reply Later']] as const)("turns %s on and off", (id, destination, name) => {
    expect(mailToggle(id, ["1"], "feedbox")).toMatchObject({ active: false, request: { destination, sourceBox: "feedbox" } });
    const off = mailToggle(id, ["1"], destination)!;
    expect(off).toMatchObject({ active: true, label: `Remove from ${name}`, request: { operation: "move", destination: "imbox", sourceBox: destination } });
    expect(bulkMutationRequest(id, ["1"], destination)).toEqual(off.request);
    expect(bulkMutationRequest(id, ["1", "2"], destination)?.destination).toBe("imbox");
  });
  it("cancels both scheduled and returned bubbles, but applies to all for mixed selections", () => {
    expect(mailToggle("bubble", ["1"], "bubblebox")?.request.operation).toBe("bubble-pop");
    const rows = [posting("1", true, true), posting("2")];
    expect(bulkMutationRequest("bubble", ["1"], "imbox", rows)?.operation).toBe("bubble-pop");
    expect(bulkMutationRequest("bubble", ["1", "2"], "imbox", rows)?.operation).toBe("bubble");
  });
  it("toggles read/unread and makes mixed selections uniformly unread", () => {
    expect(mailToggle("unread", ["1"], "feedbox", [posting("1", false)])).toMatchObject({ label: "Mark read", request: { operation: "seen" } });
    expect(mailToggle("unread", ["1"], "feedbox", [posting("1", true)])).toMatchObject({ label: "Mark unread", request: { operation: "unseen" } });
    expect(bulkMutationRequest("unread", ["1", "2"], "feedbox", [posting("1", false), posting("2", true)])?.operation).toBe("unseen");
  });
  it("offers explicit stop-ignoring without guessing state", () => {
    expect(bulkMutationRequest("stop-ignoring", ["1"], "imbox")).toEqual({ operation: "stop-ignoring", postingIds: ["1"] });
    expect(mailToggle("stop-ignoring", ["1"], "imbox")).toBeUndefined();
    expect(mailToggle("aside", [], "imbox")).toBeUndefined();
  });
});
