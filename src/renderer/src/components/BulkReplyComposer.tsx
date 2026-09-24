import { useComposerKeyboard, useModalFocus } from "../composer-keyboard";
import { useShortcutHints } from "../shortcut-context";
import { AlertTriangle, Paperclip, Reply, RotateCw, Send, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BulkReplyPreview, BulkReplySendResult, MailContact } from "../../../shared/contracts";
import ComposerAttachments, { useComposerAttachments } from "./ComposerAttachments";
import { useProfileValue } from "../profile-storage";

type BulkReplyComposerProps = {
  postingIds: string[];
  onClose: () => void;
  onComplete: (result: BulkReplySendResult) => void;
};

function recipientLabel(contact: MailContact): string {
  if (!contact.email || contact.name === contact.email) return contact.email ?? contact.name;
  return `${contact.name} <${contact.email}>`;
}

function RecipientLine({ label, contacts }: { label: string; contacts: MailContact[] }) {
  if (contacts.length === 0) return null;
  return <div className="bulk-recipient-line"><dt>{label}</dt><dd>{contacts.map(recipientLabel).join(", ")}</dd></div>;
}

export default function BulkReplyComposer({ postingIds, onClose, onComplete }: BulkReplyComposerProps) {
  const hint = useShortcutHints();
  const dialogRef = useRef<HTMLElement>(null);
  const submitting = useRef(false);
  useModalFocus(dialogRef);
  const [preview, setPreview] = useState<BulkReplyPreview>();
  const [body, setBody] = useProfileValue(`bulk-reply:${postingIds.join(",")}:body`, "");
  const [attachments, setAttachments] = useProfileValue<string[]>(`bulk-reply:${postingIds.join(",")}:attachments`, []);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const attachmentInput = useComposerAttachments(attachments, setAttachments, setError, sending);
  const skippedCount = Math.max(0, postingIds.length - (preview?.items.length ?? 0));
  const replyCount = preview?.items.length ?? 0;
  const canSend = replyCount > 0 && (body.trim().length > 0 || attachments.length > 0) && !sending && !loading && !attachmentInput.importing;
  const selectionKey = useMemo(() => postingIds.join(","), [postingIds]);

  const loadPreview = async () => {
    setLoading(true);
    setError(undefined);
    try {
      setPreview(await window.heyAgent.mail.previewBulkReply(postingIds));
    } catch (reason) {
      setPreview(undefined);
      setError(reason instanceof Error ? reason.message : "HEY could not review these recipients.");
    } finally { setLoading(false); }
  };

  useEffect(() => { void loadPreview(); }, [selectionKey]);

  const chooseAttachments = async () => {
    await attachmentInput.choose();
  };

  const submit = async () => {
    if (!canSend || submitting.current || attachmentInput.busy.current) return;
    submitting.current = true;
    setSending(true);
    setError(undefined);
    try {
      const result = await window.heyAgent.mail.sendBulkReply({ postingIds, body, attachments });
      attachmentInput.clear(); setBody("");
      onComplete(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "HEY could not send these replies. Check HEY before trying again.");
    } finally { submitting.current = false; setSending(false); }
  };

  const handleKeys = useComposerKeyboard({ "composer-send": () => void submit(), "composer-attach": () => { if (!sending) void chooseAttachments(); } }, () => { if (!sending) onClose(); }, true);

  return <div className="dialog-scrim bulk-reply-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !sending) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} className="bulk-reply-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-reply-title" onKeyDown={handleKeys}>
      <header>
        <span><Reply size={16} /><strong id="bulk-reply-title">Reply Together</strong><small>{postingIds.length} selected</small></span>
        <button type="button" className="icon-button" aria-label="Close Reply Together" data-tooltip="Close" data-shortcut="Esc" data-tooltip-side="left" onClick={onClose} disabled={sending}><X size={15} /></button>
      </header>

      <div className="bulk-reply-intro">
        <strong>One reply, delivered separately.</strong>
        <p>Each conversation receives its own copy in the original thread. Recipients never see the other conversations.</p>
      </div>

      <div className="bulk-preview" aria-busy={loading}>
        <div className="bulk-preview-heading"><span>Recipient review</span><small>HEY rechecks these recipients when you send.</small></div>
        {loading ? <div className="bulk-preview-loading"><RotateCw size={15} className="is-spinning" /><span>Checking recipients in HEY…</span></div> : null}
        {!loading && error && !preview ? <div className="bulk-preview-error"><AlertTriangle size={16} /><span>{error}</span><button type="button" className="secondary-button" onClick={() => void loadPreview()}><RotateCw size={13} /> Try again</button></div> : null}
        {!loading && preview ? <div className="bulk-preview-list">
          {preview.items.map((item, index) => <article key={`${item.topicId}-${item.entryId}-${index}`} className="bulk-preview-item">
            <div><span>{index + 1}</span><strong>{item.subject}</strong></div>
            <dl><RecipientLine label="To" contacts={item.to} /><RecipientLine label="Cc" contacts={item.cc} /><RecipientLine label="Bcc" contacts={item.bcc} /></dl>
          </article>)}
          {skippedCount > 0 ? <div className="bulk-skipped"><AlertTriangle size={14} /><span>{skippedCount} {skippedCount === 1 ? "conversation cannot" : "conversations cannot"} be replied to and will be skipped.</span></div> : null}
        </div> : null}
      </div>

      <textarea autoFocus={!loading && Boolean(preview)} value={body} onPaste={attachmentInput.onPaste} onDrop={attachmentInput.onDrop} onDragOver={attachmentInput.onDragOver} onChange={(event) => setBody(event.target.value)} placeholder="Write one reply for these conversations…" aria-label="Bulk reply message" />
      <ComposerAttachments value={attachmentInput} disabled={sending} />
      {error && preview ? <p className="composer-error">{error}</p> : null}

      <footer>
        <button type="button" className="icon-button" aria-label="Attach files" data-tooltip="Attach files" data-shortcut={hint("composer-attach")} onClick={() => void chooseAttachments()} disabled={sending}><Paperclip size={15} /></button>
        <span />
        <small>{hint("composer-send")}</small>
        <button type="button" className="send-button" data-tooltip="Send separate replies" data-shortcut={hint("composer-send")} onClick={() => void submit()} disabled={!canSend}><Send size={14} /> {sending ? "Sending…" : `Send ${replyCount || ""} ${replyCount === 1 ? "reply" : "replies"}`}</button>
      </footer>
    </section>
  </div>;
}
