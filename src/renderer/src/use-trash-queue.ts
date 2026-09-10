import { useCallback, useRef, useState } from "react";
import type { MailMutationRequest } from "../../shared/contracts";

export type PendingTrash = { id: string; request: MailMutationRequest; deadline: number; remaining: number; paused: boolean };

export function useTrashQueue(onCommitted: (request: MailMutationRequest) => void, onError: (message: string) => void) {
  const [items, setItems] = useState<PendingTrash[]>([]);
  const pending = useRef<PendingTrash[]>([]);
  const pauseRevisions = useRef(new Map<string, number>());
  const callbacks = useRef({ onCommitted, onError });
  callbacks.current = { onCommitted, onError };
  const update = useCallback((next: PendingTrash[]) => { pending.current = next; setItems(next); }, []);
  const enqueue = useCallback((request: MailMutationRequest) => {
    const alreadyQueued = new Set(pending.current.flatMap((item) => item.request.postingIds));
    const postingIds = request.postingIds.filter((id) => !alreadyQueued.has(id));
    if (!postingIds.length) return;
    const item: PendingTrash = { id: crypto.randomUUID(), request: { ...request, postingIds }, deadline: Date.now() + 5_000, remaining: 5_000, paused: false };
    update([...pending.current, item]);
    void window.heyAgent.mail.queueTrash(item.id, item.request).then((result) => {
      if (!("cancelled" in result)) callbacks.current.onCommitted(item.request);
    }).catch((reason: unknown) => {
      callbacks.current.onError(reason instanceof Error ? reason.message : "Couldn't move the conversation to Trash. It has been restored to the list.");
    }).finally(() => { pauseRevisions.current.delete(item.id); update(pending.current.filter((entry) => entry.id !== item.id)); });
  }, [update]);
  const undo = useCallback(async (id?: string) => {
    const item = id ? pending.current.find((entry) => entry.id === id) : pending.current.at(-1);
    if (!item) return false;
    try {
      const cancelled = await window.heyAgent.mail.cancelTrash(item.id);
      if (cancelled) update(pending.current.filter((entry) => entry.id !== item.id));
      return cancelled;
    } catch (reason) { callbacks.current.onError(reason instanceof Error ? reason.message : "Couldn't cancel the trash action."); return false; }
  }, [update]);
  const pause = useCallback(async (id: string, paused: boolean) => {
    const revision = (pauseRevisions.current.get(id) ?? 0) + 1;
    pauseRevisions.current.set(id, revision);
    try {
      const remaining = await window.heyAgent.mail.pauseTrash(id, paused);
      if (remaining === null || pauseRevisions.current.get(id) !== revision) return;
      update(pending.current.map((item) => item.id === id ? { ...item, remaining, deadline: Date.now() + remaining, paused } : item));
    } catch (reason) { callbacks.current.onError(reason instanceof Error ? reason.message : "Couldn't pause Undo."); }
  }, [update]);
  return { items, enqueue, undo, pause };
}
