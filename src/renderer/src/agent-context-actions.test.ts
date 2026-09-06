import { describe, expect, it } from "vitest";
import type { ImboxPosting } from "../../shared/contracts";
import { attachmentForPosting, attachmentsForPostings, contextualAgentCommands, contextualAgentPrompt, continueReplyPrompt, unattachedMailContext } from "./agent-context-actions";

const posting = (id: string, topicId = id): ImboxPosting => ({
  id,
  topicId,
  subject: `Subject ${id}`,
  summary: "Summary",
  seen: false,
  createdAt: "2026-09-03T12:00:00.000Z",
  contacts: [],
  sender: { name: `Sender ${id}` },
  visibleEntryCount: 1,
});

describe("agent context actions", () => {
  it("turns mail postings into stable, deduplicated thread attachments", () => {
    expect(attachmentForPosting(posting("1"), "imbox")).toMatchObject({ kind: "hey-thread", id: "1", sourceBox: "imbox" });
    expect(attachmentsForPostings([posting("1"), posting("2", "1")], "imbox")).toHaveLength(1);
    expect(attachmentForPosting({ ...posting("bundle"), topicId: undefined })).toBeUndefined();
  });

  it("offers explicit session choices without inventing an intent", () => {
    expect(contextualAgentCommands(1, true, false).map((command) => command.id)).toEqual(["agent-start-context", "agent-add-context"]);
    expect(contextualAgentCommands(1, true, true).map((command) => command.id)).toEqual(["agent-focus-context", "agent-start-context"]);
    expect(contextualAgentCommands(3, true, false).map((command) => command.id)).toEqual([
      "agent-start-context", "agent-add-context", "agent-summarize-selection", "agent-replies-selection",
    ]);
  });

  it("filters context that the active session already has", () => {
    const attachments = attachmentsForPostings([posting("1"), posting("2")]);
    expect(unattachedMailContext(attachments, [{ kind: "hey-thread", id: "1" }]).map((item) => item.id)).toEqual(["2"]);
  });

  it("keeps direct actions read-only and reply handoffs unsent", () => {
    expect(contextualAgentPrompt("agent-replies-selection", 2)).toContain("Do not send or modify anything");
    expect(continueReplyPrompt("Thanks — Tuesday works.")).toContain("Current draft:\nThanks — Tuesday works.");
    expect(continueReplyPrompt("")).toContain("Do not send it");
  });
});
