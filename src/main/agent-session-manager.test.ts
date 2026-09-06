import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatStore } from "./chat-store";

const getSnapshot = vi.hoisted(() => vi.fn());
const sessionOptions = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("./pi-rpc", () => ({
  PiRpcSession: class {
    private readonly snapshot;

    constructor(options: { id: string; title: string; workingDirectory: string; attachments?: unknown[]; sessionId?: string; sessionFile?: string; modelProfile?: unknown; helperId?: string; skillPath?: string; helperInstructions?: { title: string; instructions: string } }) {
      sessionOptions.push(options);
      this.snapshot = {
        tabId: options.id,
        title: options.title,
        status: "idle",
        workingDirectory: options.workingDirectory,
        timeline: [],
        attachments: options.attachments ?? [],
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        ...(options.sessionFile ? { sessionFile: options.sessionFile } : {}),
        ...(options.helperId ? { helperId: options.helperId } : {}),
        ...(options.helperInstructions ? { helperInstructions: structuredClone(options.helperInstructions) } : {}),
      };
    }

    peekSnapshot() { return structuredClone(this.snapshot); }
    getSnapshot() { getSnapshot(); return Promise.resolve(this.peekSnapshot()); }
    stop() {}
  },
}));

import { AgentSessionManager } from "./agent-session-manager";

describe("AgentSessionManager", () => {
  beforeEach(() => { getSnapshot.mockClear(); sessionOptions.length = 0; });

  it("does not start Pi when a profile retires during asynchronous initialization", async () => {
    let resolve!: (value: unknown) => void;
    const load = new Promise((done) => { resolve = done; });
    const store = { load: () => load } as unknown as ChatStore;
    const manager = new AgentSessionManager("/synthetic", store, async () => { throw new Error("unused"); });
    const pending = manager.getWorkspace(); manager.stop();
    resolve({ version: 2, chats: [], openTabIds: [] });
    await expect(pending).rejects.toThrow("closed");
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("persists personal instructions before startup and resumes without the Helper definition", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hey-agent-session-manager-"));
    try {
      const file = join(directory, "workspace.json");
      const store = new ChatStore(file);
      const resolve = async () => { throw new Error("No mail context expected."); };
      const manager = new AgentSessionManager(directory, store, resolve);
      const instructions = { title: "Project notes", instructions: "Recap decisions in two bullets." };
      const created = await manager.newSession({ helperId: "custom-project", name: "Project notes" }, { thinking: "low" }, instructions);
      instructions.instructions = "The definition was edited later.";
      expect(created.activeSession.helperInstructions).toEqual({ title: "Project notes", instructions: "Recap decisions in two bullets." });
      expect(sessionOptions.at(-1)?.skillPath).toBeUndefined();
      expect((await new ChatStore(file).list()).find((chat) => chat.id === created.activeTabId)?.helperInstructions).toEqual(created.activeSession.helperInstructions);

      sessionOptions.length = 0;
      // There is no Settings lookup or helperRoot on the resumed path. It still works after deletion.
      const resumed = await new AgentSessionManager(directory, new ChatStore(file), resolve).getWorkspace();
      expect(resumed.activeTabId).toBe(created.activeTabId);
      expect(resumed.activeSession.helperInstructions).toEqual(created.activeSession.helperInstructions);
      expect(sessionOptions.find((options) => options.id === created.activeTabId)).toMatchObject({ helperId: "custom-project", helperInstructions: created.activeSession.helperInstructions });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("hydrates the persisted active Pi session when the workspace first opens", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hey-agent-session-manager-"));
    try {
      const store = new ChatStore(join(directory, "workspace.json"));
      await store.upsert({
        id: "persisted-session",
        sessionId: "synthetic-pi-session",
        sessionFile: join(directory, "transcript.jsonl"),
        title: "Planning",
        topicIds: [],
        attachments: [],
        workingDirectory: directory,
        updatedAt: "2026-09-02T12:00:00.000Z",
      });
      await store.saveWorkspace(["persisted-session"], "persisted-session");

      const manager = new AgentSessionManager(directory, store, async () => { throw new Error("No mail context expected."); });
      const workspace = await manager.getWorkspace();

      expect(workspace.activeTabId).toBe("persisted-session");
      await vi.waitFor(() => expect(getSnapshot).toHaveBeenCalledOnce());
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("starts one session with several explicitly selected conversations", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hey-agent-session-manager-"));
    try {
      const store = new ChatStore(join(directory, "workspace.json"));
      const manager = new AgentSessionManager(directory, store, async () => { throw new Error("No mail context expected."); });
      const workspace = await manager.newSession({
        attachments: [
          { kind: "hey-thread", id: "101", title: "First", subtitle: "Maya" },
          { kind: "hey-thread", id: "202", title: "Second", subtitle: "Robin" },
        ],
      });

      expect(workspace.activeSession.title).toBe("2 conversations");
      expect(workspace.activeSession.attachments.map((attachment) => attachment.id)).toEqual(["101", "202"]);
      expect(workspace.tabs.find((tab) => tab.id === workspace.activeTabId)?.attachments.map((attachment) => attachment.id)).toEqual(["101", "202"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("applies an explicit model profile only to a newly created session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hey-agent-session-manager-"));
    try {
      const store = new ChatStore(join(directory, "workspace.json"));
      const manager = new AgentSessionManager(directory, store, async () => { throw new Error("No mail context expected."); });
      await manager.getWorkspace();
      sessionOptions.length = 0;
      await manager.newSession({}, { model: { provider: "openai", modelId: "gpt-fast" }, thinking: "low" });

      expect(sessionOptions).toHaveLength(1);
      expect(sessionOptions[0]?.modelProfile).toEqual({ model: { provider: "openai", modelId: "gpt-fast" }, thinking: "low" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("loads the requested Helper skill only for its session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hey-agent-session-manager-"));
    try {
      const store = new ChatStore(join(directory, "workspace.json"));
      const helperRoot = join(directory, "helpers");
      const manager = new AgentSessionManager(directory, store, async () => { throw new Error("No mail context expected."); }, process.env, join(directory, "extension.mjs"), helperRoot);
      await manager.getWorkspace();
      sessionOptions.length = 0;
      const workspace = await manager.newSession({
        name: "Meeting Prep · Planning",
        helperId: "meeting-prep",
        attachment: { kind: "hey-object", objectKind: "calendar-event", id: "42", title: "Planning", deepLink: "hey-agent://calendar/events/42?date=2026-09-03" },
      });

      expect(workspace.activeSession.helperId).toBe("meeting-prep");
      expect(sessionOptions[0]).toMatchObject({
        helperId: "meeting-prep",
        skillPath: join(helperRoot, "meeting-prep"),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
