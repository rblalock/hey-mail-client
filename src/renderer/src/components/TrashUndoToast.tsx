import { useEffect, useRef, useState } from "react";
import type { PendingTrash } from "../use-trash-queue";
import { useShortcutHints } from "../shortcut-context";

export default function TrashUndoToast({ item, undo, pause }: { item: PendingTrash; undo: (id: string) => Promise<boolean>; pause: (id: string, paused: boolean) => Promise<void> }) {
  const [now, setNow] = useState(Date.now);
  const undoHint = useShortcutHints()("undo-trash");
  const hovered = useRef(false);
  const focused = useRef(false);
  const paused = useRef(false);
  const syncPause = () => {
    const next = hovered.current || focused.current;
    if (paused.current !== next) { paused.current = next; void pause(item.id, next); }
  };
  useEffect(() => {
    if (item.paused) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [item.paused]);
  const remaining = item.paused ? item.remaining : Math.max(0, item.deadline - now);
  const count = item.request.postingIds.length;
  return <div className="trash-undo-toast"
    onPointerEnter={() => { hovered.current = true; syncPause(); }} onPointerLeave={() => { hovered.current = false; syncPause(); }}
    onFocus={() => { focused.current = true; syncPause(); }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { focused.current = false; syncPause(); } }}>
    <span role="status">{count === 1 ? "Moved to Trash" : `${count} conversations moved to Trash`}</span>
    <button type="button" disabled={remaining <= 0} onClick={() => void undo(item.id)} aria-keyshortcuts={undoHint && !undoHint.includes(" then ") ? undoHint.replace("Ctrl", "Control") : undefined} data-tooltip="Cancel this trash action" data-shortcut-id="undo-trash">{remaining > 0 ? <>Undo {undoHint && <kbd>{undoHint}</kbd>}</> : "Saving…"}</button>
    <div className="trash-undo-countdown" aria-hidden="true"><span style={{ width: `${Math.min(100, remaining / 50)}%` }} /></div>
  </div>;
}
