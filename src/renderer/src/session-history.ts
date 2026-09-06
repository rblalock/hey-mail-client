import type { AgentChatLink } from "../../shared/contracts";

export function recentSessions(chats: AgentChatLink[]): AgentChatLink[] {
  return chats.filter((chat) => !chat.archivedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 20);
}

export function matchingSessions(chats: AgentChatLink[], query: string, filter: string): AgentChatLink[] {
  const search = query.trim().toLocaleLowerCase();
  return chats.filter((chat) => (filter === "all" || Boolean(chat.archivedAt) === (filter === "archived"))
    && chat.title.toLocaleLowerCase().includes(search))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
