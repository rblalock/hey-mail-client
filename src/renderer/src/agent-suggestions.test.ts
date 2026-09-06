import { describe, expect, it } from "vitest";
import type { AgentAttachment } from "../../shared/contracts";
import { agentStarters } from "./agent-suggestions";

const attachment: AgentAttachment = { kind: "hey-thread", id: "42", title: "Launch timing", subtitle: "Maya Chen" };

describe("agentStarters", () => {
  it("keeps a general session blank", () => {
    expect(agentStarters([])).toEqual([]);
  });

  it("uses mailbox-aware starters without reading or inferring the email body", () => {
    const starters = agentStarters([attachment], "trailbox");

    expect(starters.map((starter) => starter.label)).toEqual([
      "Summarize the important details",
      "Pull out dates and references",
      "What should I keep track of?",
    ]);
    expect(starters.every((starter) => starter.prompt.includes("Launch timing"))).toBe(true);
  });

  it("can use the mailbox persisted with an attachment", () => {
    const persisted = { ...attachment, sourceBox: "feedbox" as const };
    expect(agentStarters([persisted])[0]?.label).toBe("Give me the key points");
  });

  it("uses the known sender in a reply starter", () => {
    expect(agentStarters([attachment], "imbox")[2]).toEqual({
      label: "Draft a reply to Maya Chen",
      prompt: "Draft a concise reply to Maya Chen for the attached HEY conversation “Launch timing”.",
    });
  });

  it("switches to cross-conversation actions for multiple attachments", () => {
    const starters = agentStarters([attachment, { ...attachment, id: "43", title: "Budget" }], "feedbox");

    expect(starters[0]).toEqual({
      label: "Summarize these 2 conversations",
      prompt: "Summarize the 2 attached HEY conversations.",
    });
    expect(starters).toHaveLength(3);
  });

  it("offers context-specific starts for local files and mixed attachments", () => {
    const file: AgentAttachment = { kind: "local-file", id: "local-file:brief", title: "brief.pdf", path: "/tmp/brief.pdf", size: 42, modifiedAt: "2026-09-03T12:00:00.000Z" };
    expect(agentStarters([file])[0]).toEqual({
      label: "Summarize this file",
      prompt: "Read the attached local file “brief.pdf” and summarize it.",
    });
    expect(agentStarters([attachment, file])[0]).toEqual({
      label: "Summarize these 2 items",
      prompt: "Summarize the 2 attached items.",
    });
  });
});
