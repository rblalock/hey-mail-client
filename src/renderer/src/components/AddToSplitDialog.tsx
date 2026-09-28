import { Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ImboxPosting } from "../../../shared/contracts";
import type { AddToSplitRequest, MailSplit } from "../../../shared/mail-splits";
import { trapFocus } from "../composer-keyboard";
import { splitAdditionForPostings, type SplitAdditionMode } from "../split-addition";
import "../split-inbox.css";

type Props = {
  postings: ImboxPosting[];
  splits: MailSplit[];
  ownEmail?: string;
  onAdd: (request: AddToSplitRequest) => Promise<void>;
  onCreate: () => void;
  onClose: () => void;
};

export default function AddToSplitDialog({ postings, splits, ownEmail, onAdd, onCreate, onClose }: Props) {
  const [splitId, setSplitId] = useState(splits[0]?.id ?? "");
  const [mode, setMode] = useState<SplitAdditionMode>("conversation");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const locked = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const node = dialog.current!;
    const opener = document.activeElement as HTMLElement | null;
    node.showModal();
    return () => { node.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  const close = () => { if (!locked.current) onClose(); };
  const candidate = (kind: SplitAdditionMode) => {
    try { return { request: splitAdditionForPostings(splitId, postings, kind, ownEmail) }; }
    catch (reason) { return { error: reason instanceof Error ? reason.message : "Email addresses unavailable. Add only these conversations instead." }; }
  };
  const personCandidate = candidate("person");
  const domainCandidate = candidate("domain");
  const people = personCandidate.request?.people;
  const domains = domainCandidate.request?.domains;
  const chooseMode = (next: SplitAdditionMode) => { setMode(next); setError(undefined); };
  const submit = async () => {
    if (locked.current) return;
    if (!splits.some((split) => split.id === splitId)) { setError("Choose a split first."); return; }
    locked.current = true; setBusy(true); setError(undefined);
    try { await onAdd(splitAdditionForPostings(splitId, postings, mode, ownEmail)); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add to this split. Try again."); }
    finally { locked.current = false; setBusy(false); }
  };
  return <dialog ref={dialog} className="split-manager split-add-dialog" aria-modal="true" aria-labelledby={`${id}-title`} data-keyboard-scope="editor"
    onCancel={(event) => { event.preventDefault(); close(); }} onKeyDown={(event) => {
      trapFocus(event, event.currentTarget);
      if (event.key === "Escape" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); close(); }
      event.stopPropagation();
    }}>
    <header className="split-manager-heading"><h2 id={`${id}-title`}>Add to split</h2><button type="button" className="icon-button" aria-label="Close add to split" disabled={busy} onClick={close}><X size={18} /></button></header>
    <form className="split-editor" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className="split-manager-body">
        <p>{postings.length === 1 ? postings[0]!.subject || "(No subject)" : `${postings.length} selected conversations`}</p>
        {splits.length ? <fieldset className="split-editor-fields split-add-fields" disabled={busy}>
          <label className="split-field" htmlFor={`${id}-split`}><span>Split</span><select id={`${id}-split`} value={splitId} onChange={(event) => { setSplitId(event.target.value); setError(undefined); }}>
            {splits.map((split) => <option key={split.id} value={split.id}>{split.name}{split.enabled ? "" : " (off)"}</option>)}
          </select></label>
          <fieldset className="split-add-options"><legend>What should belong here?</legend>
            <label><input type="radio" name={`${id}-mode`} value="conversation" checked={mode === "conversation"} onChange={() => chooseMode("conversation")} /><span>{postings.length === 1 ? "Only this conversation" : "Only these conversations"}<small>No rule for future mail.</small></span></label>
            <label><input type="radio" name={`${id}-mode`} value="person" checked={mode === "person"} disabled={!people?.length} aria-describedby={`${id}-person-help`} onChange={() => chooseMode("person")} /><span>{people?.length === 1 ? "Include this person" : "Include these people"}<small id={`${id}-person-help`}>{people?.join(", ") ?? personCandidate.error}</small></span></label>
            <label><input type="radio" name={`${id}-mode`} value="domain" checked={mode === "domain"} disabled={!domains?.length} aria-describedby={`${id}-domain-help`} onChange={() => chooseMode("domain")} /><span>{domains?.length === 1 ? "Include this domain" : "Include these domains"}<small id={`${id}-domain-help`}>{domains?.join(", ") ?? domainCandidate.error}</small></span></label>
          </fieldset>
          <p className="split-sync-note">{mode === "conversation" ? "Adds the split’s HEY label without moving the mail." : "Adds to the existing rules. Matching mail across your account is included as it loads; new matches are labeled while the app runs."}</p>
          {splits.find((split) => split.id === splitId)?.enabled === false && <p className="split-sync-note">This split is off. Its label will be added, but automatic rules stay paused until you enable it.</p>}
        </fieldset> : <p className="split-add-fields">Create a split first, then add these conversations to it.</p>}
        {error && <p className="split-feedback" role="alert">{error}</p>}
        <button type="button" className="secondary-button split-add-create" disabled={busy} onClick={onCreate}><Plus size={15} />Create split</button>
      </div>
      <footer className="split-manager-footer"><button type="button" className="secondary-button" disabled={busy} onClick={close}>Cancel</button><button type="submit" className="primary-button" disabled={busy || !splits.length}>{busy ? "Adding…" : mode === "conversation" ? postings.length === 1 ? "Add conversation" : "Add conversations" : "Add and include future mail"}</button></footer>
    </form>
  </dialog>;
}
