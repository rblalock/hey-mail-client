import {
  AlertCircle, CalendarDays, Check, ChevronDown, ExternalLink, File, FileText, FileUp, LoaderCircle, Mail,
  MoreVertical, Paperclip, Pencil, Plus, Save, TerminalSquare, TextQuote, Trash2, Wrench, X,
} from "lucide-react";
import { ChevronDown as ChevronDownData, ChevronRight as ChevronRightData, CircleStop as CircleStopData, Paperclip as PaperclipData, Send as SendData, X as XData } from "lucide";
import { type KeyboardEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentAttachment, AgentNativeAttachment, AgentObjectLink, AgentRun, AgentSnapshot, AgentThreadAttachment, AgentToolActivity, AgentUiRequest, AgentWorkspace, ImboxPosting, MailboxKey, SoundSettings } from "../../../shared/contracts";
import { agentRunResultObjects } from "../agent-activity";
import { agentStarters } from "../agent-suggestions";
import { useProfileValue } from "../profile-storage";
import { appSound } from "../sound";
import AgentMarkdown from "./AgentMarkdown";
import AgentHandoffDialog from "./AgentHandoffDialog";
import AgentObjectPreview from "./AgentObjectPreview";
import MorphingIcon from "./MorphingIcon";
import RailMorphButton from "./RailMorphButton";
import { helperById } from "../../../shared/helpers";

type AgentPaneProps = {
  workspace: AgentWorkspace;
  onWorkspace: (workspace: AgentWorkspace) => void;
  posting?: ImboxPosting;
  mailbox?: MailboxKey;
  standalone?: boolean;
  initialDraft?: string;
  focusRequest?: number;
  onInitialDraftConsumed?: () => void;
  onUseInComposer?: (text: string) => void;
  onClose?: () => void;
  closeShortcut?: string;
  sound: SoundSettings;
  onOpenObject?: (object: AgentObjectLink) => void;
};

function attachmentFor(posting?: ImboxPosting, mailbox?: MailboxKey): AgentThreadAttachment | undefined {
  if (!posting?.topicId) return undefined;
  return { kind: "hey-thread", id: posting.topicId, title: posting.subject, subtitle: posting.sender.name, ...(mailbox ? { sourceBox: mailbox } : {}) };
}

function AttachmentIcon({ attachment, size = 12 }: { attachment: AgentAttachment; size?: number }) {
  if (attachment.kind === "local-file") return <File size={size} />;
  if (attachment.kind === "local-selection") return <TextQuote size={size} />;
  if (attachment.kind === "hey-thread") return <Mail size={size} />;
  if (attachment.objectKind.startsWith("calendar-")) return <CalendarDays size={size} />;
  return <FileText size={size} />;
}

function attachmentDescription(attachment: AgentAttachment): string | undefined {
  if (attachment.kind === "hey-thread") return attachment.subtitle ? `From ${attachment.subtitle}` : undefined;
  if (attachment.kind === "local-file") return attachment.path;
  return attachment.subtitle;
}

function AttachmentMenu({ snapshot, onWorkspace, onFocusComposer }: { snapshot: AgentSnapshot; onWorkspace: (workspace: AgentWorkspace) => void; onFocusComposer: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"files" | "selection">();
  const [error, setError] = useState<string>();
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); onFocusComposer(); } };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", dismiss); window.removeEventListener("keydown", escape); };
  }, [onFocusComposer, open]);
  const attach = async (kind: "files" | "selection") => {
    setBusy(kind); setError(undefined);
    try {
      const next = kind === "files"
        ? await window.heyAgent.agent.attachFiles(snapshot.tabId)
        : await window.heyAgent.agent.attachSelection(snapshot.tabId);
      const changed = next.activeSession.attachments.length > snapshot.attachments.length;
      onWorkspace(next);
      if (changed) appSound.play("drop", "interface");
      setOpen(false);
      onFocusComposer();
    } catch (reason) {
      appSound.play("error", "agent");
      setError(reason instanceof Error ? reason.message : "Unable to attach that context.");
    } finally {
      setBusy(undefined);
    }
  };
  return <div className="agent-attachment-menu" ref={menuRef}>
    <button type="button" className="agent-attach-button" aria-label="Attach context" aria-expanded={open} data-tooltip="Attach context" data-tooltip-side="top" onClick={() => { setOpen((value) => !value); setError(undefined); }}><MorphingIcon icon={open ? XData : PaperclipData} size={15} /></button>
    {open && <div className="agent-attachment-popover" role="dialog" aria-label="Attach context">
      <button type="button" disabled={Boolean(busy)} onClick={() => void attach("files")}><FileUp size={14} /><span><strong>Files</strong><small>Choose from this computer</small></span>{busy === "files" && <LoaderCircle className="is-spinning" size={13} />}</button>
      <button type="button" disabled={Boolean(busy)} onClick={() => void attach("selection")}><TextQuote size={14} /><span><strong>Selected text</strong><small>Use the current desktop selection</small></span>{busy === "selection" && <LoaderCircle className="is-spinning" size={13} />}</button>
      {error && <p role="alert">{error}</p>}
    </div>}
  </div>;
}

function durationLabel(milliseconds?: number): string | undefined {
  if (milliseconds === undefined) return undefined;
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1_000)}s`;
}

function ToolRow({ tool }: { tool: AgentToolActivity }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(tool.detail?.length || tool.error);
  const statusLabel = tool.state === "running" ? "Running" : tool.state === "error" ? "Failed" : "Done";
  return <div className={`agent-tool-row is-${tool.state}`}>
    <button type="button" className="agent-tool-summary" aria-expanded={hasDetail ? open : undefined} disabled={!hasDetail} onClick={() => setOpen((value) => !value)}>
      <span className="agent-tool-state" aria-label={statusLabel}>{tool.state === "running" ? <LoaderCircle className="is-spinning" size={13} /> : tool.state === "error" ? <AlertCircle size={13} /> : <Check size={13} />}</span>
      <strong title={tool.label}>{tool.label}</strong>{tool.target && <span className="agent-tool-target" title={tool.target}>{tool.target}</span>}<span className="agent-tool-duration">{durationLabel(tool.durationMs)}</span>{hasDetail && <MorphingIcon className="agent-disclosure-chevron" icon={open ? ChevronDownData : ChevronRightData} size={13} />}
    </button>
    {tool.artifact && (tool.artifact.objects.length === 0 || tool.artifact.status === "declined") && <div className={`agent-tool-artifact is-${tool.artifact.status}`}>
      <p>{tool.artifact.summary}</p>
    </div>}
    {open && hasDetail && <div className="agent-tool-detail">{tool.error && <p>{tool.error}</p>}{tool.detail?.map((line, index) => <code key={`${tool.id}-${index}`}>{line}</code>)}</div>}
  </div>;
}

function ActivityDisclosure({ run, waitingLabel = "Planning the next step…", onOpenObject, onAttachObject, attachedObjectIds }: { run: AgentRun; waitingLabel?: string; onOpenObject?: (object: AgentObjectLink) => void; onAttachObject?: (object: AgentObjectLink) => void; attachedObjectIds: Set<string> }) {
  const [open, setOpen] = useState(run.state === "running");
  const previousState = useRef(run.state);
  const resultObjects = useMemo(() => agentRunResultObjects(run.tools), [run.tools]);
  useEffect(() => {
    if (run.state === "running") setOpen(true);
    if (previousState.current === "running" && run.state !== "running") setOpen(false);
    previousState.current = run.state;
  }, [run.state]);
  const failed = run.tools.filter((tool) => tool.state === "error").length;
  const completed = run.tools.filter((tool) => tool.state === "complete").length;
  const summary = run.state === "running"
    ? run.tools.length ? `Working · ${run.tools.length} ${run.tools.length === 1 ? "step" : "steps"}` : "Working"
    : failed ? `${completed + failed} ${completed + failed === 1 ? "step" : "steps"} · ${failed} failed` : `${run.tools.length} ${run.tools.length === 1 ? "step" : "steps"} completed`;
  return <section className={`agent-run is-${run.state}`}>
    <button type="button" className="agent-run-header" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span className="agent-run-icon">{run.state === "running" ? <LoaderCircle className="is-spinning" size={14} /> : failed ? <AlertCircle size={14} /> : <Wrench size={14} />}</span>
      <strong>{summary}</strong><span>{durationLabel(run.durationMs)}</span><MorphingIcon className="agent-disclosure-chevron" icon={open ? ChevronDownData : ChevronRightData} size={14} />
    </button>
    {open && <div className="agent-run-tools">{run.tools.length ? run.tools.map((tool) => <ToolRow key={tool.id} tool={tool} />) : <div className="agent-run-waiting"><span className="agent-planning-dots" aria-hidden><i /><i /><i /></span><span>{waitingLabel}</span></div>}{resultObjects.length > 0 && <div className="agent-run-results"><span>{resultObjects.length} {resultObjects.length === 1 ? "result" : "results"}</span><div>{resultObjects.map((object) => {
      const attached = attachedObjectIds.has(`${object.kind}:${object.id}`);
      return <div className="agent-result-object" key={object.deepLink}><AgentObjectPreview object={object} onOpen={onOpenObject} variant="button"><span><strong>{object.title}</strong>{object.subtitle && <small>{object.subtitle}</small>}</span><ExternalLink size={13} /></AgentObjectPreview>{!attached && <button className="agent-result-attach" type="button" aria-label={`Keep ${object.title} as session context`} data-tooltip="Keep as context" onClick={() => onAttachObject?.(object)}><Paperclip size={12} /></button>}</div>;
    })}</div></div>}</div>}
  </section>;
}

function UiRequestCard({ tabId, request }: { tabId: string; request: AgentUiRequest }) {
  const editableApproval = request.heyAction?.editable;
  const [value, setValue] = useState(request.prefill ?? editableApproval?.value ?? "");
  const [editingApproval, setEditingApproval] = useState(false);
  const focusRef = useRef<HTMLTextAreaElement | HTMLButtonElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const titleId = `agent-request-${request.id}`;
  useEffect(() => {
    setValue(request.prefill ?? request.heyAction?.editable?.value ?? "");
    setEditingApproval(false);
    focusRef.current?.focus();
  }, [request.id, request.prefill, request.heyAction?.editable?.value]);
  useEffect(() => { if (editingApproval) editorRef.current?.focus(); }, [editingApproval]);
  const respond = (response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => window.heyAgent.agent.respondToUi(tabId, { id: request.id, ...response });
  const command = editableApproval
    ? `${editableApproval.commandPrefix}${displayApprovalArgument(value)}${editableApproval.commandSuffix}`
    : request.heyAction?.command;
  const validEdit = !editableApproval?.required || Boolean(value.trim());
  return <section className="agent-ui-request" role="dialog" aria-modal="false" aria-labelledby={titleId}>
    <div className="agent-ui-request-heading"><span><AlertCircle size={15} /></span><div><strong id={titleId}>{request.title}</strong>{request.heyAction ? <p>{request.heyAction.summary}</p> : request.message && <p>{request.message}</p>}</div></div>
    {request.heyAction && <>
      <dl className="agent-approval-fields">
        {request.heyAction.fields.map((field) => <div key={`${field.label}-${field.value}`}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}
        {editableApproval && <div className="agent-approval-editable"><dt>{editableApproval.label}</dt><dd>{editingApproval
          ? <textarea ref={editorRef} aria-label={editableApproval.label} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setEditingApproval(false);
              requestAnimationFrame(() => editButtonRef.current?.focus());
            } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && validEdit) {
              event.preventDefault();
              void respond({ value });
            }
          }} />
          : <button ref={editButtonRef} type="button" className="agent-approval-edit-value" aria-label={`Edit ${editableApproval.label}`} onClick={() => setEditingApproval(true)}><span>{value}</span><span className="agent-approval-edit-hint"><Pencil size={11} /> Edit</span></button>}</dd></div>}
      </dl>
      {command && <details className="agent-approval-command"><summary>Technical command</summary><code>{command}</code></details>}
    </>}
    {request.method === "select" && <div className="agent-ui-options">{request.options?.map((option, index) => <button ref={index === 0 ? focusRef as RefObject<HTMLButtonElement> : undefined} key={option} type="button" onClick={() => void respond({ value: option })}>{option}</button>)}</div>}
    {(request.method === "input" || (request.method === "editor" && !request.heyAction)) && <textarea ref={focusRef as RefObject<HTMLTextAreaElement>} aria-label={request.title} value={value} onChange={(event) => setValue(event.target.value)} placeholder={request.placeholder} />}
    <div className="agent-ui-actions"><button type="button" onClick={() => void respond({ cancelled: true })}>Cancel</button>{request.method === "confirm" && <button ref={focusRef as RefObject<HTMLButtonElement>} type="button" onClick={() => void respond({ confirmed: false })}>No</button>}{request.method === "editor" && request.heyAction && <button ref={focusRef as RefObject<HTMLButtonElement>} type="button" onClick={() => void respond({ cancelled: true })}>No</button>}{request.method === "confirm" && <button className="primary" type="button" onClick={() => void respond({ confirmed: true })}>{request.heyAction ? "Approve action" : "Yes, continue"}</button>}{request.method === "editor" && request.heyAction && <button className="primary" type="button" disabled={!validEdit} onClick={() => void respond({ value })}>Approve action</button>}{(request.method === "input" || (request.method === "editor" && !request.heyAction)) && <button className="primary" type="button" onClick={() => void respond({ value })}>Continue</button>}</div>
  </section>;
}

function displayApprovalArgument(value: string): string {
  return value.includes(" ") || value.includes("\n") ? JSON.stringify(value) : value;
}

function SessionMenu({ snapshot, onWorkspace, onError }: { snapshot: AgentSnapshot; onWorkspace: (workspace: AgentWorkspace) => void; onError: (message?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const [name, setName] = useState(snapshot.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) setName(snapshot.title); }, [open, snapshot.title]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", dismiss); window.removeEventListener("keydown", escape); };
  }, [open]);
  const rename = async () => {
    try { onWorkspace(await window.heyAgent.agent.renameSession(snapshot.tabId, name)); onError(undefined); setOpen(false); }
    catch (reason) { onError(reason instanceof Error ? reason.message : "Unable to rename this session."); }
  };
  const remove = async () => {
    try { onWorkspace(await window.heyAgent.agent.deleteSession(snapshot.tabId)); onError(undefined); setOpen(false); }
    catch (reason) { onError(reason instanceof Error ? reason.message : "Unable to delete this session."); }
  };
  return <div className="agent-session-menu" ref={menuRef}>
    <button type="button" className="agent-session-menu-button" aria-label="Session options" aria-expanded={open} onClick={() => { setOpen((value) => !value); setConfirmDelete(false); }}><MoreVertical size={16} /></button>
    {open && <div className="agent-session-popover" role="dialog" aria-label="Session options">
      <form onSubmit={(event) => { event.preventDefault(); void rename(); }}>
        <label htmlFor={`session-name-${snapshot.tabId}`}>Session name</label>
        <div><input id={`session-name-${snapshot.tabId}`} value={name} maxLength={160} onChange={(event) => setName(event.target.value)} /><button type="submit" aria-label="Save session name" disabled={!name.trim() || name.trim() === snapshot.title}><Save size={14} /></button></div>
      </form>
      <dl>{snapshot.helperId && <div><dt>Helper</dt><dd>{snapshot.helperInstructions?.title ?? helperById(snapshot.helperId)?.title ?? "Personal Helper"}</dd></div>}<div><dt>Model</dt><dd>{snapshot.model?.name ?? "Loads when used"}</dd></div><div><dt>Workspace</dt><dd title={snapshot.workingDirectory}>{snapshot.workingDirectory.split("/").pop() || snapshot.workingDirectory}</dd></div></dl>
      <button type="button" className="agent-session-action" disabled={!snapshot.sessionFile} onClick={() => void window.heyAgent.agent.continueInTerminal(snapshot.tabId)}><TerminalSquare size={14} /> Continue in terminal</button>
      <button type="button" className="agent-session-action" disabled={["running", "starting"].includes(snapshot.status) || Boolean(snapshot.pendingUiRequest)} title={["running", "starting"].includes(snapshot.status) || snapshot.pendingUiRequest ? "Wait for this chat to finish, or stop it, before handing it off" : "Preview a prompt to copy or open in another agent"} onClick={() => { setOpen(false); setHandoff(true); }}><ExternalLink size={14} /> Continue in another agent…</button>
      {!confirmDelete ? <button type="button" className="agent-session-action is-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> Delete session</button> : <div className="agent-delete-confirm"><p>Remove this session from HEY Agent? Its Pi transcript will stay on disk.</p><div><button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button><button type="button" className="is-danger" onClick={() => void remove()}>Delete</button></div></div>}
    </div>}
    {handoff && <AgentHandoffDialog key={snapshot.tabId} tabId={snapshot.tabId} onClose={() => { setHandoff(false); requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>(".agent-session-menu-button")?.focus()); }} />}
  </div>;
}

function SessionTabs({ workspace, snapshot, attachment, onWorkspace, onError, onClose, closeShortcut }: { workspace: AgentWorkspace; snapshot: AgentSnapshot; attachment?: AgentNativeAttachment; onWorkspace: (workspace: AgentWorkspace) => void; onError: (message?: string) => void; onClose?: () => void; closeShortcut?: string }) {
  const listRef = useRef<HTMLDivElement>(null);
  const activate = async (tabId: string) => {
    try { onWorkspace(await window.heyAgent.agent.activateSession(tabId)); onError(undefined); }
    catch (reason) { onError(reason instanceof Error ? reason.message : "Unable to open that session."); }
  };
  const handleKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const index = workspace.tabs.findIndex((tab) => tab.id === workspace.activeTabId);
    const next = workspace.tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + workspace.tabs.length) % workspace.tabs.length];
    if (!next) return;
    event.preventDefault(); void activate(next.id);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${next.id}"]`)?.focus());
  };
  return <div className="agent-tabs-bar">
    <div ref={listRef} className="agent-tabs" role="tablist" aria-label="Open HEY Agent sessions" onKeyDown={handleKeys}>
      {workspace.tabs.map((tab) => <div className="agent-tab-wrap" key={tab.id}><button type="button" role="tab" data-tab-id={tab.id} aria-selected={tab.id === workspace.activeTabId} tabIndex={tab.id === workspace.activeTabId ? 0 : -1} className="agent-tab" title={tab.title} onClick={() => void activate(tab.id)}><span className={`agent-state-dot is-${tab.status}`} /><span>{tab.title}</span></button><button type="button" className="agent-tab-close" aria-label={`Close ${tab.title}`} data-tooltip="Close session" data-shortcut-id={tab.id === workspace.activeTabId ? "session-close" : undefined} onClick={() => void window.heyAgent.agent.closeSession(tab.id).then(onWorkspace)}><X size={12} /></button></div>)}
    </div>
    <button type="button" className="agent-new-tab" aria-label="New session" data-tooltip="New session" data-shortcut-id="session-new" onClick={() => void window.heyAgent.agent.newSession(attachment ? { attachment } : {}).then(onWorkspace)}><Plus size={15} /></button>
    <SessionMenu snapshot={snapshot} onWorkspace={onWorkspace} onError={onError} />
    {onClose && <RailMorphButton rail="agent" open className="agent-rail-close" aria-label="Hide HEY Agent" data-tooltip="Hide HEY Agent" data-shortcut={closeShortcut} data-tooltip-side="left" onClick={onClose} />}
  </div>;
}

export default function AgentPane({ workspace, onWorkspace, posting, mailbox, standalone = false, initialDraft, focusRequest = 0, onInitialDraftConsumed, onUseInComposer, onClose, closeShortcut, sound, onOpenObject }: AgentPaneProps) {
  const snapshot = workspace.activeSession;
  const helper = snapshot.helperInstructions ?? (snapshot.helperId ? helperById(snapshot.helperId) : undefined);
  const currentAttachment = useMemo(() => attachmentFor(posting, mailbox), [mailbox, posting]);
  const [draft, setDraft] = useProfileValue(`chat:${snapshot.tabId}:input`, "");
  const [localError, setLocalError] = useState<string>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const nearBottomRef = useRef(true);
  const previousStatus = useRef(snapshot.status);
  const attachedCurrent = currentAttachment && snapshot.attachments.some((item) => item.kind === currentAttachment.kind && item.id === currentAttachment.id);
  const starterMailbox = snapshot.attachments.length === 1 && snapshot.attachments[0]!.kind === "hey-thread" ? snapshot.attachments[0]!.sourceBox ?? (attachedCurrent ? mailbox : undefined) : undefined;
  const starters = useMemo(() => agentStarters(snapshot.attachments, starterMailbox), [snapshot.attachments, starterMailbox]);
  const attachedObjectIds = useMemo(() => new Set(snapshot.attachments.flatMap((attachment) => attachment.kind === "hey-object" ? [`${attachment.objectKind}:${attachment.id}`] : [])), [snapshot.attachments]);
  const reusableAssistantMessageId = useMemo(() => [...snapshot.timeline].reverse().find((item) => item.kind === "message" && item.role === "assistant" && item.state !== "streaming" && item.text.trim())?.id, [snapshot.timeline]);
  const attachObject = (object: AgentObjectLink) => void window.heyAgent.agent.attach(snapshot.tabId, { kind: "hey-object", objectKind: object.kind, id: object.id, title: object.title, ...(object.subtitle ? { subtitle: object.subtitle } : {}), deepLink: object.deepLink }).then(onWorkspace).catch((reason: unknown) => setLocalError(reason instanceof Error ? reason.message : "Unable to attach that HEY object."));

  useEffect(() => {
    if (!nearBottomRef.current) return;
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: snapshot.status === "running" ? "auto" : "smooth" }));
  }, [snapshot.timeline, snapshot.pendingUiRequest, snapshot.status]);
  const send = async (value = draft) => {
    if (!value.trim() || snapshot.status === "running") return;
    setDraft(""); setLocalError(undefined);
    try { await window.heyAgent.agent.send(snapshot.tabId, value.trim()); appSound.play("send", "agent"); }
    catch (reason) { appSound.play("error", "agent"); setDraft(value); setLocalError(reason instanceof Error ? reason.message : "HEY Agent could not send that message."); }
  };
  const hasConversation = snapshot.timeline.some((item) => item.kind === "message" && item.role !== "notice");
  const streaming = snapshot.timeline.some((item) => item.kind === "message" && item.role === "assistant" && item.state === "streaming");
  const activeRun = snapshot.timeline.some((item) => item.kind === "run" && item.state === "running");
  const busy = snapshot.status === "starting" || snapshot.status === "running";
  const showContextRow = snapshot.attachments.length > 0 || Boolean(currentAttachment && !attachedCurrent);
  const activeError = localError || snapshot.error;

  useEffect(() => {
    if (!initialDraft) return;
    setDraft(initialDraft);
    onInitialDraftConsumed?.();
    requestAnimationFrame(() => composerRef.current?.focus());
  }, [initialDraft, onInitialDraftConsumed]);

  useEffect(() => {
    if (focusRequest <= 0) return;
    requestAnimationFrame(() => composerRef.current?.focus());
  }, [focusRequest]);

  useEffect(() => {
    const key = `agent:${snapshot.tabId}`;
    if (snapshot.status === "starting") appSound.startLoop(key, "connecting", "agent-loop");
    else if (snapshot.status === "running" && !snapshot.pendingUiRequest) appSound.startLoop(key, streaming ? "streaming" : "processing", "agent-loop");
    else appSound.stopLoop(key);
    return () => appSound.stopLoop(key);
  }, [snapshot.pendingUiRequest, snapshot.status, snapshot.tabId, sound.agentLoops, sound.agentSounds, sound.enabled, streaming]);

  useEffect(() => {
    const previous = previousStatus.current;
    if (previous === "running" && snapshot.status !== "running" && snapshot.status !== "stopped") appSound.play(snapshot.status === "error" || snapshot.error ? "error" : "receive", "agent");
    previousStatus.current = snapshot.status;
  }, [snapshot.error, snapshot.status]);

  const stop = async () => {
    try { await window.heyAgent.agent.abort(snapshot.tabId); appSound.play("stop", "agent"); }
    catch (reason) { appSound.play("error", "agent"); setLocalError(reason instanceof Error ? reason.message : "HEY Agent could not stop that run."); }
  };
  const chooseStarter = (prompt: string) => {
    setDraft(prompt);
    requestAnimationFrame(() => composerRef.current?.focus());
  };
  const focusComposer = useCallback(() => composerRef.current?.focus(), []);

  return <div className={`agent-pane ${standalone ? "is-standalone" : ""}`}>
    <SessionTabs workspace={workspace} snapshot={snapshot} attachment={currentAttachment} onWorkspace={onWorkspace} onError={setLocalError} onClose={onClose} closeShortcut={closeShortcut} />
    <div className="agent-transcript" ref={scrollRef} role="log" aria-live="polite" aria-relevant="additions text" onScroll={(event) => { const element = event.currentTarget; nearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96; }}>
      {!hasConversation && activeError ? <div className="agent-session-error-state"><span><AlertCircle size={20} /></span><h2>Session unavailable</h2><p>{activeError}</p><button type="button" onClick={() => void window.heyAgent.agent.newSession(currentAttachment ? { attachment: currentAttachment } : {}).then(onWorkspace)}>New session</button></div>
        : !hasConversation && !busy && snapshot.attachments.length > 0 && <div className="agent-intro is-contextual"><span className="agent-mark"><AttachmentIcon attachment={snapshot.attachments[0]!} size={19} /></span><h2>{snapshot.attachments.length === 1 ? snapshot.attachments[0]!.title : `${snapshot.attachments.length} ${snapshot.attachments.every((item) => item.kind === "hey-thread") ? "conversations" : "items"} attached`}</h2>{snapshot.attachments.length === 1 && attachmentDescription(snapshot.attachments[0]!) ? <p title={attachmentDescription(snapshot.attachments[0]!)}>{attachmentDescription(snapshot.attachments[0]!)}</p> : null}<div className="agent-suggestions">{starters.map((starter) => <button type="button" key={starter.label} onClick={() => chooseStarter(starter.prompt)}>{starter.label}</button>)}</div></div>}
      {snapshot.status === "starting" && !activeRun && <div className="agent-loading"><LoaderCircle className="is-spinning" size={15} /> Connecting {helper?.title ?? "HEY Agent"}…</div>}
      {snapshot.timeline.map((item) => item.kind === "run" ? <ActivityDisclosure key={item.id} run={item} waitingLabel={helper ? "Reading attached context…" : undefined} onOpenObject={onOpenObject} onAttachObject={attachObject} attachedObjectIds={attachedObjectIds} /> : <article key={item.id} className={`agent-message is-${item.role} is-${item.state ?? "complete"}`}><span>{item.role === "user" ? "You" : item.role === "assistant" ? helper?.title ?? "HEY Agent" : "Update"}</span>{item.role === "assistant" ? <AgentMarkdown text={item.text || (item.state === "streaming" ? "Working…" : "")} streaming={item.state === "streaming"} onOpenObject={onOpenObject} /> : <p>{item.text || (item.state === "streaming" ? "Working…" : "")}</p>}{onUseInComposer && item.id === reusableAssistantMessageId && <button type="button" className="agent-use-in-composer" onClick={() => onUseInComposer(item.text)}><Pencil size={12} /> Use in reply</button>}</article>)}
      {snapshot.pendingUiRequest && <UiRequestCard tabId={snapshot.tabId} request={snapshot.pendingUiRequest} />}
      {hasConversation && activeError && <div className="agent-error"><AlertCircle size={14} /><span>{activeError}</span></div>}
    </div>
    <div className="agent-composer">
      {showContextRow && <div className="agent-context-row" aria-label="Session context">{snapshot.attachments.length > 2 ? <details className="agent-context-group"><summary><Mail size={12} /><span>{snapshot.attachments.length} {snapshot.attachments.every((item) => item.kind === "hey-thread") ? "conversations" : "items"}</span><ChevronDown size={12} /></summary><div>{snapshot.attachments.map((attachment) => <span className={`agent-context-chip is-${attachment.kind}`} key={`${attachment.kind}:${attachment.id}`} title={attachment.kind === "local-file" ? attachment.path : attachment.title}><AttachmentIcon attachment={attachment} /><span>{attachment.title}</span><button type="button" title="Remove from session" aria-label={`Remove ${attachment.title} from session`} onClick={() => void window.heyAgent.agent.detach(snapshot.tabId, attachment.id).then((next) => { appSound.play("deselect", "interface"); onWorkspace(next); })}><X size={11} /></button></span>)}</div></details> : snapshot.attachments.map((attachment) => <span className={`agent-context-chip is-${attachment.kind}`} key={`${attachment.kind}:${attachment.id}`} title={attachment.kind === "local-file" ? attachment.path : attachment.title}><AttachmentIcon attachment={attachment} /><span>{attachment.title}</span><button type="button" title="Remove from session" aria-label={`Remove ${attachment.title} from session`} onClick={() => void window.heyAgent.agent.detach(snapshot.tabId, attachment.id).then((next) => { appSound.play("deselect", "interface"); onWorkspace(next); })}><X size={11} /></button></span>)}{currentAttachment && !attachedCurrent && <button type="button" className="agent-add-context" onClick={() => void window.heyAgent.agent.attach(snapshot.tabId, currentAttachment).then((next) => { appSound.play("drop", "interface"); onWorkspace(next); })}><Paperclip size={13} /> Add email to session</button>}</div>}
      <textarea ref={composerRef} aria-label={`Message ${helper?.title ?? "HEY Agent"}`} data-tooltip="Focus AI chat composer" data-shortcut-id="focus-agent" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); } }} placeholder={helper ? `Ask ${helper.title}…` : snapshot.attachments.length ? "Ask about the emails in this session…" : "Message HEY Agent…"} disabled={snapshot.status === "starting"} />
      <div className="agent-composer-footer"><AttachmentMenu snapshot={snapshot} onWorkspace={onWorkspace} onFocusComposer={focusComposer} /><button type="button" className={snapshot.status === "running" ? "agent-stop" : undefined} aria-label={snapshot.status === "running" ? `Stop ${helper?.title ?? "HEY Agent"}` : `Send to ${helper?.title ?? "HEY Agent"}`} data-tooltip={snapshot.status === "running" ? `Stop ${helper?.title ?? "HEY Agent"}` : `Send to ${helper?.title ?? "HEY Agent"}`} data-shortcut={snapshot.status === "running" ? undefined : "Ctrl+Enter"} data-tooltip-side="top" disabled={snapshot.status !== "running" && (!draft.trim() || busy)} onClick={() => snapshot.status === "running" ? void stop() : void send()}><MorphingIcon icon={snapshot.status === "running" ? CircleStopData : SendData} size={16} /></button></div>
    </div>
  </div>;
}
