import { focusRecipient, useComposerKeyboard } from "../composer-keyboard";
import { useShortcutHints } from "../shortcut-context";
import {
  ArrowLeft, ArrowUpCircle, Bell, BellOff, Check, ChevronDown, ChevronsUpDown, ChevronUp, Clock3, Eye, EyeOff, ExternalLink,
  FileClock, Forward, MoreHorizontal, Paperclip, Reply, Save, Send, ShieldAlert, Sparkles, Tag, Trash2, X,
} from "lucide-react";
import { ChevronDown as ChevronDownData, ChevronRight as ChevronRightData } from "lucide";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readProfileValue, useProfileValue } from "../profile-storage";
import type { ReactNode } from "react";
import type { AgentObjectLink, ImboxPosting, MailLibraryItem, MailMutationRequest, MailReplyContext, MailSendResult, MailThread, MailboxKey } from "../../../shared/contracts";
import type { ShortcutId } from "../shortcuts";
import { contactIdentityKey, enrichContactAvatar } from "../contact-avatar";
import { REPLY_CONTEXT_RESTART_MESSAGE, replyContextIssue } from "../reply-context";
import { readerScrollIntent } from "../reader-scroll";
import { hasNewThreadEntry } from "../thread-reconciliation";
import { appSound } from "../sound";
import ContactAvatar from "./ContactAvatar";
import ComposerWritingAssistant, { type ComposerWritingHandle } from "./ComposerWritingAssistant";
import DraftReviewDialog from "./DraftReviewDialog";
import { draftReviewIssue, type DraftSuggestion } from "../draft-review";
import EmailBody from "./EmailBody";
import EmailAttachments from "./EmailAttachments";
import { mailToggle } from "../mail-toggles";
import { contactDetails, contactLabel, currentMailEmail, entryAddressedContacts } from "../mail-presentation";
import MorphingIcon from "./MorphingIcon";
import RecipientField, { parseRecipients } from "./RecipientField";
import { ContactObjectLink } from "./SmartObjectLink";

type ThreadPanelProps = {
  posting: ImboxPosting;
  thread?: MailThread;
  threadError?: string;
  sourceLabel: string;
  mailActions?: {
    sourceBox: MailboxKey;
    onMutate: (request: MailMutationRequest) => void;
    onForward: () => void;
    onMailChanged: (result: MailSendResult, topicId: string) => void;
  };
  onOrganize?: () => void;
  supplementalActions?: ReactNode;
  onRefresh: () => void;
  onRetryThread: () => void;
  replyRequest: number;
  replyDraftSeed?: { revision: number; text: string; mode?: "append" | "replace" };
  onContinueInAgent?: (draft: string) => void;
  continueInAgentLabel?: string;
  helperActions?: Array<{ id: ShortcutId; title: string }>;
  onHelperAction?: (id: ShortcutId) => void;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  showTraversal?: boolean;
  embedded?: boolean;
  onReaderKeyDown?: (event: KeyboardEvent) => void;
  onOpenObject?: (object: AgentObjectLink) => void;
};

function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function formatEntryTime(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const sameDay = date.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat(undefined, sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function entryPreview(body: string, fallback: string): string {
  const value = (body || fallback || "Message").replace(/\s+/g, " ").trim();
  return value.length > 160 ? `${value.slice(0, 157)}…` : value;
}

function contactAddresses(contacts: MailReplyContext["to"]): string {
  return contacts.map((contact) => contact.email).filter(Boolean).join(", ");
}

function sameRecipients(left: string, right: string): boolean {
  const normalize = (value: string) => parseRecipients(value).map((address) => address.toLowerCase()).sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export default function ThreadPanel({
  posting, thread, threadError, sourceLabel, mailActions, onOrganize, supplementalActions, onRefresh, onRetryThread, replyRequest, onClose,
  replyDraftSeed, onContinueInAgent, continueInAgentLabel = "Continue in agent", helperActions = [], onHelperAction, onPrevious, onNext, hasPrevious, hasNext, showTraversal = true, embedded = false, onReaderKeyDown,
  onOpenObject,
}: ThreadPanelProps) {
  const hint = useShortcutHints();
  const replyRoot = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const hasMailActions = Boolean(mailActions);
  const [error, setError] = useState<string>();
  const draftKey = `reply:${posting.id}`;
  const [draft, setDraft] = useProfileValue(`${draftKey}:body`, "");
  const [agentSuggestion, setAgentSuggestion] = useState<DraftSuggestion>();
  const [attachments, setAttachments] = useProfileValue<string[]>(`${draftKey}:attachments`, []);
  const [sending, setSending] = useState(false);
  const [composerError, setComposerError] = useState<string>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [replyExpanded, setReplyExpanded] = useProfileValue(`${draftKey}:expanded`, false);
  const [replyContext, setReplyContext] = useState<MailReplyContext>();
  const [replyContextError, setReplyContextError] = useState<string>();
  const [replyContextRetryable, setReplyContextRetryable] = useState(true);
  const [replyTo, setReplyTo] = useProfileValue(`${draftKey}:to`, "");
  const [replyCc, setReplyCc] = useProfileValue(`${draftKey}:cc`, "");
  const [replyBcc, setReplyBcc] = useProfileValue(`${draftKey}:bcc`, "");
  const [replyCcVisible, setReplyCcVisible] = useProfileValue(`${draftKey}:cc-visible`, false);
  const [replyContacts, setReplyContacts] = useState<MailLibraryItem[]>([]);
  const [pendingReply, setPendingReply] = useState<{ body: string; attachments: string[]; sentAt: string; previousThread: MailThread }>();
  const replyInput = useRef<HTMLTextAreaElement>(null);
  const pendingReplyElement = useRef<HTMLElement>(null);
  const latestEntryElement = useRef<HTMLElement>(null);
  const collapsedReplyButton = useRef<HTMLButtonElement>(null);
  const threadScroll = useRef<HTMLDivElement>(null);
  const handledReplyRequest = useRef(replyRequest);
  const handledReplyDraftSeed = useRef<number | undefined>(undefined);
  const writingAssistant = useRef<ComposerWritingHandle>(null);
  const replyContextSequence = useRef(0);
  const [expandedOlderEntries, setExpandedOlderEntries] = useState<Set<string>>(() => new Set());

  const loadReplyContext = useCallback(async () => {
    const sequence = replyContextSequence.current + 1;
    replyContextSequence.current = sequence;
    setReplyContextError(undefined);
    setReplyContextRetryable(true);
    const getReplyContext = window.heyAgent.mail.getReplyContext;
    if (typeof getReplyContext !== "function") {
      setReplyContextError(REPLY_CONTEXT_RESTART_MESSAGE);
      setReplyContextRetryable(false);
      return;
    }
    try {
      const context = await getReplyContext(posting.id);
      if (sequence !== replyContextSequence.current) return;
      setReplyContext(context);
      setReplyTo(readProfileValue(`${draftKey}:to`, contactAddresses(context.to)));
      setReplyCc(readProfileValue(`${draftKey}:cc`, contactAddresses(context.cc)));
      setReplyBcc(readProfileValue(`${draftKey}:bcc`, contactAddresses(context.bcc)));
      setReplyCcVisible(readProfileValue(`${draftKey}:cc-visible`, context.cc.length > 0 || context.bcc.length > 0));
    } catch (reason) {
      if (sequence !== replyContextSequence.current) return;
      const issue = replyContextIssue(reason);
      setReplyContextError(issue.message);
      setReplyContextRetryable(issue.retryable);
    }
  }, [posting.id]);

  useEffect(() => {
    setError(undefined); setComposerError(undefined); setMenuOpen(false);
    setPendingReply(undefined);
    setExpandedOlderEntries(new Set());
    setReplyContext(undefined); setReplyContextError(undefined); setReplyContextRetryable(true);
    if (!posting.topicId) {
      setError("This is a HEY contact bundle. Return to the list and open the bundle to choose an individual conversation.");
    }
  }, [posting]);

  useEffect(() => {
    if (embedded) return;
    const frame = requestAnimationFrame(() => threadScroll.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [embedded, posting.id]);

  useEffect(() => {
    if (hasMailActions) void loadReplyContext();
  }, [hasMailActions, loadReplyContext]);

  useEffect(() => {
    if (!replyExpanded || replyContacts.length > 0) return;
    let cancelled = false;
    void window.heyAgent.mail.listLibrary("contacts").then((result) => { if (!cancelled) setReplyContacts(result.items); }).catch(() => {
      // Reply addresses remain editable when contact suggestions are unavailable.
    });
    return () => { cancelled = true; };
  }, [replyContacts.length, replyExpanded]);

  useEffect(() => {
    if (replyRequest > handledReplyRequest.current) {
      setReplyExpanded(true);
      requestAnimationFrame(() => requestAnimationFrame(() => replyInput.current?.focus()));
    }
    handledReplyRequest.current = replyRequest;
  }, [replyRequest]);

  useEffect(() => {
    if (!replyDraftSeed || handledReplyDraftSeed.current === replyDraftSeed.revision) return;
    handledReplyDraftSeed.current = replyDraftSeed.revision;
    const proposed = replyDraftSeed.mode === "replace" || !draft.trim() ? replyDraftSeed.text : `${draft.trimEnd()}\n\n${replyDraftSeed.text}`;
    setAgentSuggestion({ original: draft, proposed, context: posting.id });
    setReplyExpanded(true);
  }, [replyDraftSeed]);

  const laterToggle = mailToggle("later", [posting.id], mailActions?.sourceBox ?? "imbox", [posting])!;
  const asideToggle = mailToggle("aside", [posting.id], mailActions?.sourceBox ?? "imbox", [posting])!;
  const bubbleToggle = mailToggle("bubble", [posting.id], mailActions?.sourceBox ?? "imbox", [posting])!;
  const readToggle = mailToggle("unread", [posting.id], mailActions?.sourceBox ?? "imbox", [posting])!;
  const entries = useMemo(() => (thread?.entries ?? []).map((entry) => ({
    ...entry,
    sender: enrichContactAvatar(entry.sender, posting.contacts),
  })), [posting.contacts, thread]);
  const participants = useMemo(() => {
    const contacts = entries.map((entry) => entry.sender);
    if (contacts.length === 0) contacts.push(enrichContactAvatar(posting.sender, posting.contacts));
    const seen = new Set<string>();
    return contacts.filter((contact) => {
      const key = contactIdentityKey(contact);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 6);
  }, [entries, posting.contacts, posting.sender]);
  const participantNames = participants.map((contact) => contact.name);
  const replyRecipient = entries.at(-1)?.sender ?? posting.sender;
  const displayError = error ?? threadError;
  const showPendingReply = Boolean(pendingReply && (!thread || !hasNewThreadEntry(pendingReply.previousThread, thread)));
  const olderEntries = entries.slice(0, -1);
  const selfEmail = currentMailEmail();
  const latestEntryId = entries.at(-1)?.id;
  const allOlderExpanded = olderEntries.length > 0 && olderEntries.every((entry) => expandedOlderEntries.has(entry.id));
  const writingThreadContext = useMemo(() => thread?.entries.slice(-4).map((entry) => `${entry.sender.name}: ${entry.body}`).join("\n\n").slice(0, 24_000), [thread]);

  useEffect(() => {
    if (embedded) return;
    if (entries.length === 0) return;
    const frame = requestAnimationFrame(() => latestEntryElement.current?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [embedded, entries.length, latestEntryId]);

  const toggleOlderEntry = (entryId: string) => {
    appSound.play(expandedOlderEntries.has(entryId) ? "collapse" : "expand", "interface");
    setExpandedOlderEntries((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  const handleReaderKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as { isContentEditable?: boolean; closest?: (selector: string) => Element | null } | null;
    if (target?.isContentEditable || target?.closest?.("input, textarea, select, button, a, [contenteditable='true']")) return;
    const scroll = threadScroll.current;
    if (!scroll) return;
    const intent = readerScrollIntent(event.key, event.shiftKey, scroll.clientHeight, scroll.scrollHeight);
    if (!intent) return;
    event.preventDefault();
    if (intent.kind === "to") scroll.scrollTo({ top: intent.top });
    else scroll.scrollBy({ top: intent.top });
  }, []);

  useEffect(() => {
    if (embedded) return;
    window.addEventListener("keydown", handleReaderKeyDown);
    return () => window.removeEventListener("keydown", handleReaderKeyDown);
  }, [embedded, handleReaderKeyDown]);

  const readerKeyDown = embedded && onReaderKeyDown ? onReaderKeyDown : handleReaderKeyDown;

  const openReply = () => {
    setReplyExpanded(true);
    requestAnimationFrame(() => requestAnimationFrame(() => replyInput.current?.focus()));
  };

  const collapseReply = () => {
    if (sending) return;
    setReplyExpanded(false);
    requestAnimationFrame(() => collapsedReplyButton.current?.focus());
  };

  const submitReply = async (saveAsDraft = false) => {
    if (submitting.current || !mailActions || !posting.topicId || sending || (!draft.trim() && attachments.length === 0)) return;
    submitting.current = true;
    setSending(true); setComposerError(undefined);
    try {
      const recipientsChanged = Boolean(replyContext) && (
        !sameRecipients(replyTo, contactAddresses(replyContext!.to))
        || !sameRecipients(replyCc, contactAddresses(replyContext!.cc))
        || !sameRecipients(replyBcc, contactAddresses(replyContext!.bcc))
      );
      const result = await window.heyAgent.mail.send({
        mode: "reply",
        topicId: posting.topicId,
        body: draft,
        attachments,
        saveAsDraft,
        ...(recipientsChanged ? { to: replyTo, cc: replyCc, bcc: replyBcc } : {}),
      });
      if (result.disposition === "sent" && thread) {
        setPendingReply({ body: draft, attachments, sentAt: new Date().toISOString(), previousThread: thread });
        requestAnimationFrame(() => requestAnimationFrame(() => pendingReplyElement.current?.scrollIntoView({ block: "nearest" })));
      }
      setDraft(""); setAttachments([]); setReplyExpanded(false); mailActions.onMailChanged(result, posting.topicId);
    } catch (reason) {
      setComposerError(reason instanceof Error ? reason.message : "HEY could not save this reply.");
    } finally { submitting.current = false; setSending(false); }
  };

  const chooseAttachments = async () => {
    const selected = await window.heyAgent.mail.selectAttachments();
    if (selected.length) appSound.play("drop", "interface");
    setAttachments((current) => [...new Set([...current, ...selected])]);
  };

  const replyKeys = useComposerKeyboard({
    "composer-write": () => writingAssistant.current?.open(),
    "composer-send": () => void submitReply(false),
    "composer-save": () => void submitReply(true),
    "composer-attach": () => { if (!sending) void chooseAttachments(); },
    "composer-cc": () => focusRecipient(replyRoot.current!, "Cc", () => setReplyCcVisible(true)),
    "composer-bcc": () => focusRecipient(replyRoot.current!, "Bcc", () => setReplyCcVisible(true)),
  }, collapseReply);

  return <section className={`panel thread-panel${embedded ? " read-together-thread" : ""}`} aria-label={`${posting.subject} conversation`}>
    {agentSuggestion && <DraftReviewDialog suggestion={agentSuggestion} currentValue={draft} context={posting.id} subject={posting.subject} disabled={sending}
      onDiscard={() => { setAgentSuggestion(undefined); requestAnimationFrame(() => replyInput.current?.focus()); }}
      onApply={(text) => {
        const issue = draftReviewIssue(agentSuggestion, replyInput.current?.value ?? draft, posting.id);
        if (issue) return issue;
        setDraft(text); setAgentSuggestion(undefined); appSound.play("drop", "interface");
        requestAnimationFrame(() => replyInput.current?.focus());
      }} />}
    {!embedded && <header className="panel-header thread-header">
      <button className="thread-back" type="button" data-tooltip={`Back to ${sourceLabel}`} data-shortcut-id="back" onClick={onClose}><ArrowLeft size={15} /><span>{sourceLabel}</span></button>
      {showTraversal && <div className="header-actions">
        <button className="icon-button" type="button" aria-label="Previous conversation" data-tooltip="Previous conversation" data-shortcut-id="previous" disabled={!hasPrevious} onClick={onPrevious}><ChevronUp size={16} /></button>
        <button className="icon-button" type="button" aria-label="Next conversation" data-tooltip="Next conversation" data-shortcut-id="next" disabled={!hasNext} onClick={onNext}><ChevronDown size={16} /></button>
      </div>}
    </header>}

    <div className="thread-content">
      <div ref={threadScroll} className="thread-scroll" tabIndex={embedded ? -1 : 0} aria-label="Conversation messages">
        <div className="message-heading thread-reading-column">
          <div className="thread-participants" aria-label={`Participants: ${participantNames.join(", ")}`}>
            <span className="participant-avatars" aria-hidden>{participants.map((contact) => <ContactAvatar key={contactIdentityKey(contact)} contact={contact} title={contact.name} />)}</span>
            <span>{participants.map((contact, index) => <Fragment key={contactIdentityKey(contact)}>{index > 0 && ", "}<ContactObjectLink contact={contact} onOpenObject={onOpenObject}>{contact.name}</ContactObjectLink></Fragment>)}</span>
          </div>
          <h1>{posting.subject}</h1>
          {(mailActions || onOrganize || supplementalActions || helperActions.length > 0) && <div className="message-actions">
            {mailActions && <>
            <button type="button" aria-expanded={replyExpanded} data-tooltip="Reply" data-shortcut-id="reply" onClick={openReply}><Reply size={14} /> Reply</button>
            <button type="button" aria-pressed={laterToggle.active} aria-label={laterToggle.label} data-tooltip={laterToggle.label} data-shortcut-id="later" onClick={() => mailActions.onMutate(laterToggle.request)}>{laterToggle.active ? <Check size={14} /> : <Clock3 size={14} />} Reply Later</button>
            <button type="button" aria-pressed={asideToggle.active} aria-label={asideToggle.label} data-tooltip={asideToggle.label} data-shortcut-id="aside" onClick={() => mailActions.onMutate(asideToggle.request)}>{asideToggle.active ? <Check size={14} /> : <FileClock size={14} />} Set Aside</button>
            </>}
            {(mailActions || onOrganize || helperActions.length > 0) &&
            <span className="message-menu">
              <button type="button" aria-label="More conversation actions" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><MoreHorizontal size={15} /></button>
              {menuOpen && <span className="message-menu-popover">
                {helperActions.map((action) => <button key={action.id} type="button" onClick={() => { setMenuOpen(false); onHelperAction?.(action.id); }}><Sparkles size={14} /> {action.title}</button>)}
                {helperActions.length > 0 && (olderEntries.length > 0 || onOrganize || mailActions) && <span className="message-menu-separator" aria-hidden />}
                {olderEntries.length > 0 && <button type="button" onClick={() => {
                  setMenuOpen(false);
                  appSound.play(allOlderExpanded ? "collapse" : "expand", "interface");
                  setExpandedOlderEntries(allOlderExpanded ? new Set() : new Set(olderEntries.map((entry) => entry.id)));
                }}><ChevronsUpDown size={14} /> {allOlderExpanded ? "Collapse older messages" : "Expand all messages"}</button>}
                {onOrganize && <button type="button" onClick={() => { setMenuOpen(false); onOrganize(); }}><Tag size={14} /> Labels &amp; Collections</button>}
                {mailActions && <>
                <button type="button" data-tooltip={readToggle.label} data-shortcut-id="unread" data-tooltip-side="left" onClick={() => { setMenuOpen(false); mailActions.onMutate(readToggle.request); }}>{readToggle.active ? <Eye size={14} /> : <EyeOff size={14} />} {readToggle.label}</button>
                <button type="button" data-tooltip="Forward" data-shortcut-id="forward" data-tooltip-side="left" onClick={() => { setMenuOpen(false); mailActions.onForward(); }}><Forward size={14} /> Forward</button>
                <button type="button" aria-pressed={bubbleToggle.active} data-tooltip={bubbleToggle.label} data-shortcut-id="bubble" data-tooltip-side="left" onClick={() => { setMenuOpen(false); mailActions.onMutate(bubbleToggle.request); }}><ArrowUpCircle size={14} /> {bubbleToggle.label}</button>
                <button type="button" onClick={() => { setMenuOpen(false); mailActions.onMutate({ operation: "bubble", postingIds: [posting.id], bubbleSchedule: "weekend", sourceBox: mailActions.sourceBox }); }}><ArrowUpCircle size={14} /> Bubble up this weekend</button>
                {posting.appUrl && <button type="button" onClick={() => { setMenuOpen(false); void window.heyAgent.system.openHeyUrl(posting.appUrl!); }}><ExternalLink size={14} /> Open in HEY</button>}
                <button type="button" onClick={() => { setMenuOpen(false); mailActions.onMutate({ operation: "ignore", postingIds: [posting.id] }); }}><BellOff size={14} /> Ignore thread</button>
                <button type="button" data-tooltip="Stop ignoring thread" data-shortcut-id="stop-ignoring" onClick={() => { setMenuOpen(false); mailActions.onMutate({ operation: "stop-ignoring", postingIds: [posting.id] }); }}><Bell size={14} /> Stop ignoring thread</button>
                <button type="button" data-tooltip="Move to Trash" data-shortcut-id="trash" data-tooltip-side="left" onClick={() => { setMenuOpen(false); mailActions.onMutate({ operation: "trash", postingIds: [posting.id], sourceBox: mailActions.sourceBox }); }}><Trash2 size={14} /> Trash</button>
                <button type="button" onClick={() => { setMenuOpen(false); mailActions.onMutate({ operation: "spam", postingIds: [posting.id], sourceBox: mailActions.sourceBox }); }}><ShieldAlert size={14} /> Mark spam</button>
                </>}
              </span>}
            </span>
            }
            {supplementalActions}
          </div>}
        </div>

        <div className="thread-entries">
          {!thread && !displayError && <div className="thread-loading thread-reading-column"><span />Loading conversation…</div>}
          {displayError && <div className="thread-notice thread-reading-column">{displayError}{threadError && posting.topicId && <button type="button" className="secondary-button" onClick={onRetryThread}>Try again</button>}</div>}
          {thread?.entries.length === 0 && <p className="message-body thread-reading-column">{posting.summary || "No message text was returned by HEY."}</p>}
          {thread?.attachmentsError && <div className="thread-notice thread-reading-column" role="alert">{thread.attachmentsError}{onRetryThread && <button type="button" className="secondary-button" onClick={onRetryThread}>Reload</button>}</div>}
          {olderEntries.length > 0 && <p className="thread-history-label thread-reading-column">{olderEntries.length} earlier {olderEntries.length === 1 ? "message" : "messages"}</p>}
          {entries.map((entry, index) => {
            const latest = index === entries.length - 1;
            const expanded = latest || expandedOlderEntries.has(entry.id);
            const senderName = contactLabel(entry.sender, selfEmail);
            const recipients = entryAddressedContacts(posting, entry, latest, entries.length);
            const sender = latest
              ? <ContactObjectLink contact={entry.sender} onOpenObject={onOpenObject} className="entry-sender-contact"><strong title={contactDetails(entry.sender)}>{senderName}</strong>{!recipients.length && entry.sender.email && <small>{entry.sender.email}</small>}</ContactObjectLink>
              : <><strong title={contactDetails(entry.sender)}>{senderName}</strong>{entry.sender.email && <small>{entry.sender.email}</small>}</>;
            const meta = <>
              <span className="entry-sender"><ContactAvatar className="entry-avatar" contact={entry.sender} />{sender}</span>
              {recipients.length > 0 && <span className="entry-recipient-summary" title={recipients.map(contactDetails).join(", ")}>→ {recipients.map((contact) => contactLabel(contact, selfEmail)).join(", ")}</span>}
              {!expanded && <span className="entry-preview">{entryPreview(entry.body, posting.summary)}</span>}
              <span className="entry-position">{index + 1} of {entries.length}</span>
              {!!entry.attachments?.length && <span className="entry-attachment-count" aria-label={`${entry.attachments.length} attachments`}><Paperclip size={13} aria-hidden="true" />{entry.attachments.length}</span>}
              <time dateTime={entry.occurredAt}>{formatEntryTime(entry.occurredAt)}</time>
              {!latest && <MorphingIcon className="entry-chevron" icon={expanded ? ChevronDownData : ChevronRightData} size={15} />}
            </>;
            return <article ref={latest ? latestEntryElement : undefined} key={entry.id} className={`thread-entry thread-reading-column ${expanded ? "is-expanded" : "is-collapsed"}`} data-latest={latest}>
              {latest
                ? <div className="entry-meta entry-disclosure">{meta}</div>
                : <button type="button" className="entry-meta entry-disclosure" aria-expanded={expanded} onClick={() => toggleOlderEntry(entry.id)}>{meta}</button>}
              {latest && recipients.length > 0 && <details className="entry-recipient-details">
                <summary>Recipients ({recipients.length})</summary>
                <ul>{recipients.map((contact, recipientIndex) => <li key={recipientIndex}>{contactDetails(contact)}</li>)}</ul>
              </details>}
              {expanded && <EmailBody entry={entry} onReaderKeyDown={readerKeyDown} onOpenObject={onOpenObject} />}
              {expanded && thread && <EmailAttachments topicId={thread.topicId} attachments={entry.attachments} />}
            </article>;
          })}
          {showPendingReply && pendingReply && <article ref={pendingReplyElement} className="thread-entry thread-reading-column pending-reply" aria-label="Sent reply syncing with HEY">
            <div className="entry-meta">
              <span className="entry-sender"><ContactAvatar className="entry-avatar" contact={{ name: "You", initials: "Y" }} /><strong>You</strong><small>Sent · syncing with HEY…</small></span>
              <time dateTime={pendingReply.sentAt}>{formatEntryTime(pendingReply.sentAt)}</time>
            </div>
            {pendingReply.body && <p className="message-body pending-reply-body">{pendingReply.body}</p>}
            {pendingReply.attachments.length > 0 && <div className="pending-reply-attachments">{pendingReply.attachments.map((path) => <span key={path}><Paperclip size={12} />{fileName(path)}</span>)}</div>}
          </article>}
        </div>
      </div>

      {mailActions && (replyExpanded ? <div ref={replyRoot} className="reply-composer thread-reply-composer is-expanded" onKeyDown={replyKeys}>
        <div className="composer-label reply-composer-heading">
          <span><Reply size={14} /><strong>Reply</strong></span>
          <button type="button" className="icon-button" aria-label="Collapse reply" data-tooltip="Collapse reply" data-shortcut="Esc" data-tooltip-side="top" onClick={collapseReply} disabled={sending}><X size={14} /></button>
        </div>
        {replyContext ? <div className="composer-fields reply-recipient-fields">
          <RecipientField label="To" value={replyTo} onChange={setReplyTo} contacts={replyContacts} placeholder="Name or email" collapseAfter={1} />
          {!replyCcVisible ? <button type="button" className="composer-recipients-toggle" data-tooltip="Show Cc / Bcc" data-shortcut={[hint("composer-cc"), hint("composer-bcc")].filter(Boolean).join(" / ")} onClick={() => setReplyCcVisible(true)}>Cc / Bcc</button> : <>
            <RecipientField label="Cc" value={replyCc} onChange={setReplyCc} contacts={replyContacts} placeholder="Name or email" collapseAfter={1} />
            <RecipientField label="Bcc" value={replyBcc} onChange={setReplyBcc} contacts={replyContacts} placeholder="Name or email" collapseAfter={1} />
          </>}
        </div> : <div className="reply-recipient-status">
          {replyContextError ? <><span>{replyContextError}</span>{replyContextRetryable && <button type="button" onClick={() => void loadReplyContext()}>Try again</button>}</> : <span>Loading reply recipients…</span>}
        </div>}
        <textarea ref={replyInput} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write your reply…" />
        {attachments.length > 0 && <div className="composer-attachments compact">{attachments.map((path) => <span key={path}><Paperclip size={12} /> {fileName(path)} <button type="button" aria-label={`Remove ${fileName(path)}`} onClick={() => { appSound.play("deselect", "interface"); setAttachments((current) => current.filter((item) => item !== path)); }}><X size={11} /></button></span>)}</div>}
        {composerError && <p className="composer-error compact">{composerError}</p>}
        <div className="composer-actions">
          <button className="icon-button" type="button" aria-label="Attach file" disabled={sending} data-tooltip="Attach file" data-shortcut={hint("composer-attach")} onClick={() => void chooseAttachments()}><Paperclip size={15} /></button>
          <ComposerWritingAssistant disabled={sending} ref={writingAssistant} value={draft} onChange={setDraft} textareaRef={replyInput} mode="reply" subject={posting.subject} recipients={[replyTo, replyCc, replyBcc].filter(Boolean).join(", ")} threadContext={writingThreadContext} />
          {onContinueInAgent && <button className="composer-agent-button" type="button" data-tooltip={continueInAgentLabel} data-tooltip-side="top" onClick={() => onContinueInAgent(draft)}><Sparkles size={14} /><span>{continueInAgentLabel}</span></button>}
          <button className="composer-draft-button" type="button" data-tooltip="Save draft" data-shortcut={hint("composer-save")} data-tooltip-side="top" onClick={() => void submitReply(true)} disabled={sending || !posting.topicId || (!draft.trim() && attachments.length === 0)}><Save size={14} /><span>Save draft</span></button>
          <span />
          <small>{hint("composer-send")}</small>
          <button className="send-button" type="button" data-tooltip="Send reply" data-shortcut={hint("composer-send")} data-tooltip-side="top" onClick={() => void submitReply(false)} disabled={sending || !posting.topicId || (!draft.trim() && attachments.length === 0)}><Send size={14} /> {sending ? "Sending…" : "Send"}</button>
        </div>
      </div> : <button ref={collapsedReplyButton} type="button" className="thread-reply-collapsed" data-tooltip="Open reply" data-shortcut-id="reply" aria-expanded="false" onClick={openReply}>
        <Reply size={15} />
        <span><strong>{draft.trim() || attachments.length ? "Continue reply" : "Reply"}</strong><small>{draft.trim() || attachments.length ? "Unsaved reply" : `To ${replyRecipient?.name ?? "conversation"}`}</small></span>
        {hint("reply") && <kbd>{hint("reply")}</kbd>}
      </button>)}
    </div>
  </section>;
}
