import { ChevronDown as ChevronDownData, ChevronUp as ChevronUpData } from "lucide";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { activateMailRow } from "../mail-row-keyboard";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ImboxPosting, MailSearchFilters, MailSearchRequest, MailSearchResult } from "../../../shared/contracts";
import { isTopmostDialogScrim } from "../dialog-stack";
import MorphingIcon from "./MorphingIcon";

type MailSearchProps = {
  hidden?: boolean;
  onClose: () => void;
  onOpen: (posting: ImboxPosting) => void;
};

type Refinements = Omit<MailSearchRequest, "query" | "page">;

const EMPTY_REFINEMENTS: Refinements = {
  required: "", any: "", none: "", exact: "", from: "", to: "", subject: "", date: "", box: "", label: "", attachment: "",
};

function mergePostings(current: ImboxPosting[], next: ImboxPosting[]): ImboxPosting[] {
  const seen = new Set<string>();
  return [...current, ...next].filter((posting) => {
    const key = posting.topicId || posting.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function MailSearch({ hidden = false, onClose, onOpen }: MailSearchProps) {
  const [query, setQuery] = useState("");
  const [refinements, setRefinements] = useState<Refinements>(EMPTY_REFINEMENTS);
  const [filters, setFilters] = useState<MailSearchFilters>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [result, setResult] = useState<MailSearchResult>();
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const activeFilterCount = useMemo(() => Object.values(refinements).filter((value) => value?.trim()).length, [refinements]);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    if (!hidden) requestAnimationFrame(() => input.current?.focus());
  }, [hidden]);
  useEffect(() => {
    if (hidden) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !isTopmostDialogScrim(scrim.current)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  }, [hidden, onClose]);
  useEffect(() => {
    let cancelled = false;
    void window.heyAgent.mail.searchFilters().then((value) => { if (!cancelled) setFilters(value); }).catch(() => {
      // Free-text search remains available if HEY cannot load refinement values.
    });
    return () => { cancelled = true; };
  }, []);

  const updateRefinement = (key: keyof Refinements, value: string) => setRefinements((current) => ({ ...current, [key]: value }));
  const requestFor = (page: number): MailSearchRequest => ({
    ...(query.trim() ? { query: query.trim() } : {}),
    ...Object.fromEntries(Object.entries(refinements).filter(([, value]) => value?.trim()).map(([key, value]) => [key, value!.trim()])),
    page,
  });

  const search = async (page = 1, append = false) => {
    if (loading || loadingMore || (!query.trim() && activeFilterCount === 0)) return;
    append ? setLoadingMore(true) : setLoading(true);
    setError(undefined);
    try {
      const next = await window.heyAgent.mail.search(requestFor(page));
      setResult((current) => append && current ? { ...next, postings: mergePostings(current.postings, next.postings) } : next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "HEY search failed."); }
    finally { setLoading(false); setLoadingMore(false); }
  };

  const clearFilters = () => {
    setRefinements(EMPTY_REFINEMENTS);
    requestAnimationFrame(() => input.current?.focus());
  };

  return (
    <div ref={scrim} className="dialog-scrim search-scrim" role="presentation" hidden={hidden} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="mail-search-dialog" role="dialog" aria-modal="true" aria-label="Search HEY">
        <header className="command-search mail-search-command">
          <Search size={16} />
          <input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} placeholder="Search all email" aria-label="Search all email" />
          <button type="button" className="search-filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}><SlidersHorizontal size={14} /><span>Filters{activeFilterCount ? ` ${activeFilterCount}` : ""}</span><MorphingIcon icon={filtersOpen ? ChevronUpData : ChevronDownData} size={13} /></button>
          <button type="button" className="primary-button search-submit" onClick={() => void search()} disabled={loading || (!query.trim() && activeFilterCount === 0)}>Search</button>
          <button type="button" className="icon-button" aria-label="Close search" onClick={onClose}><X size={15} /></button>
        </header>

        {filtersOpen && <section className="search-refinements" aria-label="Advanced search filters">
          <div className="search-refinement-grid">
            <label><span>From</span><input value={refinements.from} onChange={(event) => updateRefinement("from", event.target.value)} placeholder="Name or email" /></label>
            <label><span>To</span><input value={refinements.to} onChange={(event) => updateRefinement("to", event.target.value)} placeholder="Name or email" /></label>
            <label><span>Subject</span><input value={refinements.subject} onChange={(event) => updateRefinement("subject", event.target.value)} placeholder="Words in subject" /></label>
            <label><span>Exact phrase</span><input value={refinements.exact} onChange={(event) => updateRefinement("exact", event.target.value)} placeholder="This exact phrase" /></label>
            <label><span>All these words</span><input value={refinements.required} onChange={(event) => updateRefinement("required", event.target.value)} /></label>
            <label><span>Any of these words</span><input value={refinements.any} onChange={(event) => updateRefinement("any", event.target.value)} /></label>
            <label><span>Exclude words</span><input value={refinements.none} onChange={(event) => updateRefinement("none", event.target.value)} /></label>
            <label><span>Mailbox</span><select value={refinements.box} onChange={(event) => updateRefinement("box", event.target.value)}><option value="">Anywhere</option>{filters?.boxes.map((option) => <option key={option.value} value={option.value}>{option.title}</option>)}</select></label>
            <label><span>Date</span><select value={refinements.date} onChange={(event) => updateRefinement("date", event.target.value)}><option value="">Any time</option>{filters?.dates.map((option) => <option key={option.value} value={option.value}>{option.title}</option>)}</select></label>
            <label><span>Label</span><select value={refinements.label} onChange={(event) => updateRefinement("label", event.target.value)}><option value="">Any label</option>{filters?.labels.map((option) => <option key={option.value} value={option.value}>{option.title}</option>)}</select></label>
            <label><span>Attachment</span><select value={refinements.attachment} onChange={(event) => updateRefinement("attachment", event.target.value)}><option value="">Any message</option>{filters?.attachments.map((option) => <option key={option.value} value={option.value}>{option.title}</option>)}</select></label>
          </div>
          <footer><span>HEY combines every refinement you set.</span>{activeFilterCount > 0 && <button type="button" onClick={clearFilters}>Clear filters</button>}</footer>
        </section>}

        <div className="mail-search-body">
          <div className="mail-search-results">
            {result?.postings.map((posting) => <button type="button" key={`${posting.id}-${posting.topicId}`} data-posting-id={posting.id} onClick={() => onOpen(posting)} onKeyDown={(event) => activateMailRow(event, () => onOpen(posting))}><strong>{posting.subject}</strong><span>{posting.sender.name}</span><p>{posting.summary}</p></button>)}
            {result && result.postings.length === 0 && <p className="search-empty">No messages matched this search.</p>}
            {!result && !error && <p className="search-empty">Search sender, subject, message content, mailbox, date, labels, or attachments across HEY.</p>}
            {error && <p className="composer-error">{error}</p>}
            {result?.hasMore && <button type="button" className="search-load-more secondary-button" onClick={() => void search(result.page + 1, true)} disabled={loadingMore}>{loadingMore ? "Loading…" : "Load more"}</button>}
          </div>
        </div>
        {loading && <div className="search-progress"><span />Searching HEY…</div>}
      </section>
    </div>
  );
}
