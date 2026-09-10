import { CalendarDays, Download, ExternalLink, Paperclip } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CalendarSummary, MailAttachment, MailCalendarInvite } from "../../../shared/contracts";
import { attachmentSize, canOpenMailAttachment, isCalendarAttachment } from "../../../shared/mail-attachments";
import CalendarEventComposer from "./CalendarEventComposer";

function AttachmentCard({ topicId, file }: { topicId: string; file: MailAttachment }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState<"open" | "save" | "preview" | "calendar" | "hey" | null>(null);
  const [invite, setInvite] = useState<MailCalendarInvite>();
  const [calendars, setCalendars] = useState<CalendarSummary[]>();
  const [added, setAdded] = useState(false);
  const previewRef = useRef<HTMLElement>(null);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const copyTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (invite) previewRef.current?.focus(); }, [invite]);
  const closePreview = () => { setInvite(undefined); previewTrigger.current?.focus(); };
  const closeCalendar = () => { setCalendars(undefined); copyTrigger.current?.focus(); };
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const openable = canOpenMailAttachment(file);
  const act = async (action: "open" | "save" | "preview" | "calendar" | "hey") => {
    if (pending.current) return;
    pending.current = true;
    setBusy(action); setError(""); setStatus("");
    try {
      if (action === "preview") {
        setInvite(await window.heyAgent.mail.previewCalendarInvite(topicId, file.id));
      } else if (action === "hey") {
        await window.heyAgent.system.openExternalUrl(`https://app.hey.com/topics/${topicId}`);
      } else if (action === "calendar" && invite?.copy) {
        const result = await window.heyAgent.calendar.list({ startsOn: invite.copy.startsOn, endsOn: invite.copy.endsOn ?? invite.copy.startsOn });
        if (result.status !== "ready") throw new Error(result.detail ?? "Calendars could not be loaded.");
        if (!result.calendars.some((calendar) => calendar.writable)) throw new Error("No writable calendar is available. Open the invitation in HEY.");
        setCalendars(result.calendars);
      } else if (action === "open") {
        await window.heyAgent.mail.openAttachment(topicId, file.id);
        setStatus("Opened in your desktop app.");
      } else {
        const result = await window.heyAgent.mail.saveAttachment(topicId, file.id);
        if (!result.cancelled) setStatus("Saved.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "Couldn’t download this attachment. Try again.");
    } finally {
      pending.current = false; setBusy(null);
    }
  };
  return <li className="received-attachment" aria-busy={busy !== null}>
    <Paperclip size={18} aria-hidden="true" />
    <div className="received-attachment-info">
      <strong><bdi>{file.filename}</bdi></strong>
      <span>{[file.contentType, attachmentSize(file.byteSize)].filter(Boolean).join(" · ")}</span>
      {!openable && !isCalendarAttachment(file) && <span>Save this file to open it.</span>}
    </div>
    <div className="received-attachment-actions">
      {isCalendarAttachment(file) && <button ref={previewTrigger} type="button" className="secondary-button" disabled={busy !== null} aria-label={`Preview ${file.filename}`} aria-expanded={Boolean(invite)} onClick={() => void act("preview")}><CalendarDays size={14} aria-hidden="true" />{busy === "preview" ? "Loading…" : "Preview event"}</button>}
      {openable && <button type="button" className="secondary-button" disabled={busy !== null} aria-label={`Open ${file.filename}`} data-tooltip="Open in your desktop app" onClick={() => void act("open")}><ExternalLink size={14} aria-hidden="true" />{busy === "open" ? "Opening…" : "Open"}</button>}
      <button type="button" className="secondary-button" disabled={busy !== null} aria-label={`Save ${file.filename}`} data-tooltip="Save attachment" onClick={() => void act("save")}><Download size={14} aria-hidden="true" />{busy === "save" ? "Saving…" : "Save"}</button>
    </div>
    {invite && <section ref={previewRef} tabIndex={-1} className="mail-invite-preview" aria-label="Calendar invitation" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closePreview(); } }}>
      <h4>{invite.title}</h4><p>{invite.when}</p>
      {invite.location && <p>{invite.location}</p>}{invite.organizer && <p>Organizer: {invite.organizer}</p>}
      <p>{invite.notice ?? "Add a personal copy, or respond to the invitation in HEY. A copy does not send an RSVP."}</p>
      <div className="received-attachment-actions">
        {invite.copy && <button ref={copyTrigger} type="button" className="secondary-button" disabled={busy !== null || added} onClick={() => void act("calendar")}>{added ? "Added to calendar" : "Add personal copy…"}</button>}
        <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => void act("hey")}>Respond in HEY<ExternalLink size={14} aria-hidden="true" /></button>
        <button type="button" className="secondary-button" onClick={closePreview}>Close preview</button>
      </div>
    </section>}
    {calendars && invite?.copy && <CalendarEventComposer calendars={calendars} startsOn={invite.copy.startsOn} initial={invite.copy} onClose={closeCalendar} onSaved={(message) => { setCalendars(undefined); setAdded(true); setStatus(message); previewRef.current?.focus(); }} />}
    {status && <p className="received-attachment-status" role="status">{status}</p>}
    {error && <p className="received-attachment-status" role="alert">{error}</p>}
  </li>;
}

export default function EmailAttachments({ topicId, attachments }: { topicId: string; attachments?: MailAttachment[] }) {
  if (!attachments?.length) return null;
  return <section className="received-attachments" aria-label="Message attachments">
    <h3>{attachments.length === 1 ? "Attachment" : `${attachments.length} attachments`}</h3>
    <ul>{attachments.map((file) => <AttachmentCard key={`${topicId}:${file.id}`} topicId={topicId} file={file} />)}</ul>
  </section>;
}
