import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  AgentAttachment,
  AgentChatLink,
  AgentMailContext,
  AgentModelProfile,
  AgentSnapshot,
  AgentTab,
  AgentUiResponse,
  AgentWorkspace,
  NewAgentSessionRequest,
} from "../shared/contracts";
import { helperById, isBuiltinHelperId, type HelperSessionInstructions } from "../shared/helpers";
import { assertAgentAttachment, MAX_AGENT_ATTACHMENTS } from "./agent-attachments";
import { ChatStore } from "./chat-store";
import { PiRpcSession } from "./pi-rpc";

export class AgentSessionManager {
  private initialized?: Promise<void>;
  private sessions = new Map<string, PiRpcSession>();
  private chats = new Map<string, AgentChatLink>();
  private openTabIds: string[] = [];
  private activeTabId = "";
  private retired = false;
  private listeners = new Set<(workspace: AgentWorkspace) => void>();

  constructor(
    private readonly workingDirectory: string,
    private readonly store: ChatStore,
    private readonly resolveContext: (topicId: string) => Promise<AgentMailContext>,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly extensionPath?: string,
    private readonly helperRoot?: string,
  ) {}

  subscribe(listener: (workspace: AgentWorkspace) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getWorkspace(): Promise<AgentWorkspace> {
    await this.ensureInitialized();
    // Restore the active Pi transcript in the background. The renderer gets the
    // saved tab metadata immediately, then receives the hydrated timeline via
    // the normal onChange subscription once Pi is ready.
    void this.activeSession().getSnapshot().catch(() => undefined);
    return this.workspace();
  }

  async newSession(request: NewAgentSessionRequest = {}, modelProfile?: AgentModelProfile, helperInstructions?: HelperSessionInstructions): Promise<AgentWorkspace> {
    await this.ensureInitialized();
    const attachments = request.attachments ?? (request.attachment ? [request.attachment] : []);
    for (const attachment of attachments) assertAgentAttachment(attachment);
    if (attachments.length > MAX_AGENT_ATTACHMENTS) throw new Error(`A session can have up to ${MAX_AGENT_ATTACHMENTS} attachments.`);
    const id = randomUUID();
    const title = request.name?.trim().slice(0, 160) || (attachments.length === 1 ? attachments[0]!.title : attachments.length > 1 ? `${attachments.length} conversations` : "New chat");
    const link: AgentChatLink = {
      id,
      title,
      ...(request.helperId ? { helperId: request.helperId } : {}),
      ...(helperInstructions ? { helperInstructions: structuredClone(helperInstructions) } : {}),
      topicIds: attachments.flatMap((attachment) => attachment.kind === "hey-thread" ? [attachment.id] : []),
      attachments,
      workingDirectory: this.workingDirectory,
      updatedAt: new Date().toISOString(),
    };
    const session = this.createSession(link, modelProfile);
    // Save authored instructions before Pi starts, including failed/offline starts.
    await this.store.upsert(link);
    this.chats.set(id, link);
    this.sessions.set(id, session);
    this.openTabIds.push(id);
    this.activeTabId = id;
    await this.saveWorkspace();
    this.emit();
    void session.getSnapshot().catch(() => undefined);
    return this.workspace();
  }

  async activateSession(tabId: string): Promise<AgentWorkspace> {
    await this.ensureInitialized();
    this.assertOpen(tabId);
    this.activeTabId = tabId;
    await this.saveWorkspace();
    await this.activeSession().getSnapshot().catch(() => undefined);
    this.emit();
    return this.workspace();
  }

  async closeSession(tabId: string): Promise<AgentWorkspace> {
    await this.ensureInitialized();
    this.assertOpen(tabId);
    const index = this.openTabIds.indexOf(tabId);
    this.sessions.get(tabId)?.stop();
    this.sessions.delete(tabId);
    this.openTabIds = this.openTabIds.filter((id) => id !== tabId);
    if (this.openTabIds.length === 0) {
      const id = randomUUID();
      this.sessions.set(id, this.createSession(this.blankLink(id)));
      this.openTabIds = [id];
    }
    if (this.activeTabId === tabId) this.activeTabId = this.openTabIds[Math.max(0, index - 1)] ?? this.openTabIds[0]!;
    await this.saveWorkspace();
    this.emit();
    return this.workspace();
  }

  async openChat(chatId: string): Promise<AgentWorkspace> {
    await this.ensureInitialized();
    const link = this.chats.get(chatId);
    if (!link) throw new Error("That HEY Agent session could not be found.");
    if (link.archivedAt) throw new Error("Restore this archived session before opening it.");
    if (!this.sessions.has(chatId)) this.sessions.set(chatId, this.createSession(link));
    if (!this.openTabIds.includes(chatId)) this.openTabIds.push(chatId);
    this.activeTabId = chatId;
    await this.saveWorkspace();
    await this.activeSession().getSnapshot().catch(() => undefined);
    this.emit();
    return this.workspace();
  }

  async renameSession(sessionId: string, value: string): Promise<AgentWorkspace> {
    await this.ensureInitialized();
    const title = value.trim().replace(/\s+/g, " ").slice(0, 160);
    if (!title) throw new Error("A session name is required.");
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.rename(title);
    } else {
      const link = this.chats.get(sessionId);
      if (!link) throw new Error("That HEY Agent session could not be found.");
      const next = { ...link, title, updatedAt: new Date().toISOString() };
      this.chats.set(sessionId, next);
      await this.store.upsert(next);
    }
    this.emit();
    return this.workspace();
  }

  async deleteSession(sessionId: string): Promise<AgentWorkspace> {
    await this.ensureInitialized();
    this.sessions.get(sessionId)?.stop();
    this.sessions.delete(sessionId);
    this.chats.delete(sessionId);
    this.openTabIds = this.openTabIds.filter((id) => id !== sessionId);
    if (this.openTabIds.length === 0) {
      const id = randomUUID();
      this.sessions.set(id, this.createSession(this.blankLink(id)));
      this.openTabIds = [id];
    }
    if (this.activeTabId === sessionId || !this.openTabIds.includes(this.activeTabId)) this.activeTabId = this.openTabIds[0]!;
    await this.store.remove(sessionId);
    await this.saveWorkspace();
    this.emit();
    return this.workspace();
  }

  async archiveSession(sessionId: string, archived: boolean): Promise<AgentWorkspace> {
    await this.ensureInitialized();
    const current = this.chats.get(sessionId);
    if (!current) throw new Error("That HEY Agent session could not be found.");
    const { archivedAt: _archivedAt, ...rest } = current;
    const next: AgentChatLink = {
      ...rest,
      updatedAt: new Date().toISOString(),
      ...(archived ? { archivedAt: new Date().toISOString() } : {}),
    };
    this.chats.set(sessionId, next);
    if (archived) {
      const index = this.openTabIds.indexOf(sessionId);
      this.sessions.get(sessionId)?.stop();
      this.sessions.delete(sessionId);
      this.openTabIds = this.openTabIds.filter((id) => id !== sessionId);
      if (this.openTabIds.length === 0) {
        const id = randomUUID();
        this.sessions.set(id, this.createSession(this.blankLink(id)));
        this.openTabIds = [id];
      }
      if (this.activeTabId === sessionId || !this.openTabIds.includes(this.activeTabId)) {
        this.activeTabId = this.openTabIds[Math.max(0, index - 1)] ?? this.openTabIds[0]!;
      }
    }
    await this.store.upsert(next);
    await this.saveWorkspace();
    this.emit();
    return this.workspace();
  }

  async attach(tabId: string, attachment: AgentAttachment): Promise<AgentWorkspace> {
    await this.ensureInitialized();
    assertAgentAttachment(attachment);
    const current = this.session(tabId).peekSnapshot().attachments;
    const alreadyAttached = current.some((item) => item.kind === attachment.kind && item.id === attachment.id);
    if (!alreadyAttached && current.length >= MAX_AGENT_ATTACHMENTS) throw new Error(`A session can have up to ${MAX_AGENT_ATTACHMENTS} attachments.`);
    await this.session(tabId).attach(attachment);
    this.emit();
    return this.workspace();
  }

  async attachMany(tabId: string, attachments: AgentAttachment[]): Promise<AgentWorkspace> {
    await this.ensureInitialized();
    for (const attachment of attachments) assertAgentAttachment(attachment);
    const session = this.session(tabId);
    const current = session.peekSnapshot().attachments;
    const keys = new Set(current.map((item) => `${item.kind}:${item.id}`));
    for (const attachment of attachments) keys.add(`${attachment.kind}:${attachment.id}`);
    if (keys.size > MAX_AGENT_ATTACHMENTS) throw new Error(`A session can have up to ${MAX_AGENT_ATTACHMENTS} attachments.`);
    await session.attach(attachments);
    this.emit();
    return this.workspace();
  }

  async detach(tabId: string, attachmentId: string): Promise<AgentWorkspace> {
    await this.ensureInitialized();
    if (!attachmentId || attachmentId.length > 300) throw new Error("Invalid HEY Agent attachment ID.");
    await this.session(tabId).detach(attachmentId);
    this.emit();
    return this.workspace();
  }

  async send(tabId: string, message: string): Promise<void> {
    await this.ensureInitialized();
    const session = this.session(tabId);
    const attachments = session.peekSnapshot().attachments;
    const contexts = Promise.all(attachments.filter((attachment) => attachment.kind === "hey-thread").map((attachment) => this.resolveContext(attachment.id)));
    await session.send(message, contexts);
  }

  async abort(tabId: string): Promise<void> {
    await this.ensureInitialized();
    await this.session(tabId).abort();
  }

  async respondToUi(tabId: string, response: AgentUiResponse): Promise<void> {
    await this.ensureInitialized();
    await this.session(tabId).respondToUi(response);
  }

  async continueInTerminal(tabId: string): Promise<void> {
    await this.ensureInitialized();
    await this.session(tabId).continueInTerminal();
  }

  async handoffSnapshot(tabId: string): Promise<AgentSnapshot> {
    await this.ensureInitialized();
    // Preparing a handoff does not start Pi, fetch mail, or ask a model to summarize.
    return this.session(tabId).peekSnapshot();
  }

  async listChats(): Promise<AgentChatLink[]> {
    await this.ensureInitialized();
    return this.sortedChats();
  }

  stop(): void {
    this.retired = true;
    for (const session of this.sessions.values()) session.stop();
    this.sessions.clear();
  }

  isBusy(): boolean {
    return [...this.sessions.values()].some((session) => {
      const snapshot = session.peekSnapshot();
      return ["starting", "running"].includes(snapshot.status) || Boolean(snapshot.pendingUiRequest);
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.retired) throw new Error("This account session has closed.");
    if (!this.initialized) this.initialized = this.initialize();
    await this.initialized;
    if (this.retired) throw new Error("This account session has closed.");
  }

  private async initialize(): Promise<void> {
    const stored = await this.store.load();
    if (this.retired) throw new Error("This account session has closed.");
    for (const chat of stored.chats) this.chats.set(chat.id, chat);
    this.openTabIds = stored.openTabIds.filter((id) => this.chats.has(id) && !this.chats.get(id)!.archivedAt);
    for (const id of this.openTabIds) this.sessions.set(id, this.createSession(this.chats.get(id)!));
    if (this.openTabIds.length === 0) {
      const id = randomUUID();
      this.openTabIds = [id];
      this.sessions.set(id, this.createSession(this.blankLink(id)));
    }
    this.activeTabId = stored.activeTabId && this.openTabIds.includes(stored.activeTabId)
      ? stored.activeTabId
      : this.openTabIds[0]!;
    await this.saveWorkspace();
  }

  private createSession(link: AgentChatLink, modelProfile?: AgentModelProfile): PiRpcSession {
    const builtin = isBuiltinHelperId(link.helperId) ? helperById(link.helperId) : undefined;
    if (builtin && !this.helperRoot) throw new Error("Helper resources are unavailable.");
    return new PiRpcSession({
      id: link.id,
      title: link.title,
      workingDirectory: this.workingDirectory,
      attachments: link.attachments,
      sessionId: link.sessionId,
      sessionFile: link.sessionFile,
      env: this.env,
      extensionPath: this.extensionPath,
      ...(link.helperId ? { helperId: link.helperId } : {}),
      ...(builtin ? { skillPath: join(this.helperRoot!, builtin.skillDirectory!) } : {}),
      ...(link.helperInstructions ? { helperInstructions: link.helperInstructions } : {}),
      ...(modelProfile ? { modelProfile } : {}),
      onChange: () => this.emit(),
      onPersist: async (next) => {
        this.chats.set(next.id, next);
        await this.store.upsert(next);
        this.emit();
      },
    });
  }

  private blankLink(id: string): AgentChatLink {
    return {
      id,
      title: "New chat",
      topicIds: [],
      attachments: [],
      workingDirectory: this.workingDirectory,
      updatedAt: new Date().toISOString(),
    };
  }

  private activeSession(): PiRpcSession {
    return this.session(this.activeTabId);
  }

  private session(tabId: string): PiRpcSession {
    const session = this.sessions.get(tabId);
    if (!session || !this.openTabIds.includes(tabId)) throw new Error("That HEY Agent tab is not open.");
    return session;
  }

  private assertOpen(tabId: string): void {
    if (!this.openTabIds.includes(tabId)) throw new Error("That HEY Agent tab is not open.");
  }

  private async saveWorkspace(): Promise<void> {
    await this.store.saveWorkspace(this.openTabIds, this.activeTabId);
  }

  private sortedChats(archived = false): AgentChatLink[] {
    return [...this.chats.values()]
      .filter((chat) => Boolean(chat.archivedAt) === archived)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private workspace(): AgentWorkspace {
    return {
      activeTabId: this.activeTabId,
      tabs: this.openTabIds.map((id): AgentTab => {
        const snapshot = this.sessions.get(id)!.peekSnapshot();
        return {
          id,
          title: snapshot.title,
          status: snapshot.status,
          ...(snapshot.sessionId ? { sessionId: snapshot.sessionId } : {}),
          attachments: snapshot.attachments,
          ...(snapshot.helperId ? { helperId: snapshot.helperId } : {}),
        };
      }),
      activeSession: this.activeSession().peekSnapshot(),
      chats: this.sortedChats(),
      archivedChats: this.sortedChats(true),
    };
  }

  private emit(): void {
    if (!this.activeTabId || !this.sessions.has(this.activeTabId)) return;
    const workspace = this.workspace();
    for (const listener of this.listeners) listener(structuredClone(workspace));
  }
}
