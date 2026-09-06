import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HelperId } from "../shared/helpers";
import { PiRpcSession } from "./pi-rpc";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("./process", () => ({ findExecutable: async () => "/synthetic/pi" }));

// Exercise the real session/JSONL boundary, without starting Pi or calling a model.
function rpcHarness(history: { role: string; content: string }[] = []) {
  const commands: { id: string; type: string; message?: string }[] = [];
  const messages = [...history];
  const stdout = new PassThrough();
  const respond = (command: { id: string }, data = {}) => stdout.write(`${JSON.stringify({ type: "response", id: command.id, success: true, data })}\n`);
  const child = Object.assign(new EventEmitter(), {
    stdout,
    stderr: new PassThrough(),
    killed: false,
    kill() { this.killed = true; },
    stdin: new Writable({ write(chunk, _encoding, done) {
      const command = JSON.parse(chunk.toString());
      commands.push(command);
      if (command.type === "prompt") {
        messages.push({ role: "user", content: command.message });
        respond(command);
      } else if (command.type === "set_session_name") respond(command);
      // Startup state and transcript responses are deliberately held back.
      done();
    } }),
  });
  mocks.spawn.mockReturnValue(child);
  return {
    commands,
    release(type: string) {
      const command = commands.find((item) => item.type === type);
      expect(command).toBeDefined();
      respond(command!, type === "get_messages" ? { messages } : {});
    },
  };
}

const sessions: PiRpcSession[] = [];
afterEach(() => {
  sessions.splice(0).forEach((session) => session.stop());
  vi.clearAllMocks();
});

describe("Pi startup and first-send ordering", () => {
  it.each<HelperId | undefined>(["reply-coach", "meeting-prep", "daily-brief", "calendar-triage", undefined])(
    "waits for transcript restoration before sending in %s",
    async (helperId) => {
      const rpc = rpcHarness();
      const session = new PiRpcSession({ id: "startup", title: "Test chat", workingDirectory: "/synthetic", helperId });
      sessions.push(session);
      // The manager prewarms the session before the renderer sends its starter.
      const startup = session.getSnapshot();
      await vi.waitFor(() => expect(rpc.commands.some((item) => item.type === "get_state")).toBe(true));
      const send = session.send("Write the reply");
      await Promise.resolve();
      await Promise.resolve();
      expect(session.peekSnapshot().timeline.filter((item) => item.kind === "message")).toHaveLength(1);
      const promptsBeforeState = rpc.commands.filter((item) => item.type === "prompt").length;

      rpc.release("get_state");
      await vi.waitFor(() => expect(rpc.commands.some((item) => item.type === "get_messages")).toBe(true));
      const promptsBeforeHistory = rpc.commands.filter((item) => item.type === "prompt").length;
      rpc.release("get_messages");
      await Promise.all([startup, send]);

      expect(promptsBeforeState).toBe(0);
      expect(promptsBeforeHistory).toBe(0);
      expect(rpc.commands.filter((item) => item.type === "prompt")).toHaveLength(1);
      expect(session.peekSnapshot().timeline).toMatchObject([
        { kind: "message", role: "user", text: "Write the reply" },
        { kind: "run", state: "running" },
      ]);
    },
  );

  it("preserves history even when the new request has identical text", async () => {
    const rpc = rpcHarness([{ role: "user", content: "Write the reply" }, { role: "assistant", content: "Earlier reply" }]);
    const session = new PiRpcSession({ id: "history", title: "Test chat", workingDirectory: "/synthetic" });
    sessions.push(session);
    const send = session.send("Write the reply");
    await expect(session.send("Write the reply")).rejects.toThrow("already working");
    await vi.waitFor(() => expect(rpc.commands.some((item) => item.type === "get_state")).toBe(true));
    rpc.release("get_state");
    await vi.waitFor(() => expect(rpc.commands.some((item) => item.type === "get_messages")).toBe(true));
    rpc.release("get_messages");
    await send;
    expect(session.peekSnapshot().timeline).toMatchObject([
      { kind: "message", role: "user", text: "Write the reply" },
      { kind: "message", role: "assistant", text: "Earlier reply" },
      { kind: "message", role: "user", text: "Write the reply" },
      { kind: "run", state: "running" },
    ]);
    expect(rpc.commands.filter((item) => item.type === "prompt")).toHaveLength(1);
  });
});
