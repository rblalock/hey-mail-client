import { ArrowUpCircle, BellOff, Check, Circle, Clock3, Eye, EyeOff, FileClock, FolderKanban, FolderPlus, Inbox, Layers3, MoreHorizontal, Newspaper, RefreshCw, Reply, Rows3, Search, Sparkles, Tag, ThumbsDown, ThumbsUp, Trash2, Ungroup } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Bell } from "lucide-react";
import type { ImboxPosting, ImboxResult, MailboxKey, MailOrganizationKind, MailOverview, SetAsideGroupMutationRequest } from "../../../shared/contracts";
import type { ShortcutId } from "../shortcuts";
import { appSound } from "../sound";
import { groupImboxPostings } from "../mailbox-navigation";
import { mailDayHeaders } from "../mail-days";
import { mailToggle } from "../mail-toggles";
import { paperTrailVisitBoundary, usePaperTrailVisit } from "../mailbox-visits";
import ContactAvatar from "./ContactAvatar";
import { enrichContactAvatar } from "../contact-avatar";
import { addressedContacts, contactDetails, contactLabel, currentMailEmail, isOwnMail } from "../mail-presentation";
import { useShortcutHints } from "../shortcut-context";

type ImboxViewProps = {
  mailboxKey: MailboxKey;
  result?: ImboxResult;
  overview?: MailOverview;
  loading: boolean;
  searchRequest: number;
  focusSection?: "new" | "previous";
  selectedId?: string;
  bulkSelectedIds: string[];
  bulkBusy: boolean;
  commandPaletteOpen: boolean;
  onSelect: (posting: ImboxPosting) => void;
  onHighlight: (id: string) => void;
  onToggleSelection: (posting: ImboxPosting) => void;
  onBulkAction: (id: ShortcutId) => void;
  helperActions?: Array<{ id: ShortcutId; title: string }>;
  onReadTogether: () => void;
  onReplyTogether: () => void;
  onOrganizeSelection: (kind: MailOrganizationKind) => void;
  onClearSelection: () => void;
  onRefresh: () => void;
  onNavigate: (route: string) => void;
  setAsideGroupTarget?: string;
  onSetAsideGroup: (request: SetAsideGroupMutationRequest) => void;
  hidden?: boolean;
  showSenderAvatars?: boolean;
};

function formatDate(value: string, dayGrouped = false): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (dayGrouped || date.toDateString() === now.toDateString()) return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

export function mailboxEmptyCopy(boxName: string, imbox: boolean, filtered: boolean): { title: string; detail: string } {
  if (filtered) return { title: "No matching conversations", detail: "Try a sender, subject, or phrase from the message." };
  if (imbox) return { title: "Imbox zero", detail: "Nothing is asking for your attention." };
  return { title: `${boxName} is empty`, detail: `There are no conversations in ${boxName}.` };
}

function MailRow({ posting, selectedId, bulkSelected, imbox, dayGrouped, showSenderAvatars, onSelect, onHighlight, onToggleSelection }: { posting: ImboxPosting; selectedId?: string; bulkSelected: boolean; imbox: boolean; dayGrouped: boolean; showSenderAvatars: boolean; onSelect: (posting: ImboxPosting) => void; onHighlight: (id: string) => void; onToggleSelection: (posting: ImboxPosting) => void }) {
  const selectHint = useShortcutHints()("select");
  const selfEmail = currentMailEmail();
  const own = isOwnMail(posting.sender, selfEmail);
  const recipients = own ? addressedContacts(posting) : [];
  const sender = contactLabel(posting.sender, selfEmail);
  const senderTitle = [contactDetails(posting.sender), recipients.length ? `Recipients: ${recipients.map(contactDetails).join(", ")}` : ""].filter(Boolean).join("\n");
  const selected = posting.id === selectedId;
  const bubbledUp = imbox && posting.bubbledUp === true;
  const clickRow = (event: MouseEvent<HTMLButtonElement>) => {
    if ((event.target as Element).closest("[data-bulk-toggle]")) onToggleSelection(posting);
    else onSelect(posting);
  };
  const previewHover = () => appSound.play("hover", "interface", { cooldownMs: 70, retrigger: "restart" });
  return <button id={`mail-row-${posting.id}`} type="button" role="option" aria-current={selected || undefined} aria-selected={bulkSelected} aria-keyshortcuts={selectHint && !selectHint.includes(" then ") ? selectHint : undefined} className="mail-row" data-posting-id={posting.id} data-selected={selected} data-bulk-selected={bulkSelected} data-unseen={!posting.seen && !bubbledUp} onFocus={() => onHighlight(posting.id)} onPointerEnter={previewHover} onClick={clickRow}>
    <span className="mail-state-cell" data-bulk-toggle data-tooltip={bulkSelected ? "Remove from selection" : "Select conversation"} data-shortcut-id="select">
      <span className="mail-selection-mark" data-checked={bulkSelected}>{bulkSelected && <Check size={12} />}</span>
      {!bulkSelected && (bubbledUp ? <span className="bubbled-up-mark" title="Bubbled Up"><ArrowUpCircle size={16} aria-label="Bubbled Up" /></span> : !posting.seen && <span className="unseen-dot" title="Unseen" />)}
    </span>
    <span className="sender-cell">
      {showSenderAvatars && <ContactAvatar className="sender-avatar" contact={enrichContactAvatar(posting.sender, posting.contacts)} />}
      <span className="sender-copy" title={senderTitle}>
        <strong>{sender}{recipients[0] ? ` → ${contactLabel(recipients[0], selfEmail)}` : ""}</strong>
        {recipients.length > 1 && <span className="recipient-count">+{recipients.length - 1}</span>}
      </span>
    </span>
    <span className="conversation-cell">
      <span className="subject-line"><strong title={posting.subject}>{posting.subject}</strong>{posting.kind === "bundle" && <Layers3 size={12} aria-label="Contact bundle" />}{posting.visibleEntryCount > 1 && <span className="entry-count" title={`${posting.visibleEntryCount} ${posting.kind === "bundle" ? "items" : "messages"}`} aria-label={`${posting.visibleEntryCount} ${posting.kind === "bundle" ? "items" : "messages"}`}>({posting.visibleEntryCount})</span>}</span>
      {posting.summary && <span className="summary-line">— {posting.summary}</span>}
    </span>
    <span className="updated-cell"><time dateTime={posting.createdAt} title={posting.createdAt && Number.isFinite(Date.parse(posting.createdAt)) ? new Date(posting.createdAt).toLocaleString() : undefined}>{formatDate(posting.createdAt, dayGrouped)}</time></span>
  </button>;
}

export default function ImboxView({ mailboxKey, result, overview, loading, searchRequest, focusSection = "new", selectedId, bulkSelectedIds, bulkBusy, commandPaletteOpen, onSelect, onHighlight, onToggleSelection, onBulkAction, helperActions = [], onReadTogether, onReplyTogether, onOrganizeSelection, onClearSelection, onRefresh, onNavigate, setAsideGroupTarget, onSetAsideGroup, hidden = false, showSenderAvatars = false }: ImboxViewProps) {
  const hint = useShortcutHints();
  const [query, setQuery] = useState("");
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const previousRef = useRef<HTMLDivElement>(null);
  const bulkMenu = useRef<HTMLSpanElement>(null);
  const isImbox = result?.boxKey === "imbox";
  const postings = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return result?.postings ?? [];
    return (result?.postings ?? []).filter((posting) => [posting.subject, posting.summary, ...posting.contacts.flatMap((contact) => [contact.name, contact.email ?? ""])].some((value) => value.toLowerCase().includes(normalized)));
  }, [query, result]);
  const sections = groupImboxPostings(postings);
  const dayGrouped = mailboxKey === "feedbox" || mailboxKey === "trailbox";
  const dayHeaders = dayGrouped ? mailDayHeaders(postings) : new Map<string, string>();
  const showSections = isImbox && result?.status === "ready" && !query.trim() && postings.length > 0;
  const isSetAside = result?.boxKey === "asidebox" && !query;
  const trailVisit = usePaperTrailVisit(mailboxKey, result, hidden, loading);
  const visitBoundary = result?.status === "ready" && !query.trim() ? paperTrailVisitBoundary(postings, trailVisit?.cutoff) : undefined;
  const setAsideGroups = useMemo(() => {
    const groups = new Map<string, ImboxPosting[]>();
    const ungrouped: ImboxPosting[] = [];
    for (const posting of postings) {
      if (!posting.boxGroupId) { ungrouped.push(posting); continue; }
      groups.set(posting.boxGroupId, [...(groups.get(posting.boxGroupId) ?? []), posting]);
    }
    return { groups: [...groups.entries()], ungrouped };
  }, [postings]);
  const emptyCopy = mailboxEmptyCopy(result?.boxName ?? "Mailbox", isImbox, Boolean(query));

  useEffect(() => { if (searchRequest > 0) searchRef.current?.focus(); }, [searchRequest]);
  useEffect(() => {
    if (focusSection === "previous" && isImbox) requestAnimationFrame(() => previousRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }, [focusSection, isImbox]);
  useEffect(() => {
    if (!selectedId || hidden) return;
    const row = document.getElementById(`mail-row-${selectedId}`);
    // Escape returns focus to a row. Keep native Enter/Space on the same row
    // as J/K, arrow-key and range-selection navigation, without stealing focus
    // from search, toolbar controls or another pane.
    if (document.activeElement?.matches(".mail-row")) row?.focus({ preventScroll: true });
    const frame = requestAnimationFrame(() => row?.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [hidden, selectedId]);
  useEffect(() => {
    if (!bulkMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!bulkMenu.current?.contains(event.target as Node)) setBulkMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setBulkMenuOpen(false);
      document.getElementById("bulk-actions-menu-button")?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [bulkMenuOpen]);
  useEffect(() => { if (bulkSelectedIds.length === 0) setBulkMenuOpen(false); }, [bulkSelectedIds.length]);
  useEffect(() => { if (commandPaletteOpen) setBulkMenuOpen(false); }, [commandPaletteOpen]);
  useEffect(() => {
    if (!setAsideGroupTarget || hidden) return;
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-set-aside-group="${CSS.escape(setAsideGroupTarget)}"]`)?.scrollIntoView({ block: "start" }));
  }, [hidden, setAsideGroupTarget, postings]);

  const bulkSelection = useMemo(() => new Set(bulkSelectedIds), [bulkSelectedIds]);
  const renderRows = (rows: ImboxPosting[]) => rows.map((posting) => <Fragment key={posting.id}>
    {dayHeaders.has(posting.id) && <div className="mail-day-heading" role="separator" aria-label={dayHeaders.get(posting.id)}><span>{dayHeaders.get(posting.id)}</span></div>}
    <MailRow showSenderAvatars={showSenderAvatars} posting={posting} selectedId={selectedId} bulkSelected={bulkSelection.has(posting.id)} imbox={isImbox} dayGrouped={dayGrouped} onSelect={onSelect} onHighlight={onHighlight} onToggleSelection={onToggleSelection} />
  </Fragment>);
  const selectedPostings = postings.filter((posting) => bulkSelection.has(posting.id));
  const selectionToggle = (id: ShortcutId) => mailToggle(id, bulkSelectedIds, mailboxKey, selectedPostings);
  const selectedGrouped = selectedPostings.some((posting) => Boolean(posting.boxGroupId));
  const renderSetAsideRows = () => <div className="set-aside-groups">
    {setAsideGroups.groups.map(([groupId, rows], index) => <section key={groupId} className="set-aside-group" data-set-aside-group={groupId} data-targeted={setAsideGroupTarget === groupId || undefined}>
      <header><span><Layers3 size={13} /><strong>Group {index + 1}</strong><small>{rows.length} {rows.length === 1 ? "conversation" : "conversations"}</small></span><span>{bulkSelectedIds.length > 0 && <button type="button" className="toolbar-button" disabled={bulkBusy || selectedPostings.every((posting) => posting.boxGroupId === groupId)} onClick={() => onSetAsideGroup({ action: "add", postingIds: bulkSelectedIds, groupId })}><FolderPlus size={13} />Add selected</button>}<button type="button" className="icon-button" aria-label={`Dissolve Set Aside group ${index + 1}`} data-tooltip="Dissolve group" disabled={bulkBusy} onClick={() => onSetAsideGroup({ action: "delete", groupId })}><Ungroup size={14} /></button></span></header>
      {renderRows(rows)}
    </section>)}
    {setAsideGroups.ungrouped.length > 0 && <section className="set-aside-group is-ungrouped"><header><span><strong>Not grouped</strong><small>{setAsideGroups.ungrouped.length} {setAsideGroups.ungrouped.length === 1 ? "conversation" : "conversations"}</small></span></header>{renderRows(setAsideGroups.ungrouped)}</section>}
  </div>;

  return <section className="panel imbox-panel" aria-label={result?.boxName ?? "Mail"} hidden={hidden}>
    <header className="panel-header imbox-titlebar">
      <div className="title-cluster"><h1>{result?.boxName ?? "Mail"}</h1>{!isImbox && <span className="title-count">{result?.postings.length ?? 0}</span>}</div>
      <div className="imbox-header-tools"><label className="mail-search" data-tooltip={`Search ${result?.boxName ?? "mail"}`}><Search size={15} /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${result?.boxName ?? "mail"}`} /></label></div>
      <div className="header-actions"><button className="icon-button" type="button" aria-label={`Refresh ${result?.boxName ?? "mail"}`} data-tooltip={`Refresh ${result?.boxName ?? "mail"}`} onClick={onRefresh} disabled={loading}><RefreshCw size={15} className={loading ? "is-spinning" : ""} /></button></div>
    </header>
    <div className="mail-list" data-imbox={isImbox} role="listbox" aria-label={`${result?.boxName ?? "Mail"} conversations`} aria-activedescendant={selectedId ? `mail-row-${selectedId}` : undefined}>
      {loading && !result && <div className="loading-list">{Array.from({ length: 7 }, (_, index) => <div className="loading-row" key={index} />)}</div>}
      {!loading && result?.status !== "ready" && <div className="empty-state"><span className="empty-mark"><Circle size={18} /></span><h2>{result?.status === "needs-auth" ? "HEY needs your sign-in" : "Mailbox unavailable"}</h2><p>{result?.detail ?? "Check the local HEY CLI and try again."}</p><button type="button" className="primary-button" onClick={onRefresh}>Try again</button></div>}

      {isImbox && !query && Boolean(overview?.screener.entries.length) && <button type="button" className="imbox-screener-callout" onClick={() => onNavigate("screener")}><span><span className="screener-thumbs" aria-hidden><ThumbsUp size={15} /><ThumbsDown size={15} /></span><strong>Screen {overview!.screener.entries.length} first-time {overview!.screener.entries.length === 1 ? "sender" : "senders"}</strong></span></button>}

      {showSections && sections.bubbledUp.length > 0 && <div className="imbox-section is-bubbled" role="group" aria-label="Bubbled Up"><div className="imbox-section-heading" data-section="bubbled"><span>Bubbled Up</span><em>{sections.bubbledUp.length}</em></div>{renderRows(sections.bubbledUp)}</div>}
      {showSections && <div className="imbox-section-heading" data-section="new"><span>New For You</span><em>{sections.newForYou.length}</em></div>}
      {isSetAside ? renderSetAsideRows() : visitBoundary !== undefined ? <>
        {renderRows(postings.slice(0, visitBoundary))}
        <div className="mail-visit-divider" role="separator" aria-label="New since you last visited" title="Since your previous Paper Trail visit in HEY Agent. Tracked separately for this account on this device, not synced with HEY."><span>New since you last visited</span></div>
        {renderRows(postings.slice(visitBoundary))}
      </> : renderRows(showSections ? sections.newForYou : postings)}
      {trailVisit?.saved === false && <p className="mail-visit-notice" role="status">Visit tracking couldn’t be saved on this device. The divider may be out of date next time. Restart HEY Agent to retry.</p>}
      {!loading && result?.status === "ready" && postings.length === 0 && <div className="empty-state"><span className="empty-mark is-done"><Check size={18} /></span><h2>{emptyCopy.title}</h2><p>{emptyCopy.detail}</p></div>}

      {showSections && <div ref={previousRef} className="imbox-section is-previous" role="group" aria-label="Previously Seen"><div className="imbox-section-heading" data-section="previous"><span>Previously Seen</span><em>{sections.previouslySeen.length}</em></div>{sections.previouslySeen.length ? renderRows(sections.previouslySeen) : <p className="imbox-section-empty">Seen conversations stay here in Imbox.</p>}</div>}

      {isImbox && !query && overview && overview.replyLater.count > 0 && <section className="imbox-reply-later" aria-label="Reply Later">
        <button type="button" data-tooltip={`Open ${overview.replyLater.count} Reply Later ${overview.replyLater.count === 1 ? "conversation" : "conversations"}`} data-shortcut-id="nav-later" data-tooltip-side="top" onClick={() => onNavigate("reply-later")}>
          <span className="reply-later-mark" aria-hidden><Reply size={19} /><Clock3 size={11} /></span>
          <span className="reply-later-card">
            <ContactAvatar className="sender-avatar" contact={overview.replyLater.latest?.sender ?? { name: "Reply Later", initials: "RL" }} />
            <span className="reply-later-copy"><strong>{overview.replyLater.latest?.subject ?? "Reply Later"}</strong><small>{overview.replyLater.latest?.sender.name ?? `${overview.replyLater.count} conversations`}</small></span>
          </span>
        </button>
      </section>}
    </div>
    {bulkSelectedIds.length > 0 ? <div id="bulk-action-bar" className="bulk-action-bar" role="toolbar" aria-label={`${bulkSelectedIds.length} selected conversations`}>
      <strong>{bulkBusy ? `Updating ${bulkSelectedIds.length}…` : `${bulkSelectedIds.length} selected`}</strong>
      {isSetAside && <button type="button" className="primary-button" onClick={() => onSetAsideGroup({ action: "create", postingIds: bulkSelectedIds })} disabled={bulkBusy}><FolderPlus size={14} /> New group</button>}
      {isSetAside && <button type="button" className="toolbar-button" onClick={() => onSetAsideGroup({ action: "remove", postingIds: bulkSelectedIds })} disabled={bulkBusy || !selectedGrouped}><Ungroup size={14} /> Ungroup</button>}
      <button data-tooltip="Read Together" data-shortcut-id="read-together" type="button" className="primary-button" onClick={onReadTogether} disabled={bulkBusy}><Rows3 size={14} /> Read Together {hint("read-together") && <kbd>{hint("read-together")}</kbd>}</button>
      <button data-tooltip="Reply Together" data-shortcut-id="reply-together" type="button" className="toolbar-button bulk-reply-button" onClick={onReplyTogether} disabled={bulkBusy || bulkSelectedIds.length < 2}><Reply size={14} /><span>Reply Together</span>{hint("reply-together") && <kbd>{hint("reply-together")}</kbd>}</button>
      <span ref={bulkMenu} className="bulk-actions-menu" onKeyDown={(event) => {
        if (!bulkMenuOpen || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const items = [...(bulkMenu.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? [])];
        if (items.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
          : event.key === "ArrowDown" ? (current + 1 + items.length) % items.length
          : (current - 1 + items.length) % items.length;
        items[next]?.focus();
      }}>
        <button data-tooltip="More actions" data-shortcut-id="bulk-actions" id="bulk-actions-menu-button" type="button" className="toolbar-button bulk-more-button" aria-haspopup="menu" aria-expanded={bulkMenuOpen} onClick={() => setBulkMenuOpen((value) => !value)} disabled={bulkBusy}><MoreHorizontal size={15} /><span>More</span>{hint("bulk-actions") && <kbd>{hint("bulk-actions")}</kbd>}</button>
        {bulkMenuOpen ? <span className="bulk-actions-popover" role="menu" aria-label={`Actions for ${bulkSelectedIds.length} selected conversations`}>
          {helperActions.map((action) => <button key={action.id} type="button" role="menuitem" onClick={() => { setBulkMenuOpen(false); onBulkAction(action.id); }}><Sparkles size={14} /><span>{action.title}</span></button>)}
          {helperActions.length > 0 && <span className="bulk-menu-separator" role="separator" />}
          <button data-tooltip="Label selection" data-shortcut-id="bulk-label" type="button" role="menuitem" onClick={() => { setBulkMenuOpen(false); onOrganizeSelection("labels"); }}><Tag size={14} /><span>Label</span>{hint("bulk-label") && <kbd>{hint("bulk-label")}</kbd>}</button>
          <button data-tooltip="Add selection to collection" data-shortcut-id="bulk-collection" type="button" role="menuitem" onClick={() => { setBulkMenuOpen(false); onOrganizeSelection("collections"); }}><FolderKanban size={14} /><span>Collection</span>{hint("bulk-collection") && <kbd>{hint("bulk-collection")}</kbd>}</button>
          <span className="bulk-menu-separator" role="separator" />
          <button data-tooltip={selectionToggle("later")?.label} data-shortcut-id="later" type="button" role="menuitem" onClick={() => { setBulkMenuOpen(false); onBulkAction("later"); }}><Clock3 size={14} /><span>{selectionToggle("later")?.label}</span>{hint("later") && <kbd>{hint("later")}</kbd>}</button>
          <button data-tooltip={selectionToggle("aside")?.label} data-shortcut-id="aside" type="button" role="menuitem" onClick={() => { setBulkMenuOpen(false); onBulkAction("aside"); }}><FileClock size={14} /><span>{selectionToggle("aside")?.label}</span>{hint("aside") && <kbd>{hint("aside")}</kbd>}</button>
          <button data-tooltip={selectionToggle("bubble")?.label} data-shortcut-id="bubble" type="button" role="menuitem" onClick={() => { setBulkMenuOpen(false); onBulkAction("bubble"); }}><ArrowUpCircle size={14} /><span>{selectionToggle("bubble")?.label}</span>{hint("bubble") && <kbd>{hint("bubble")}</kbd>}</button>
          <span className="bulk-menu-separator" role="separator" />
          <button data-tooltip="Mark selection seen" data-shortcut-id="seen" type="button" role="menuitem" onClick={() => { setBulkMenuOpen(false); onBulkAction("seen"); }}><Eye size={14} /><span>Mark seen</span>{hint("seen") && <kbd>{hint("seen")}</kbd>}</button>
          <button data-tooltip={selectionToggle("unread")?.label} data-shortcut-id="unread" type="button" role="menuitem" onClick={() => { setBulkMenuOpen(false); onBulkAction("unread"); }}><EyeOff size={14} /><span>{selectionToggle("unread")?.label}</span>{hint("unread") && <kbd>{hint("unread")}</kbd>}</button>
          <button data-tooltip="Ignore selection" data-shortcut-id="bulk-ignore" type="button" role="menuitem" onClick={() => { setBulkMenuOpen(false); onBulkAction("bulk-ignore"); }}><BellOff size={14} /><span>Ignore</span>{hint("bulk-ignore") && <kbd>{hint("bulk-ignore")}</kbd>}</button>
          <button data-tooltip="Stop ignoring selection" data-shortcut-id="stop-ignoring" type="button" role="menuitem" onClick={() => { setBulkMenuOpen(false); onBulkAction("stop-ignoring"); }}><Bell size={14} /><span>Stop ignoring</span>{hint("stop-ignoring") && <kbd>{hint("stop-ignoring")}</kbd>}</button>
          <span className="bulk-menu-separator" role="separator" />
          <button data-tooltip="Move selection to Imbox" data-shortcut-id="bulk-imbox" type="button" role="menuitem" onClick={() => { setBulkMenuOpen(false); onBulkAction("bulk-imbox"); }} disabled={result?.boxKey === "imbox"}><Inbox size={14} /><span>Imbox</span>{hint("bulk-imbox") && <kbd>{hint("bulk-imbox")}</kbd>}</button>
          <button data-tooltip="Move selection to The Feed" data-shortcut-id="bulk-feed" type="button" role="menuitem" onClick={() => { setBulkMenuOpen(false); onBulkAction("bulk-feed"); }} disabled={result?.boxKey === "feedbox"}><Newspaper size={14} /><span>The Feed</span>{hint("bulk-feed") && <kbd>{hint("bulk-feed")}</kbd>}</button>
          <button data-tooltip="Move selection to Paper Trail" data-shortcut-id="bulk-trail" type="button" role="menuitem" onClick={() => { setBulkMenuOpen(false); onBulkAction("bulk-trail"); }} disabled={result?.boxKey === "trailbox"}><FileClock size={14} /><span>Paper Trail</span>{hint("bulk-trail") && <kbd>{hint("bulk-trail")}</kbd>}</button>
          <span className="bulk-menu-separator" role="separator" />
          <button data-tooltip="Trash selection" data-shortcut-id="trash" type="button" role="menuitem" className="is-danger" onClick={() => { setBulkMenuOpen(false); onBulkAction("trash"); }}><Trash2 size={14} /><span>Trash</span>{hint("trash") && <kbd>{hint("trash")}</kbd>}</button>
        </span> : null}
      </span>
      <button type="button" className="icon-button" aria-label="Clear selection" data-tooltip="Clear selection" onClick={onClearSelection} disabled={bulkBusy}><span aria-hidden>×</span></button>
    </div> : null}
    <footer className="list-footer"><span>{([["next", "next"], ["previous", "previous"], ["select", "select"], ["open", "open"], ["forward", "forward"], ["compose", "compose"], ["commands", "commands"]] as const).map(([id, label]) => hint(id) ? <span key={id}><kbd>{hint(id)}</kbd> {label} </span> : null)}</span></footer>
  </section>;
}
