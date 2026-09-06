import { describe, expect, it } from "vitest";
import type { AgentToolActivity } from "../../shared/contracts";
import { agentRunResultObjects } from "./agent-activity";

const tool = (id: string, objects: NonNullable<AgentToolActivity["artifact"]>["objects"]): AgentToolActivity => ({
  id,
  technicalName: "hey",
  label: "HEY search",
  state: "complete",
  startedAt: "2026-09-03T12:00:00Z",
  artifact: { version: 1, status: "complete", impact: "read", summary: `${objects.length} results`, objects, refresh: [] },
});

describe("agentRunResultObjects", () => {
  it("keeps one native result for repeated objects across tool steps", () => {
    const first = { kind: "mail-thread" as const, id: "42", title: "Planning", deepLink: "hey-agent://mail/threads/42" };
    const second = { kind: "mail-thread" as const, id: "84", title: "Contract", deepLink: "hey-agent://mail/threads/84" };
    expect(agentRunResultObjects([tool("one", [first]), tool("two", [first, second])])).toEqual([first, second]);
  });
});
