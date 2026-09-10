import { chmod, copyFile, lstat, mkdtemp, rm } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MailAttachment, MailThread } from "../shared/contracts";
import { findExecutable, runFile } from "./profile-process";

export function attachmentFilename(filename: string): string {
  const name = filename.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").trim();
  return !name || /^\.+$/.test(name) ? "attachment" : name;
}

export function validMailAttachmentId(id: string): boolean {
  if (/^[1-9]\d*:[1-9]\d*$/.test(id)) return true;
  const match = id.match(/^[1-9]\d*:e-([A-Za-z0-9_-]{43})(?:\.([1-9]\d*))?$/);
  return Boolean(match && (!match[2] || Number(match[2]) > 1)
    && Buffer.from(match[1]!, "base64url").toString("base64url") === match[1]);
}

export function parseMailAttachments(stdout: string): MailAttachment[] {
  const payload = JSON.parse(stdout);
  if (payload?.ok !== true || !Array.isArray(payload.data)) throw new Error("HEY did not return an attachment list.");
  const attachments = new Map<string, MailAttachment>();
  for (const item of payload.data) {
    const id = typeof item?.id === "string" ? item.id : "";
    const messageId = String(item?.message_id ?? "");
    if (!validMailAttachmentId(id) || id.split(":")[0] !== messageId || typeof item.filename !== "string" || !item.filename.trim()) {
      throw new Error("HEY returned incomplete attachment details.");
    }
    attachments.set(id, {
      id, messageId, filename: attachmentFilename(item.filename),
      contentType: typeof item.content_type === "string" ? item.content_type.toLowerCase() : "application/octet-stream",
      ...(Number.isSafeInteger(item.byte_size) && item.byte_size >= 0 ? { byteSize: item.byte_size } : {}),
    });
  }
  return [...attachments.values()];
}

export async function listMailAttachments(topicId: string, env = process.env): Promise<MailAttachment[]> {
  if (!/^\d+$/.test(topicId)) throw new Error("Invalid HEY topic ID.");
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable.");
  const { stdout } = await runFile(executable, ["attachment", "list", topicId, "--json"], { env, timeoutMs: 20_000 });
  return parseMailAttachments(stdout);
}

export function withMailAttachments(thread: MailThread, attachments: MailAttachment[]): MailThread {
  const entryIds = new Set(thread.entries.map((entry) => entry.id));
  return {
    ...thread,
    entries: thread.entries.map((entry) => ({ ...entry, attachments: attachments.filter((file) => file.messageId === entry.id) })),
    ...(attachments.some((file) => !entryIds.has(file.messageId))
      ? { attachmentsError: "New attachment details arrived while this conversation was loading. Reload to see them." } : {}),
  };
}

export async function resolveMailAttachment(topicId: unknown, attachmentId: unknown): Promise<MailAttachment> {
  if (typeof topicId !== "string" || typeof attachmentId !== "string" || !validMailAttachmentId(attachmentId)) {
    throw new Error("Invalid HEY attachment.");
  }
  // This account-scoped read verifies membership and authorizes the subsequent save.
  const files = await listMailAttachments(topicId);
  const file = files.find((item) => item.id === attachmentId);
  if (!file) throw new Error("This attachment is no longer available in this conversation. Reload and try again.");
  return file;
}

const downloadDirectories = new Set<string>();

export function cleanupMailAttachmentDownloads(): void {
  for (const directory of downloadDirectories) {
    try { rmSync(directory, { recursive: true, force: true }); downloadDirectories.delete(directory); } catch { /* Best effort at shutdown. */ }
  }
}

export async function downloadMailAttachment(file: MailAttachment): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const executable = await findExecutable("hey", process.env);
  if (!executable) throw new Error("HEY CLI is unavailable.");
  const directory = await mkdtemp(join(tmpdir(), "hey-agent-attachment-"));
  downloadDirectories.add(directory);
  const path = join(directory, attachmentFilename(file.filename));
  const cleanup = async () => {
    await rm(directory, { recursive: true, force: true });
    downloadDirectories.delete(directory);
  };
  try {
    const { stdout } = await runFile(executable, ["attachment", "save", file.id, "--output", path, "--json"], { timeoutMs: 60_000 });
    if (JSON.parse(stdout)?.ok !== true) throw new Error("HEY could not download this attachment.");
    const info = await lstat(path);
    if (!info.isFile() || (file.byteSize !== undefined && info.size !== file.byteSize)) throw new Error("The attachment download was incomplete. Try again.");
    await chmod(path, 0o600);
    return { path, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function saveMailAttachment(file: MailAttachment, destination: string): Promise<void> {
  const download = await downloadMailAttachment(file);
  try { await copyFile(download.path, destination); }
  finally { await download.cleanup(); }
}
