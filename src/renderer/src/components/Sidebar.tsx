import {
  Archive, Plus,
} from "lucide-react";
import { ChevronDown as ChevronDownData, ChevronRight as ChevronRightData } from "lucide";
import { useState } from "react";
import appIcon from "../../../../resources/icon.png";
import type { AgentChatLink } from "../../../shared/contracts";
import type { ShortcutDefinition, ShortcutId } from "../shortcuts";
import { appSound } from "../sound";
import { recentSessions } from "../session-history";
import MorphingIcon from "./MorphingIcon";
import RailMorphButton from "./RailMorphButton";
import AccountControl from "./AccountControl";
import ProfileMenu from "./ProfileMenu";
import { sidebarItemIcon, type SidebarIconKey } from "./sidebar-icons";

type SidebarProps = {
  imboxCount: number;
  active: string;
  chats: AgentChatLink[];
  activeChatId?: string;
  collapsed: boolean;
  onNavigate: (key: string) => void;
  onCompose: () => void;
  onNewChat: () => void;
  onOpenChat: (chatId: string) => void;
  onArchiveChat: (chatId: string, archived: boolean) => void;
  onToggleCollapsed: () => void;
  shortcuts: ShortcutDefinition[];
};

type SessionRowProps = {
  chat: AgentChatLink;
  active: boolean;
  onOpen: () => void;
  onArchive: () => void;
};

function SessionRow({ chat, active, onOpen, onArchive }: SessionRowProps) {
  return <div className="recent-chat-row" data-active={active}>
    <button type="button" className="recent-chat" data-active={active} title={chat.title} onClick={onOpen}><span>{chat.title}</span></button>
    <span className="recent-chat-actions">
      <button type="button" aria-label={`Archive ${chat.title}`} data-tooltip="Archive session" data-tooltip-side="right" onClick={onArchive}><Archive size={12} /></button>
    </span>
  </div>;
}

const MAIL_ITEMS = [
  { key: "drafts", label: "Drafts" },
  { key: "imbox", label: "Imbox" },
  { key: "feed", label: "The Feed" },
  { key: "paper-trail", label: "Paper Trail" },
  { key: "reply-later", label: "Reply Later" },
  { key: "set-aside", label: "Set Aside" },
  { key: "bubble-up", label: "Bubble Up" },
  { key: "screener", label: "The Screener" },
  { key: "calendar", label: "Calendar" },
  { key: "library", label: "Library" },
] satisfies { key: SidebarIconKey; label: string }[];

const ROUTE_SHORTCUTS: Record<string, ShortcutId | undefined> = {
  imbox: "nav-imbox", feed: "nav-feed", "paper-trail": "nav-trail", "reply-later": "nav-later",
  "set-aside": "nav-aside", "bubble-up": "nav-bubble", screener: "nav-screener", calendar: "nav-calendar",
};

export default function Sidebar({ imboxCount, active, chats, activeChatId, collapsed, onNavigate, onCompose, onNewChat, onOpenChat, onArchiveChat, onToggleCollapsed, shortcuts }: SidebarProps) {
  const [sessionsExpanded, setSessionsExpanded] = useState(true);
  const [previewedItem, setPreviewedItem] = useState<SidebarIconKey>();
  const visibleChats = recentSessions(chats);
  const display = (id?: ShortcutId) => id ? shortcuts.find((shortcut) => shortcut.id === id)?.display : undefined;
  const previewNavigation = () => appSound.play("hover", "interface", { cooldownMs: 70, retrigger: "restart" });
  const beginItemPreview = (key: SidebarIconKey, audible: boolean) => {
    setPreviewedItem(key);
    if (audible) previewNavigation();
  };
  const endItemPreview = (key: SidebarIconKey) => setPreviewedItem((current) => current === key ? undefined : current);

  return (
    <aside className="sidebar" data-collapsed={collapsed} aria-label="HEY navigation">
      <div className="sidebar-inner">
        <div className="sidebar-heading">
          <button className="workspace-switcher" type="button" title="HEY Agent" aria-label="HEY Agent">
            <img className="workspace-icon" src={appIcon} alt="" width={22} height={22} draggable={false} />
          </button>
          <RailMorphButton rail="navigation" open={!collapsed} iconSize={17} className="icon-button sidebar-toggle" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} data-tooltip={collapsed ? "Expand navigation sidebar" : "Collapse navigation sidebar"} data-shortcut={display("toggle-navigation")} data-tooltip-side="right" onClick={onToggleCollapsed} />
        </div>

        <nav className="nav-group" aria-label="Mail">
          <button className="nav-row compose-row" type="button" data-tooltip="Compose a message" data-shortcut={display("compose")} data-tooltip-side="right" onPointerEnter={() => beginItemPreview("compose", true)} onPointerLeave={() => endItemPreview("compose")} onFocus={() => beginItemPreview("compose", false)} onBlur={() => endItemPreview("compose")} onClick={onCompose}>
            <span className="nav-icon"><MorphingIcon icon={sidebarItemIcon("compose", previewedItem === "compose")} size={17} /></span><span className="sidebar-copy">Compose</span><kbd className="sidebar-copy">{display("compose")}</kbd>
          </button>
          {MAIL_ITEMS.map(({ key, label }) => <button key={key} className="nav-row" data-active={active === key} type="button" data-tooltip={label} data-shortcut={display(ROUTE_SHORTCUTS[key])} data-tooltip-side="right" onPointerEnter={() => beginItemPreview(key, true)} onPointerLeave={() => endItemPreview(key)} onFocus={() => beginItemPreview(key, false)} onBlur={() => endItemPreview(key)} onClick={() => onNavigate(key)}>
            <span className="nav-icon"><MorphingIcon icon={sidebarItemIcon(key, active === key || previewedItem === key)} size={17} /></span><span className="sidebar-copy nav-label">{label}</span>
            {key === "imbox" && imboxCount > 0 && <span className="sidebar-copy nav-count">{imboxCount}</span>}
          </button>)}
        </nav>

        <section className="sidebar-section chats-section sidebar-copy" aria-label="Sessions">
          <button className="section-label sessions-toggle" type="button" aria-expanded={sessionsExpanded} data-tooltip="Sessions" data-shortcut={display("nav-sessions")} data-tooltip-side="right" onClick={() => setSessionsExpanded((value) => !value)}>
            <span>Sessions</span><span className="sessions-toggle-meta"><small>{visibleChats.length}</small><MorphingIcon icon={sessionsExpanded ? ChevronDownData : ChevronRightData} size={14} /></span>
          </button>
          {sessionsExpanded && <div className="sessions-content">
            <button className="session-new-row" type="button" data-tooltip="New session" data-shortcut={display("session-new")} data-tooltip-side="right" onClick={onNewChat}><Plus size={14} /><span>New session</span></button>
            <div className="recent-chats">
              {visibleChats.map((chat) => <SessionRow key={chat.id} chat={chat} active={activeChatId === chat.id} onOpen={() => onOpenChat(chat.id)} onArchive={() => onArchiveChat(chat.id, true)} />)}
              {visibleChats.length === 0 && <span className="recent-chats-empty">No recent sessions</span>}
            </div>
          </div>}
          <button type="button" className="session-history-link" data-active={active === "sessions"} onClick={() => onNavigate("sessions")}><span>View past sessions</span><MorphingIcon icon={ChevronRightData} size={12} /></button>
        </section>

        <div className="sidebar-footer">
          <div className="sidebar-profile">
            {typeof window !== "undefined" && window.heyAgent?.profiles && <AccountControl state={window.heyAgent.profiles.current} />}
            <ProfileMenu onSettings={() => onNavigate("settings")} active={active === "settings"} shortcut={display("nav-settings")} />
          </div>
        </div>
      </div>
    </aside>
  );
}
