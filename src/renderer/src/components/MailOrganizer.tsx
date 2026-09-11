import { ArrowUpRight, Check, FolderKanban, Minus, Plus, RefreshCw, Search, Tag, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentObjectLink, ImboxPosting, MailOrganization, MailOrganizationItem, MailOrganizationKind, MailOrganizationMutationRequest } from "../../../shared/contracts";
import { isTopmostDialogScrim } from "../dialog-stack";
import { filterOrganizationItems, organizationTargets, organizationToggleAction } from "../mail-organization";
import { appSound } from "../sound";

type MailOrganizerProps = {
  postings: ImboxPosting[];
  initialKind?: MailOrganizationKind;
  onClose: () => void;
  onNotice: (message: string) => void;
  onOpenObject?: (object: AgentObjectLink) => void;
};

export default function MailOrganizer({ postings, initialKind = "labels", onClose, onNotice, onOpenObject }: MailOrganizerProps) {
  const { postingIds, topicIds } = useMemo(() => organizationTargets(postings), [postings]);
  const [organization, setOrganization] = useState<MailOrganization>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [labelQuery, setLabelQuery] = useState("");
  const [collectionQuery, setCollectionQuery] = useState("");
  const [labelName, setLabelName] = useState("");
  const [collectionName, setCollectionName] = useState("");
  const dialog = useRef<HTMLElement>(null);
  const scrim = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(undefined);
    try { setOrganization(await window.heyAgent.mail.getOrganization({ postingIds, topicIds })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "HEY could not load labels and Collections."); }
    finally { setLoading(false); }
  }, [postingIds, topicIds]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const preferred = organization
        ? dialog.current?.querySelector<HTMLElement>(`.organizer-section[data-kind="${initialKind}"] .organizer-filter input, .organizer-section[data-kind="${initialKind}"] .organizer-create input`)
        : undefined;
      (preferred ?? dialog.current?.querySelector<HTMLElement>("button:not(:disabled)"))?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [initialKind, organization]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (!isTopmostDialogScrim(scrim.current)) return;
      if (event.key === "Tab") {
        const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? [])].filter((element) => !element.hidden);
        if (focusable.length === 0) return;
        const current = focusable.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey ? (current <= 0 ? focusable.length - 1 : current - 1) : (current < 0 || current === focusable.length - 1 ? 0 : current + 1);
        event.preventDefault(); event.stopImmediatePropagation(); focusable[next]?.focus(); return;
      }
      if (event.key !== "Escape") return;
      const field = document.activeElement instanceof HTMLInputElement ? document.activeElement.dataset.organizerField : undefined;
      const clear = field === "label-query" && labelQuery ? () => setLabelQuery("")
        : field === "collection-query" && collectionQuery ? () => setCollectionQuery("")
          : field === "label-name" && labelName ? () => setLabelName("")
            : field === "collection-name" && collectionName ? () => setCollectionName("")
              : undefined;
      event.preventDefault(); event.stopImmediatePropagation();
      if (clear) clear();
      else if (!busy) onClose();
    };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  }, [busy, collectionName, collectionQuery, labelName, labelQuery, onClose]);

  const mutate = async (request: MailOrganizationMutationRequest, key: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(key); setError(undefined);
    try {
      const result = await window.heyAgent.mail.updateOrganization(request);
      appSound.play(request.action === "remove" ? "deselect" : "select", "mail");
      onNotice(result.message);
      await refresh();
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "HEY could not update this conversation."); return false; }
    finally { setBusy(undefined); }
  };

  const toggle = (kind: MailOrganizationKind, item: MailOrganizationItem) => void mutate({
    kind,
    action: organizationToggleAction(item),
    targetId: item.id,
    postingIds,
    topicIds,
  }, `${kind}:${item.id}`);

  const create = (event: FormEvent, kind: MailOrganizationKind) => {
    event.preventDefault();
    const name = (kind === "labels" ? labelName : collectionName).trim();
    if (!name) return;
    void mutate({ kind, action: "create", name, postingIds, topicIds }, `${kind}:create`).then((succeeded) => {
      if (!succeeded) return;
      if (kind === "labels") setLabelName("");
      else setCollectionName("");
    });
  };

  const section = (kind: MailOrganizationKind, items: MailOrganizationItem[], enabled: boolean) => {
    const labels = kind === "labels";
    const Icon = labels ? Tag : FolderKanban;
    const name = labels ? labelName : collectionName;
    const query = labels ? labelQuery : collectionQuery;
    const visibleItems = filterOrganizationItems(items, query);
    const targetCount = labels ? postingIds.length : topicIds.length;
    const skippedCount = Math.max(0, postings.length - targetCount);
    const fullyApplied = items.filter((item) => item.membership === "all").length;
    const mixed = items.filter((item) => item.membership === "some").length;
    return <section className="organizer-section" data-kind={kind} aria-label={labels ? "Labels" : "Collections"}>
      <header><span><Icon size={15} /><strong>{labels ? "Labels" : "Collections"}</strong></span><em>{fullyApplied} applied{mixed ? ` · ${mixed} mixed` : ""}</em></header>
      {!enabled ? <p className="organizer-unavailable">HEY did not return the {labels ? "posting" : "thread"} ID required to edit this membership.</p> : <>
        <label className="organizer-filter"><Search size={13} /><input data-organizer-field={labels ? "label-query" : "collection-query"} value={query} onChange={(event) => labels ? setLabelQuery(event.target.value) : setCollectionQuery(event.target.value)} placeholder={labels ? "Filter labels" : "Filter Collections"} aria-label={labels ? "Filter labels" : "Filter Collections"} /></label>
        {skippedCount > 0 && <p className="organizer-eligibility">{skippedCount} selected {skippedCount === 1 ? "row is" : "rows are"} missing the HEY {labels ? "posting" : "thread"} ID this action requires and will be skipped.</p>}
        <div className="organizer-options">
          {visibleItems.map((item) => <div className="organizer-option-row" key={item.id}>
            <button type="button" role="checkbox" aria-checked={item.membership === "some" ? "mixed" : item.membership === "all"} disabled={Boolean(busy)} onClick={() => toggle(kind, item)}><span className="organizer-check">{item.membership === "all" ? <Check size={13} /> : item.membership === "some" ? <Minus size={13} /> : null}</span><span><strong>{item.name}</strong>{(item.summary || item.membership === "some") && <small>{[item.summary, item.membership === "some" ? `${item.memberCount} of ${targetCount} selected` : ""].filter(Boolean).join(" · ")}</small>}</span>{busy === `${kind}:${item.id}` && <RefreshCw size={13} className="is-spinning" />}</button>
            {onOpenObject && <button type="button" className="organizer-browse" disabled={Boolean(busy)} aria-label={`Browse ${item.name}`} title={`Browse ${item.name}`} onClick={() => { onClose(); onOpenObject({ kind: labels ? "label" : "collection", id: item.id, title: item.name, deepLink: `hey-agent://mail/${kind}/${item.id}` }); }}><ArrowUpRight size={15} /><span>Browse</span></button>}
          </div>)}
          {items.length === 0 ? <p>No {labels ? "labels" : "Collections"} yet.</p> : visibleItems.length === 0 ? <p>No matches for “{query.trim()}”.</p> : null}
        </div>
        <form className="organizer-create" onSubmit={(event) => create(event, kind)}><input data-organizer-field={labels ? "label-name" : "collection-name"} maxLength={120} value={name} onChange={(event) => labels ? setLabelName(event.target.value) : setCollectionName(event.target.value)} placeholder={labels ? "New label" : "New Collection"} aria-label={labels ? "New label name" : "New Collection name"} /><button type="submit" className="secondary-button" disabled={Boolean(busy) || !name.trim()}><Plus size={13} /> Create and add</button></form>
      </>}
    </section>;
  };

  return <div ref={scrim} className="dialog-scrim organizer-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialog} className="mail-organizer" role="dialog" aria-modal="true" aria-label={postings.length === 1 ? `Organize ${postings[0]?.subject ?? "conversation"}` : `Organize ${postings.length} conversations`}>
      <header className="organizer-heading"><div><span>{postings.length === 1 ? "Organize conversation" : `Organize ${postings.length} conversations`}</span><h2>{postings.length === 1 ? postings[0]?.subject : "Apply labels or add the selected threads to a Collection"}</h2></div><button type="button" className="icon-button" aria-label="Close organizer" onClick={onClose} disabled={Boolean(busy)}><X size={15} /></button></header>
      {error && <div className="thread-notice organizer-error">{error}<button type="button" className="secondary-button" onClick={() => void refresh()} disabled={loading}>Try again</button></div>}
      {loading && !organization ? <div className="organizer-loading"><span />Checking HEY membership…</div> : organization && <div className="organizer-grid">
        {section("labels", organization.labels, postingIds.length > 0)}
        {section("collections", organization.collections, topicIds.length > 0)}
      </div>}
    </section>
  </div>;
}
