import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CalendarDays, ChevronRight, Clock3, ListTodo, LoaderCircle, Search, X } from "lucide-react";
import type { CalendarSearchItem, CalendarSearchKind, CalendarSearchResult } from "../../../shared/contracts";
import { dateFromKey } from "../calendar";
import { appSound } from "../sound";

const KIND_LABELS: Record<CalendarSearchKind, string> = {
  event: "Event",
  todo: "Sometime This Week",
  journal: "Journal",
  time: "Tracked time",
};

function KindIcon({ kind }: { kind: CalendarSearchKind }) {
  if (kind === "todo") return <ListTodo size={15} />;
  if (kind === "journal") return <BookOpen size={15} />;
  if (kind === "time") return <Clock3 size={15} />;
  return <CalendarDays size={15} />;
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(dateFromKey(date));
}

export default function CalendarSearch({ onClose, onOpen }: { onClose: () => void; onOpen: (item: CalendarSearchItem) => void }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<CalendarSearchResult>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef(new Map<number, HTMLButtonElement>());
  const items = result?.items ?? [];

  useEffect(() => { requestAnimationFrame(() => inputRef.current?.focus()); }, []);
  useEffect(() => { setCursor((current) => Math.min(current, Math.max(0, items.length - 1))); }, [items.length]);

  const sourceNotice = useMemo(() => result?.unavailableSources.map((kind) => KIND_LABELS[kind]).join(", "), [result]);
  const submit = async () => {
    const value = query.trim();
    if (!value || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const next = await window.heyAgent.calendar.search({ query: value });
      setResult(next);
      setCursor(0);
      if (next.status !== "ready") appSound.play("error", "interface");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "HEY Calendar search is unavailable.");
      appSound.play("error", "interface");
    } finally {
      setLoading(false);
    }
  };
  const move = (delta: number) => {
    if (!items.length) return;
    const next = Math.max(0, Math.min(items.length - 1, cursor + delta));
    setCursor(next);
    itemRefs.current.get(next)?.focus();
    appSound.play("hover", "interface", { cooldownMs: 70, retrigger: "restart" });
  };
  const open = (item: CalendarSearchItem) => {
    appSound.play("open", "interface");
    onOpen(item);
  };

  return <section className="calendar-search" aria-label="Search HEY Calendar" onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    else if (event.key === "ArrowDown" || event.key.toLowerCase() === "j" && event.target !== inputRef.current) { event.preventDefault(); move(1); }
    else if (event.key === "ArrowUp" || event.key.toLowerCase() === "k" && event.target !== inputRef.current) { event.preventDefault(); move(-1); }
  }}>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <Search size={17} />
      <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Calendar" aria-label="Search events, Sometime This Week, Journal, and tracked time" />
      {query && <button type="button" className="icon-button" aria-label="Clear search" onClick={() => { setQuery(""); setResult(undefined); inputRef.current?.focus(); }}><X size={14} /></button>}
      <button type="submit" className="calendar-search-submit" data-tooltip="Search Calendar" data-shortcut="Enter" disabled={!query.trim() || loading}>{loading ? <LoaderCircle size={14} className="is-spinning" /> : "Search"}</button>
    </form>
    <div className="calendar-search-results" aria-busy={loading}>
      {!result && !error && <div className="calendar-search-idle"><span><CalendarDays size={16} />Events</span><span><ListTodo size={16} />Sometime</span><span><BookOpen size={16} />Journal</span><span><Clock3 size={16} />Time</span></div>}
      {error && <p className="composer-error">{error}</p>}
      {result?.status !== "ready" && result?.detail && <p className="composer-error">{result.detail}</p>}
      {result?.status === "ready" && sourceNotice && <p className="calendar-search-partial">Not searched: {sourceNotice}</p>}
      {result?.status === "ready" && items.length === 0 && <div className="calendar-search-empty"><Search size={18} /><strong>No results for “{result.query}”</strong></div>}
      {items.map((item, index) => <button key={`${item.kind}:${item.id}:${item.date}`} ref={(node) => { if (node) itemRefs.current.set(index, node); else itemRefs.current.delete(index); }} type="button" className="calendar-search-result" data-current={cursor === index || undefined} onFocus={() => setCursor(index)} onClick={() => open(item)}>
        <span className="calendar-search-kind"><KindIcon kind={item.kind} /></span>
        <span className="calendar-search-copy"><strong>{item.title}</strong><small>{[KIND_LABELS[item.kind], item.detail].filter((value, valueIndex, values) => value && values.indexOf(value) === valueIndex).join(" · ")}</small></span>
        <time dateTime={item.date}>{formatDate(item.date)}</time>
        <ChevronRight size={14} />
      </button>)}
    </div>
    <footer><kbd>J</kbd><kbd>K</kbd><span>move</span><kbd>Enter</kbd><span>open</span><kbd>Esc</kbd><span>close</span></footer>
  </section>;
}
