export const MAX_HANDOFF_LENGTH = 60_000;

export type HandoffTarget = { id: string; name: string };
export type AgentHandoff = {
  id: string;
  title: string;
  account: string;
  prompt: string;
  targets: HandoffTarget[];
  terminalAvailable: boolean;
};

export type HandoffAction = { id: string; prompt: string; target?: string };

export function assertHandoffAction(value: unknown): asserts value is HandoffAction {
  if (!value || typeof value !== "object") throw new Error("Invalid handoff.");
  const item = value as Partial<HandoffAction>;
  if (typeof item.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(item.id)
    || typeof item.prompt !== "string" || !item.prompt.trim() || item.prompt.length > MAX_HANDOFF_LENGTH || item.prompt.includes("\0")
    || (item.target !== undefined && (typeof item.target !== "string" || !/^[a-z-]{1,30}$/.test(item.target)))) {
    throw new Error("Enter a handoff prompt of 1–60,000 characters without null characters.");
  }
}
