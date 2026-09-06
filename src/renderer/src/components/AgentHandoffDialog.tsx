import { Copy, ExternalLink, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { MAX_HANDOFF_LENGTH, type AgentHandoff } from "../../../shared/handoff";
import { trapFocus } from "../composer-keyboard";

// THESIS: inspect exactly what leaves this chat, then copy or open it once.
// OWN-WORLD: existing opaque dialog, theme colors, app font and native controls.
// STORY: select a local agent or any destination; edit context before transfer.
// FIRST VIEWPORT: title/account, destination, roomy text editor, safety note/actions.
// FORM: narrow, code-led extension of the existing review-dialog pattern.
// FINISH: independent finish review and scoped feature documentation.
export default function AgentHandoffDialog({ tabId, onClose }: { tabId: string; onClose: () => void }) {
  const [handoff, setHandoff] = useState<AgentHandoff>();
  const [prompt, setPrompt] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [outcome, setOutcome] = useState<"copied" | "opened">();
  const [launched, setLaunched] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const actionInFlight = useRef(false);
  const id = useId();
  useEffect(() => {
    const node = dialog.current!;
    const opener = document.activeElement as HTMLElement | null;
    node.showModal();
    let cancelled = false;
    void window.heyAgent.agent.prepareHandoff(tabId).then((result) => {
      if (cancelled) return;
      setHandoff(result); setPrompt(result.prompt);
    }).catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to prepare this handoff. Close it and try again."); });
    return () => { cancelled = true; node.close(); if (opener?.isConnected) opener.focus(); };
  }, [tabId]);
  const valid = Boolean(handoff && prompt.trim() && prompt.length <= MAX_HANDOFF_LENGTH && !prompt.includes("\0"));
  const destination = handoff?.targets.find((item) => item.id === target);
  const act = async (launch: boolean) => {
    if (!handoff || !valid || actionInFlight.current || (launch && (!destination || launched))) return;
    actionInFlight.current = true; setBusy(true); setError(undefined); setOutcome(undefined);
    try {
      const request = { id: handoff.id, prompt, ...(launch ? { target } : {}) };
      if (launch) { await window.heyAgent.agent.launchHandoff(request); setLaunched(true); setOutcome("opened"); }
      else { await window.heyAgent.agent.copyHandoff(request); setOutcome("copied"); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The handoff failed. Your edits are still here; try Copy prompt."); }
    finally { actionInFlight.current = false; setBusy(false); }
  };
  const close = () => { if (!actionInFlight.current) onClose(); };
  return <dialog ref={dialog} className="agent-handoff-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`} onCancel={(event) => { event.preventDefault(); close(); }} onKeyDownCapture={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) close(); }
  }} onKeyDown={(event) => { trapFocus(event, event.currentTarget); event.stopPropagation(); }}>
    <header className="agent-handoff-heading"><div><h2 id={`${id}-title`}>Continue in another agent</h2><p title={handoff ? `${handoff.title} · ${handoff.account}` : undefined}>{handoff ? `${handoff.title} · ${handoff.account}` : "Preparing this chat…"}</p></div><button type="button" className="icon-button" aria-label="Close handoff" title="Close handoff (Esc)" disabled={busy} onClick={close}><X size={18} /></button></header>
    <div className="agent-handoff-destination">
      <label htmlFor={`${id}-destination`}>Destination</label>
      <select id={`${id}-destination`} value={target} disabled={!handoff || busy || launched} onChange={(event) => { setTarget(event.target.value); setOutcome(undefined); }}>
        <option value="">Copy for any agent</option>
        {handoff?.targets.length ? <optgroup label="Installed on this computer">{handoff.targets.map((item) => <option key={item.id} value={item.id} disabled={!handoff.terminalAvailable}>{item.name}</option>)}</optgroup> : null}
      </select>
      <p id={`${id}-help`}>{destination ? "Opens a new terminal session and submits this prompt. Your agent’s model and permission settings apply." : "Paste into ChatGPT, Claude, OpenClaw, or any other agent. Local files and HEY commands are not accessible to web agents."}</p>
      {handoff && (!handoff.targets.length || !handoff.terminalAvailable) && <p>{!handoff.targets.length ? "No supported local agent was detected. Copy works with any destination." : "No supported terminal was found. Copy the prompt to continue."}</p>}
    </div>
    <div className="agent-handoff-editor"><label htmlFor={`${id}-prompt`}>Handoff prompt <span>Edit the task and remove anything you don’t want to share.</span></label>
      <textarea id={`${id}-prompt`} aria-label="Handoff prompt" value={prompt} disabled={!handoff || busy} spellCheck onChange={(event) => { setPrompt(event.target.value); setOutcome(undefined); }} placeholder="Preparing your recent conversation and reference links…" />
    </div>
    {prompt.length > MAX_HANDOFF_LENGTH && <p className="agent-handoff-feedback" role="alert">The prompt is too long. Keep it under 60,000 characters to continue.</p>}
    {error && <p className="agent-handoff-feedback" role="alert">{error}</p>}
    {outcome && <p className="agent-handoff-feedback" role="status">{outcome === "copied" ? "Copied. Paste the prompt into your other agent." : "Terminal launch requested. Check that window for sign-in, permissions, or startup errors. Nothing will sync back here."}</p>}
    <footer className="agent-handoff-footer"><p>{destination ? "A private prompt file stays in this account’s workspace. HEY Agent’s approval controls do not carry over." : "Includes recent chat text, selected text, and reference links. Mail quoted in the chat may be included. Review before sharing."}</p><div>
      <button type="button" className="secondary-button" disabled={busy} onClick={close}>{launched ? "Done" : "Cancel"}</button>
      <button type="button" className={destination ? "secondary-button" : "primary-button"} disabled={!valid || busy} onClick={() => void act(false)}><Copy size={16} />Copy prompt</button>
      {destination && <button type="button" className="primary-button" disabled={!valid || busy || launched || !handoff?.terminalAvailable} onClick={() => void act(true)}><ExternalLink size={16} />{launched ? "Opened" : `Open ${destination.name}`}</button>}
    </div></footer>
  </dialog>;
}
