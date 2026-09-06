import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile, unlink, rmdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentSnapshot, MailAccountProfile } from "../shared/contracts";
import { assertHandoffAction, type AgentHandoff, type HandoffAction } from "../shared/handoff";
import { buildHandoffPrompt } from "./agent-handoff-prompt";
import { findExecutable, runFile } from "./process";

// Only interactive, foreground adapters whose prompt forms we recognize.
// Finding a binary is not evidence of authentication or model availability.
const ADAPTERS = [
  { id: "pi", name: "Pi", executable: "pi", help: ["--help"], recognizes: /pi - AI coding assistant/, form: "file" },
  { id: "codex", name: "Codex", executable: "codex", help: ["--help"], recognizes: /Codex CLI/, form: "reference" },
  { id: "claude", name: "Claude Code", executable: "claude", help: ["--help"], recognizes: /Claude Code/, form: "reference" },
  { id: "hermes", name: "Hermes", executable: "hermes", help: ["chat", "--help"], recognizes: /Hermes Agent[\s\S]*--query-file/, form: "query-file" },
  { id: "cursor", name: "Cursor Agent", executable: "agent", help: ["--help"], recognizes: /Start the Cursor Agent/, form: "reference" },
  { id: "grok", name: "Grok CLI", executable: "grok", help: ["--help"], recognizes: /Grok Build TUI/, form: "reference" },
] as const;
type Destination = { id: string; name: string; path: string };
type Terminal = { path: string; kind: "xdg" | "terminal" };
type Discovery = { targets: Destination[]; terminal?: Terminal };

export function handoffArgs(id: string, file: string): string[] {
  const adapter = ADAPTERS.find((item) => item.id === id);
  if (!adapter) throw new Error("That agent is not supported. Copy the prompt instead.");
  if (adapter.form === "file") return [`@${file}`];
  if (adapter.form === "query-file") return ["chat", "--query-file", file];
  // The private prompt never appears in process listings or terminal arguments.
  return [`Read the UTF-8 handoff at ${JSON.stringify(file)} and follow its task. This is a new session; leave the source Pi transcript unchanged. If you cannot read the file, ask me to paste it.`];
}

export function terminalArgs(terminal: Terminal, executable: string, args: string[], cwd: string): string[] {
  return terminal.kind === "xdg" ? [`--dir=${cwd}`, "--", executable, ...args] : ["-e", executable, ...args];
}

export async function discoverHandoffTargets(env: NodeJS.ProcessEnv): Promise<Discovery> {
  const targets = (await Promise.all(ADAPTERS.map(async (adapter): Promise<Destination | undefined> => {
    const path = await findExecutable(adapter.executable, env);
    if (!path) return;
    try {
      const result = await runFile(path, [...adapter.help], { env, timeoutMs: 3500, maxBuffer: 96_000 });
      if (adapter.recognizes.test(`${result.stdout}\n${result.stderr}`)) return { id: adapter.id, name: adapter.name, path };
    } catch { /* Missing/incompatible tools leave the universal copy path intact. */ }
  }))).filter((item): item is Destination => Boolean(item));
  const xdg = await findExecutable("xdg-terminal-exec", env);
  if (xdg) return { targets, terminal: { path: xdg, kind: "xdg" } };
  for (const name of ["alacritty", "ghostty"]) {
    const path = await findExecutable(name, env);
    if (path) return { targets, terminal: { path, kind: "terminal" } };
  }
  return { targets };
}

export function handoffEnvironment(env: NodeJS.ProcessEnv, profile: MailAccountProfile): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("HEY_AGENT_") && !["HEY_TOKEN", "HEY_COOKIE", "HEY_CONFIG", "ELECTRON_RUN_AS_NODE"].includes(key))),
    HEY_ACCOUNT_ID: profile.accountId, HEY_BASE_URL: profile.server, HEY_NONINTERACTIVE: "1",
  };
}

async function openTerminal(terminal: Terminal, executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(terminal.path, terminalArgs(terminal, executable, args, cwd), { cwd, env, detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

type Prepared = { snapshot: AgentSnapshot; fingerprint: string; created: number; discovery: Discovery; launched: boolean };
const fingerprint = (snapshot: AgentSnapshot) => JSON.stringify([snapshot.sessionId, snapshot.sessionFile, snapshot.timeline, snapshot.attachments]);

export class AgentHandoffs {
  private prepared = new Map<string, Prepared>();
  private discovery?: Promise<Discovery>;
  constructor(
    private readonly profile: MailAccountProfile,
    private readonly snapshot: (tabId: string) => Promise<AgentSnapshot>,
    private readonly env: NodeJS.ProcessEnv,
    private readonly dependencies = { discover: discoverHandoffTargets, open: openTerminal },
  ) {}

  async prepare(tabId: string): Promise<AgentHandoff> {
    const snapshot = await this.snapshot(tabId);
    if (["running", "starting"].includes(snapshot.status) || snapshot.pendingUiRequest) throw new Error("Wait for this chat to finish, or stop it, before handing it off.");
    const discovery = await (this.discovery ??= this.dependencies.discover(this.env));
    for (const [id, item] of this.prepared) if (Date.now() - item.created > 30 * 60_000) this.prepared.delete(id);
    if (this.prepared.size >= 20) this.prepared.delete(this.prepared.keys().next().value!);
    const id = randomUUID();
    this.prepared.set(id, { snapshot, fingerprint: fingerprint(snapshot), created: Date.now(), discovery, launched: false });
    return { id, title: snapshot.title, account: this.profile.email, prompt: buildHandoffPrompt(snapshot, this.profile), targets: discovery.targets.map(({ id, name }) => ({ id, name })), terminalAvailable: Boolean(discovery.terminal) };
  }

  private async validate(request: HandoffAction): Promise<Prepared> {
    assertHandoffAction(request);
    const prepared = this.prepared.get(request.id);
    if (!prepared || Date.now() - prepared.created > 30 * 60_000) throw new Error("This handoff has expired. Close it and prepare a new one.");
    const current = await this.snapshot(prepared.snapshot.tabId);
    if (["starting", "running"].includes(current.status) || current.pendingUiRequest || fingerprint(current) !== prepared.fingerprint) {
      throw new Error("This chat changed after the preview was prepared. Copy your edits somewhere safe, then close and reopen the handoff.");
    }
    return prepared;
  }

  async copy(request: HandoffAction, write: (text: string) => void): Promise<void> {
    await this.validate(request);
    write(request.prompt);
  }

  async launch(request: HandoffAction): Promise<void> {
    const prepared = await this.validate(request);
    if (prepared.launched) throw new Error("This handoff has already opened a terminal. Check it before trying again.");
    const destination = prepared.discovery.targets.find((item) => item.id === request.target);
    const terminal = prepared.discovery.terminal;
    if (!destination || !terminal) throw new Error("That local agent or terminal is unavailable. Copy the prompt instead.");
    prepared.launched = true; // Set before I/O so a double click cannot start two agents.
    const directory = join(prepared.snapshot.workingDirectory, "handoffs", request.id);
    const file = join(directory, "prompt.md");
    let created = false;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(file, request.prompt, { encoding: "utf8", mode: 0o600, flag: "wx" });
      created = true;
      await this.dependencies.open(terminal, destination.path, handoffArgs(destination.id, file), prepared.snapshot.workingDirectory, handoffEnvironment(this.env, this.profile));
    } catch {
      if (created) await unlink(file).catch(() => undefined);
      await rmdir(directory).catch(() => undefined);
      prepared.launched = false;
      throw new Error("Could not open the agent in a terminal. Copy the prompt and paste it into your agent instead.");
    }
  }
}
