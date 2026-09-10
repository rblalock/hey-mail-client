import { focusRecipient, useComposerKeyboard } from "../composer-keyboard";
import { confirmAction } from "./ConfirmAction";
import { useShortcutHints } from "../shortcut-context";
import { FileEdit, RefreshCw, Save, Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useProfileValue } from "../profile-storage";
import type { AgentObjectLink, MailDraft } from "../../../shared/contracts";
import { appSound } from "../sound";
import ComposerWritingAssistant, { type ComposerWritingHandle } from "./ComposerWritingAssistant";

type DraftsViewProps = { onNotice: (message: string) => void; target?: { object: AgentObjectLink; id: string; revision: number }; onTargetMissing?: (object: AgentObjectLink) => void; refreshToken?: number };

export default function DraftsView({ onNotice, target, onTargetMissing, refreshToken = 0 }: DraftsViewProps) {
  const hint = useShortcutHints();
  const editorRef = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const openRequest = useRef(0);
  const [drafts, setDrafts] = useState<MailDraft[]>([]);
  const [selected, setSelected] = useProfileValue<MailDraft | undefined>("draft-editor", undefined);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string>();
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const writingAssistant = useRef<ComposerWritingHandle>(null);

  const refresh = async () => {
    setLoading(true); setError(undefined);
    try {
      const values = await window.heyAgent.mail.listDrafts();
      setDrafts(values);
      setSelected((current) => current && values.some((draft) => draft.id === current.id) ? current : undefined);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "HEY could not load drafts."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, [refreshToken]);
  useEffect(() => () => { openRequest.current += 1; }, []);

  const open = async (id: string, linkedObject?: AgentObjectLink) => {
    if (submitting.current || saving) return;
    const request = ++openRequest.current;
    setError(undefined); setSelected(undefined); setOpening(true);
    try {
      const draft = await window.heyAgent.mail.showDraft(id);
      if (request !== openRequest.current) return;
      setSelected(draft); appSound.play("open", "interface");
    }
    catch (reason) {
      if (request !== openRequest.current) return;
      appSound.play("error", "mail");
      if (linkedObject) onTargetMissing?.(linkedObject);
      else setError(reason instanceof Error ? reason.message : "HEY could not read this draft.");
    }
    finally { if (request === openRequest.current) setOpening(false); }
  };
  useEffect(() => { if (target) void open(target.id, target.object); }, [target?.revision]);

  const save = async () => {
    if (!selected || saving || submitting.current) return;
    submitting.current = true;
    setSaving(true); setError(undefined);
    try {
      const result = await window.heyAgent.mail.editDraft(selected);
      appSound.play("success", "mail");
      onNotice(result.message);
      const [, saved] = await Promise.all([refresh(), window.heyAgent.mail.showDraft(selected.id)]);
      setSelected(saved);
    } catch (reason) { appSound.play("error", "mail"); setError(reason instanceof Error ? reason.message : "HEY could not save this draft."); }
    finally { submitting.current = false; setSaving(false); }
  };

  const send = async () => {
    if (!selected || !selected.to.trim() || saving || submitting.current) return;
    submitting.current = true;
    setSaving(true); setError(undefined);
    try { await window.heyAgent.mail.editDraft(selected); const result = await window.heyAgent.mail.sendDraft(selected.id); appSound.play("send", "mail"); onNotice(result.message); setSelected(undefined); await refresh(); }
    catch (reason) { appSound.play("error", "mail"); setError(reason instanceof Error ? reason.message : "HEY could not send this draft."); }
    finally { submitting.current = false; setSaving(false); }
  };

  const remove = async () => {
    if (!selected || saving || !await confirmAction("This draft will be deleted from HEY.", "Delete draft")) return;
    setSaving(true); setError(undefined);
    try { const result = await window.heyAgent.mail.deleteDraft(selected.id); appSound.play("delete", "mail"); onNotice(result.message); setSelected(undefined); await refresh(); }
    catch (reason) { appSound.play("error", "mail"); setError(reason instanceof Error ? reason.message : "HEY could not delete this draft."); }
    finally { submitting.current = false; setSaving(false); }
  };

  const handleKeys = useComposerKeyboard({
    "composer-write": () => writingAssistant.current?.open(), "composer-save": () => void save(), "composer-send": () => void send(),
    "composer-cc": () => focusRecipient(editorRef.current!, "Cc"), "composer-bcc": () => focusRecipient(editorRef.current!, "Bcc"),
  });

  return (
    <section className="panel drafts-panel" aria-label="Drafts">
      <header className="panel-header"><div className="title-cluster"><h1>Drafts</h1><span className="title-count">{drafts.length}</span></div><button type="button" className="icon-button" aria-label="Refresh drafts" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} className={loading ? "is-spinning" : ""} /></button></header>
      <div className="drafts-layout">
        <div className="draft-list">
          {drafts.map((draft) => <button key={draft.id} type="button" disabled={saving} data-selected={selected?.id === draft.id} onClick={() => void open(draft.id)}><FileEdit size={15} /><span><strong>{draft.subject}</strong><small>{draft.to || "No recipients yet"}</small></span>{draft.updatedAt && <time>{new Date(draft.updatedAt).toLocaleDateString()}</time>}</button>)}
          {!loading && drafts.length === 0 && <div className="empty-state"><FileEdit size={20} /><h2>No drafts</h2><p>Saved messages will appear here and in HEY.</p></div>}
        </div>
        {selected ? <div ref={editorRef} className="draft-editor" onKeyDown={handleKeys}>
          <label><span>To</span><input value={selected.to} onChange={(event) => setSelected({ ...selected, to: event.target.value })} /></label>
          <label><span>Cc</span><input aria-label="Cc" value={selected.cc} onChange={(event) => setSelected({ ...selected, cc: event.target.value })} /></label>
          <label><span>Bcc</span><input aria-label="Bcc" value={selected.bcc} onChange={(event) => setSelected({ ...selected, bcc: event.target.value })} /></label>
          <label><span>Subject</span><input value={selected.subject} onChange={(event) => setSelected({ ...selected, subject: event.target.value })} /></label>
          {selected.scheduledAt && <p className="draft-schedule">Scheduled for {new Date(selected.scheduledAt).toLocaleString()}. Editing preserves this delivery time.</p>}
          <textarea ref={bodyInput} value={selected.body} onChange={(event) => setSelected({ ...selected, body: event.target.value })} />
          {error && <p className="composer-error">{error}</p>}
          <footer><button type="button" className="secondary-button draft-delete" onClick={() => void remove()} disabled={saving}><Trash2 size={14} /> Delete</button><ComposerWritingAssistant disabled={saving} key={selected.id} ref={writingAssistant} value={selected.body} onChange={(body) => setSelected((current) => current ? { ...current, body } : current)} textareaRef={bodyInput} mode="compose" subject={selected.subject} recipients={[selected.to, selected.cc, selected.bcc].filter(Boolean).join(", ")} /><span /><button type="button" className="secondary-button" data-tooltip="Save draft" data-shortcut={hint("composer-save")} onClick={() => void save()} disabled={saving}><Save size={14} /> Save</button><button type="button" className="send-button" data-tooltip="Save changes and send draft" data-shortcut={hint("composer-send")} onClick={() => void send()} disabled={saving || !selected.to.trim()}><Send size={14} /> Send</button></footer>
        </div> : <div className="draft-editor-empty"><FileEdit size={22} /><p>{opening ? "Loading draft…" : "Select a draft to continue writing."}</p>{error && <p className="composer-error">{error}</p>}</div>}
      </div>
    </section>
  );
}
