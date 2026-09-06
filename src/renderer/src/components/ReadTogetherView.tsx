import { ArrowLeft, ChevronDown, ChevronUp, Rows3 } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { AgentObjectLink, ImboxPosting, MailThread } from "../../../shared/contracts";
import { readerScrollIntent } from "../reader-scroll";
import { appSound } from "../sound";
import ThreadPanel from "./ThreadPanel";

export type ReadTogetherItem = {
  posting: ImboxPosting;
  thread?: MailThread;
  threadError?: string;
};

export type ReadTogetherHandle = {
  jump: (delta: -1 | 1) => void;
};

type ReadTogetherViewProps = {
  items: ReadTogetherItem[];
  sourceLabel: string;
  skippedCount: number;
  onClose: () => void;
  onRetryThread: (topicId: string) => void;
  onOpenObject?: (object: AgentObjectLink) => void;
};

const ReadTogetherView = forwardRef<ReadTogetherHandle, ReadTogetherViewProps>(function ReadTogetherView({
  items, sourceLabel, skippedCount, onClose, onRetryThread, onOpenObject,
}, ref) {
  const scroll = useRef<HTMLDivElement>(null);
  const itemElements = useRef<Array<HTMLElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const scrollToItem = useCallback((index: number) => {
    const next = Math.min(Math.max(index, 0), items.length - 1);
    const container = scroll.current;
    const item = itemElements.current[next];
    if (!container || !item) return;
    if (next === activeIndex) return;
    appSound.play("hover", "interface", { cooldownMs: 70, retrigger: "restart" });
    setActiveIndex(next);
    container.scrollTo({ top: Math.max(0, item.offsetTop - 12) });
  }, [activeIndex, items.length]);

  useImperativeHandle(ref, () => ({
    jump(delta) {
      scrollToItem(activeIndex + delta);
    },
  }), [activeIndex, scrollToItem]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => scroll.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (activeIndex < items.length) return;
    setActiveIndex(Math.max(0, items.length - 1));
  }, [activeIndex, items.length]);

  const handleReaderKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as { isContentEditable?: boolean; closest?: (selector: string) => Element | null } | null;
    if (target?.isContentEditable || target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
    if (event.key === " " && target?.closest?.("button, a")) return;
    const container = scroll.current;
    if (!container) return;
    const intent = readerScrollIntent(event.key, event.shiftKey, container.clientHeight, container.scrollHeight);
    if (!intent) return;
    event.preventDefault();
    if (intent.kind === "to") container.scrollTo({ top: intent.top });
    else container.scrollBy({ top: intent.top });
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleReaderKeyDown);
    return () => window.removeEventListener("keydown", handleReaderKeyDown);
  }, [handleReaderKeyDown]);

  const trackActiveItem = () => {
    const container = scroll.current;
    if (!container || items.length === 0) return;
    const readingLine = container.scrollTop + Math.min(180, container.clientHeight * 0.24);
    let next = 0;
    for (let index = 0; index < items.length; index += 1) {
      const item = itemElements.current[index];
      if (item && item.offsetTop <= readingLine) next = index;
    }
    setActiveIndex(next);
  };

  return <section className="panel thread-panel read-together-panel" aria-label={`Read ${items.length} conversations together`}>
    <header className="panel-header thread-header read-together-header">
      <button className="thread-back" type="button" data-tooltip={`Back to ${sourceLabel}`} data-shortcut-id="back" onClick={onClose}><ArrowLeft size={15} /><span>{sourceLabel}</span></button>
      <div className="read-together-title"><Rows3 size={14} /><strong>Read Together</strong><span>{activeIndex + 1} of {items.length}</span></div>
      <div className="header-actions">
        <button className="icon-button" type="button" aria-label="Previous selected conversation" data-tooltip="Previous selected conversation" data-shortcut-id="previous" disabled={activeIndex === 0} onClick={() => scrollToItem(activeIndex - 1)}><ChevronUp size={16} /></button>
        <button className="icon-button" type="button" aria-label="Next selected conversation" data-tooltip="Next selected conversation" data-shortcut-id="next" disabled={activeIndex >= items.length - 1} onClick={() => scrollToItem(activeIndex + 1)}><ChevronDown size={16} /></button>
      </div>
    </header>

    <div ref={scroll} className="thread-scroll read-together-scroll" tabIndex={0} aria-label="Selected conversations" onScroll={trackActiveItem}>
      {skippedCount > 0 && <p className="read-together-skipped" role="status">{skippedCount} selected {skippedCount === 1 ? "contact bundle was" : "contact bundles were"} left out because HEY did not provide individual conversation IDs.</p>}
      {items.map((item, index) => <article
        ref={(element) => { itemElements.current[index] = element; }}
        key={item.posting.id}
        className="read-together-item"
        aria-label={`${index + 1} of ${items.length}: ${item.posting.subject}`}
      >
        <ThreadPanel
          embedded
          posting={item.posting}
          thread={item.thread}
          threadError={item.threadError}
          sourceLabel={sourceLabel}
          onRefresh={() => undefined}
          onRetryThread={() => item.posting.topicId && onRetryThread(item.posting.topicId)}
          replyRequest={0}
          onClose={() => undefined}
          onPrevious={() => undefined}
          onNext={() => undefined}
          hasPrevious={false}
          hasNext={false}
          showTraversal={false}
          onReaderKeyDown={handleReaderKeyDown}
          onOpenObject={onOpenObject}
        />
      </article>)}
    </div>
  </section>;
});

export default ReadTogetherView;
