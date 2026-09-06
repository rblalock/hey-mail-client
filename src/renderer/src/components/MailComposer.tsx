import { FileText, Paperclip, Save, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useProfileValue } from "../profile-storage";
import type { ImboxPosting, MailComposerMode, MailLibraryItem, MailSendResult } from "../../../shared/contracts";
import { appSound } from "../sound";
import { focusRecipient, useComposerKeyboard, useModalFocus } from "../composer-keyboard";
import { useShortcutHints } from "../shortcut-context";
import RecipientField from "./RecipientField";
import ComposerWritingAssistant, { type ComposerWritingHandle } from "./ComposerWritingAssistant";

type MailComposerProps = {
  mode: Exclude<MailComposerMode, "reply">;
  posting?: ImboxPosting;
  initialTo?: string;
  onClose: () => void;
  onComplete: (result: MailSendResult) => void;
};

function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

export default function MailComposer({ mode, posting, initialTo = "", onClose, onComplete }: MailComposerProps) {
  const hint = useShortcutHints();
  const dialogRef = useRef<HTMLElement>(null);
  const submitting = useRef(false);
  useModalFocus(dialogRef);
  const draftKey = `composer:${mode}:${posting?.topicId ?? initialTo}`;
  const [to, setTo] = useProfileValue(`${draftKey}:to`, initialTo);
  const [ccVisible, setCcVisible] = useProfileValue(`${draftKey}:cc-visible`, false);
  const [cc, setCc] = useProfileValue(`${draftKey}:cc`, "");
  const [bcc, setBcc] = useProfileValue(`${draftKey}:bcc`, "");
  const [subject, setSubject] = useProfileValue(`${draftKey}:subject`, mode === "forward" && posting ? `Fwd: ${posting.subject}` : "");
  const [body, setBody] = useProfileValue(`${draftKey}:body`, "");
  const [attachments, setAttachments] = useProfileValue<string[]>(`${draftKey}:attachments`, []);
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const [contacts, setContacts] = useState<MailLibraryItem[]>([]);
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const writingAssistant = useRef<ComposerWritingHandle>(null);

  useEffect(() => {
    let cancelled = false;
    void window.heyAgent.mail.listLibrary("contacts").then((result) => {
      if (!cancelled) setContacts(result.items);
    }).catch(() => {
      // Manual addresses remain available when HEY cannot load contact suggestions.
    });
    return () => { cancelled = true; };
  }, []);

  const canSend = !sending && Boolean(to.trim()) && (mode !== "compose" || Boolean(subject.trim()));
  const canSave = !sending && mode === "compose" && Boolean(subject.trim() || body.trim());
  const submit = async (saveAsDraft = false) => {
    if (submitting.current || !(saveAsDraft ? canSave : canSend)) return;
    submitting.current = true;
    setSending(true);
    setError(undefined);
    try {
      const result = await window.heyAgent.mail.send({
        mode,
        ...(posting?.topicId ? { topicId: posting.topicId } : {}),
        to,
        cc,
        bcc,
        ...(mode === "compose" ? { subject } : {}),
        body,
        attachments,
        saveAsDraft,
      });
      setTo(initialTo); setCc(""); setBcc(""); setCcVisible(false); setSubject(""); setBody(""); setAttachments([]);
      onComplete(result);
    } catch (reason) {
      appSound.play("error", "mail");
      setError(reason instanceof Error ? reason.message : "HEY could not save this message.");
    } finally { submitting.current = false; setSending(false); }
  };

  const chooseAttachments = async () => {
    const selected = await window.heyAgent.mail.selectAttachments();
    if (selected.length) appSound.play("drop", "interface");
    setAttachments((current) => [...new Set([...current, ...selected])]);
  };

  const handleKeys = useComposerKeyboard({
    "composer-write": () => writingAssistant.current?.open(),
    "composer-send": () => void submit(false),
    "composer-save": () => void submit(true),
    "composer-attach": () => { if (mode === "compose" && !sending) void chooseAttachments(); },
    "composer-cc": () => focusRecipient(dialogRef.current!, "Cc", () => setCcVisible(true)),
    "composer-bcc": () => focusRecipient(dialogRef.current!, "Bcc", () => setCcVisible(true)),
  }, () => { if (!sending) onClose(); }, true);

  return (
    <div className="dialog-scrim composer-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !sending) onClose(); }}>
      <section ref={dialogRef} tabIndex={-1} className="mail-composer-dialog" role="dialog" aria-modal="true" aria-label={mode === "compose" ? "New message" : `Forward ${posting?.subject ?? "message"}`} onKeyDown={handleKeys}>
        <header>
          <span><FileText size={15} /> {mode === "compose" ? "New message" : "Forward"}</span>
          <button type="button" className="icon-button" aria-label="Close composer" data-tooltip="Close composer" data-shortcut="Esc" data-tooltip-side="left" onClick={onClose} disabled={sending}><X size={15} /></button>
        </header>
        {window.heyAgent.profiles?.current.active && <div className="composer-account">From {window.heyAgent.profiles.current.active.email}</div>}
        <div className="composer-fields">
          <RecipientField label="To" value={to} onChange={setTo} contacts={contacts} autoFocus placeholder="Name or email" />
          {!ccVisible ? <button type="button" className="composer-recipients-toggle" data-tooltip="Show Cc / Bcc" data-shortcut={[hint("composer-cc"), hint("composer-bcc")].filter(Boolean).join(" / ")} onClick={() => setCcVisible(true)}>Cc / Bcc</button> : <>
            <RecipientField label="Cc" value={cc} onChange={setCc} contacts={contacts} placeholder="Name or email" />
            <RecipientField label="Bcc" value={bcc} onChange={setBcc} contacts={contacts} placeholder="Name or email" />
          </>}
          {mode === "compose" && <label><span>Subject</span><input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject" /></label>}
        </div>
        {mode === "forward" && <div className="forward-context">Forwarding <strong>{posting?.subject}</strong></div>}
        <textarea ref={bodyInput} value={body} onChange={(event) => setBody(event.target.value)} placeholder={mode === "compose" ? "Write your message…" : "Add a note…"} />
        {attachments.length > 0 && <div className="composer-attachments">{attachments.map((path) => <span key={path}><Paperclip size={12} /> {fileName(path)} <button type="button" aria-label={`Remove ${fileName(path)}`} onClick={() => { appSound.play("deselect", "interface"); setAttachments((current) => current.filter((item) => item !== path)); }}><X size={11} /></button></span>)}</div>}
        {error && <p className="composer-error">{error}</p>}
        <footer>
          {mode === "compose" && <button type="button" className="secondary-button" onClick={() => void submit(true)} data-tooltip="Save draft" data-shortcut={hint("composer-save")} disabled={!canSave}><Save size={14} /> Save draft</button>}
          {mode === "compose" && <button type="button" className="icon-button" aria-label="Attach files" data-tooltip="Attach files" data-shortcut={hint("composer-attach")} onClick={() => void chooseAttachments()} disabled={sending}><Paperclip size={15} /></button>}
          <ComposerWritingAssistant disabled={sending} ref={writingAssistant} value={body} onChange={setBody} textareaRef={bodyInput} mode={mode} subject={subject || posting?.subject} recipients={[to, cc, bcc].filter(Boolean).join(", ")} threadContext={mode === "forward" ? posting?.summary : undefined} />
          <span />
          <small>{hint("composer-send")}</small>
          <button type="button" className="send-button" data-tooltip="Send message" data-shortcut={hint("composer-send")} data-tooltip-side="top" onClick={() => void submit(false)} disabled={!canSend}><Send size={14} /> {sending ? "Sending…" : "Send"}</button>
        </footer>
      </section>
    </div>
  );
}
