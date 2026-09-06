import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { isAgentObjectKind, type AgentAttachment, type AgentLocalFileAttachment, type AgentLocalSelectionAttachment } from "../shared/contracts";

export const MAX_AGENT_ATTACHMENTS = 25;
export const MAX_LOCAL_SELECTION_LENGTH = 80_000;
const MAX_ATTACHMENT_ID_LENGTH = 300;
const MAX_ATTACHMENT_TITLE_LENGTH = 2_000;
const MAX_ATTACHMENT_SUBTITLE_LENGTH = 1_000;
const MAX_LOCAL_PATH_LENGTH = 4_096;

function commonFields(value: Record<string, unknown>): { id: string; title: string; subtitle?: string } | undefined {
  if (typeof value.id !== "string" || !value.id || value.id.length > MAX_ATTACHMENT_ID_LENGTH) return undefined;
  if (typeof value.title !== "string" || !value.title || value.title.length > MAX_ATTACHMENT_TITLE_LENGTH) return undefined;
  if (value.subtitle !== undefined && (typeof value.subtitle !== "string" || value.subtitle.length > MAX_ATTACHMENT_SUBTITLE_LENGTH)) return undefined;
  return { id: value.id, title: value.title, ...(typeof value.subtitle === "string" ? { subtitle: value.subtitle } : {}) };
}

function validIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length <= 100 && !Number.isNaN(Date.parse(value));
}

export function normalizeAgentAttachment(value: unknown): AgentAttachment | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const common = commonFields(item);
  if (!common) return undefined;
  if (item.kind === "hey-thread") {
    if (item.sourceBox !== undefined && !["imbox", "feedbox", "trailbox", "asidebox", "laterbox", "bubblebox"].includes(String(item.sourceBox))) return undefined;
    return { kind: "hey-thread", ...common, ...(typeof item.sourceBox === "string" ? { sourceBox: item.sourceBox as "imbox" | "feedbox" | "trailbox" | "asidebox" | "laterbox" | "bubblebox" } : {}) };
  }
  if (item.kind === "hey-object") {
    if (!isAgentObjectKind(item.objectKind) || typeof item.deepLink !== "string" || !item.deepLink.startsWith("hey-agent://") || item.deepLink.length > 2_000) return undefined;
    return { kind: "hey-object", ...common, objectKind: item.objectKind, deepLink: item.deepLink };
  }
  if (item.kind === "local-file") {
    if (typeof item.path !== "string" || !isAbsolute(item.path) || item.path.length > MAX_LOCAL_PATH_LENGTH || item.path.includes("\0")) return undefined;
    if (typeof item.size !== "number" || !Number.isSafeInteger(item.size) || item.size < 0 || !validIsoDate(item.modifiedAt)) return undefined;
    return { kind: "local-file", ...common, path: item.path, size: item.size, modifiedAt: item.modifiedAt };
  }
  if (item.kind === "local-selection") {
    if (typeof item.text !== "string" || !item.text.trim() || item.text.length > MAX_LOCAL_SELECTION_LENGTH) return undefined;
    return { kind: "local-selection", ...common, text: item.text };
  }
  return undefined;
}

export function assertAgentAttachment(value: unknown): asserts value is AgentAttachment {
  if (!normalizeAgentAttachment(value)) throw new Error("Invalid HEY Agent attachment.");
}

function stableId(kind: "local-file" | "local-selection", value: string): string {
  return `${kind}:${createHash("sha256").update(value).digest("hex")}`;
}

export async function localFileAttachments(filePaths: string[]): Promise<AgentLocalFileAttachment[]> {
  const uniquePaths = [...new Set(filePaths)];
  if (uniquePaths.length > MAX_AGENT_ATTACHMENTS) throw new Error(`Attach no more than ${MAX_AGENT_ATTACHMENTS} files at once.`);
  return Promise.all(uniquePaths.map(async (candidate) => {
    if (!isAbsolute(candidate) || candidate.length > MAX_LOCAL_PATH_LENGTH || candidate.includes("\0")) throw new Error("Invalid local file selection.");
    const path = await realpath(candidate);
    const details = await stat(path);
    if (!details.isFile()) throw new Error(`${basename(path)} is not a file.`);
    return {
      kind: "local-file",
      id: stableId("local-file", path),
      title: basename(path),
      path,
      size: details.size,
      modifiedAt: details.mtime.toISOString(),
    };
  }));
}

export function localSelectionAttachment(value: string): AgentLocalSelectionAttachment {
  const text = value.trim();
  if (!text) throw new Error("Select some text, then attach the selection again.");
  if (text.length > MAX_LOCAL_SELECTION_LENGTH) throw new Error("That selection is too large to attach.");
  return {
    kind: "local-selection",
    id: stableId("local-selection", text),
    title: "Selected text",
    subtitle: `${text.length.toLocaleString()} characters`,
    text,
  };
}
