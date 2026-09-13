import { ArrowLeft, Inbox, LoaderCircle, MailOpen, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { activateMailRow } from "../mail-row-keyboard";
import type { ImboxPosting, MailThreadListing } from "../../../shared/contracts";
import { appSound } from "../sound";
import ContactAvatar from "./ContactAvatar";
import { isShortcutEvent } from "../../../shared/shortcut-binding";
import { isEditingEvent, isLocalKeyboardEvent } from "../../../shared/keyboard-scope";

type ThreadListingViewProps = {
  listing?: MailThreadListing;
  loading: boolean;
  error?: string;
  onBack: () => void;
  onOpen: (posting: ImboxPosting) => void;
  onRetry: () => void;
  onShowAll?: () => void;
};

const EMPTY_POSTINGS: ImboxPosting[] = [];

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

export default function ThreadListingView({ listing, loading, error, onBack, onOpen, onRetry, onShowAll }: ThreadListingViewProps) {
  const [highlightedId, setHighlightedId] = useState<string>();
  const panelRef = useRef<HTMLElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const postings = listing?.postings ?? EMPTY_POSTINGS;
  useEffect(() => { setHighlightedId((current) => current && postings.some((item) => item.id === current) ? current : postings[0]?.id); }, [postings]);
  const highlightedIndex = useMemo(() => postings.findIndex((item) => item.id === highlightedId), [highlightedId, postings]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isShortcutEvent(event, ["ArrowDown", "ArrowUp", "j", "k"].includes(event.key)) || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (!panelRef.current?.contains(document.activeElement) && document.activeElement !== document.body) return;
      const target = event.target as HTMLElement | null;
      if (isEditingEvent(event) || isLocalKeyboardEvent(event)) return;
      const key = event.key.toLowerCase();
      if (event.key === "Escape") { event.preventDefault(); onBack(); return; }
      // Native activation belongs to the focused row or header control.
      if (key === "enter" && target?.closest("button, a[href]")) return;
      if (!["arrowdown", "arrowup", "j", "k", "enter"].includes(key)) return;
      event.preventDefault();
      if (key === "enter" && highlightedIndex >= 0) { onOpen(postings[highlightedIndex]!); return; }
      const delta = key === "arrowdown" || key === "j" ? 1 : -1;
      const next = Math.max(0, Math.min(postings.length - 1, (highlightedIndex < 0 ? 0 : highlightedIndex) + delta));
      const posting = postings[next];
      if (!posting) return;
      appSound.play("hover", "interface", { cooldownMs: 70, retrigger: "restart" });
      setHighlightedId(posting.id);
      rowRefs.current.get(posting.id)?.focus();
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [highlightedIndex, onBack, onOpen, postings]);

  return <section ref={panelRef} className="panel thread-listing-panel" aria-label={listing?.title ?? "HEY conversations"}>
    <header className="panel-header thread-listing-header">
      <button autoFocus type="button" className="calendar-back" onClick={onBack}><ArrowLeft size={15} />Back</button>
      <div>{listing ? <><ContactAvatar contact={listing.contact} /><span><strong>{listing.title}</strong><small>{listing.contact.email}</small></span></> : <strong>Conversations</strong>}</div>
      <button type="button" className="icon-button" aria-label="Refresh conversations" onClick={onRetry} disabled={loading}><RefreshCw size={15} className={loading ? "is-spinning" : undefined} /></button>
    </header>
    <div className="thread-listing-body" role="listbox" aria-busy={loading} aria-activedescendant={highlightedId ? `thread-listing-${highlightedId}` : undefined}>
      {loading && !listing && <div className="thread-listing-loading"><LoaderCircle className="is-spinning" size={16} />Reading HEY conversations…</div>}
      {error && <div className="empty-state"><Inbox size={18} /><h2>These conversations could not be read</h2><p>{error}</p><button type="button" className="primary-button" onClick={onRetry}>Try again</button></div>}
      {!loading && !error && listing && postings.length === 0 && <div className="empty-state"><MailOpen size={18} /><h2>No unseen conversations</h2><p>This bundle has been read through. The contact’s complete history is still available.</p>{onShowAll && <button type="button" className="primary-button" onClick={onShowAll}>Show all conversations</button>}</div>}
      {!error && postings.map((posting) => <button id={`thread-listing-${posting.id}`} data-posting-id={posting.id} ref={(node) => { if (node) rowRefs.current.set(posting.id, node); else rowRefs.current.delete(posting.id); }} type="button" role="option" aria-selected={highlightedId === posting.id} key={posting.id} className="thread-listing-row" onFocus={() => setHighlightedId(posting.id)} onClick={() => onOpen(posting)} onKeyDown={(event) => activateMailRow(event, () => onOpen(posting))}>
        <ContactAvatar contact={posting.sender} />
        <span><strong>{posting.subject}</strong><small>{posting.summary || posting.sender.name}</small></span>
        <time>{formatDate(posting.createdAt)}</time>
      </button>)}
    </div>
    <footer className="list-footer"><span><kbd>j</kbd><kbd>k</kbd> move <kbd>Enter</kbd> open <kbd>Esc</kbd> back</span></footer>
  </section>;
}
