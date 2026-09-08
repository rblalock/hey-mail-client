import { Check, CircleAlert, ExternalLink, Inbox, Newspaper, ReceiptText, RefreshCw, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { matchesBindingStep } from "../../../shared/shortcut-binding";
import { isEditableTarget } from "../shortcuts";
import type { AgentObjectLink, MailThread, MailboxKey, ScreenerEntry, ScreenerResult } from "../../../shared/contracts";
import { screenerPosting } from "../screener-posting";
import { appSound } from "../sound";
import ContactAvatar from "./ContactAvatar";
import ThreadPanel from "./ThreadPanel";

type ScreenerViewProps = { onNotice: (message: string) => void; onOpenObject?: (object: AgentObjectLink) => void };

const DESTINATIONS: Array<{ box: MailboxKey; label: string; icon: typeof Inbox }> = [
  { box: "imbox", label: "Imbox", icon: Inbox },
  { box: "feedbox", label: "The Feed", icon: Newspaper },
  { box: "trailbox", label: "Paper Trail", icon: ReceiptText },
];

export default function ScreenerView({ onNotice, onOpenObject }: ScreenerViewProps) {
  const [result, setResult] = useState<ScreenerResult>();
  const [selected, setSelected] = useState<ScreenerEntry>();
  const [thread, setThread] = useState<MailThread>();
  const [threadError, setThreadError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string>();
  const [choosingId, setChoosingId] = useState<string>();
  const threadSequence = useRef(0);

  const refresh = async () => {
    setLoading(true);
    try { setResult(await window.heyAgent.mail.listScreener()); }
    catch (reason) { setResult({ status: "unavailable", entries: [], detail: reason instanceof Error ? reason.message : "HEY could not load The Screener." }); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const closeReader = useCallback(() => {
    const id = selected?.id;
    appSound.play("back", "interface");
    threadSequence.current += 1;
    setSelected(undefined); setThread(undefined); setThreadError(undefined);
    requestAnimationFrame(() => {
      if (id) document.querySelector<HTMLButtonElement>(`.screener-copy[data-screener-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    });
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    const keyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !matchesBindingStep(event, "escape") || isEditableTarget(event.target)) return;
      if (!(event.target instanceof Element) || !event.target.closest(".thread-panel")) return;
      if (document.querySelector('[role="dialog"], [aria-modal="true"], [role="menu"]')) return;
      event.preventDefault();
      closeReader();
    };
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, [closeReader, selected]);

  const open = (entry: ScreenerEntry) => {
    appSound.play("open", "interface");
    const sequence = threadSequence.current + 1;
    threadSequence.current = sequence;
    setSelected(entry); setThread(undefined); setThreadError(undefined);
    void window.heyAgent.mail.readThread(entry.topicId).then((result) => {
      if (threadSequence.current === sequence) setThread(result);
    }).catch((reason: unknown) => {
      if (threadSequence.current === sequence) setThreadError(reason instanceof Error ? reason.message : "Unable to read this conversation.");
    });
  };

  const decide = async (entry: ScreenerEntry, decision: "approve" | "deny", destination?: MailboxKey, spam = false) => {
    if (decision === "deny" && !window.confirm(spam ? `Say No to ${entry.sender.name} and mark this as spam? This trains HEY's filters.` : `Say No to ${entry.sender.name}? Their current and future email won't appear in HEY.`)) return;
    setWorkingId(entry.id);
    try {
      const response = await window.heyAgent.mail.decideScreener({ id: entry.id, decision, ...(destination ? { destination } : {}), ...(spam ? { spam: true } : {}) });
      appSound.play(spam ? "warning" : "streak", "mail");
      onNotice(response.message);
      setChoosingId(undefined);
      if (selected?.id === entry.id) { setSelected(undefined); setThread(undefined); setThreadError(undefined); }
      await refresh();
    } catch (reason) { appSound.play("error", "mail"); onNotice(reason instanceof Error ? reason.message : "HEY could not update The Screener."); }
    finally { setWorkingId(undefined); }
  };

  if (selected) {
    return <ThreadPanel
      posting={screenerPosting(selected)}
      thread={thread}
      threadError={threadError}
      sourceLabel="The Screener"
      supplementalActions={<>
        <button type="button" onClick={() => void window.heyAgent.system.openHeyUrl(`https://app.hey.com/topics/${selected.topicId}`)}><ExternalLink size={14} /> Open in HEY</button>
        <button type="button" className="is-danger" onClick={() => void decide(selected, "deny", undefined, true)} disabled={workingId === selected.id}>This is spam</button>
      </>}
      onRefresh={() => void refresh()}
      onRetryThread={() => open(selected)}
      replyRequest={0}
      onClose={closeReader}
      onPrevious={() => undefined}
      onNext={() => undefined}
      hasPrevious={false}
      hasNext={false}
      showTraversal={false}
      onOpenObject={onOpenObject}
    />;
  }

  return <section className="panel screener-panel" aria-label="The Screener">
    <header className="panel-header"><div className="title-cluster"><h1>The Screener</h1><span className="title-count">{result?.entries.length ?? 0}</span></div><button type="button" className="icon-button" aria-label="Refresh The Screener" data-tooltip="Refresh The Screener" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} className={loading ? "is-spinning" : ""} /></button></header>
    <div className="screener-layout">
      <div className="screener-queue">
        {result?.status === "ready" && result.entries.length > 0 && <div className="screener-question"><span className="screener-thumbs" aria-hidden><ThumbsUp size={16} /><ThumbsDown size={16} /></span><h2>Want to get emails from them?</h2></div>}
        {result?.status !== "ready" && <div className="empty-state"><CircleAlert size={20} /><h2>The Screener is unavailable</h2><p>{result?.detail}</p></div>}
        {!loading && result?.status === "ready" && result.entries.length === 0 && <div className="empty-state"><Check size={20} /><h2>All screened</h2><p>No first-time senders are waiting for you.</p></div>}
        {result?.entries.map((entry) => <article key={entry.id} className="screener-row">
          <div className="screener-choice" aria-label={`Screen ${entry.sender.name}`}>
            <button type="button" className="is-yes" aria-expanded={choosingId === entry.id} onClick={() => { appSound.play(choosingId === entry.id ? "collapse" : "expand", "interface"); setChoosingId((current) => current === entry.id ? undefined : entry.id); }} disabled={workingId === entry.id}><ThumbsUp size={18} /><span>Yes</span></button>
            <button type="button" className="is-no" onClick={() => void decide(entry, "deny")} disabled={workingId === entry.id}><ThumbsDown size={18} /><span>No</span></button>
          </div>
          <button type="button" className="screener-copy" data-screener-id={entry.id} onClick={() => open(entry)}><ContactAvatar className="sender-avatar" contact={entry.sender} /><span><strong>{entry.sender.name}</strong><small>{entry.sender.email}</small><b>{entry.subject}</b><p>{entry.summary}</p></span></button>
          {choosingId === entry.id && <div className="screener-destination-popover" role="group" aria-label={`Deliver email from ${entry.sender.name} to`}>
            <header><strong>Screen in and deliver to…</strong><button type="button" aria-label="Close destination choices" onClick={() => setChoosingId(undefined)}><X size={14} /></button></header>
            <div>{DESTINATIONS.map(({ box, label, icon: Icon }) => <button key={box} type="button" disabled={workingId === entry.id} onClick={() => void decide(entry, "approve", box)}><Icon size={18} /><span>{label}</span></button>)}</div>
          </div>}
        </article>)}
      </div>
    </div>
  </section>;
}
