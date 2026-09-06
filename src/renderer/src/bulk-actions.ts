import type { MailMutationRequest, MailboxKey } from "../../shared/contracts";
import type { ShortcutDefinition, ShortcutId } from "./shortcuts";

const REUSED_BULK_COMMANDS = new Set<ShortcutId>(["later", "aside", "bubble", "seen", "unread", "trash"]);
const BULK_ONLY_COMMANDS = new Set<ShortcutId>(["bulk-imbox", "bulk-feed", "bulk-trail", "bulk-ignore"]);

export function isBulkMutationCommand(id: ShortcutId): boolean {
  return REUSED_BULK_COMMANDS.has(id) || BULK_ONLY_COMMANDS.has(id);
}

export function bulkMutationRequest(id: ShortcutId, postingIds: string[], sourceBox: MailboxKey): MailMutationRequest | undefined {
  if (postingIds.length === 0) return undefined;
  if (id === "later" && sourceBox !== "laterbox") return { operation: "move", postingIds, destination: "laterbox", sourceBox };
  if (id === "aside" && sourceBox !== "asidebox") return { operation: "move", postingIds, destination: "asidebox", sourceBox };
  if (id === "bubble") return { operation: "bubble", postingIds, bubbleSchedule: "tomorrow", sourceBox };
  if (id === "seen") return { operation: "seen", postingIds };
  if (id === "unread") return { operation: "unseen", postingIds };
  if (id === "trash") return { operation: "trash", postingIds, sourceBox };
  if (id === "bulk-imbox" && sourceBox !== "imbox") return { operation: "move", postingIds, destination: "imbox", sourceBox };
  if (id === "bulk-feed" && sourceBox !== "feedbox") return { operation: "move", postingIds, destination: "feedbox", sourceBox };
  if (id === "bulk-trail" && sourceBox !== "trailbox") return { operation: "move", postingIds, destination: "trailbox", sourceBox };
  if (id === "bulk-ignore") return { operation: "ignore", postingIds };
  return undefined;
}

function selectionNoun(count: number): string {
  return `${count} ${count === 1 ? "conversation" : "conversations"}`;
}

export function countAwareBulkCommand(command: ShortcutDefinition, count: number): ShortcutDefinition {
  if (count <= 0) return command;
  const selection = selectionNoun(count);
  const labels: Partial<Record<ShortcutId, string>> = {
    "bulk-actions": `Open actions for ${selection}`,
    "read-together": `Read ${selection} together`,
    "reply-together": `Reply Together with ${selection}`,
    "bulk-label": `Add ${selection} to a label`,
    "bulk-collection": `Add ${selection} to a Collection`,
    later: `Move ${selection} to Reply Later`,
    aside: `Move ${selection} to Set Aside`,
    bubble: `Bubble up ${selection} tomorrow`,
    seen: `Mark ${selection} seen`,
    unread: `Mark ${selection} unseen`,
    trash: `Move ${selection} to Trash`,
    "bulk-imbox": `Move ${selection} to Imbox`,
    "bulk-feed": `Move ${selection} to The Feed`,
    "bulk-trail": `Move ${selection} to Paper Trail`,
    "bulk-ignore": `Ignore ${selection}`,
  };
  return labels[command.id] ? { ...command, label: labels[command.id]! } : command;
}

export function prioritizeBulkCommands(commands: ShortcutDefinition[], count: number): ShortcutDefinition[] {
  if (count <= 0) return commands;
  const decorated = commands.map((command) => countAwareBulkCommand(command, count));
  const priority = new Map<ShortcutId, number>([["read-together", 0], ["reply-together", 1], ["bulk-label", 2], ["bulk-collection", 3]]);
  return [
    ...decorated.filter((command) => priority.has(command.id)).sort((left, right) => priority.get(left.id)! - priority.get(right.id)!),
    ...decorated.filter((command) => isBulkMutationCommand(command.id)),
    ...decorated.filter((command) => !priority.has(command.id) && !isBulkMutationCommand(command.id)),
  ];
}
