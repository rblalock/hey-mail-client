import { useEffect, useMemo, useRef, useState } from "react";
import { confirmAction } from "./ConfirmAction";
import type { AgentChatLink, AgentWorkspace } from "../../../shared/contracts";
import { matchingSessions } from "../session-history";
import { appSound } from "../sound";

type Props = {
  workspace?: AgentWorkspace;
  onWorkspace: (workspace: AgentWorkspace) => void;
  onOpen: () => void;
};

export default function SessionHistory({ workspace, onWorkspace, onOpen }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const searchInput = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const sessions = useMemo(() => matchingSessions([...(workspace?.chats ?? []), ...(workspace?.archivedChats ?? [])], query, filter), [workspace?.chats, workspace?.archivedChats, query, filter]);
  useEffect(() => { searchInput.current?.focus(); }, []);

  const act = async (chat: AgentChatLink, open: boolean) => {
    if (pending.current) return;
    const running = workspace?.tabs.some((tab) => tab.id === chat.id && ["starting", "running"].includes(tab.status));
    if (!open && !chat.archivedAt && running && !await confirmAction("This session is still working. Archive it and stop the current run?", "Archive session")) return;
    pending.current = true;
    setBusy(chat.id); setError(undefined);
    try {
      if (!open || chat.archivedAt) onWorkspace(await window.heyAgent.agent.archiveSession(chat.id, !open && !chat.archivedAt));
      if (open) {
        onWorkspace(await window.heyAgent.agent.openChat(chat.id));
        onOpen();
      }
      appSound.play(open ? "open" : "drop", "interface");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update this session.");
      appSound.play("error", "agent");
    } finally { pending.current = false; setBusy(undefined); }
  };

  return <section className="panel session-history-panel" aria-label="Past sessions">
    <header className="panel-header"><div className="title-cluster"><h1>Past sessions</h1><span className="title-count">{sessions.length}</span></div></header>
    <div className="session-history-toolbar">
      <input ref={searchInput} type="search" aria-label="Search all sessions" placeholder="Search sessions" value={query} onChange={(event) => setQuery(event.target.value)} />
      <select aria-label="Session status" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All sessions</option><option value="active">Unarchived</option><option value="archived">Archived</option></select>
    </div>
    {error && <p className="composer-error" role="alert">{error}</p>}
    <div className="session-history-scroll">
      <table className="session-history-table">
        <thead><tr><th scope="col">Session</th><th scope="col">Updated</th><th scope="col">Status</th><th scope="col" aria-label="Actions" /></tr></thead>
        <tbody>{sessions.map((chat) => <tr key={chat.id} data-selected={workspace?.activeTabId === chat.id} aria-busy={busy === chat.id}>
          <td><button className="session-history-title" type="button" title={chat.title} disabled={Boolean(busy)} data-tooltip={chat.archivedAt ? "Restore and open session" : "Open session"} onClick={() => void act(chat, true)}>{chat.title}</button></td>
          <td><time dateTime={chat.updatedAt} title={new Date(chat.updatedAt).toLocaleString()}>{new Date(chat.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</time></td>
          <td>{chat.archivedAt ? "Archived" : "Unarchived"}</td>
          <td><button className="session-history-action" type="button" disabled={Boolean(busy)} aria-label={`${chat.archivedAt ? "Restore" : "Archive"} ${chat.title}`} onClick={() => void act(chat, false)}>{chat.archivedAt ? "Restore" : "Archive"}</button></td>
        </tr>)}</tbody>
      </table>
      {sessions.length === 0 && <p className="session-history-empty">{!workspace ? "Loading sessions…" : query || filter !== "all" ? "No matching sessions" : "No sessions yet"}</p>}
    </div>
  </section>;
}
