import { AlertCircle, Sparkles } from "lucide-react";
import ConfirmAction, { confirmAction } from "./components/ConfirmAction";
import TrashUndoToast from "./components/TrashUndoToast";
import { useTrashQueue } from "./use-trash-queue";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProfileValue } from "./profile-storage";
import type {
  AgentNativeAttachment, AgentObjectLink, AgentWorkspace, AppSettings, BulkReplySendResult, CalendarEvent, ImboxPosting, MailContactDetail, MailLibraryKind, MailMutationRequest, MailOrganizationKind, MailOverview, MailSendResult, MailThread, MailThreadListing, MailboxKey, SetAsideGroupMutationRequest, ThemeSnapshot,
} from "../../shared/contracts";
import AgentPane from "./components/AgentPane";
import BulkReplyComposer from "./components/BulkReplyComposer";
import CalendarView from "./components/CalendarView";
import CommandPalette from "./components/CommandPalette";
import DraftsView from "./components/DraftsView";
import ImboxView from "./components/ImboxView";
import MailComposer from "./components/MailComposer";
import MailLibrary from "./components/MailLibrary";
import MailOrganizer from "./components/MailOrganizer";
import MailSearch from "./components/MailSearch";
import MissingObjectView from "./components/MissingObjectView";
import ReadTogetherView, { type ReadTogetherHandle, type ReadTogetherItem } from "./components/ReadTogetherView";
import ScreenerView from "./components/ScreenerView";
import SettingsView from "./components/SettingsView";
import Sidebar from "./components/Sidebar";
import SessionHistory from "./components/SessionHistory";
import ThreadPanel from "./components/ThreadPanel";
import ThreadListingView from "./components/ThreadListingView";
import RailMorphButton from "./components/RailMorphButton";
import { MailThreadCache } from "./mail-thread-cache";
import { bulkMutationRequest, isBulkMutationCommand, prioritizeBulkCommands } from "./bulk-actions";
import { mailToggle } from "./mail-toggles";
import { extendMailboxSelection, groupImboxPostings, moveMailboxCursor, postingAtCursor, type MailSelectionRange } from "./mailbox-navigation";
import { applyOptimisticMailMutation, hidePendingTrash, nextPostingInSequence, type MailboxCache } from "./optimistic-mail";
import { readThreadUntilAdvanced } from "./thread-reconciliation";
import { postingsForReadTogether, skippedReadTogetherCount } from "./read-together";
import TooltipLayer from "./components/TooltipLayer";
import { ShortcutContext } from "./shortcut-context";
import { isShortcutEvent, matchesBindingStep } from "../../shared/shortcut-binding";
import { completesShortcutChord, DEFAULT_SETTINGS, matchesShortcut, resolveShortcuts, startsShortcutChord, type ShortcutDefinition, type ShortcutId } from "./shortcuts";
import { isDialogKeyboardEvent, isEditingEvent, isLocalKeyboardEvent, isNativeEditingShortcut } from "../../shared/keyboard-scope";
import { appSound, installSoundUnlock } from "./sound";
import { calendarTargetDate, eventDayKey } from "./calendar";
import { helperCatalog, helperAcceptsContextCount, helperById, helperCommandId, helperCommandLabel, helperIdFromCommand, helperStarter, isCustomHelperId, type HelperId } from "../../shared/helpers";
import { calendarHelperInput, eventHelperAttachment, type HelperCalendarWindow } from "./helper-context";
import { buildMissingObjectRecoveryPrompt } from "./missing-object";
import { deriveThemeVariables } from "./theme-palette";
import { COMPACT_AGENT_NAVIGATION_QUERY, navigationPresentation } from "./shell-layout";
import { MAX_CONTEXTUAL_MAIL_ATTACHMENTS, attachmentForPosting, attachmentsForPostings, contextualAgentCommands, contextualAgentPrompt, continueReplyPrompt, unattachedMailContext } from "./agent-context-actions";

function applyTheme(theme: ThemeSnapshot): void {
  const root = document.documentElement;
  root.dataset.theme = theme.mode;
  root.dataset.omarchyTheme = theme.name;
  for (const [property, value] of Object.entries(deriveThemeVariables(theme))) root.style.setProperty(property, value);
}

function UnsupportedView({ active, onReturn }: { active: string; onReturn: () => void }) {
  return <section className="panel placeholder-panel"><div className="placeholder-content"><span className="placeholder-mark"><AlertCircle size={22} /></span><h1>{active.replaceAll("-", " ")}</h1><p>This HEY destination is represented in the shell and will be connected after the Imbox path is proven.</p><button type="button" className="primary-button" onClick={onReturn}>Return to Imbox</button></div></section>;
}

const MAILBOX_ROUTES: Partial<Record<string, MailboxKey>> = {
  imbox: "imbox",
  feed: "feedbox",
  "paper-trail": "trailbox",
  "set-aside": "asidebox",
  "reply-later": "laterbox",
  "bubble-up": "bubblebox",
};

const MAILBOX_LABELS: Record<MailboxKey, string> = {
  imbox: "Imbox",
  feedbox: "The Feed",
  trailbox: "Paper Trail",
  asidebox: "Set Aside",
  laterbox: "Reply Later",
  bubblebox: "Bubble Up",
};

const MAILBOX_KEYS: MailboxKey[] = ["imbox", "feedbox", "trailbox", "laterbox", "asidebox", "bubblebox"];
const READER_TRIAGE_OPERATIONS = new Set<MailMutationRequest["operation"]>(["seen", "unseen", "move", "bubble", "trash", "spam"]);
type MailboxLoading = Partial<Record<MailboxKey, boolean>>;
type MailboxCursor = Partial<Record<MailboxKey, string>>;

type Notice = { message: string; undo?: MailMutationRequest; bulkUndoId?: string };
type ComposerState = { mode: "compose" | "forward"; posting?: ImboxPosting; initialTo?: string };
type AgentDraftSeed = { tabId: string; text: string };
type ReplyDraftSeed = { postingId: string; revision: number; text: string; mode?: "append" | "replace" };
type ReadTogetherState = { postingIds: string[]; skippedCount: number };
type OrganizerState = { postings: ImboxPosting[]; initialKind?: MailOrganizationKind };
type CalendarAgentTarget = { object: AgentObjectLink; eventId?: string; date?: string; section?: "schedule" | "habits" | "journal" | "time"; revision: number };
type LibraryAgentTarget = { object: AgentObjectLink; kind: MailLibraryKind; id: string; revision: number };
type ThreadListingState = { kind: MailThreadListing["kind"]; id: string; listing?: MailThreadListing; loading: boolean; error?: string };

export default function App() {
  const [active, setActive] = useProfileValue("location", "imbox");
  const [imboxSection, setImboxSection] = useState<"new" | "previous">("new");
  const [mailboxes, setMailboxes] = useState<MailboxCache>({});
  const [loadingMailboxes, setLoadingMailboxes] = useState<MailboxLoading>({});
  const [mailboxCursor, setMailboxCursor] = useState<MailboxCursor>({});
  const [overview, setOverview] = useState<MailOverview>();
  const [agentWorkspace, setAgentWorkspace] = useState<AgentWorkspace>();
  const [agentError, setAgentError] = useState<string>();
  const [selected, setSelected] = useProfileValue<ImboxPosting | undefined>("selected-thread", undefined);
  const [threadCacheRevision, setThreadCacheRevision] = useState(0);
  const [threadErrors, setThreadErrors] = useState<Record<string, string | undefined>>({});
  const [navigationCollapsed, setNavigationCollapsed] = useState(false);
  const [agentRailOpen, setAgentRailOpen] = useState(true);
  const [compactAgentViewport, setCompactAgentViewport] = useState(() => window.matchMedia(COMPACT_AGENT_NAVIGATION_QUERY).matches);
  const [compactNavigationExpanded, setCompactNavigationExpanded] = useState(false);
  const [composer, setComposer] = useProfileValue<ComposerState | undefined>("open-composer", undefined);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([]);
  const [bulkMutating, setBulkMutating] = useState(false);
  const [bulkComposerOpen, setBulkComposerOpen] = useState(false);
  const [readTogether, setReadTogether] = useState<ReadTogetherState>();
  const [readTogetherThreads, setReadTogetherThreads] = useState<Record<string, MailThread | undefined>>({});
  const [notice, setNotice] = useState<Notice>();
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [organizer, setOrganizer] = useState<OrganizerState>();
  const [readerOrigin, setReaderOrigin] = useState<"search" | "agent" | "bundle" | "library">();
  const [libraryReaderTitle, setLibraryReaderTitle] = useState("Library");
  const [threadListing, setThreadListing] = useState<ThreadListingState>();
  const [setAsideGroupTarget, setSetAsideGroupTarget] = useState<string>();
  const [setAsideGroupBusy, setSetAsideGroupBusy] = useState(false);
  const [replyRequest, setReplyRequest] = useState(0);
  const [replyDraftSeed, setReplyDraftSeed] = useState<ReplyDraftSeed>();
  const [agentDraftSeed, setAgentDraftSeed] = useState<AgentDraftSeed>();
  const [agentFocusRequest, setAgentFocusRequest] = useState(0);
  const selectionRange = useRef<MailSelectionRange | undefined>(undefined);
  useEffect(() => { if (bulkSelectedIds.length === 0) selectionRange.current = undefined; }, [bulkSelectedIds.length]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [theme, setTheme] = useState<ThemeSnapshot>();
  const [chordHint, setChordHint] = useState<string>();
  const [calendarAgentTarget, setCalendarAgentTarget] = useState<CalendarAgentTarget>();
  const [draftAgentTarget, setDraftAgentTarget] = useState<{ object: AgentObjectLink; id: string; revision: number }>();
  const [libraryAgentTarget, setLibraryAgentTarget] = useState<LibraryAgentTarget>();
  const [missingAgentObject, setMissingAgentObject] = useState<AgentObjectLink>();
  const [agentMailRefreshToken, setAgentMailRefreshToken] = useState(0);
  const [agentCalendarRefreshToken, setAgentCalendarRefreshToken] = useState(0);
  const [calendarHelperEvent, setCalendarHelperEvent] = useState<CalendarEvent>();
  const [calendarHelperWindow, setCalendarHelperWindow] = useState<HelperCalendarWindow>();
  const [startingHelpers, setStartingHelpers] = useState<Set<HelperId>>(() => new Set());
  const startingHelpersRef = useRef(new Set<HelperId>());
  const requestSequence = useRef<Partial<Record<MailboxKey, number>>>({});
  const listingRequestSequence = useRef(0);
  const threadCache = useRef(new MailThreadCache(10)).current;
  const readTogetherRef = useRef<ReadTogetherHandle>(null);
  const readTogetherThreadsRef = useRef<Record<string, MailThread | undefined>>({});
  const visibleTopicIds = useRef<Set<string>>(new Set());
  const reconciliationSequences = useRef(new Map<string, number>());
  const chord = useRef<{ first: string; timer: ReturnType<typeof setTimeout> } | undefined>(undefined);
  const handledAgentTools = useRef(new Set<string>());
  const initializedAgentTab = useRef<string | undefined>(undefined);
  const activeMailbox = MAILBOX_ROUTES[active];
  const trash = useTrashQueue((request) => {
    const ids = new Set(request.postingIds);
    // Retire the optimistic mask only after the write; old reads must not restore it.
    for (const key of MAILBOX_KEYS) requestSequence.current[key] = (requestSequence.current[key] ?? 0) + 1;
    setLoadingMailboxes({});
    setMailboxes((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, value && { ...value, postings: value.postings.filter((posting) => !ids.has(posting.id)) }])));
  }, (message) => {
    appSound.play("error", "mail");
    setNotice({ message: `Trash action failed. ${message}` });
  });
  const pendingTrashIds = useMemo(() => new Set(trash.items.flatMap((item) => item.request.postingIds)), [trash.items]);
  const mailbox = useMemo(() => {
    const source = activeMailbox ? mailboxes[activeMailbox] : undefined;
    const result = hidePendingTrash(source, pendingTrashIds);
    if (result?.boxKey !== "imbox") return result;
    const { bubbledUp, newForYou, previouslySeen } = groupImboxPostings(result.postings);
    return { ...result, postings: [...bubbledUp, ...newForYou, ...previouslySeen] };
  }, [activeMailbox, mailboxes, pendingTrashIds]);
  const imboxUnread = mailboxes.imbox?.postings.filter((posting) => !pendingTrashIds.has(posting.id) && !posting.seen && !posting.bubbledUp).length ?? 0;
  const highlightedId = activeMailbox ? mailboxCursor[activeMailbox] : undefined;
  const loading = activeMailbox ? Boolean(loadingMailboxes[activeMailbox]) : false;
  const consumeAgentDraftSeed = useCallback(() => setAgentDraftSeed(undefined), []);
  const shortcuts = useMemo(() => resolveShortcuts(settings), [settings]);
  const compactAgentLayout = agentRailOpen && compactAgentViewport;
  const navigation = navigationPresentation(compactAgentLayout, navigationCollapsed, compactNavigationExpanded);
  const readTogetherPostings = useMemo(
    () => readTogether ? postingsForReadTogether(mailbox?.postings ?? [], readTogether.postingIds) : [],
    [mailbox, readTogether],
  );
  readTogetherThreadsRef.current = readTogetherThreads;
  visibleTopicIds.current = new Set([
    ...(selected?.topicId ? [selected.topicId] : []),
    ...readTogetherPostings.flatMap((posting) => posting.topicId ? [posting.topicId] : []),
  ]);

  useEffect(() => {
    const query = window.matchMedia(COMPACT_AGENT_NAVIGATION_QUERY);
    const update = () => setCompactAgentViewport(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!compactAgentLayout) setCompactNavigationExpanded(false);
  }, [compactAgentLayout]);

  const toggleNavigation = useCallback(() => {
    appSound.play(navigation.collapsed ? "snap" : "drop", "interface");
    if (compactAgentLayout) setCompactNavigationExpanded((value) => !value);
    else setNavigationCollapsed((value) => !value);
  }, [compactAgentLayout, navigation.collapsed]);

  const setNavigationRailTarget = useCallback((target: string) => {
    if (target === "toggle") {
      toggleNavigation();
      return;
    }
    if (target !== "open" && target !== "closed") return;
    const open = target === "open";
    setNavigationCollapsed(!open);
    setCompactNavigationExpanded(compactAgentLayout && open);
  }, [compactAgentLayout, toggleNavigation]);

  const refreshMailbox = useCallback(async (box: MailboxKey) => {
    const sequence = (requestSequence.current[box] ?? 0) + 1;
    requestSequence.current[box] = sequence;
    setLoadingMailboxes((current) => ({ ...current, [box]: true }));
    try {
      const [result, nextOverview] = await Promise.all([
        window.heyAgent.mail.listMailbox(box),
        box === "imbox" ? window.heyAgent.mail.getOverview() : Promise.resolve(undefined),
      ]);
      if (sequence !== requestSequence.current[box]) return;
      setMailboxes((current) => ({ ...current, [box]: result }));
      if (nextOverview) setOverview(nextOverview);
    } finally {
      if (sequence === requestSequence.current[box]) setLoadingMailboxes((current) => ({ ...current, [box]: false }));
    }
  }, []);

  const refresh = useCallback(async () => {
    if (activeMailbox) await refreshMailbox(activeMailbox);
  }, [activeMailbox, refreshMailbox]);

  const loadThread = useCallback(async (topicId: string, options: { force?: boolean; reportError?: boolean } = {}): Promise<MailThread | undefined> => {
    const cached = !options.force ? threadCache.get(topicId) : undefined;
    if (cached) return cached;
    if (options.reportError) {
      setThreadErrors((current) => {
        if (!(topicId in current)) return current;
        const next = { ...current };
        delete next[topicId];
        return next;
      });
    }
    try {
      const thread = await threadCache.read(topicId, (id) => window.heyAgent.mail.readThread(id), options.force);
      setThreadCacheRevision((value) => value + 1);
      return thread;
    } catch (reason) {
      if (options.reportError) {
        setThreadErrors((current) => ({
          ...current,
          [topicId]: reason instanceof Error ? reason.message : "Unable to read this conversation.",
        }));
      }
      return undefined;
    }
  }, [threadCache]);

  const loadThreadListing = useCallback(async (kind: MailThreadListing["kind"], id: string, preserve = false) => {
    const sequence = ++listingRequestSequence.current;
    setThreadListing((current) => ({ kind, id, ...(preserve && current?.kind === kind && current.id === id && current.listing ? { listing: current.listing } : {}), loading: true }));
    try {
      const listing = kind === "bundle" ? await window.heyAgent.mail.readBundle(id) : await window.heyAgent.mail.listContactThreads(id);
      if (sequence === listingRequestSequence.current) setThreadListing({ kind, id, listing, loading: false });
    } catch (reason) {
      if (sequence === listingRequestSequence.current) setThreadListing((current) => ({ kind, id, ...(current?.listing ? { listing: current.listing } : {}), loading: false, error: reason instanceof Error ? reason.message : "HEY could not read these conversations." }));
    }
  }, []);

  useEffect(() => {
    const receiveTheme = (nextTheme: ThemeSnapshot) => { applyTheme(nextTheme); setTheme(nextTheme); };
    const unsubscribeTheme = window.heyAgent.theme.subscribe(receiveTheme);
    const unsubscribeAgent = window.heyAgent.agent.subscribe(setAgentWorkspace);
    void Promise.all([
      window.heyAgent.theme.current().then(receiveTheme),
      window.heyAgent.settings.get().then(setSettings),
      window.heyAgent.agent.getWorkspace().then(setAgentWorkspace).catch((reason: unknown) => setAgentError(reason instanceof Error ? reason.message : "Unable to start HEY Agent.")),
    ]);
    return () => { unsubscribeTheme(); unsubscribeAgent(); };
  }, []);

  useEffect(() => appSound.configure(settings.sound), [settings.sound]);
  useEffect(() => { document.documentElement.dataset.interfaceFont = settings.interfaceFont; }, [settings.interfaceFont]);
  useEffect(() => installSoundUnlock(), []);

  useEffect(() => {
    if (activeMailbox) void refreshMailbox(activeMailbox);
  }, [activeMailbox, refreshMailbox]);

  useEffect(() => {
    const timer = setTimeout(() => {
      for (const box of MAILBOX_KEYS) {
        if (box !== "imbox") void refreshMailbox(box);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [refreshMailbox]);

  useEffect(() => {
    if (!readerOrigin && selected && mailbox && !mailbox.postings.some((posting) => posting.id === selected.id)) setSelected(undefined);
  }, [mailbox, readerOrigin, selected]);

  useEffect(() => {
    if (!selected?.topicId) return;
    let cancelled = false;
    void loadThread(selected.topicId, { reportError: true }).then((loaded) => {
      if (!loaded || cancelled) return;
      const postings = mailbox?.postings ?? [];
      const index = postings.findIndex((posting) => posting.id === selected.id);
      for (const neighbor of [postings[index - 1], postings[index + 1]]) {
        if (neighbor?.topicId) void loadThread(neighbor.topicId);
      }
    });
    return () => { cancelled = true; };
  }, [loadThread, mailbox, selected?.id, selected?.topicId]);

  useEffect(() => {
    if (!readTogether) return;
    let cancelled = false;
    let cursor = 0;
    const topics = readTogetherPostings.flatMap((posting) => posting.topicId && !readTogetherThreadsRef.current[posting.topicId] ? [posting.topicId] : []);
    const loadNext = async () => {
      while (!cancelled) {
        const topicId = topics[cursor];
        cursor += 1;
        if (!topicId) return;
        const thread = await loadThread(topicId, { reportError: true });
        if (!cancelled && thread) setReadTogetherThreads((current) => ({ ...current, [topicId]: thread }));
      }
    };
    void Promise.all(Array.from({ length: Math.min(3, topics.length) }, loadNext));
    return () => { cancelled = true; };
  }, [loadThread, readTogether, readTogetherPostings]);

  useEffect(() => {
    if (!activeMailbox || !mailbox?.postings.length) return;
    setMailboxCursor((current) => current[activeMailbox] && mailbox.postings.some((posting) => posting.id === current[activeMailbox])
      ? current
      : { ...current, [activeMailbox]: mailbox.postings[0]!.id });
  }, [activeMailbox, mailbox]);

  useEffect(() => {
    const timers = new Map<MailboxKey, ReturnType<typeof setTimeout>>();
    const unsubscribe = window.heyAgent.mail.subscribe((change) => {
      if (change.change === "added" && change.isNew && document.hidden) appSound.play("notification", "notification");
      if (change.topicId) {
        if (!reconciliationSequences.current.has(change.topicId)) {
          threadCache.invalidate(change.topicId);
          setThreadCacheRevision((value) => value + 1);
          if (visibleTopicIds.current.has(change.topicId)) {
            void loadThread(change.topicId, { force: true, reportError: true }).then((thread) => {
              if (thread && visibleTopicIds.current.has(change.topicId!)) setReadTogetherThreads((current) => ({ ...current, [change.topicId!]: thread }));
            });
          }
        }
      }
      if (!change.box) return;
      const box = change.box.key as MailboxKey;
      if (!MAILBOX_KEYS.includes(box)) return;
      const current = timers.get(box);
      if (current) clearTimeout(current);
      timers.set(box, setTimeout(() => void refreshMailbox(box), 120));
    });
    return () => { for (const timer of timers.values()) clearTimeout(timer); unsubscribe(); };
  }, [loadThread, refreshMailbox, threadCache]);

  useEffect(() => {
    if (!notice) return;
    if (notice.bulkUndoId) return;
    const timer = setTimeout(() => setNotice(undefined), 7_000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Called only by explicit reader actions, never by loadThread or neighbor prefetch.
  const markOpenedSeen = useCallback((postings: ImboxPosting[]) => {
    const postingIds = postings.filter((posting) => !posting.seen && posting.topicId && posting.kind !== "bundle").map((posting) => posting.id);
    if (!activeMailbox || postingIds.length === 0) return;
    const request: MailMutationRequest = { operation: "seen", postingIds };
    // Discard mailbox reads started before this local update.
    requestSequence.current[activeMailbox] = (requestSequence.current[activeMailbox] ?? 0) + 1;
    setLoadingMailboxes((current) => ({ ...current, [activeMailbox]: false }));
    setMailboxes((current) => applyOptimisticMailMutation(current, activeMailbox, undefined, request).mailboxes);
    void window.heyAgent.mail.mutate(request).catch((reason: unknown) => {
      appSound.play("error", "mail");
      setNotice({ message: reason instanceof Error ? reason.message : "HEY could not mark these conversations as read." });
      setMailboxes((current) => applyOptimisticMailMutation(current, activeMailbox, undefined, { operation: "unseen", postingIds }).mailboxes);
      setSelected((current) => current && postingIds.includes(current.id) ? { ...current, seen: false } : current);
      void refresh();
    });
  }, [activeMailbox, refresh]);

  const selectPosting = useCallback((posting: ImboxPosting, audible = true) => {
    selectionRange.current = undefined;
    if (audible) appSound.play("open", "interface");
    setBulkSelectedIds([]);
    setReadTogether(undefined);
    setReadTogetherThreads({});
    setReaderOrigin(undefined);
    if (activeMailbox) setMailboxCursor((current) => ({ ...current, [activeMailbox]: posting.id }));
    if (posting.kind === "bundle" || !posting.topicId) {
      setSelected(undefined);
      setThreadListing({ kind: "bundle", id: posting.id, loading: true });
      void loadThreadListing("bundle", posting.id);
      return;
    }
    setThreadListing(undefined);
    const shouldMarkSeen = Boolean(activeMailbox) && !posting.seen;
    setSelected(shouldMarkSeen ? { ...posting, seen: true } : posting);
    markOpenedSeen([posting]);
  }, [activeMailbox, loadThreadListing, markOpenedSeen]);

  const toggleBulkSelection = useCallback((posting: ImboxPosting) => {
    selectionRange.current = undefined;
    appSound.play(bulkSelectedIds.includes(posting.id) ? "deselect" : "select", "interface");
    if (activeMailbox) setMailboxCursor((current) => ({ ...current, [activeMailbox]: posting.id }));
    setBulkSelectedIds((current) => current.includes(posting.id) ? current.filter((id) => id !== posting.id) : [...current, posting.id]);
  }, [activeMailbox, bulkSelectedIds]);

  const openBulkOrganizer = useCallback((initialKind: MailOrganizationKind) => {
    if (!mailbox || bulkSelectedIds.length === 0) return;
    const selectedIds = new Set(bulkSelectedIds);
    const postings = mailbox.postings.filter((posting) => selectedIds.has(posting.id));
    if (postings.length === 0) return;
    appSound.play("open", "interface");
    setOrganizer({ postings, initialKind });
  }, [bulkSelectedIds, mailbox]);

  const mutate = useCallback(async (request: MailMutationRequest): Promise<boolean> => {
    if (request.operation === "move" && mailbox?.postings.some((posting) => posting.kind === "bundle" && request.postingIds.includes(posting.id))) {
      setNotice({ message: "Open the contact bundle and select individual conversations to move." });
      return false;
    }
    const selectionCount = request.postingIds.length;
    const selection = selectionCount === 1 ? "this conversation" : `${selectionCount} conversations`;
    if (request.operation === "spam" && !await confirmAction(`Mark ${selection} as spam? This also trains HEY's filters.`, "Mark as spam")) return false;
    if (request.operation === "trash") {
      const ids = new Set(request.postingIds);
      const rows = mailbox?.postings ?? [];
      const index = rows.findIndex((posting) => posting.id === (selected?.id ?? highlightedId));
      const next = rows.slice(Math.max(0, index + 1)).find((posting) => !ids.has(posting.id))
        ?? rows.slice(0, Math.max(0, index)).reverse().find((posting) => !ids.has(posting.id));
      trash.enqueue({ ...request, sourceBox: request.sourceBox ?? activeMailbox });
      if (activeMailbox && (!highlightedId || ids.has(highlightedId))) setMailboxCursor((current) => ({ ...current, [activeMailbox]: next?.id }));
      if (selected && ids.has(selected.id)) {
        if (next) selectPosting(next, false);
        else setSelected(undefined);
      }
      if (!selected || !next) requestAnimationFrame(() => document.querySelector<HTMLElement>('.imbox-panel:not([hidden]) .mail-row[data-selected="true"]')?.focus({ preventScroll: true }));
      appSound.play("delete", "mail");
      return true;
    }
    const advancesReader = Boolean(selected && request.postingIds.includes(selected.id) && READER_TRIAGE_OPERATIONS.has(request.operation));
    const nextPosting = advancesReader && selected ? nextPostingInSequence(mailbox?.postings ?? [], selected.id) : undefined;
    const optimistic = applyOptimisticMailMutation(mailboxes, activeMailbox, highlightedId, request);
    const sourceBox = request.sourceBox ?? activeMailbox;
    if (sourceBox) {
      // An older mailbox read must not paint over the immediate local result.
      requestSequence.current[sourceBox] = (requestSequence.current[sourceBox] ?? 0) + 1;
      setLoadingMailboxes((current) => ({ ...current, [sourceBox]: false }));
    }
    setMailboxes((current) => applyOptimisticMailMutation(current, activeMailbox, highlightedId, request).mailboxes);
    if (activeMailbox && optimistic.removedFromActiveMailbox) setMailboxCursor((current) => ({ ...current, [activeMailbox]: optimistic.nextCursor }));
    if (advancesReader) {
      if (nextPosting) selectPosting(nextPosting, false);
      else setSelected(undefined);
    } else if (["move", "bubble", "bubble-pop", "unseen", "trash", "spam"].includes(request.operation)) setSelected(undefined);
    try {
      const result = await window.heyAgent.mail.mutate(request);
      appSound.play(request.operation === "spam" ? "warning" : "success", "mail");
      setNotice({ message: result.message, ...(result.undo ? { undo: result.undo } : {}) });
      await refresh();
      return true;
    } catch (reason) {
      appSound.play("error", "mail");
      setNotice({ message: reason instanceof Error ? reason.message : "HEY could not update this conversation." });
      await refresh();
      return false;
    }
  }, [activeMailbox, highlightedId, mailbox, mailboxes, refresh, selectPosting, selected, trash.enqueue]);

  const runBulkCommand = useCallback(async (id: ShortcutId) => {
    if (!activeMailbox || bulkSelectedIds.length === 0 || bulkMutating) return;
    const request = bulkMutationRequest(id, bulkSelectedIds, activeMailbox, mailbox?.postings);
    if (!request) return;
    setBulkMutating(true);
    try {
      const completed = await mutate(request);
      if (completed) {
        setBulkSelectedIds([]);
        setReadTogether(undefined);
        setReadTogetherThreads({});
      }
    } finally {
      setBulkMutating(false);
    }
  }, [activeMailbox, bulkMutating, bulkSelectedIds, mailbox, mutate]);

  const openReadTogether = useCallback(() => {
    if (!activeMailbox || !mailbox || bulkSelectedIds.length === 0) return;
    const postings = postingsForReadTogether(mailbox.postings, bulkSelectedIds);
    const skippedCount = skippedReadTogetherCount(mailbox.postings, bulkSelectedIds);
    if (postings.length === 0) {
      setNotice({ message: "Open each HEY contact bundle and choose individual conversations before using Read Together." });
      return;
    }
    const postingIds = postings.map((posting) => posting.id);
    const cached: Record<string, MailThread | undefined> = {};
    for (const posting of postings) {
      if (posting.topicId) cached[posting.topicId] = threadCache.get(posting.topicId);
    }
    appSound.play("open", "interface");
    setSelected(undefined);
    setReaderOrigin(undefined);
    setReadTogether({ postingIds, skippedCount });
    setReadTogetherThreads(cached);
    setMailboxCursor((current) => ({ ...current, [activeMailbox]: postingIds[0]! }));

    markOpenedSeen(postings);
  }, [activeMailbox, bulkSelectedIds, mailbox, markOpenedSeen, threadCache]);

  const moveThreadSelection = useCallback((delta: number) => {
    const postings = mailbox?.postings ?? [];
    if (postings.length === 0) return;
    const current = postings.findIndex((posting) => posting.id === selected?.id);
    const start = current < 0 ? (delta > 0 ? -1 : postings.length) : current;
    const next = postings[Math.min(Math.max(start + delta, 0), postings.length - 1)];
    if (next && next.id !== selected?.id) {
      appSound.play("hover", "interface", { cooldownMs: 70, retrigger: "restart" });
      selectPosting(next, false);
    }
  }, [mailbox, selectPosting, selected]);

  const moveCursor = useCallback((delta: -1 | 1) => {
    selectionRange.current = undefined;
    if (!activeMailbox) return;
    const byId = new Map((mailbox?.postings ?? []).map((posting) => [posting.id, posting]));
    const visible = [...document.querySelectorAll<HTMLElement>('.imbox-panel:not([hidden]) .mail-row')].flatMap((row) => { const posting = byId.get(row.dataset.postingId!); return posting ? [posting] : []; });
    const next = moveMailboxCursor(visible, highlightedId, delta);
    if (!next) return;
    // Explicit list navigation takes keyboard focus, even when the cursor is
    // already at an edge or a toolbar/sidebar button previously had focus.
    // Otherwise Enter activates that old control instead of the highlighted row.
    document.getElementById(`mail-row-${next}`)?.focus({ preventScroll: true });
    if (next === highlightedId) return;
    appSound.play("hover", "interface", { cooldownMs: 70, retrigger: "restart" });
    setMailboxCursor((current) => ({ ...current, [activeMailbox]: next }));
  }, [activeMailbox, highlightedId, mailbox]);

  const navigate = useCallback((route: string, section: "new" | "previous" = "new") => {
    selectionRange.current = undefined;
    appSound.play("press", "interface");
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    listingRequestSequence.current += 1;
    setCompactNavigationExpanded(false);
    if (["settings", "sessions"].includes(route) && window.matchMedia("(max-width: 980px)").matches) setAgentRailOpen(false);
    setActive(route); setSelected(undefined); setReaderOrigin(undefined); setThreadListing(undefined); setSetAsideGroupTarget(undefined); setMissingAgentObject(undefined); setSearchOpen(false); setBulkSelectedIds([]); setBulkComposerOpen(false); setReadTogether(undefined); setReadTogetherThreads({});
    if (route === "imbox") setImboxSection(section);
  }, []);

  const markAgentObjectMissing = useCallback((object: AgentObjectLink) => {
    setMissingAgentObject(object);
    if (object.kind.startsWith("calendar-")) setCalendarAgentTarget(undefined);
    else if (object.kind === "draft") setDraftAgentTarget(undefined);
    else if (object.kind === "contact" || object.kind === "label" || object.kind === "collection") setLibraryAgentTarget(undefined);
  }, []);

  const openAgentObject = useCallback(async (object: AgentObjectLink) => {
    appSound.play("open", "interface");
    setMissingAgentObject(undefined);
    if (object.kind.startsWith("calendar-")) {
      const date = calendarTargetDate(object.deepLink, object.subtitle);
      const section = object.kind === "calendar-habit" ? "habits" : object.kind === "calendar-journal" ? "journal" : object.kind === "calendar-time-track" ? "time" : "schedule";
      setCalendarAgentTarget({ object, ...(object.kind === "calendar-event" ? { eventId: object.id } : {}), ...(date ? { date } : {}), section, revision: Date.now() });
      setActive("calendar"); setSelected(undefined); setReaderOrigin(undefined);
      return;
    }
    if (object.kind === "draft") {
      setDraftAgentTarget({ object, id: object.id, revision: Date.now() });
      setActive("drafts"); setSelected(undefined); setReaderOrigin(undefined);
      return;
    }
    if (object.kind === "contact" || object.kind === "label" || object.kind === "collection") {
      const kind: MailLibraryKind = object.kind === "contact" ? "contacts" : object.kind === "label" ? "labels" : "collections";
      setLibraryAgentTarget({ object, kind, id: object.id, revision: Date.now() });
      setActive("library"); setSelected(undefined); setReaderOrigin(undefined);
      return;
    }
    if (object.kind === "mailbox") {
      const normalized = object.id.toLowerCase().replace(/[\s_-]+/g, "");
      const route = Object.entries(MAILBOX_ROUTES).find(([, key]) => key && (key.replace("box", "") === normalized || key === object.id))?.[0]
        ?? ({ imbox: "imbox", feed: "feed", trail: "paper-trail", papertrail: "paper-trail", aside: "set-aside", later: "reply-later", bubble: "bubble-up" } as Record<string, string>)[normalized];
      if (route) navigate(route);
      else setNotice({ message: `HEY returned mailbox ${object.title}, but this app does not have a matching view yet.` });
      return;
    }
    if (object.kind === "set-aside-group") {
      navigate("set-aside");
      setSetAsideGroupTarget(object.id);
      return;
    }
    if (object.kind === "mail-bundle") {
      setActive("imbox"); setSelected(undefined); setReaderOrigin(undefined); setReadTogether(undefined);
      void loadThreadListing("bundle", object.id);
      return;
    }
    if (object.kind === "mail-thread") {
      setThreadErrors((current) => ({ ...current, [object.id]: undefined }));
      const thread = await loadThread(object.id, { force: true, reportError: true });
      if (!thread) { markAgentObjectMissing(object); return; }
      const last = thread.entries.at(-1);
      const sender = last?.sender ?? { name: "HEY contact" };
      const contacts = [...new Map(thread.entries.map((entry) => [entry.sender.email ?? entry.sender.name, entry.sender])).values()];
      setActive("imbox");
      setSelected({ id: `agent:${thread.topicId}`, topicId: thread.topicId, subject: thread.subject, summary: last?.body ?? "", seen: true, createdAt: last?.occurredAt ?? new Date().toISOString(), contacts, sender, visibleEntryCount: thread.entries.length });
      setReaderOrigin("agent"); setSearchOpen(false); setReadTogether(undefined);
    }
  }, [loadThread, loadThreadListing, markAgentObjectMissing, navigate]);

  const findMissingObject = useCallback(async () => {
    if (!missingAgentObject || !agentWorkspace) return;
    setAgentRailOpen(true);
    setAgentError(undefined);
    try {
      await window.heyAgent.agent.send(agentWorkspace.activeTabId, buildMissingObjectRecoveryPrompt(missingAgentObject));
      appSound.play("send", "agent");
    } catch (reason) {
      appSound.play("error", "agent");
      setNotice({ message: reason instanceof Error ? reason.message : "HEY Agent could not search for possible matches." });
    }
  }, [agentWorkspace, missingAgentObject]);

  useEffect(() => {
    const tools = agentWorkspace?.activeSession.timeline.flatMap((item) => item.kind === "run" ? item.tools : []) ?? [];
    const tabId = agentWorkspace?.activeTabId;
    if (tabId && initializedAgentTab.current !== tabId) {
      for (const tool of tools) if (tool.artifact || tool.appAction) handledAgentTools.current.add(tool.id);
      initializedAgentTab.current = tabId;
      return;
    }
    for (const tool of tools) {
      if ((!tool.artifact && !tool.appAction) || handledAgentTools.current.has(tool.id)) continue;
      handledAgentTools.current.add(tool.id);
      if (tool.appAction) {
        if (tool.appAction.action === "navigate") navigate(tool.appAction.target);
        else if (tool.appAction.action === "set-agent-rail") setAgentRailOpen((current) => tool.appAction!.target === "toggle" ? !current : tool.appAction!.target === "open");
        else if (tool.appAction.action === "set-navigation-rail") setNavigationRailTarget(tool.appAction.target);
        else {
          const posting = selected ?? mailbox?.postings.find((item) => item.id === highlightedId);
          if (!posting?.topicId || !agentWorkspace) setNotice({ message: "Select an email with a HEY thread before asking the agent to attach it." });
          else void window.heyAgent.agent.attach(agentWorkspace.activeTabId, { kind: "hey-thread", id: posting.topicId, title: posting.subject, subtitle: posting.sender.name, ...(!readerOrigin && activeMailbox ? { sourceBox: activeMailbox } : {}) }).then(setAgentWorkspace).catch((reason: unknown) => setNotice({ message: reason instanceof Error ? reason.message : "Unable to attach the selected email." }));
        }
      }
      if (tool.artifact?.status === "complete") {
        if (tool.artifact.refresh.includes("mail")) {
          setAgentMailRefreshToken((value) => value + 1);
          if (activeMailbox) void refreshMailbox(activeMailbox);
        }
        if (tool.artifact.refresh.includes("calendar")) setAgentCalendarRefreshToken((value) => value + 1);
      }
    }
  }, [activeMailbox, agentWorkspace, highlightedId, mailbox, navigate, readerOrigin, refreshMailbox, selected, setNavigationRailTarget]);

  const undo = useCallback(async () => {
    if (notice?.bulkUndoId) {
      const deliveryId = notice.bulkUndoId;
      setNotice(undefined);
      try {
        const result = await window.heyAgent.mail.undoBulkReply(deliveryId);
        appSound.play("undo", "mail");
        setNotice({ message: result.message });
        await refresh();
      } catch (reason) {
        appSound.play("error", "mail");
        setNotice({ message: reason instanceof Error ? reason.message : "HEY could not recall those replies. The undo window may have ended." });
      }
      return;
    }
    if (!notice?.undo) return;
    const request = notice.undo;
    setNotice(undefined);
    try {
      const result = await window.heyAgent.mail.mutate(request);
      appSound.play("undo", "mail");
      setNotice({ message: `Undone. ${result.message}` });
      await refresh();
    } catch (reason) {
      appSound.play("error", "mail");
      setNotice({ message: reason instanceof Error ? reason.message : "HEY could not undo that action." });
    }
  }, [notice, refresh]);

  const highlightedPosting = mailbox ? postingAtCursor(mailbox.postings, highlightedId) : undefined;
  const actionPosting = readerOrigin ? undefined : selected ?? highlightedPosting;
  const contextualPosting = selected ?? highlightedPosting;
  const agentContextPostings = useMemo(() => bulkSelectedIds.length > 0
    ? (mailbox?.postings ?? []).filter((posting) => bulkSelectedIds.includes(posting.id))
    : contextualPosting ? [contextualPosting] : [], [bulkSelectedIds, contextualPosting, mailbox?.postings]);
  const agentContextAttachments = useMemo(() => attachmentsForPostings(agentContextPostings, readerOrigin ? undefined : activeMailbox), [activeMailbox, agentContextPostings, readerOrigin]);
  const missingAgentContext = useMemo(() => unattachedMailContext(agentContextAttachments, agentWorkspace?.activeSession.attachments ?? []), [agentContextAttachments, agentWorkspace?.activeSession.attachments]);
  const contextCommands = useMemo(() => contextualAgentCommands(agentContextAttachments.length, Boolean(agentWorkspace), missingAgentContext.length === 0).filter((command) => {
    if (command.id === "agent-summarize-selection" && settings.helpers.enabled.includes("thread-recap")) return false;
    if (command.id === "agent-replies-selection" && settings.helpers.enabled.includes("follow-up-finder")) return false;
    return true;
  }), [agentContextAttachments.length, agentWorkspace, missingAgentContext.length, settings.helpers.enabled]);
  const helpers = useMemo(() => helperCatalog(settings.helpers.custom), [settings.helpers.custom]);
  const helperMailAttachments = useMemo(() => activeMailbox || selected ? agentContextAttachments : [], [activeMailbox, selected, agentContextAttachments]);
  const mailHelpers = useMemo(() => helpers.filter((helper) => helper.surfaces.includes("mail")
    && settings.helpers.enabled.includes(helper.id)
    && helperMailAttachments.length > 0
    && helperAcceptsContextCount(helper, helperMailAttachments.length)), [helpers, helperMailAttachments.length, settings.helpers.enabled]);
  const mailHelperActions = useMemo(() => mailHelpers.map((helper) => ({ id: helperCommandId(helper.id), title: helper.title })), [mailHelpers]);

  const runAgentContextCommand = useCallback(async (id: ShortcutId) => {
    if (!["agent-focus-context", "agent-start-context", "agent-add-context", "agent-summarize-selection", "agent-replies-selection"].includes(id)) return false;
    setCommandsOpen(false);
    if (agentContextAttachments.length === 0) return true;
    if (agentContextAttachments.length > MAX_CONTEXTUAL_MAIL_ATTACHMENTS) {
      appSound.play("error", "agent");
      setNotice({ message: `Select no more than ${MAX_CONTEXTUAL_MAIL_ATTACHMENTS} conversations for one agent session.` });
      return true;
    }
    try {
      if (id === "agent-focus-context") {
        setAgentRailOpen(true);
        setAgentFocusRequest((value) => value + 1);
        appSound.play("snap", "interface");
        return true;
      }
      if (id === "agent-add-context" && agentWorkspace) {
        const next = missingAgentContext.length > 0
          ? await window.heyAgent.agent.attachMany(agentWorkspace.activeTabId, missingAgentContext)
          : agentWorkspace;
        setAgentWorkspace(next);
        setAgentRailOpen(true);
        setAgentFocusRequest((value) => value + 1);
        appSound.play("drop", "interface");
        return true;
      }
      const workspace = await window.heyAgent.agent.newSession({ attachments: agentContextAttachments });
      setAgentWorkspace(workspace);
      setAgentRailOpen(true);
      setAgentFocusRequest((value) => value + 1);
      appSound.play("open", "interface");
      if (id === "agent-summarize-selection" || id === "agent-replies-selection") {
        await window.heyAgent.agent.send(workspace.activeTabId, contextualAgentPrompt(id, agentContextAttachments.length));
      }
    } catch (reason) {
      appSound.play("error", "agent");
      setNotice({ message: reason instanceof Error ? reason.message : "HEY Agent could not use that context." });
    }
    return true;
  }, [agentContextAttachments, agentWorkspace, missingAgentContext]);

  const startHelper = useCallback(async (helperId: HelperId, attachments: AgentNativeAttachment[], prompt?: string) => {
    if (startingHelpersRef.current.has(helperId)) return;
    const helper = helperById(helperId, settings.helpers.custom);
    if (!helper || !settings.helpers.enabled.includes(helperId)) return;
    startingHelpersRef.current.add(helperId);
    setStartingHelpers((current) => new Set(current).add(helperId));
    const contextName = attachments.length === 1 ? attachments[0]!.title : attachments.length ? `${attachments.length} conversations` : "";
    try {
      const workspace = await window.heyAgent.agent.newSession({ name: `${helper.title}${contextName ? ` · ${contextName}` : ""}`, helperId, attachments: attachments.length ? attachments : undefined });
      setAgentWorkspace(workspace);
      setAgentRailOpen(true);
      setAgentFocusRequest((value) => value + 1);
      appSound.play("open", "interface");
      await window.heyAgent.agent.send(workspace.activeTabId, prompt ?? helperStarter(helper, attachments.length));
    } catch (reason) {
      appSound.play("error", "agent");
      setNotice({ message: reason instanceof Error ? reason.message : `${helper.title} could not start.` });
    } finally {
      startingHelpersRef.current.delete(helperId);
      setStartingHelpers((current) => {
        const next = new Set(current);
        next.delete(helperId);
        return next;
      });
    }
  }, [settings.helpers.custom, settings.helpers.enabled]);

  const startMeetingPrep = useCallback((event: CalendarEvent) => {
    void startHelper("meeting-prep", [eventHelperAttachment(event)]);
  }, [startHelper]);

  const startMailHelper = useCallback((helperId: HelperId, draft?: string) => {
    const helper = helperById(helperId, settings.helpers.custom);
    if (!helper?.surfaces.includes("mail") || !helperAcceptsContextCount(helper, helperMailAttachments.length)) return;
    const prompt = helperId === "reply-coach" && draft?.trim()
      ? `Revise my current reply to the attached HEY conversation. Preserve my intent and return only the complete replacement reply.\n\nCurrent draft:\n${draft.trim()}`
      : undefined;
    void startHelper(helperId, helperMailAttachments, prompt);
  }, [helperMailAttachments, settings.helpers.custom, startHelper]);

  const launchHelper = useCallback((id: HelperId) => {
    if (id === "meeting-prep") { if (calendarHelperEvent) startMeetingPrep(calendarHelperEvent); return; }
    const custom = settings.helpers.custom?.find((helper) => helper.id === id);
    if (id === "daily-brief" || id === "calendar-triage" || custom?.context === "calendar" || custom?.context === "any" && active === "calendar") {
      if (custom && calendarHelperEvent) { void startHelper(id, [eventHelperAttachment(calendarHelperEvent)]); return; }
      const window = active === "calendar" ? calendarHelperEvent ? { date: eventDayKey(calendarHelperEvent), mode: "day" as const } : calendarHelperWindow : undefined;
      const input = calendarHelperInput(id, window);
      void startHelper(id, input.attachments, input.prompt);
    } else startMailHelper(id);
  }, [active, calendarHelperEvent, calendarHelperWindow, settings.helpers.custom, startHelper, startMailHelper, startMeetingPrep]);

  const contextualHelpers = useMemo(() => helpers.filter((helper) => settings.helpers.enabled.includes(helper.id)
    && (helper.id === "daily-brief" || helper.id === "calendar-triage"
      || helper.id === "meeting-prep" && Boolean(calendarHelperEvent)
      || mailHelpers.includes(helper)
      || isCustomHelperId(helper.id) && (helper.contextKinds.includes("calendar-date") && (active === "calendar" || helper.minimumContexts > 0)
        || helper.minimumContexts === 0 && helperAcceptsContextCount(helper, helperMailAttachments.length)))), [active, helpers, settings.helpers.enabled, calendarHelperEvent, mailHelpers, helperMailAttachments.length]);

  const closeReader = useCallback(() => {
    const postingId = selected?.id ?? readTogether?.postingIds[0];
    const origin = readerOrigin;
    appSound.play("back", "interface");
    setSelected(undefined);
    setReaderOrigin(undefined);
    setReadTogether(undefined);
    setReadTogetherThreads({});
    // Let the source view remount and finish its own initial focus first.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (document.querySelector(".thread-panel")) return;
      // Explicit navigation after Escape wins over this delayed restoration.
      if (document.activeElement instanceof HTMLElement && document.activeElement.closest('.imbox-panel:not([hidden]) .mail-row[aria-current="true"]')) return;
      const scope = origin === "search" ? ".mail-search-results" : origin === "library" ? ".library-conversations" : origin === "bundle" ? ".thread-listing-body" : ".imbox-panel";
      const row = postingId ? document.querySelector<HTMLElement>(`${scope} [data-posting-id="${CSS.escape(postingId)}"]`) : null;
      const fallback = origin === "agent" ? document.querySelector<HTMLElement>(".agent-composer textarea") : document.querySelector<HTMLElement>(`${scope} button`);
      const target = row ?? fallback;
      if (target?.getClientRects().length) target.focus({ preventScroll: true });
    }));
  }, [readTogether, readerOrigin, selected]);

  const undoTrash = useCallback(async (id?: string) => {
    const item = id ? trash.items.find((entry) => entry.id === id) : trash.items.at(-1);
    if (!item || !await trash.undo(item.id)) return false;
    appSound.play("undo", "mail");
    if (!selected && activeMailbox && item.request.sourceBox === activeMailbox) {
      const postingId = item.request.postingIds[0];
      setMailboxCursor((current) => ({ ...current, [activeMailbox]: postingId }));
      requestAnimationFrame(() => document.getElementById(`mail-row-${postingId}`)?.focus({ preventScroll: true }));
    }
    return true;
  }, [activeMailbox, selected, trash.items, trash.undo]);

  const runCommand = useCallback((id: ShortcutId) => {
    if (id === "commands") {
      appSound.play("open", "interface");
      setCommandsOpen(true);
      requestAnimationFrame(() => {
        const input = document.getElementById("command-palette-input") as HTMLInputElement | null;
        input?.focus();
        input?.select();
      });
      return;
    }
    setCommandsOpen(false);
    if (id === "undo-trash") { void undoTrash(); return; }
    const helperId = helperIdFromCommand(id);
    if (helperId) {
      launchHelper(helperId);
      return;
    }
    if (id === "focus-agent") { setAgentRailOpen(true); setAgentFocusRequest((value) => value + 1); return; }
    if (id.startsWith("agent-")) { void runAgentContextCommand(id); return; }
    if (id === "compose") { appSound.play("open", "interface"); setComposer({ mode: "compose" }); return; }
    if (id === "search") { appSound.play("open", "interface"); setSearchOpen(true); return; }
    if (id === "toggle-navigation") { toggleNavigation(); return; }
    if (id === "toggle-agent") { appSound.play(agentRailOpen ? "drop" : "snap", "interface"); setAgentRailOpen((value) => !value); return; }
    if (id === "next") {
      if (readTogether) readTogetherRef.current?.jump(1);
      else if (selected && !readerOrigin) moveThreadSelection(1);
      else if (!selected) moveCursor(1);
      return;
    }
    if (id === "previous") {
      if (readTogether) readTogetherRef.current?.jump(-1);
      else if (selected && !readerOrigin) moveThreadSelection(-1);
      else if (!selected) moveCursor(-1);
      return;
    }
    if (id === "open" && !selected && mailbox) {
      const posting = postingAtCursor(mailbox.postings, highlightedId);
      if (posting) selectPosting(posting);
      return;
    }
    if ((id === "select-next" || id === "select-previous") && !selected && !readTogether && activeMailbox) {
      const ids = [...document.querySelectorAll<HTMLElement>('.imbox-panel:not([hidden]) .mail-row')].map((row) => row.dataset.postingId!);
      const next = extendMailboxSelection(ids, highlightedId, id === "select-next" ? 1 : -1, bulkSelectedIds, selectionRange.current);
      if (next) {
        selectionRange.current = next.range;
        setBulkSelectedIds(next.selected);
        setMailboxCursor((current) => ({ ...current, [activeMailbox]: next.edge }));
        document.getElementById(`mail-row-${next.edge}`)?.focus({ preventScroll: true });
      }
      return;
    }
    if (id === "select" && !selected && mailbox) {
      const posting = postingAtCursor(mailbox.postings, highlightedId);
      if (posting) toggleBulkSelection(posting);
      return;
    }
    if (id === "bulk-actions" && bulkSelectedIds.length > 0) {
      const button = document.getElementById("bulk-actions-menu-button") as HTMLButtonElement | null;
      button?.focus();
      if (button?.getAttribute("aria-expanded") !== "true") button?.click();
      return;
    }
    if (id === "read-together" && bulkSelectedIds.length > 0) { openReadTogether(); return; }
    if (id === "reply-together" && bulkSelectedIds.length >= 2) { appSound.play("open", "interface"); setBulkComposerOpen(true); return; }
    if (id === "bulk-label" && bulkSelectedIds.length > 0) { openBulkOrganizer("labels"); return; }
    if (id === "bulk-collection" && bulkSelectedIds.length > 0) { openBulkOrganizer("collections"); return; }
    if (bulkSelectedIds.length > 0 && isBulkMutationCommand(id)) { void runBulkCommand(id); return; }
    if (id === "back") {
      if (navigation.overlay) setCompactNavigationExpanded(false);
      else closeReader();
      return;
    }
    if (id === "nav-sessions") { setAgentRailOpen(true); return; }
    const routes: Partial<Record<ShortcutId, [string, "new" | "previous"]>> = {
      "nav-imbox": ["imbox", "new"], "nav-feed": ["feed", "new"], "nav-trail": ["paper-trail", "new"],
      "nav-later": ["reply-later", "new"], "nav-aside": ["set-aside", "new"], "nav-bubble": ["bubble-up", "new"],
      "nav-screener": ["screener", "new"], "nav-previously": ["imbox", "previous"],
      "nav-calendar": ["calendar", "new"], "nav-settings": ["settings", "new"],
    };
    const route = routes[id];
    if (route) { navigate(...route); return; }
    if (id === "session-new") {
      const attachment = attachmentForPosting(selected, readerOrigin ? undefined : activeMailbox);
      void window.heyAgent.agent.newSession(attachment ? { attachment } : {}).then((workspace) => { setAgentWorkspace(workspace); setAgentRailOpen(true); });
      return;
    }
    if (id === "session-close" && agentRailOpen && agentWorkspace && agentWorkspace.tabs.length > 1) { void window.heyAgent.agent.closeSession(agentWorkspace.activeTabId).then(setAgentWorkspace); return; }
    if ((id === "session-next" || id === "session-previous") && agentWorkspace?.tabs.length) {
      const index = agentWorkspace.tabs.findIndex((tab) => tab.id === agentWorkspace.activeTabId);
      const delta = id === "session-next" ? 1 : -1;
      const next = agentWorkspace.tabs[(index + delta + agentWorkspace.tabs.length) % agentWorkspace.tabs.length];
      if (next) void window.heyAgent.agent.activateSession(next.id).then((workspace) => { setAgentWorkspace(workspace); setAgentRailOpen(true); });
      return;
    }
    if (id.startsWith("session-") && /^session-[1-9]$/.test(id) && agentWorkspace) {
      const tab = agentWorkspace.tabs[Number(id.slice(-1)) - 1];
      if (tab) void window.heyAgent.agent.activateSession(tab.id).then((workspace) => { setAgentWorkspace(workspace); setAgentRailOpen(true); });
      return;
    }
    if (readerOrigin) return;
    const target = selected ?? (mailbox ? postingAtCursor(mailbox.postings, highlightedId) : undefined);
    if (!target || !activeMailbox) return;
    if (id === "reply") {
      if (selected) setReplyRequest((value) => value + 1);
      else {
        selectPosting(target);
        requestAnimationFrame(() => setReplyRequest((value) => value + 1));
      }
      return;
    }
    if (id === "forward") { appSound.play("forward", "interface"); setComposer({ mode: "forward", posting: target }); return; }
    if (id === "seen") { if (!selected) setImboxSection("previous"); void mutate({ operation: "seen", postingIds: [target.id] }); }
    const toggle = mailToggle(id, [target.id], activeMailbox, [target]);
    if (toggle) void mutate(toggle.request);
    if (id === "stop-ignoring") void mutate({ operation: "stop-ignoring", postingIds: [target.id] });
    if (id === "trash") void mutate({ operation: "trash", postingIds: [target.id], sourceBox: activeMailbox });
  }, [activeMailbox, agentRailOpen, agentWorkspace, bulkSelectedIds, closeReader, highlightedId, launchHelper, mailbox, moveCursor, moveThreadSelection, mutate, navigate, navigation.overlay, openBulkOrganizer, openReadTogether, readTogether, readerOrigin, runAgentContextCommand, runBulkCommand, selectPosting, selected, toggleBulkSelection, toggleNavigation, undoTrash]);

  const availableCommands = useMemo(() => {
    const applicable = shortcuts.filter((command) => (command.id !== "undo-trash" || trash.items.length > 0) && (command.scope === "global"
      || command.scope === "mailbox" && Boolean(activeMailbox)
      || command.scope === "bulk" && bulkSelectedIds.length > 0 && (command.id !== "reply-together" || bulkSelectedIds.length >= 2)
      || command.scope === "conversation" && Boolean(actionPosting) && (bulkSelectedIds.length === 0 || isBulkMutationCommand(command.id))
      || command.scope === "reader" && Boolean(selected || readTogether)
      || command.scope === "session" && Boolean(agentWorkspace)));
    const validForMailbox = bulkSelectedIds.length > 0 && activeMailbox
      ? applicable.filter((command) => !isBulkMutationCommand(command.id) || Boolean(bulkMutationRequest(command.id, bulkSelectedIds, activeMailbox)))
      : applicable;
    const helperCommands: ShortcutDefinition[] = contextualHelpers.map((helper) => ({ id: helperCommandId(helper.id), label: helperCommandLabel(helper, agentContextAttachments.length), keys: [], display: "", scope: "agent-context" as const }));
    const contextualCommands = prioritizeBulkCommands(validForMailbox, bulkSelectedIds.length).map((command) => {
      if (!activeMailbox) return command;
      const ids = bulkSelectedIds.length ? bulkSelectedIds : actionPosting ? [actionPosting.id] : [];
      const toggle = mailToggle(command.id, ids, activeMailbox, bulkSelectedIds.length ? mailbox?.postings : actionPosting ? [actionPosting] : []);
      const label = command.id === "aside" ? (toggle?.active ? "Set Aside: remove" : "Set Aside") : toggle?.label;
      return toggle ? { ...command, label: `${label}${bulkSelectedIds.length ? ` · ${bulkSelectedIds.length} selected` : ""}` } : command;
    });
    return [...helperCommands, ...contextCommands, ...contextualCommands];
  }, [activeMailbox, actionPosting, agentContextAttachments.length, agentWorkspace, bulkSelectedIds, contextCommands, contextualHelpers, mailbox, readTogether, selected, shortcuts, trash.items.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isShortcutEvent(event, true)) return;
      const editableTarget = isEditingEvent(event) || isLocalKeyboardEvent(event);
      if (editableTarget && chord.current) {
        clearTimeout(chord.current.timer); chord.current = undefined; setChordHint(undefined);
      }
      // Never cancel the browser's editing behavior or dispatch mailbox actions
      // from an editor/dialog, including when focus is on its toolbar.
      if (isDialogKeyboardEvent(event) || editableTarget && isNativeEditingShortcut(event)) return;
      if (event.repeat && !availableCommands.some((item) => matchesShortcut(event, item))) return;
      if (bulkComposerOpen || organizer) return;
      if (event.target instanceof Element && event.target.closest("[data-helper-controls]") && !(event.ctrlKey && event.key.toLowerCase() === "k")) return;
      if (navigation.overlay && event.key === "Escape") {
        event.preventDefault();
        appSound.play("back", "interface");
        setCompactNavigationExpanded(false);
        requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".sidebar-toggle")?.focus());
        return;
      }
      const activationTarget = event.target instanceof Element ? event.target.closest("button, a[href], summary") : null;
      if (activationTarget && (event.key === "Enter" || event.key === " ")) return;
      if (editableTarget) {
        if (!event.ctrlKey && !event.metaKey) return;
        const editableCommand = availableCommands.find((item) => matchesShortcut(event, item));
        if (!editableCommand || !["commands", "toggle-navigation", "toggle-agent", "focus-agent", "session-new", "session-close", "session-next", "session-previous"].includes(editableCommand.id)) return;
        if (composer && editableCommand.id !== "commands") return;
        event.preventDefault();
        runCommand(editableCommand.id);
        return;
      }
      if (readTogether && event.key === "Escape") {
        event.preventDefault();
        closeReader();
        return;
      }
      if (bulkSelectedIds.length > 0 && event.key === "Escape") {
        selectionRange.current = undefined;
        event.preventDefault();
        setBulkSelectedIds([]);
        return;
      }
      if ((selected || readTogether) && ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) return;
      if (notice?.bulkUndoId && event.key.toLowerCase() === "q") {
        event.preventDefault();
        void undo();
        return;
      }
      if (chord.current) {
        const pending = chord.current;
        clearTimeout(pending.timer); chord.current = undefined; setChordHint(undefined);
        const completion = availableCommands.find((item) => completesShortcutChord(pending.first, event, item));
        if (completion) { event.preventDefault(); runCommand(completion.id); return; }
      }
      const command = availableCommands.find((item) => matchesShortcut(event, item));
      if (!command) {
        const starter = availableCommands.find((item) => startsShortcutChord(event, item));
        if (starter) {
          event.preventDefault();
          const first = starter.keys.find((binding) => binding.includes(" ") && matchesBindingStep(event, binding.split(" ")[0]!))!.split(" ")[0]!;
          const timer = setTimeout(() => { chord.current = undefined; setChordHint(undefined); }, 1_200);
          chord.current = { first, timer }; setChordHint(first.toUpperCase());
        }
        return;
      }
      if (composer && command.id !== "commands") return;
      event.preventDefault();
      runCommand(command.id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); if (chord.current) clearTimeout(chord.current.timer); };
  }, [availableCommands, bulkComposerOpen, bulkSelectedIds.length, closeReader, composer, navigation.overlay, notice?.bulkUndoId, organizer, readTogether, runCommand, undo, undoTrash, trash.items.length, selected, mailbox, selectPosting]);

  const newChat = () => {
    setAgentError(undefined); setAgentDraftSeed(undefined);
    void window.heyAgent.agent.newSession().then((workspace) => { appSound.play("open", "interface"); setAgentWorkspace(workspace); setAgentRailOpen(true); }).catch((reason: unknown) => { appSound.play("error", "agent"); setAgentError(reason instanceof Error ? reason.message : "Unable to create a session."); });
  };
  const continueReplyInAgent = useCallback(async (posting: ImboxPosting, draft: string) => {
    const attachment = attachmentForPosting(posting, activeMailbox);
    if (!attachment) return;
    if (settings.helpers.enabled.includes("reply-coach")) {
      startMailHelper("reply-coach", draft);
      return;
    }
    setAgentError(undefined);
    try {
      const workspace = await window.heyAgent.agent.newSession({ attachment });
      setAgentWorkspace(workspace);
      setAgentDraftSeed({ tabId: workspace.activeTabId, text: continueReplyPrompt(draft) });
      setAgentRailOpen(true);
      setAgentFocusRequest((value) => value + 1);
      appSound.play("open", "interface");
    } catch (reason) {
      appSound.play("error", "agent");
      setNotice({ message: reason instanceof Error ? reason.message : "HEY Agent could not continue this reply." });
    }
  }, [activeMailbox, settings.helpers.enabled, startMailHelper]);

  const useAgentDraftInReply = useCallback((text: string) => {
    if (!selected || readerOrigin) return;
    setReplyDraftSeed({ postingId: selected.id, revision: Date.now(), text, mode: agentWorkspace?.activeSession.helperId === "reply-coach" ? "replace" : "append" });
    appSound.play("drop", "interface");
  }, [agentWorkspace?.activeSession.helperId, readerOrigin, selected]);
  const openChat = (chatId: string) => {
    setAgentError(undefined); setAgentDraftSeed(undefined);
    void window.heyAgent.agent.openChat(chatId).then((workspace) => { setAgentWorkspace(workspace); setAgentRailOpen(true); }).catch((reason: unknown) => setAgentError(reason instanceof Error ? reason.message : "Unable to open that session."));
  };
  const archiveChat = async (chatId: string, archived: boolean) => {
    const tab = agentWorkspace?.tabs.find((item) => item.id === chatId);
    if (archived && (tab?.status === "starting" || tab?.status === "running") && !await confirmAction("This session is still working. Archive it and stop the current run?", "Archive session")) return;
    setAgentError(undefined);
    void window.heyAgent.agent.archiveSession(chatId, archived).then(setAgentWorkspace).catch((reason: unknown) => setAgentError(reason instanceof Error ? reason.message : `Unable to ${archived ? "archive" : "restore"} that session.`));
  };

  const mailComplete = (result: MailSendResult) => {
    appSound.play(result.disposition === "sent" ? "send" : "success", "mail");
    setComposer(undefined);
    setNotice({ message: result.message });
    void refresh();
  };

  const bulkReplyComplete = (result: BulkReplySendResult) => {
    appSound.play("send", "mail");
    setBulkComposerOpen(false);
    setBulkSelectedIds([]);
    setNotice({
      message: result.message,
      ...(result.delayed && result.deliveryId ? { bulkUndoId: result.deliveryId } : {}),
    });
    void refresh();
  };

  const replyComplete = (result: MailSendResult, topicId: string) => {
    appSound.play(result.disposition === "sent" ? "send" : "success", "mail");
    setNotice({ message: result.message });
    if (result.disposition === "sent") {
      const previous = threadCache.get(topicId);
      if (previous) {
        const sequence = (reconciliationSequences.current.get(topicId) ?? 0) + 1;
        reconciliationSequences.current.set(topicId, sequence);
        setThreadErrors((current) => {
          if (!(topicId in current)) return current;
          const next = { ...current };
          delete next[topicId];
          return next;
        });
        void threadCache.read(topicId, () => readThreadUntilAdvanced(previous, () => window.heyAgent.mail.readThread(topicId)), true)
          .then(() => {
            if (reconciliationSequences.current.get(topicId) === sequence) setThreadCacheRevision((value) => value + 1);
          })
          .catch((reason: unknown) => {
            if (reconciliationSequences.current.get(topicId) === sequence) {
              setThreadErrors((current) => ({
                ...current,
                [topicId]: reason instanceof Error ? reason.message : "Unable to refresh this conversation.",
              }));
            }
          })
          .finally(() => {
            if (reconciliationSequences.current.get(topicId) === sequence) reconciliationSequences.current.delete(topicId);
          });
      } else {
        void loadThread(topicId, { force: true, reportError: true });
      }
    }
    void refresh();
  };

  const chatAboutContact = (contact: MailContactDetail) => {
    setAgentError(undefined);
    void window.heyAgent.agent.newSession({ name: contact.name }).then((workspace) => {
      setAgentWorkspace(workspace);
      setAgentDraftSeed({
        tabId: workspace.activeTabId,
        text: `Tell me about my HEY history with ${contact.name} <${contact.email}> (contact ID ${contact.id}).`,
      });
      setAgentRailOpen(true);
    }).catch((reason: unknown) => setAgentError(reason instanceof Error ? reason.message : "Unable to create a contact session."));
  };

  const updateSetAsideGroup = useCallback(async (request: SetAsideGroupMutationRequest) => {
    if (setAsideGroupBusy) return;
    if (request.action === "delete" && !await confirmAction("HEY will move every conversation in this group to Previously Seen.", "Dissolve group")) return;
    setSetAsideGroupBusy(true);
    try {
      const result = await window.heyAgent.mail.updateSetAsideGroup(request);
      appSound.play(request.action === "delete" ? "delete" : "success", "mail");
      setNotice({ message: result.message });
      setBulkSelectedIds([]);
      await refreshMailbox("asidebox");
    } catch (reason) {
      appSound.play("error", "mail");
      setNotice({ message: reason instanceof Error ? reason.message : "HEY could not update this Set Aside group." });
    } finally {
      setSetAsideGroupBusy(false);
    }
  }, [refreshMailbox, setAsideGroupBusy]);

  const openDetachedPosting = useCallback((posting: ImboxPosting, origin: "bundle" | "library") => {
    appSound.play("open", "interface");
    setSelected(posting);
    setReaderOrigin(origin);
  }, []);

  const selectedIndex = selected ? mailbox?.postings.findIndex((posting) => posting.id === selected.id) ?? -1 : -1;
  const hasPrevious = selectedIndex > 0;
  const hasNext = selectedIndex >= 0 && selectedIndex < (mailbox?.postings.length ?? 0) - 1;
  const selectedThread: MailThread | undefined = useMemo(
    () => selected?.topicId ? threadCache.get(selected.topicId) : undefined,
    [selected?.topicId, threadCache, threadCacheRevision],
  );
  const selectedThreadError = selected?.topicId ? threadErrors[selected.topicId] : undefined;
  const readTogetherItems: ReadTogetherItem[] = useMemo(() => readTogetherPostings.map((posting) => ({
    posting,
    thread: posting.topicId ? readTogetherThreads[posting.topicId] : undefined,
    threadError: posting.topicId ? threadErrors[posting.topicId] : undefined,
  })), [readTogetherPostings, readTogetherThreads, threadErrors]);
  const agentShortcut = shortcuts.find((shortcut) => shortcut.id === "toggle-agent")?.display;

  return (
    <ShortcutContext value={shortcuts}>
    <main className="app-shell" data-compact-agent-layout={compactAgentLayout || undefined} data-navigation-overlay={navigation.overlay || undefined}>
      {navigation.overlay && <button type="button" tabIndex={-1} className="navigation-overlay-dismiss" aria-label="Close navigation sidebar" onClick={() => { appSound.play("drop", "interface"); setCompactNavigationExpanded(false); }} />}
      <Sidebar active={active} imboxCount={imboxUnread} chats={agentWorkspace?.chats ?? []} activeChatId={agentWorkspace?.activeTabId} collapsed={navigation.collapsed} shortcuts={shortcuts} onNavigate={navigate} onCompose={() => { setCompactNavigationExpanded(false); appSound.play("open", "interface"); setComposer({ mode: "compose" }); }} onNewChat={() => { setCompactNavigationExpanded(false); newChat(); }} onOpenChat={(chatId) => { setCompactNavigationExpanded(false); openChat(chatId); }} onArchiveChat={archiveChat} onToggleCollapsed={toggleNavigation} />
      <div className="workspace-shell" inert={navigation.overlay || undefined}>
        <div className="workspace-row" data-agent-open={agentRailOpen}>
          <div className="primary-workspace" data-agent-open={agentRailOpen}>
            {active === "library" && <MailLibrary hidden={Boolean(readerOrigin && selected) || Boolean(missingAgentObject)} onComposeContact={(contact) => setComposer({ mode: "compose", initialTo: contact.email })} onChatContact={chatAboutContact} onOpenPosting={(posting, title) => { setLibraryReaderTitle(title); openDetachedPosting(posting, "library"); }} onNotice={(message) => setNotice({ message })} target={libraryAgentTarget} onTargetMissing={markAgentObjectMissing} refreshToken={agentMailRefreshToken} />}
            {missingAgentObject ? <MissingObjectView object={missingAgentObject} finding={agentWorkspace?.activeSession.status === "starting" || agentWorkspace?.activeSession.status === "running"} onFind={() => void findMissingObject()} onBack={() => setMissingAgentObject(undefined)} />
              : readerOrigin && selected ? <ThreadPanel posting={selected} thread={selectedThread} threadError={selectedThreadError} sourceLabel={readerOrigin === "search" ? "Search results" : readerOrigin === "agent" ? "HEY Agent result" : readerOrigin === "bundle" ? threadListing?.listing?.title ?? "Bundle" : libraryReaderTitle} onOrganize={/^\d+$/.test(selected.id) || /^\d+$/.test(selected.topicId ?? "") ? () => setOrganizer({ postings: [selected] }) : undefined} helperActions={mailHelperActions} onHelperAction={runCommand} onRefresh={() => undefined} onRetryThread={() => selected.topicId && void loadThread(selected.topicId, { force: true, reportError: true })} replyRequest={0} onClose={closeReader} onPrevious={() => undefined} onNext={() => undefined} hasPrevious={false} hasNext={false} showTraversal={false} onOpenObject={(object) => void openAgentObject(object)} />
              : activeMailbox ? <>
              <ImboxView mailboxKey={activeMailbox} showSenderAvatars={settings.showSenderAvatars} result={mailbox} overview={activeMailbox === "imbox" ? overview : undefined} loading={loading} searchRequest={0} focusSection={imboxSection} selectedId={highlightedId} bulkSelectedIds={bulkSelectedIds} bulkBusy={bulkMutating || setAsideGroupBusy} commandPaletteOpen={commandsOpen} onSelect={selectPosting} onHighlight={(id) => setMailboxCursor((current) => current[activeMailbox] === id ? current : { ...current, [activeMailbox]: id })} onToggleSelection={toggleBulkSelection} onBulkAction={runCommand} helperActions={mailHelperActions} onReadTogether={openReadTogether} onReplyTogether={() => setBulkComposerOpen(true)} onOrganizeSelection={openBulkOrganizer} onClearSelection={() => setBulkSelectedIds([])} onRefresh={() => void refresh()} onNavigate={navigate} setAsideGroupTarget={setAsideGroupTarget} onSetAsideGroup={(request) => void updateSetAsideGroup(request)} hidden={Boolean(selected || readTogether || threadListing)} />
              {threadListing ? <ThreadListingView listing={threadListing.listing} loading={threadListing.loading} error={threadListing.error} onBack={() => { listingRequestSequence.current += 1; setThreadListing(undefined); }} onOpen={(posting) => openDetachedPosting(posting, "bundle")} onRetry={() => void loadThreadListing(threadListing.kind, threadListing.id, true)} onShowAll={threadListing.kind === "bundle" && threadListing.listing?.contact.id ? () => void loadThreadListing("contact", threadListing.listing!.contact.id!) : undefined} />
                : readTogether && readTogetherItems.length > 0 ? <ReadTogetherView ref={readTogetherRef} items={readTogetherItems} sourceLabel={MAILBOX_LABELS[activeMailbox]} skippedCount={readTogether.skippedCount} onClose={closeReader} onRetryThread={(topicId) => void loadThread(topicId, { force: true, reportError: true }).then((thread) => { if (thread) setReadTogetherThreads((current) => ({ ...current, [topicId]: thread })); })} onOpenObject={(object) => void openAgentObject(object)} />
                : selected && <ThreadPanel posting={selected} thread={selectedThread} threadError={selectedThreadError} sourceLabel={MAILBOX_LABELS[activeMailbox]} mailActions={{ sourceBox: activeMailbox, onMutate: (request) => void mutate(request), onForward: () => { appSound.play("forward", "interface"); setComposer({ mode: "forward", posting: selected }); }, onMailChanged: replyComplete }} onOrganize={() => setOrganizer({ postings: [selected] })} helperActions={mailHelperActions} onHelperAction={runCommand} onRefresh={() => void refresh()} onRetryThread={() => selected.topicId && void loadThread(selected.topicId, { force: true, reportError: true })} replyRequest={replyRequest} replyDraftSeed={replyDraftSeed?.postingId === selected.id ? replyDraftSeed : undefined} onContinueInAgent={(draft) => void continueReplyInAgent(selected, draft)} continueInAgentLabel={settings.helpers.enabled.includes("reply-coach") ? "Reply Coach" : "Continue in agent"} onClose={closeReader} onPrevious={() => moveThreadSelection(-1)} onNext={() => moveThreadSelection(1)} hasPrevious={hasPrevious} hasNext={hasNext} onOpenObject={(object) => void openAgentObject(object)} />}
            </>
              : active === "screener" ? <ScreenerView onNotice={(message) => setNotice({ message })} onOpenObject={(object) => void openAgentObject(object)} />
              : active === "drafts" ? <DraftsView onNotice={(message) => setNotice({ message })} target={draftAgentTarget} onTargetMissing={markAgentObjectMissing} refreshToken={agentMailRefreshToken} />
              : active === "calendar" ? <CalendarView onReturnMail={() => navigate("imbox")} onNotice={(message) => setNotice({ message })} target={calendarAgentTarget} onTargetMissing={markAgentObjectMissing} onActiveEvent={setCalendarHelperEvent} onHelperWindow={setCalendarHelperWindow} helpers={contextualHelpers.filter((helper) => helper.id !== "meeting-prep" && helper.surfaces.includes("calendar"))} onRunHelper={launchHelper} onMeetingPrep={startMeetingPrep} meetingPrepEnabled={settings.helpers.enabled.includes("meeting-prep")} meetingPrepBusy={startingHelpers.has("meeting-prep")} refreshToken={agentCalendarRefreshToken} />
              : active === "library" ? null
              : active === "settings" ? <SettingsView settings={settings} theme={theme} onSettings={setSettings} onRunHelper={launchHelper} onEditHelper={() => { if (window.matchMedia("(max-width: 980px)").matches) setAgentRailOpen(false); }} runnableHelpers={contextualHelpers.map((helper) => helper.id)} busyHelpers={startingHelpers} />
              : active === "sessions" ? <SessionHistory workspace={agentWorkspace} onWorkspace={setAgentWorkspace} onOpen={() => { setAgentDraftSeed(undefined); setAgentRailOpen(true); setAgentFocusRequest((value) => value + 1); }} />
              : <UnsupportedView active={active} onReturn={() => setActive("imbox")} />}
            {!agentRailOpen ? <RailMorphButton rail="agent" open={false} className="agent-rail-reopen" aria-label="Show HEY Agent" data-tooltip="Show HEY Agent" data-shortcut={agentShortcut} data-tooltip-side="left" onClick={() => { appSound.play("snap", "interface"); setAgentRailOpen(true); }} /> : null}
          </div>
          {agentRailOpen ? <aside className="panel agent-rail" aria-label="HEY Agent">
            {agentWorkspace ? <AgentPane workspace={agentWorkspace} onWorkspace={setAgentWorkspace} posting={selected} contextAttachments={agentContextAttachments} unavailableContextCount={agentContextPostings.filter((posting) => !posting.topicId).length} mailbox={readerOrigin ? undefined : activeMailbox} initialDraft={agentDraftSeed?.tabId === agentWorkspace.activeTabId ? agentDraftSeed.text : undefined} focusRequest={agentFocusRequest} onInitialDraftConsumed={consumeAgentDraftSeed} onUseInComposer={!readerOrigin && selected ? useAgentDraftInReply : undefined} onClose={() => { appSound.play("drop", "interface"); setAgentRailOpen(false); }} closeShortcut={agentShortcut} sound={settings.sound} onOpenObject={(object) => void openAgentObject(object)} />
              : <div className="agent-rail-loading"><Sparkles size={20} /><strong>Starting HEY Agent</strong><span>{agentError ?? "Restoring your local sessions…"}</span></div>}
          </aside> : null}
        </div>
      </div>
      {composer && <MailComposer mode={composer.mode} posting={composer.posting} initialTo={composer.initialTo} onClose={() => setComposer(undefined)} onComplete={mailComplete} />}
      {bulkComposerOpen && <BulkReplyComposer postingIds={bulkSelectedIds} onClose={() => setBulkComposerOpen(false)} onComplete={bulkReplyComplete} />}
      {organizer && <MailOrganizer postings={organizer.postings} initialKind={organizer.initialKind} onClose={() => setOrganizer(undefined)} onNotice={(message) => setNotice({ message })} onOpenObject={(object) => void openAgentObject(object)} />}
      {searchOpen && <MailSearch hidden={readerOrigin === "search"} onOpen={(posting) => { appSound.play("open", "interface"); setSelected(posting); setReaderOrigin("search"); }} onClose={() => { appSound.play("close", "interface"); setSearchOpen(false); if (readerOrigin === "search") { setSelected(undefined); setReaderOrigin(undefined); } }} />}
      {commandsOpen && <CommandPalette commands={availableCommands} onRun={runCommand} onClose={() => { appSound.play("close", "interface"); setCommandsOpen(false); }} />}
      <div className="app-notices">
        <div className="trash-undo-stack" aria-label="Pending trash actions">{[...trash.items].reverse().map((item) => <TrashUndoToast key={item.id} item={item} undo={undoTrash} pause={trash.pause} />)}</div>
        {notice && <div className="mail-notice" role="status"><span>{notice.message}</span>{(notice.undo || notice.bulkUndoId) && <button type="button" onClick={() => void undo()}>Undo{notice.bulkUndoId ? " (Q)" : ""}</button>}<button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setNotice(undefined)}>×</button></div>}
      </div>
      {chordHint && <div className="shortcut-chord-hint" role="status"><kbd>{chordHint}</kbd><span>waiting for next key</span></div>}
      <ConfirmAction />
      <TooltipLayer />
    </main>
    </ShortcutContext>
  );
}
