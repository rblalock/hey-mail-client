import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentAttachment, AgentSnapshot, AgentThreadAttachment } from "../../../shared/contracts";
import AgentMailContextAction from "./AgentMailContextAction";

const candidates: AgentThreadAttachment[] = ["1", "2", "3"].map((id) => ({ kind: "hey-thread", id, title: id }));
function render(attached: AgentAttachment[] = [], selected = candidates) {
  const snapshot: AgentSnapshot = { tabId: "test", title: "Chat", workingDirectory: "/synthetic", status: "idle", timeline: [], attachments: attached };
  return load(renderToStaticMarkup(<AgentMailContextAction candidates={selected} snapshot={snapshot} onWorkspace={() => {}} onFocusComposer={() => {}} onError={() => {}} />));
}

describe("chat context action", () => {
  it("offers the bulk action with no existing context, and the single action for one email", () => {
    expect(render()("button").text()).toBe("Add 3 conversations to chat");
    expect(render([], candidates.slice(0, 1))("button").text()).toBe("Add email to chat");
  });
  it("shows only remaining context and makes completion non-actionable", () => {
    expect(render(candidates.slice(0, 1))("button").text()).toBe("Add 2 remaining conversations to chat");
    const button = render(candidates)("button");
    expect(button.text()).toBe("Selection added");
    expect(button.is(":disabled")).toBe(true);
  });
  it("explains the limit visibly rather than leaving a dead button", () => {
    const full: AgentAttachment[] = Array.from({ length: 25 }, (_, i) => ({ kind: "hey-thread", id: `existing-${i}`, title: "Existing" }));
    const $ = render(full);
    expect($("button").is(":disabled")).toBe(true);
    expect($("[role=status]").text()).toContain("25 attachments");
  });
  it("renders no action without eligible context", () => {
    expect(render([], [])("button")).toHaveLength(0);
  });
});
