import { describe, expect, it } from "vitest";
import { bulkMutationRequest, countAwareBulkCommand, isBulkMutationCommand, prioritizeBulkCommands } from "./bulk-actions";
import { SHORTCUTS } from "./shortcuts";

describe("bulk mailbox actions", () => {
  it("maps HEY bulk keys to one aggregate mutation", () => {
    expect(bulkMutationRequest("trash", ["101", "202"], "feedbox")).toEqual({ operation: "trash", postingIds: ["101", "202"], sourceBox: "feedbox" });
    expect(bulkMutationRequest("later", ["101", "202"], "imbox")).toEqual({ operation: "move", postingIds: ["101", "202"], destination: "laterbox", sourceBox: "imbox" });
    expect(bulkMutationRequest("bulk-trail", ["101", "202"], "feedbox")).toEqual({ operation: "move", postingIds: ["101", "202"], destination: "trailbox", sourceBox: "feedbox" });
  });

  it("does not offer a move to the mailbox already open", () => {
    expect(bulkMutationRequest("bulk-feed", ["101"], "feedbox")).toBeUndefined();
  });

  it("makes Ctrl+K labels count-aware and puts actionable bulk commands first", () => {
    const trash = SHORTCUTS.find((command) => command.id === "trash")!;
    expect(countAwareBulkCommand(trash, 4).label).toBe("Move 4 conversations to Trash");
    const commands = prioritizeBulkCommands(SHORTCUTS, 4);
    expect(commands[0]).toMatchObject({ id: "read-together", label: "Read 4 conversations together" });
    expect(commands[1]).toMatchObject({ id: "reply-together", label: "Reply Together with 4 conversations" });
    expect(commands[2]).toMatchObject({ id: "bulk-label", label: "Add 4 conversations to a label" });
    expect(commands[3]).toMatchObject({ id: "bulk-collection", label: "Add 4 conversations to a Collection" });
    expect(isBulkMutationCommand(commands[4]!.id)).toBe(true);
  });
});
