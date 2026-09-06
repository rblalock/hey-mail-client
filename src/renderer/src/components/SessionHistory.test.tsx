import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentChatLink, AgentWorkspace } from "../../../shared/contracts";
import SessionHistory from "./SessionHistory";
import Sidebar from "./Sidebar";

const noop = () => {};
const chats: AgentChatLink[] = Array.from({ length: 25 }, (_, i) => ({ id: String(i), title: `Session ${i}`, topicIds: [], attachments: [], workingDirectory: "/synthetic", updatedAt: new Date(Date.UTC(2026, 7, i + 1)).toISOString() }));
const workspace: AgentWorkspace = { chats, archivedChats: [{ ...chats[0]!, id: "old", title: "Archived research", archivedAt: "2026-08-28T12:00:00Z" }], tabs: [], activeTabId: "24", activeSession: { tabId: "24", title: "Session 24", status: "ready", timeline: [], attachments: [], workingDirectory: "/synthetic" } };

describe("session history surfaces", () => {
  it("caps the sidebar and replaces the archived accordion with one history entry", () => {
    const $ = load(renderToStaticMarkup(<Sidebar chats={chats} active="sessions" imboxCount={0} collapsed={false} shortcuts={[]} onNavigate={noop} onCompose={noop} onNewChat={noop} onOpenChat={noop} onArchiveChat={noop} onToggleCollapsed={noop} />));
    expect($(".recent-chat-row")).toHaveLength(20);
    expect($(".recent-chat").first().text()).toBe("Session 24");
    expect($(".session-history-link").text()).toBe("View past sessions");
    expect($(".session-history-link").attr("data-active")).toBe("true");
    expect($(".archived-sessions, .chat-search")).toHaveLength(0);
  });
  it("renders all saved sessions as table rows with open and restore actions", () => {
    const $ = load(renderToStaticMarkup(<SessionHistory workspace={workspace} onWorkspace={noop} onOpen={noop} />));
    expect($("tbody tr")).toHaveLength(26);
    expect($("th")).toHaveLength(4);
    expect($("button[aria-label='Restore Archived research']")).toHaveLength(1);
    expect($("button[data-tooltip='Restore and open session']").text()).toBe("Archived research");
  });
});
