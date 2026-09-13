import { Check, LoaderCircle, Paperclip } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentSnapshot, AgentThreadAttachment, AgentWorkspace } from "../../../shared/contracts";
import { mailContextAddState } from "../agent-context-actions";
import { appSound } from "../sound";

export default function AgentMailContextAction({ candidates, snapshot, onWorkspace, onFocusComposer, onError }: {
  candidates: AgentThreadAttachment[];
  snapshot: AgentSnapshot;
  onWorkspace: (workspace: AgentWorkspace) => void;
  onFocusComposer: () => void;
  onError: (message: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const { missing, label, limitMessage } = mailContextAddState(candidates, snapshot.attachments);
  const add = async () => {
    if (pending.current || missing.length === 0 || limitMessage) return;
    pending.current = true;
    setAdding(true);
    try {
      const next = await window.heyAgent.agent.attachMany(snapshot.tabId, missing);
      if (!mounted.current) return;
      onWorkspace(next);
      onFocusComposer();
      appSound.play("drop", "interface");
    } catch (reason) {
      if (mounted.current) onError(reason instanceof Error ? reason.message : "Unable to add these conversations to chat.");
    } finally {
      pending.current = false;
      if (mounted.current) setAdding(false);
    }
  };
  if (!candidates.length) return null;
  return <>
    <button type="button" className="agent-add-context" disabled={adding || missing.length === 0 || Boolean(limitMessage)} onClick={() => void add()}>
      {adding ? <LoaderCircle className="is-spinning" size={13} /> : missing.length === 0 ? <Check size={13} /> : <Paperclip size={13} />}
      {adding ? "Adding…" : label}
    </button>
    {limitMessage && <span role="status" className="agent-context-notice">{limitMessage}</span>}
  </>;
}
