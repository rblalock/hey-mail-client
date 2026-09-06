import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentAttachment, AgentChatLink } from "../shared/contracts";
import { normalizeAgentAttachment } from "./agent-attachments";
import { isHelperId, MAX_HELPER_INSTRUCTIONS } from "../shared/helpers";

export type StoredAgentWorkspace = {
  version: 2;
  chats: AgentChatLink[];
  openTabIds: string[];
  activeTabId?: string;
};

const EMPTY: StoredAgentWorkspace = { version: 2, chats: [], openTabIds: [] };

function normalizeChat(value: unknown): AgentChatLink | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Partial<AgentChatLink>;
  const sessionId = typeof item.sessionId === "string" ? item.sessionId : undefined;
  const id = typeof item.id === "string" ? item.id : sessionId;
  if (!id || typeof item.title !== "string" || typeof item.workingDirectory !== "string") return undefined;
  const topicIds = Array.isArray(item.topicIds) ? item.topicIds.filter((topic): topic is string => typeof topic === "string") : [];
  const attachments = Array.isArray(item.attachments)
    ? item.attachments.map(normalizeAgentAttachment).filter((attachment): attachment is AgentAttachment => Boolean(attachment))
    : topicIds.map((topicId) => ({ kind: "hey-thread" as const, id: topicId, title: `HEY thread ${topicId}` }));
  return {
    id,
    ...(sessionId ? { sessionId } : {}),
    ...(typeof item.sessionFile === "string" ? { sessionFile: item.sessionFile } : {}),
    title: item.title,
    topicIds: [...new Set([...topicIds, ...attachments.filter((attachment) => attachment.kind === "hey-thread").map((attachment) => attachment.id)])],
    attachments,
    ...(isHelperId(item.helperId) ? { helperId: item.helperId } : {}),
    ...(isHelperId(item.helperId) && item.helperInstructions && typeof item.helperInstructions.title === "string" && item.helperInstructions.title.trim().length > 0 && item.helperInstructions.title.length <= 60 && !/[\r\n\0]/.test(item.helperInstructions.title)
      && typeof item.helperInstructions.instructions === "string" && item.helperInstructions.instructions.length <= MAX_HELPER_INSTRUCTIONS && !item.helperInstructions.instructions.includes("\0")
      ? { helperInstructions: { title: item.helperInstructions.title, instructions: item.helperInstructions.instructions } } : {}),
    workingDirectory: item.workingDirectory,
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date(0).toISOString(),
    ...(typeof item.archivedAt === "string" ? { archivedAt: item.archivedAt } : {}),
  };
}

export class ChatStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  async load(): Promise<StoredAgentWorkspace> {
    await this.queue;
    return this.read();
  }

  async list(): Promise<AgentChatLink[]> {
    return (await this.load()).chats;
  }

  async upsert(link: AgentChatLink): Promise<void> {
    await this.update((state) => ({
      ...state,
      chats: [link, ...state.chats.filter((chat) => chat.id !== link.id)]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 300),
    }));
  }

  async remove(id: string): Promise<void> {
    await this.update((state) => ({
      ...state,
      chats: state.chats.filter((chat) => chat.id !== id),
      openTabIds: state.openTabIds.filter((tabId) => tabId !== id),
      ...(state.activeTabId === id ? { activeTabId: undefined } : {}),
    }));
  }

  async saveWorkspace(openTabIds: string[], activeTabId: string): Promise<void> {
    await this.update((state) => ({ ...state, openTabIds: [...new Set(openTabIds)], activeTabId }));
  }

  private async update(transform: (state: StoredAgentWorkspace) => StoredAgentWorkspace): Promise<void> {
    const operation = this.queue.then(async () => this.write(transform(await this.read())));
    this.queue = operation.catch(() => undefined);
    await operation;
  }

  private async read(): Promise<StoredAgentWorkspace> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as Partial<StoredAgentWorkspace> & { version?: number };
      const chats = Array.isArray(parsed.chats)
        ? parsed.chats.map(normalizeChat).filter((chat): chat is AgentChatLink => Boolean(chat))
        : [];
      const openTabIds = Array.isArray(parsed.openTabIds)
        ? parsed.openTabIds.filter((id): id is string => typeof id === "string")
        : chats.slice(0, 1).map((chat) => chat.id);
      return {
        version: 2,
        chats,
        openTabIds,
        ...(typeof parsed.activeTabId === "string" ? { activeTabId: parsed.activeTabId } : {}),
      };
    } catch {
      return structuredClone(EMPTY);
    }
  }

  private async write(state: StoredAgentWorkspace): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temporary, this.file);
  }
}
