import { describe, expect, it } from "vitest";
import type { AgentChatLink } from "../../shared/contracts";
import { matchingSessions, recentSessions } from "./session-history";

const chats: AgentChatLink[] = Array.from({ length: 35 }, (_, index) => ({
  id: String(index), title: `Research ${index}`, topicIds: [], attachments: [], workingDirectory: "/synthetic",
  updatedAt: new Date(Date.UTC(2026, 7, index + 1)).toISOString(),
  ...(index >= 30 ? { archivedAt: "2026-09-05T12:00:00Z" } : {}),
}));

describe("session history", () => {
  it("keeps only the newest 20 unarchived sessions in the sidebar without changing stored history", () => {
    expect(recentSessions(chats).map((chat) => chat.id)).toEqual(Array.from({ length: 20 }, (_, index) => String(29 - index)));
    expect(chats).toHaveLength(35);
    expect(chats[0]!.id).toBe("0");
  });
  it("includes every session in history, newest first", () => {
    expect(matchingSessions(chats, "", "all")).toHaveLength(35);
    expect(matchingSessions(chats, "", "all")[0]!.id).toBe("34");
  });
  it("searches outside the recent 20 and filters archived sessions", () => {
    expect(matchingSessions(chats, " RESEARCH 0 ", "all").map((chat) => chat.id)).toEqual(["0"]);
    expect(matchingSessions(chats, "", "archived")).toHaveLength(5);
    expect(matchingSessions(chats, "", "active")).toHaveLength(30);
    expect(matchingSessions(chats, "no match", "all")).toEqual([]);
  });
});
