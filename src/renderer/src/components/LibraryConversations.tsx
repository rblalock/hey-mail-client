import { RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ImboxPosting, MailLibraryKind, MailLibraryThreads } from "../../../shared/contracts";
import { mergeLibraryPostings, navigateLibraryRows } from "../library-browsing";
import { activateMailRow } from "../mail-row-keyboard";
import ContactAvatar from "./ContactAvatar";

type Props = {
  kind: MailLibraryKind;
  id: string;
  onOpen: (posting: ImboxPosting) => void;
};

export default function LibraryConversations({ kind, id, onOpen }: Props) {
  const [result, setResult] = useState<MailLibraryThreads>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string>();
  const request = useRef(0);
  const busy = useRef(false);
  const failedPage = useRef<string | undefined>(undefined);

  const load = useCallback(async (page?: string) => {
    if (busy.current) return;
    busy.current = true;
    const sequence = ++request.current;
    setLoading(true); setError(undefined);
    failedPage.current = page;
    try {
      const next = await window.heyAgent.mail.listLibraryThreads(kind, id, page);
      if (sequence !== request.current) return;
      if (page && next.nextPage === page) throw new Error("HEY returned the same page again. Refresh conversations to continue.");
      setResult((current) => ({ ...next, postings: mergeLibraryPostings(page ? current?.postings ?? [] : [], next.postings) }));
    } catch (reason) {
      if (sequence === request.current) setError(reason instanceof Error ? reason.message : "HEY could not load these conversations.");
    } finally {
      if (sequence === request.current) { busy.current = false; setLoading(false); }
    }
  }, [kind, id]);

  useEffect(() => {
    void load();
    return () => { request.current += 1; busy.current = false; };
  }, [load]);

  const postings = useMemo(() => (result?.postings ?? []).filter((posting) =>
    `${posting.subject} ${posting.sender.name} ${posting.sender.email ?? ""} ${posting.summary}`.toLowerCase().includes(query.trim().toLowerCase())), [result, query]);

  return <section className="library-conversations" aria-label="Conversations" aria-busy={loading} onKeyDown={navigateLibraryRows}>
    <header><h3>Conversations <span>{result?.postings.length ?? 0}{result?.nextPage ? "+" : ""}</span></h3><button type="button" className="icon-button" aria-label="Refresh conversations" disabled={loading} onClick={() => void load()}><RefreshCw size={14} className={loading ? "is-spinning" : undefined} /></button></header>
    <label className="library-search"><Search size={14} /><input aria-label="Filter loaded conversations" placeholder="Filter loaded conversations" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    {error && <div className="thread-notice" role="alert">{error}<button type="button" className="secondary-button" disabled={loading} onClick={() => void load(failedPage.current)}>Try again</button></div>}
    {loading && !result && <p role="status">Loading conversations…</p>}
    {!loading && !error && !postings.length && <p>{query ? "No matches in the loaded conversations." : "No conversations here yet."}</p>}
    <div className="library-conversation-rows">
      {postings.map((posting) => <button type="button" className="thread-listing-row" key={posting.topicId || posting.id} data-library-row data-posting-id={posting.id} aria-current={highlighted === posting.id ? "true" : undefined} onFocus={() => setHighlighted(posting.id)} onClick={() => onOpen(posting)} onKeyDown={(event) => activateMailRow(event, () => onOpen(posting))}>
        <ContactAvatar contact={posting.sender} />
        <span><strong title={posting.subject}>{posting.subject}</strong><small>{posting.sender.name}{posting.summary ? ` — ${posting.summary}` : ""}</small></span>
        <time dateTime={posting.createdAt}>{Number.isNaN(Date.parse(posting.createdAt)) ? "" : new Date(posting.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>
      </button>)}
    </div>
    {result?.nextPage && <button type="button" className="secondary-button library-load-more" disabled={loading} onClick={() => void load(result.nextPage)}>{loading ? "Loading…" : "Load more conversations"}</button>}
    {query && result?.nextPage && <p>Load more to include older conversations in this filter.</p>}
  </section>;
}
