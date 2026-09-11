import { ChevronRight, ExternalLink, FolderKanban, Inbox, MailPlus, Newspaper, ReceiptText, RefreshCw, Search, Sparkles, Tag, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { navigateLibraryRows } from "../library-browsing";
import { activateMailRow } from "../mail-row-keyboard";
import type { AgentObjectLink, ImboxPosting, MailContactDetail, MailLibraryItem, MailLibraryKind, MailLibraryResult } from "../../../shared/contracts";
import ContactAvatar from "./ContactAvatar";
import LibraryConversations from "./LibraryConversations";

type MailLibraryProps = {
  hidden?: boolean;
  onComposeContact: (contact: MailContactDetail) => void;
  onChatContact: (contact: MailContactDetail) => void;
  onOpenPosting: (posting: ImboxPosting, sourceTitle: string) => void;
  onNotice: (message: string) => void;
  target?: { object: AgentObjectLink; kind: MailLibraryKind; id: string; revision: number };
  onTargetMissing?: (object: AgentObjectLink) => void;
  refreshToken?: number;
};

const SECTIONS: Array<{ kind: MailLibraryKind; label: string; icon: typeof Users }> = [
  { kind: "contacts", label: "Contacts", icon: Users },
  { kind: "labels", label: "Labels", icon: Tag },
  { kind: "collections", label: "Collections", icon: FolderKanban },
];

const EMPTY_COPY: Record<MailLibraryKind, { title: string; body: string }> = {
  contacts: { title: "No contacts", body: "Your HEY contacts will appear here." },
  labels: { title: "No labels yet", body: "Labels categorize conversations across HEY." },
  collections: { title: "No collections yet", body: "Collections gather related email threads into a named topic or project." },
};

export default function MailLibrary({ hidden = false, onComposeContact, onChatContact, onOpenPosting, onNotice, target, onTargetMissing, refreshToken = 0 }: MailLibraryProps) {
  const [kind, setKind] = useState<MailLibraryKind>("contacts");
  const [result, setResult] = useState<MailLibraryResult>();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<MailLibraryItem>();
  const [contact, setContact] = useState<MailContactDetail>();
  const [contactLoading, setContactLoading] = useState(false);
  const [contactError, setContactError] = useState<string>();
  const [routing, setRouting] = useState(false);
  const detailRequest = useRef(0);
  const catalogRequest = useRef(0);
  const panel = useRef<HTMLElement>(null);
  const handledTargetRevision = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    const request = ++catalogRequest.current;
    setLoading(true); setError(undefined);
    try { const value = await window.heyAgent.mail.listLibrary(kind); if (request === catalogRequest.current) setResult(value); }
    catch (reason) { if (request === catalogRequest.current) setError(reason instanceof Error ? reason.message : `HEY could not load ${kind}.`); }
    finally { if (request === catalogRequest.current) setLoading(false); }
  }, [kind]);
  useEffect(() => {
    detailRequest.current += 1;
    setResult(undefined); setQuery(""); setSelected(undefined); setContact(undefined); setContactError(undefined); setContactLoading(false);
  }, [kind]);
  useEffect(() => { void refresh(); return () => { catalogRequest.current += 1; }; }, [refresh, refreshToken]);
  useEffect(() => () => { detailRequest.current += 1; }, []);
  const items = useMemo(() => (result?.items ?? []).filter((item) => `${item.title} ${item.subtitle ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())), [query, result]);

  useEffect(() => {
    if (!target || handledTargetRevision.current === target.revision) return;
    if (kind !== target.kind) { setKind(target.kind); return; }
    if (!result || result.kind !== kind) return;
    handledTargetRevision.current = target.revision;
    const item = result?.items.find((candidate) => candidate.id === target.id);
    if (!item) { onTargetMissing?.(target.object); return; }
    setQuery("");
    if (target.kind === "contacts") void selectContact(item);
    else setSelected(item);
  }, [kind, onTargetMissing, result, target]);

  const selectContact = async (item: MailLibraryItem) => {
    const request = ++detailRequest.current;
    setSelected(item); setContact(undefined); setContactError(undefined); setContactLoading(true);
    const detail = window.heyAgent.mail.showContact(item.id).then((value) => {
      if (request === detailRequest.current) setContact(value);
    }, (reason: unknown) => {
      if (request === detailRequest.current) setContactError(reason instanceof Error ? reason.message : "HEY could not load this contact.");
    }).finally(() => {
      if (request === detailRequest.current) setContactLoading(false);
    });
    await detail;
  };

  const closeContact = () => {
    detailRequest.current += 1;
    const id = selected?.id;
    setSelected(undefined); setContact(undefined); setContactError(undefined); setContactLoading(false);
    requestAnimationFrame(() => {
      panel.current?.querySelector<HTMLElement>(`[data-library-id="${CSS.escape(id ?? "")}"]`)?.focus({ preventScroll: true });
    });
  };

  useEffect(() => {
    if (!hidden && selected) panel.current?.querySelector<HTMLElement>(".contact-detail > header button")?.focus({ preventScroll: true });
  }, [selected?.id, kind]);

  const routeSender = async (destination: "imbox" | "feedbox" | "trailbox") => {
    if (!contact?.clearanceId) return;
    setRouting(true);
    try {
      const result = await window.heyAgent.mail.decideScreener({ id: contact.clearanceId, decision: "approve", destination });
      onNotice(result.message);
    } catch (reason) { onNotice(reason instanceof Error ? reason.message : "HEY could not change this sender's delivery rule."); }
    finally { setRouting(false); }
  };

  return (
    <section ref={panel} hidden={hidden} style={hidden ? { display: "none" } : undefined} className="panel library-panel" aria-label="HEY library" onKeyDown={(event) => {
      if (!hidden && selected && event.key === "Escape" && !(event.target as HTMLElement).closest("input, textarea")) { event.preventDefault(); event.stopPropagation(); closeContact(); }
    }}>
      <header className="panel-header"><div className="title-cluster"><h1>Library</h1><span className="title-count">{result?.items.length ?? 0}</span></div><button type="button" className="icon-button" aria-label={`Refresh ${kind}`} data-tooltip={`Refresh ${kind}`} onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} className={loading ? "is-spinning" : ""} /></button></header>
      <div className="library-tabs" role="tablist">{SECTIONS.map(({ kind: section, label, icon: Icon }) => <button key={section} type="button" role="tab" aria-selected={kind === section} onClick={() => setKind(section)}><Icon size={14} /> {label}</button>)}</div>
      <label className="library-search"><Search size={14} /><input aria-label={`Filter ${kind}`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Filter ${kind}`} /></label>
      <div className="library-body" data-detail-open={Boolean(selected)}>
        <div className="library-list" onKeyDown={navigateLibraryRows} aria-busy={loading}>
          {error && <div className="thread-notice" role="alert">{error}<button type="button" className="secondary-button" onClick={() => void refresh()}>Try again</button></div>}
          {loading && !result && <p role="status">Loading {kind}…</p>}
          {!loading && !error && items.length === 0 && <div className="empty-state"><h2>{EMPTY_COPY[kind].title}</h2><p>{query ? "Try a different filter." : EMPTY_COPY[kind].body}</p></div>}
          {kind === "contacts" ? items.map((item) => <button className="library-contact-row" key={item.id} data-library-row data-library-id={item.id} type="button" aria-pressed={selected?.id === item.id} onClick={() => void selectContact(item)} onKeyDown={(event) => activateMailRow(event, () => void selectContact(item))}>
            <ContactAvatar contact={item.contact ?? { name: item.title, email: item.subtitle }} /><div><strong>{item.title}</strong>{item.subtitle && <small>{item.subtitle}</small>}</div>
          </button>) : items.map((item) => <button type="button" className="library-contact-row" key={item.id} data-library-row data-library-id={item.id} aria-pressed={selected?.id === item.id} onClick={() => setSelected(item)} onKeyDown={(event) => activateMailRow(event, () => setSelected(item))}><span>{kind === "labels" ? <Tag size={16} /> : <FolderKanban size={16} />}</span><div><strong title={item.title}>{item.title}</strong>{item.subtitle && <small>{item.subtitle}</small>}</div>{item.detail && <em>{item.detail}</em>}<ChevronRight size={14} /></button>)}
        </div>
        {selected && kind === "contacts" && <aside className="contact-detail" aria-label={`${selected.title} contact details`}>
          <header><span>Contact</span><button type="button" className="icon-button" aria-label="Close contact details" data-tooltip="Close contact details" onClick={closeContact}><X size={15} /></button></header>
          {contactLoading && <div className="contact-detail-loading"><span />Loading contact…</div>}
          {contactError && <div className="thread-notice">{contactError}<button type="button" className="secondary-button" onClick={() => void selectContact(selected)}>Try again</button></div>}
          {contact && <div className="contact-detail-content">
            <div className="contact-identity"><ContactAvatar contact={contact} /><div><h2>{contact.name}</h2><p>{contact.email}</p></div></div>
            <div className="contact-actions">
              <button type="button" className="primary-button" onClick={() => onComposeContact(contact)}><MailPlus size={14} /> Email</button>
              <button type="button" className="secondary-button" onClick={() => onChatContact(contact)}><Sparkles size={14} /> Chat with HEY Agent</button>
              {contact.editAppUrl && <button type="button" className="secondary-button" onClick={() => void window.heyAgent.system.openHeyUrl(contact.editAppUrl!)}><ExternalLink size={14} /> Open in HEY</button>}
            </div>
            <dl>
              {contact.status && <div><dt>Screening</dt><dd>{contact.status}</dd></div>}
              {contact.domain && <div><dt>Domain</dt><dd>{contact.domain}</dd></div>}
              {contact.aliases.length > 0 && <div><dt>Aliases</dt><dd>{contact.aliases.join(", ")}</dd></div>}
              {contact.updatedAt && <div><dt>Updated</dt><dd>{new Date(contact.updatedAt).toLocaleString()}</dd></div>}
            </dl>
            {contact.status === "approved" && contact.clearanceId && <section className="contact-routing"><h3>Future delivery</h3><p>Choose where HEY should deliver future email from this sender. The CLI cannot currently read back their active destination.</p><div><button type="button" disabled={routing} onClick={() => void routeSender("imbox")}><Inbox size={14} /> Imbox</button><button type="button" disabled={routing} onClick={() => void routeSender("feedbox")}><Newspaper size={14} /> Feed</button><button type="button" disabled={routing} onClick={() => void routeSender("trailbox")}><ReceiptText size={14} /> Paper Trail</button></div></section>}
            <section className="contact-note"><h3>Private note</h3><p>{contact.note || "No private note for this contact."}</p></section>
          </div>}
          <LibraryConversations key={`contacts:${selected.id}`} kind="contacts" id={selected.id} onOpen={(posting) => onOpenPosting(posting, selected.title)} />
        </aside>}
        {selected && kind !== "contacts" && <aside className="contact-detail" aria-label={`${selected.title} conversations`}>
          <header><span>{kind === "labels" ? "Label" : "Collection"}</span><button type="button" className="icon-button" aria-label={`Back to ${kind}`} onClick={closeContact}><X size={15} /></button></header>
          <div className="library-source-heading"><h2>{selected.title}</h2>{selected.subtitle && <p>{selected.subtitle}</p>}</div>
          <LibraryConversations key={`${kind}:${selected.id}`} kind={kind} id={selected.id} onOpen={(posting) => onOpenPosting(posting, selected.title)} />
        </aside>}
      </div>
    </section>
  );
}
