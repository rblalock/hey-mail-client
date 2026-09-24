import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import type { MailWatchChange } from "../shared/contracts";
import { findExecutable } from "./process";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

export function parseWatchLine(line: string): MailWatchChange | undefined {
  let raw: unknown;
  try { raw = JSON.parse(line); } catch { return undefined; }
  const value = record(raw);
  const change = text(value.change);
  if (!change || !["ready", "disconnected", "added", "updated", "deleted", "resync"].includes(change)) return undefined;
  const box = record(value.box);
  return {
    change: change as MailWatchChange["change"],
    ...(text(value.at) ? { at: text(value.at) } : {}),
    ...(text(box.id) && text(box.kind) && text(box.name) ? { box: { id: text(box.id)!, key: text(box.kind)!, name: text(box.name)! } } : {}),
    ...(text(value.posting_id) ? { postingId: text(value.posting_id) } : {}),
    ...(text(value.thread_id) ? { topicId: text(value.thread_id) } : {}),
    ...(typeof value.new === "boolean" ? { isNew: value.new } : {}),
  };
}

export class HeyWatcher {
  private child?: ChildProcessByStdio<null, Readable, Readable>;
  private buffer = "";
  private retry?: NodeJS.Timeout;
  private stopping = false;

  constructor(
    private readonly onChange: (change: MailWatchChange) => void,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly retryMs = 2_000,
  ) {}

  async start(): Promise<void> {
    this.stopping = false;
    if (this.child) return;
    const executable = await findExecutable("hey", this.env);
    if (!executable || this.stopping) return;
    this.buffer = "";
    const scope = this.env.HEY_AGENT_ACCOUNT_ID ? ["--account", this.env.HEY_AGENT_ACCOUNT_ID, "--base-url", this.env.HEY_AGENT_ACCOUNT_SERVER!] : [];
    const child = spawn(executable, [...scope, "watch", "--events", "added,updated,deleted,resync"], {
      env: this.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.receive(chunk));
    child.stderr.resume();
    child.on("error", () => this.reconnect(child));
    child.on("close", (code) => {
      if (this.child !== child) return;
      if (code === 2 || code === 3) {
        this.child = undefined;
        if (!this.stopping) this.onChange({ change: "disconnected" });
        return; // Invalid arguments or expired authentication require user action.
      }
      this.reconnect(child);
    });
  }

  stop(): void {
    this.stopping = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = undefined;
    this.child?.kill("SIGTERM");
    this.child = undefined;
    this.buffer = "";
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const change = parseWatchLine(line.trim());
      if (change) this.onChange(change);
    }
  }

  private reconnect(child: ChildProcessByStdio<null, Readable, Readable>): void {
    if (this.child !== child) return;
    this.child = undefined;
    if (this.stopping || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = undefined;
      void this.start();
    }, this.retryMs);
    this.retry.unref();
  }
}
