import type { ImboxPosting, MailboxKey, MailMutationRequest } from "../../shared/contracts";
import type { ShortcutId } from "./shortcuts";

export function mailToggle(id: ShortcutId, postingIds: string[], sourceBox: MailboxKey, postings: ImboxPosting[] = []): { active: boolean; label: string; request: MailMutationRequest } | undefined {
  if (!postingIds.length) return undefined;
  const selected = postings.filter((posting) => postingIds.includes(posting.id));
  const all = (predicate: (posting: ImboxPosting) => boolean) => selected.length === postingIds.length && selected.every(predicate);
  if (id === "aside" || id === "later") {
    const destination = id === "aside" ? "asidebox" : "laterbox";
    const name = id === "aside" ? "Set Aside" : "Reply Later";
    const active = sourceBox === destination;
    return { active, label: active ? `Remove from ${name}` : `Move to ${name}`, request: { operation: "move", postingIds, sourceBox, destination: active ? "imbox" : destination } };
  }
  if (id === "bubble") {
    const active = sourceBox === "bubblebox" || all((posting) => posting.bubbledUp === true);
    return { active, label: active ? "Cancel Bubble Up" : "Bubble up tomorrow", request: active
      ? { operation: "bubble-pop", postingIds, sourceBox }
      : { operation: "bubble", postingIds, sourceBox, bubbleSchedule: "tomorrow" } };
  }
  if (id === "unread") {
    const active = all((posting) => !posting.seen);
    return { active, label: active ? "Mark read" : "Mark unread", request: { operation: active ? "seen" : "unseen", postingIds } };
  }
  return undefined;
}
