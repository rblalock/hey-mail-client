import { Plus, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import type { MailSplit } from "../../../shared/mail-splits";
import "../split-inbox.css";

export type SplitInboxTabsProps = {
  splits: MailSplit[];
  selectedId: string;
  counts: Record<string, number>;
  onSelect: (id: string) => void;
  onManage: () => void;
  onCreate: () => void;
};

export default function SplitInboxTabs({ splits, selectedId, counts, onSelect, onManage, onCreate }: SplitInboxTabsProps) {
  const tabs = [{ id: "all", name: "All" }, ...splits.filter((split) => split.enabled), { id: "remaining", name: "Remaining" }];
  const selected = tabs.some((tab) => tab.id === selectedId) ? selectedId : "all";
  const tabList = useRef<HTMLDivElement>(null);

  useEffect(() => {
    tabList.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected]);

  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
      : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
        : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : undefined;
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(tabs[next]!.id);
    tabList.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  return <nav className="split-inbox-bar" aria-label="Split inboxes">
    <div ref={tabList} className="split-inbox-tabs" role="tablist" aria-label="Filter Imbox by split" aria-orientation="horizontal">
      {tabs.map((tab, index) => <button key={tab.id} type="button" role="tab" data-split-id={tab.id} data-split-navigation="tab"
        aria-selected={selected === tab.id} tabIndex={selected === tab.id ? 0 : -1}
        title={tab.id === "remaining" ? "Mail that does not match an enabled split" : tab.name}
        onClick={() => onSelect(tab.id)} onKeyDown={(event) => navigate(event, index)}>
        <span className="split-inbox-name">{tab.name}</span>
        {typeof counts[tab.id] === "number" && counts[tab.id]! > 0 && <span className="split-inbox-count" aria-label={`${counts[tab.id]} outstanding conversations`}>{counts[tab.id]}</span>}
      </button>)}
    </div>
    <div className="split-inbox-tools">
      <button type="button" className="icon-button" onClick={onCreate} aria-label="Create split" title="Create split"><Plus size={16} /></button>
      <button type="button" className="icon-button" onClick={onManage} aria-label="Manage splits" title="Manage splits"><SlidersHorizontal size={16} /></button>
    </div>
  </nav>;
}
