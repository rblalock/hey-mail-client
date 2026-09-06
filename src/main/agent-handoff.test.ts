import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSnapshot, MailAccountProfile } from "../shared/contracts";
import { assertHandoffAction, MAX_HANDOFF_LENGTH } from "../shared/handoff";
import { buildHandoffPrompt, handoffReadCommands } from "./agent-handoff-prompt";
import { AgentHandoffs, handoffArgs, handoffEnvironment, terminalArgs } from "./agent-handoff";

const profile: MailAccountProfile = { key: "test", name: "Alex", email: "alex@example.com", accountId: "101", server: "https://app.hey.com" };
const snapshot = (): AgentSnapshot => ({ tabId: "test", title: "Launch notes", status: "ready", workingDirectory: "/synthetic/workspace", sessionFile: "/synthetic/source.jsonl", sessionId: "pi-id", timeline: [{ kind: "message", id: "m1", role: "user", text: "Help me with the launch plan." }], attachments: [{ kind: "hey-thread", id: "123", title: "Launch", sourceBox: "imbox" }] });
const scratch: string[] = [];
afterEach(async () => { vi.useRealTimers(); for (const path of scratch.splice(0)) await rm(path, { recursive: true, force: true }); });

describe("one-way handoff prompt", () => {
  it("provides scoped reads, transcript identity, limits and honest remote access boundaries", () => {
    const result = buildHandoffPrompt(snapshot(), profile, new Date("2026-09-05T12:00:00Z"));
    expect(result).toContain("hey --account 101 --base-url https://app.hey.com thread read 123 --json");
    expect(result).toContain("hey-agent://mail/threads/123");
    expect(result).toContain("https://app.hey.com/topics/123");
    expect(result).toContain("/synthetic/source.jsonl");
    expect(result).toContain("Pi session ID: pi-id");
    expect(result).toContain("NEW agent session");
    expect(result).toContain("Ask me before sending");
    expect(result).toContain("web or remote agent cannot open them automatically");
    expect(result).not.toContain("account use");
  });
  it("includes returned objects and outcomes but not raw tool traces or system instructions", () => {
    const input = snapshot();
    input.helperInstructions = { title: "Secret helper", instructions: "Do not export system instructions" };
    input.timeline.push({ kind: "run", id: "r", state: "complete", startedAt: "now", tools: [{ id: "t", technicalName: "hey", label: "Read contact", state: "complete", startedAt: "now", detail: ["raw secret trace"], artifact: { version: 1, status: "complete", impact: "read", summary: "Found the organizer", refresh: [], objects: [{ kind: "contact", id: "42", title: "Organizer", deepLink: "hey-agent://mail/contacts/42" }] } }] });
    const result = buildHandoffPrompt(input, profile);
    expect(result).toContain("Found the organizer");
    expect(result).toContain("contact show 42 --json");
    expect(result).not.toContain("raw secret trace");
    expect(result).not.toContain("Do not export system instructions");
  });
  it("bounds recent text and references, retaining the latest request", () => {
    const input = snapshot();
    input.timeline = Array.from({ length: 60 }, (_, index) => ({ kind: "message", role: "user", id: String(index), text: `${index} ${"x".repeat(10000)}` }));
    input.timeline.push({ kind: "message", id: "latest", role: "user", text: "LATEST REQUEST" });
    const result = buildHandoffPrompt(input, profile);
    expect(result.length).toBeLessThan(MAX_HANDOFF_LENGTH);
    expect(result).toContain("truncated");
    expect(result).toContain("LATEST REQUEST");
  });
  it("never fabricates event-show commands or interprets malicious IDs", () => {
    expect(handoffReadCommands("calendar-event", "42", "hey-agent://calendar/events/42?date=2026-09-05")).toEqual([["event", "day", "2026-09-05"]]);
    expect(handoffReadCommands("calendar-event", "42", "hey-agent://calendar/events/42")).toEqual([]);
    expect(handoffReadCommands("mail-thread", "123; touch /tmp/oops", "")).toEqual([]);
    expect(handoffReadCommands("calendar-date", "2026-09-05", "")).toHaveLength(2);
    expect(handoffReadCommands("mail-bundle", "55", "")).toEqual([]);
  });
});

describe("local destinations", () => {
  it("passes literal file paths as arguments, with no resume or permission bypass", () => {
    const file = "/tmp/spaces ' and $(not-a-command)/prompt.md";
    expect(handoffArgs("pi", file)).toEqual([`@${file}`]);
    expect(handoffArgs("hermes", file)).toEqual(["chat", "--query-file", file]);
    for (const id of ["codex", "claude", "cursor", "grok"]) {
      const args = handoffArgs(id, file);
      expect(args).toHaveLength(1);
      expect(args[0]).toContain(JSON.stringify(file));
      expect(args).not.toContain("--session");
    }
    expect(() => handoffArgs("arbitrary-cli", file)).toThrow("not supported");
    expect(terminalArgs({ kind: "xdg", path: "/bin/xdg-terminal-exec" }, "/bin/pi", handoffArgs("pi", file), "/tmp/work space")).toEqual(["--dir=/tmp/work space", "--", "/bin/pi", `@${file}`]);
  });
  it("does not hand app bridge internals or alternate HEY credentials to the child", () => {
    const env = handoffEnvironment({ PATH: "/bin", HEY_AGENT_WRITE_RECEIPTS: "private", HEY_AGENT_ACCOUNT_ID: "202", HEY_TOKEN: "secret", HEY_COOKIE: "secret", HEY_CONFIG: "other", HEY_ACCOUNT_ID: "202" }, profile);
    expect(env).toEqual({ PATH: "/bin", HEY_ACCOUNT_ID: "101", HEY_BASE_URL: "https://app.hey.com", HEY_NONINTERACTIVE: "1" });
  });
});

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "hey-handoff-test-")); scratch.push(cwd);
  let current = { ...snapshot(), workingDirectory: cwd };
  const open = vi.fn(async () => undefined);
  const discover = vi.fn(async () => ({ targets: [{ id: "codex", name: "Codex", path: "/bin/fake-codex" }], terminal: { kind: "xdg" as const, path: "/bin/fake-terminal" } }));
  const service = new AgentHandoffs(profile, async () => structuredClone(current), {}, { open, discover });
  return { cwd, open, discover, service, change: (value: Partial<AgentSnapshot>) => { current = { ...current, ...value }; } };
}

describe("handoff boundary", () => {
  it("preview/copy are file-free, launch saves exact edits privately and cannot launch twice", async () => {
    const f = await fixture();
    const preview = await f.service.prepare("test");
    expect(await readdir(f.cwd)).toEqual([]);
    const write = vi.fn();
    const request = { id: preview.id, prompt: "Reviewed text\n$(literal)", target: "codex" };
    await f.service.copy(request, write);
    expect(write).toHaveBeenCalledWith(request.prompt);
    expect(f.open).not.toHaveBeenCalled();
    const results = await Promise.allSettled([f.service.launch(request), f.service.launch(request)]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(f.open).toHaveBeenCalledTimes(1);
    const file = join(f.cwd, "handoffs", preview.id, "prompt.md");
    expect(await readFile(file, "utf8")).toBe(request.prompt);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(join(f.cwd, "handoffs", preview.id))).mode & 0o777).toBe(0o700);
  });
  it("rejects stale, expired, foreign and running chat handoffs before copying or launching", async () => {
    const f = await fixture(); const preview = await f.service.prepare("test"); const write = vi.fn();
    await expect(f.service.launch({ id: preview.id, prompt: "Hello", target: "shell" })).rejects.toThrow("unavailable");
    const other = await fixture();
    await expect(other.service.copy({ id: preview.id, prompt: "Hello" }, write)).rejects.toThrow("expired");
    f.change({ attachments: [] });
    await expect(f.service.copy({ id: preview.id, prompt: "Hello" }, write)).rejects.toThrow("changed");
    f.change({ status: "running" });
    await expect(f.service.prepare("test")).rejects.toThrow("Wait");
    f.change({ status: "ready" }); const fresh = await f.service.prepare("test");
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 31 * 60_000);
    await expect(f.service.copy({ id: fresh.id, prompt: "Hello" }, write)).rejects.toThrow("expired");
    expect(f.open).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });
  it("retains the copy path after terminal launch fails", async () => {
    const f = await fixture(); f.open.mockRejectedValueOnce(new Error("spawn failed"));
    const preview = await f.service.prepare("test"); const request = { id: preview.id, prompt: "Keep this", target: "codex" };
    await expect(f.service.launch(request)).rejects.toThrow("Copy the prompt");
    expect(await readdir(join(f.cwd, "handoffs"))).toEqual([]);
    const write = vi.fn(); await f.service.copy(request, write); expect(write).toHaveBeenCalledWith("Keep this");
  });
  it("validates edited payloads before side effects", () => {
    for (const value of [null, {}, { id: "../x", prompt: "hello" }, { id: "x", prompt: " " }, { id: "x", prompt: "a\0b" }, { id: "x", prompt: "a".repeat(MAX_HANDOFF_LENGTH + 1) }]) expect(() => assertHandoffAction(value)).toThrow();
  });
});
