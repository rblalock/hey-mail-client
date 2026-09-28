import { AlertCircle, Check, ListFilter, Sparkles } from "lucide-react";
import ConfirmAction, { confirmAction } from "./components/ConfirmAction";
import TrashUndoToast from "./components/TrashUndoToast";
import { useTrashQueue } from "./use-trash-queue";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProfileValue } from "./profile-storage";
import type {
  AgentNativeAttachment, AgentObjectLink, AgentWorkspace, AppSettings, BulkReplySendResult, CalendarEvent, ImboxPosting, MailContactDetail, MailLibraryItem, MailLibraryKind, MailMutationRequest, MailOrganizationKind, MailOverview, MailSendResult, MailThread, MailThreadListing, MailboxKey, SetAsideGroupMutationRequest, ThemeSnapshot,
} from "../../shared/contracts";
import AgentPane from "./components/AgentPane";
import BulkReplyComposer from "./components/BulkReplyComposer";
import CalendarView from "./components/CalendarView";
import CommandPalette from "./components/CommandPalette";
import DraftsView from "./components/DraftsView";
import ImboxView from "./components/ImboxView";
import SplitInboxManager from "./components/SplitInboxManager";
import SplitInboxTabs from "./components/SplitInboxTabs";
import AddToSplitDialog from "./components/AddToSplitDialog";
import { useSplitMail } from "./use-split-mail";
import type { MailSplitDraft, MailSplitState } from "../../shared/mail-splits";
import { filterSplitMailboxes, splitDraftFromPosting, splitPendingCounts, splitViewIds } from "./split-mailbox";
import { canNavigateSplits, isSplitNavigationCommand } from "./split-keyboard";
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
import { appendMailboxPage, refreshMailboxHead } from "./mailbox-pages";
import { groupAccountSplitMailboxes, groupSectionedImbox, sectionedPostingSource, sectionedSelectionSource } from "./sectioned-imbox";
import { cursorAfterRemoval, sectionedActionRequests, sectionedDoneRequest } from "./sectioned-actions";
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

type Notice = { message: string; undo?: MailMutationRequest | MailMutationRequest[]; bulkUndoId?: string };
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
  const [imboxSectionRequest, setImboxSectionRequest] = useState(0);
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
  const [settingsReady, setSettingsReady] = useState(false);
  const [splitState, setSplitState] = useState<MailSplitState>({ splits: [], memberships: {}, errors: {} });
  const [splitLoadError, setSplitLoadError] = useState<string>();
  const [splitLabelsError, setSplitLabelsError] = useState<string>();
  const [selectedSplit, setSelectedSplit] = useProfileValue("imbox-split", "all");
  const [splitManager, setSplitManager] = useState<{ draft?: Partial<MailSplitDraft> }>();
  const [addingToSplit, setAddingToSplit] = useState<ImboxPosting[]>();
  const splitFocusRequest = useRef<string | undefined>(undefined);
  const [splitLabels, setSplitLabels] = useState<MailLibraryItem[]>([]);
  const [retainedActiveId, setRetainedActiveId] = useState<string>();
  const [visibleSectionPostings, setVisibleSectionPostings] = useState<ImboxPosting[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const historyLoaded = useRef(false);
  const historyRequest = useRef<symbol | undefined>(undefined);
  const historyCursors = useRef(new Set<string>());
  const readerSequence = useRef<string[]>([]);
  const mutationBusy = useRef(false);
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
  const prefetchBusy = useRef(false);
  const readTogetherRef = useRef<ReadTogetherHandle>(null);
  const readTogetherThreadsRef = useRef<Record<string, MailThread | undefined>>({});
  const visibleTopicIds = useRef<Set<string>>(new Set());
  const reconciliationSequences = useRef(new Map<string, number>());
  const chord = useRef<{ first: string; timer: ReturnType<typeof setTimeout> } | undefined>(undefined);
  const handledAgentTools = useRef(new Set<string>());
  const initializedAgentTab = useRef<string | undefined>(undefined);
  const activeMailbox = MAILBOX_ROUTES[active];
  const paginatedImbox = settings.imboxLayout === "sectioned";
  const sectionedImbox = activeMailbox === "imbox" && paginatedImbox;
  const enabledSplits = useMemo(() => splitState.splits.filter((split) => split.enabled), [splitState.splits]);
  const splitIds = useMemo(() => splitViewIds(splitState), [splitState]);
  const splitId = splitIds.includes(selectedSplit) ? selectedSplit : "all";
  const namedSplit = enabledSplits.find((split) => split.id === splitId);
  const accountSplit = sectionedImbox && Boolean(namedSplit);
  const splitMail = useSplitMail(accountSplit ? splitId : undefined, JSON.stringify(namedSplit));
  const layoutRef = useRef(paginatedImbox);
  layoutRef.current = paginatedImbox;
  const mailboxState = useRef(mailboxes);
  mailboxState.current = mailboxes;
  const trash = useTrashQueue((request) => {
    const ids = new Set(request.postingIds);
    // Retire the optimistic mask only after the write; old reads must not restore it.
    for (const key of MAILBOX_KEYS) requestSequence.current[key] = (requestSequence.current[key] ?? 0) + 1;
    setLoadingMailboxes({});
    setMailboxes((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, value && { ...value, postings: value.postings.filter((posting) => !ids.has(posting.id)) }])));
    splitMail.apply(request);
  }, (message) => {
    appSound.play("error", "mail");
    setNotice({ message: `Trash action failed. ${message}` });
  });
  const pendingTrashIds = useMemo(() => new Set(trash.items.flatMap((item) => item.request.postingIds)), [trash.items]);
  const sectionMailboxes = useMemo(() => Object.fromEntries(Object.entries(accountSplit ? splitMail.mailboxes : mailboxes)
    .map(([key, result]) => [key, hidePendingTrash(result, pendingTrashIds)])) as MailboxCache, [accountSplit, splitMail.mailboxes, mailboxes, pendingTrashIds]);
  const viewSectionMailboxes = useMemo(() => sectionedImbox && !accountSplit ? filterSplitMailboxes(sectionMailboxes, splitState, splitId) : sectionMailboxes, [sectionedImbox, accountSplit, sectionMailboxes, splitState, splitId]);
  const splitCounts = useMemo(() => {
    const counts = splitPendingCounts(Object.fromEntries(Object.entries(mailboxes)
      .map(([key, result]) => [key, hidePendingTrash(result, pendingTrashIds)])) as MailboxCache, splitState);
    // Named split badges must never imply a complete account count before paging.
    for (const split of enabledSplits) delete counts[split.id];
    return counts;
  }, [mailboxes, pendingTrashIds, splitState, enabledSplits]);
  const mailbox = useMemo(() => {
    if (accountSplit) {
      const groups = groupAccountSplitMailboxes(viewSectionMailboxes, selected?.id === retainedActiveId ? retainedActiveId : undefined);
      const unavailable = Boolean(splitMail.error) && !Object.keys(viewSectionMailboxes).length;
      return { status: unavailable ? "unavailable" as const : "ready" as const, detail: splitMail.error, boxKey: "imbox" as const, boxName: namedSplit!.name, postings: Object.values(groups).flat(), nextPage: splitMail.nextPage };
    }
    const source = activeMailbox ? mailboxes[activeMailbox] : undefined;
    const result = hidePendingTrash(source, pendingTrashIds);
    if (result?.boxKey !== "imbox") return result;
    if (sectionedImbox) {
      const groups = groupSectionedImbox(viewSectionMailboxes, selected?.id === retainedActiveId ? retainedActiveId : undefined);
      return { ...result, postings: [...groups.active, ...groups.replyLater, ...groups.setAside, ...groups.bubbledUp, ...groups.previouslySeen] };
    }
    const { bubbledUp, newForYou, previouslySeen } = groupImboxPostings(result.postings);
    return { ...result, postings: [...bubbledUp, ...newForYou, ...previouslySeen] };
  }, [activeMailbox, accountSplit, namedSplit, splitMail.nextPage, splitMail.error, mailboxes, pendingTrashIds, retainedActiveId, sectionedImbox, viewSectionMailboxes, selected?.id]);
  const navigationPostings = useMemo(() => {
    if (!sectionedImbox) return mailbox?.postings ?? [];
    const byId = new Map(mailbox?.postings.map((posting) => [posting.id, posting]));
    const ids = selected && readerSequence.current.length ? readerSequence.current : visibleSectionPostings.map((posting) => posting.id);
    return ids.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []);
  }, [mailbox, sectionedImbox, selected, visibleSectionPostings]);
  const postingSource = useCallback((posting: ImboxPosting): MailboxKey => sectionedImbox
    ? sectionedPostingSource(sectionMailboxes, posting, accountSplit) : activeMailbox ?? "imbox", [activeMailbox, accountSplit, sectionedImbox, sectionMailboxes]);
  const updateVisibleSectionPostings = useCallback((postings: ImboxPosting[]) => {
    setVisibleSectionPostings(postings);
    setMailboxCursor((current) => {
      const id = postings.some((posting) => posting.id === current.imbox) ? current.imbox : postings[0]?.id;
      return id === current.imbox ? current : { ...current, imbox: id };
    });
  }, []);
  const imboxUnread = mailboxes.imbox?.postings.filter((posting) => !pendingTrashIds.has(posting.id) && !posting.seen && !posting.bubbledUp).length ?? 0;
  const highlightedId = activeMailbox ? mailboxCursor[activeMailbox] : undefined;
  const loading = accountSplit ? splitMail.loading : activeMailbox ? Boolean(loadingMailboxes[activeMailbox]) : false;
  const consumeAgentDraftSeed = useCallback(() => setAgentDraftSeed(undefined), []);
  const shortcuts = useMemo(() => resolveShortcuts(settings).map((shortcut) => sectionedImbox && shortcut.id === "seen"
    ? { ...shortcut, label: accountSplit ? "Done" : "Done — move to Previously Seen" } : shortcut), [settings, sectionedImbox, accountSplit]);
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
    if (box === "imbox") {
      historyRequest.current = undefined;
      setLoadingHistory(false);
      setHistoryError(undefined);
    }
    setLoadingMailboxes((current) => ({ ...current, [box]: true }));
    try {
      const [result, nextOverview] = await Promise.all([
        window.heyAgent.mail.listMailbox(box, box === "imbox" && paginatedImbox ? { paginated: true } : undefined),
        box === "imbox" ? window.heyAgent.mail.getOverview() : Promise.resolve(undefined),
      ]);
      if (sequence !== requestSequence.current[box] || box === "imbox" && layoutRef.current !== paginatedImbox) return;
      setMailboxes((current) => ({ ...current, [box]: box === "imbox" && paginatedImbox
        ? refreshMailboxHead(current.imbox, result, historyLoaded.current) : result }));
      if (nextOverview) setOverview(nextOverview);
    } catch (reason) {
      if (sequence === requestSequence.current[box]) {
        const detail = reason instanceof Error ? reason.message : "Unable to refresh mail.";
        setNotice({ message: detail });
        setMailboxes((current) => ({ ...current, [box]: current[box] ?? { status: "unavailable", boxKey: box, boxName: MAILBOX_LABELS[box], postings: [], detail } }));
      }
    } finally {
      if (sequence === requestSequence.current[box]) setLoadingMailboxes((current) => ({ ...current, [box]: false }));
    }
  }, [paginatedImbox]);

  const loadMoreHistory = useCallback(async () => {
    const current = mailboxState.current.imbox;
    const cursor = current?.nextPage;
    if (!sectionedImbox || selected || readTogether || threadListing || loadingMailboxes.imbox || historyRequest.current || !current || !cursor) return;
    if (historyCursors.current.has(cursor)) {
      setHistoryError("HEY returned a repeated history page. Refresh the Imbox to continue.");
      return;
    }
    const token = Symbol();
    historyRequest.current = token;
    const sequence = requestSequence.current.imbox;
    setLoadingHistory(true);
    setHistoryError(undefined);
    try {
      const page = await window.heyAgent.mail.listMailbox("imbox", { paginated: true, page: cursor });
      if (historyRequest.current !== token || requestSequence.current.imbox !== sequence || !layoutRef.current) return;
      if (page.status !== "ready") throw new Error(page.detail ?? "Unable to load older mail.");
      if (page.nextPage === cursor) throw new Error("HEY returned a repeated history page. Refresh the Imbox to continue.");
      historyCursors.current.add(cursor);
      historyLoaded.current = true;
      setMailboxes((mail) => ({ ...mail, imbox: mail.imbox ? appendMailboxPage(mail.imbox, page) : page }));
    } catch (reason) {
      if (historyRequest.current === token && requestSequence.current.imbox === sequence) setHistoryError(reason instanceof Error ? reason.message : "Unable to load older mail.");
    } finally {
      if (historyRequest.current === token) { historyRequest.current = undefined; setLoadingHistory(false); }
    }
  }, [sectionedImbox, selected, readTogether, threadListing, loadingMailboxes.imbox]);

  const updateImboxLayout = useCallback(async (imboxLayout: "hey" | "sectioned") => {
    try { setSettings(await window.heyAgent.settings.update({ imboxLayout })); }
    catch (reason) { setNotice({ message: reason instanceof Error ? reason.message : "Unable to save the Imbox layout." }); }
  }, []);

  const openSplitManager = useCallback((draft?: Partial<MailSplitDraft>) => {
    setCommandsOpen(false);
    setSplitManager({ draft });
    void window.heyAgent.mail.listLibrary("labels").then((result) => { setSplitLabels(result.items); setSplitLabelsError(undefined); }).catch((reason: unknown) => {
      setSplitLabelsError(reason instanceof Error ? reason.message : "Could not load HEY labels. Close and reopen split settings to retry.");
    });
  }, []);

  const openAddToSplit = useCallback((ids?: string[]) => {
    const targets = ids ?? (bulkSelectedIds.length ? bulkSelectedIds : selected ? [selected.id] : highlightedId ? [highlightedId] : []);
    const available = [selected, ...(mailbox?.postings ?? []), ...(threadListing?.listing?.postings ?? [])].filter((posting): posting is ImboxPosting => Boolean(posting));
    const rows = targets.flatMap((id) => { const row = available.find((posting) => posting.id === id); return row ? [row] : []; });
    if (!rows.length || rows.length !== targets.length || rows.some((posting) => !/^\d+$/.test(posting.id) || !posting.topicId || posting.kind === "bundle")) {
      setNotice({ message: "Choose individual mail conversations before adding them to a split." }); return;
    }
    setCommandsOpen(false);
    setAddingToSplit(rows);
  }, [bulkSelectedIds, selected, highlightedId, mailbox, threadListing]);

  const chooseSplit = useCallback((id: string, focusMail = false) => {
    if (!splitIds.includes(id)) return;
    splitFocusRequest.current = focusMail ? id : undefined;
    setActive("imbox");
    if (!paginatedImbox) void updateImboxLayout("sectioned");
    setSelectedSplit(id);
    setSelected(undefined);
    setReadTogether(undefined);
    setReaderOrigin(undefined);
    setThreadListing(undefined);
    setBulkSelectedIds([]);
    selectionRange.current = undefined;
    readerSequence.current = [];
    if (id !== splitId) setVisibleSectionPostings([]);
    setRetainedActiveId(undefined);
    if (id !== splitId) setMailboxCursor((current) => ({ ...current, imbox: undefined }));
    requestAnimationFrame(() => {
      const target = focusMail
        ? document.querySelector<HTMLElement>('.imbox-panel:not([hidden]) .mail-row') ?? document.querySelector<HTMLElement>('.imbox-panel:not([hidden]) .mail-list')
        : document.querySelector<HTMLElement>('.split-inbox-tabs [aria-selected="true"]');
      target?.focus({ preventScroll: true });
    });
  }, [splitIds, splitId, setSelectedSplit, setSelected, setActive, paginatedImbox, updateImboxLayout]);

  useEffect(() => {
    if (splitFocusRequest.current !== splitId || loading || selected || !visibleSectionPostings.length) return;
    const frame = requestAnimationFrame(() => {
      if (splitFocusRequest.current !== splitId) return;
      const focused = document.activeElement;
      // A delayed mailbox response must not pull focus out of a form or AI chat.
      if (focused && !focused.matches('body, html, .mail-list, .mail-row, [data-split-navigation="tab"]') && !focused.closest('.imbox-titlebar, nav[aria-label="Mail"]')) {
        splitFocusRequest.current = undefined; return;
      }
      const row = document.querySelector<HTMLElement>('.imbox-panel:not([hidden]) .mail-row');
      if (row) { row.focus({ preventScroll: true }); splitFocusRequest.current = undefined; }
    });
    return () => cancelAnimationFrame(frame);
  }, [splitId, loading, selected, visibleSectionPostings]);

  const saveSplit = useCallback(async (draft: MailSplitDraft) => {
    const state = await window.heyAgent.mail.saveSplit(draft);
    setSplitState(state);
    if (draft.enabled) {
      try { setSettings(await window.heyAgent.settings.update({ imboxLayout: "sectioned" })); }
      catch { setNotice({ message: "Split saved. The layout preference could not be saved; choose Sectioned in the Imbox header to show it." }); }
    }
  }, []);

  const loadThread = useCallback(async (topicId: string, options: { force?: boolean; reportError?: boolean } = {}): Promise<MailThread | undefined> => {
    const cached = !options.force ? threadCache.get(topicId) : undefined;
    if (cached && threadCache.isFresh(topicId)) return cached;
    if (options.reportError) {
      setThreadErrors((current) => {
        if (!(topicId in current)) return current;
        const next = { ...current };
        delete next[topicId];
        return next;
      });
    }
    try {
      const thread = await threadCache.read(topicId, (id) => window.heyAgent.mail.readThread(id), options.force,
        (id) => window.heyAgent.mail.readCachedThread(id),
        (preview) => {
          setThreadCacheRevision((value) => value + 1);
          if (visibleTopicIds.current.has(topicId)) setReadTogetherThreads((current) => ({ ...current, [topicId]: preview }));
        });
      // An invalidated request may finish after its replacement. Never let its
      // returned value overwrite Read Together's independently rendered map.
      if (threadCache.get(topicId) !== thread) return undefined;
      setThreadCacheRevision((value) => value + 1);
      setThreadErrors((current) => {
        if (!(topicId in current)) return current;
        const next = { ...current };
        delete next[topicId];
        return next;
      });
      return thread;
    } catch (reason) {
      if (options.reportError && !threadCache.isFresh(topicId)) {
        setThreadErrors((current) => ({
          ...current,
          [topicId]: `${threadCache.get(topicId) ? "Showing a cached copy. " : ""}${reason instanceof Error ? reason.message : "Unable to read this conversation."}`,
        }));
      }
      return undefined;
    }
  }, [threadCache]);

  const prefetchThread = useCallback(async (topicId: string) => {
    if (prefetchBusy.current) return;
    prefetchBusy.current = true;
    try { await loadThread(topicId); }
    finally { prefetchBusy.current = false; }
  }, [loadThread]);

  const refresh = useCallback(async () => {
    if (selected?.topicId) {
      threadCache.invalidate(selected.topicId, true);
      void loadThread(selected.topicId, { force: true, reportError: true });
    }
    if (accountSplit) await splitMail.refresh();
    else if (sectionedImbox) await Promise.all(["imbox", "laterbox", "asidebox"].map((box) => refreshMailbox(box as MailboxKey)));
    else if (activeMailbox) await refreshMailbox(activeMailbox);
  }, [activeMailbox, refreshMailbox, selected?.topicId, threadCache, loadThread, sectionedImbox, accountSplit, splitMail.refresh]);

  const refreshFromToolbar = useCallback(async () => {
    if (accountSplit) {
      try { setSplitState(await window.heyAgent.mail.refreshSplits()); setSplitLoadError(undefined); }
      catch (reason) { setSplitLoadError(reason instanceof Error ? reason.message : "Unable to refresh split labels."); }
      await splitMail.refresh(true);
      return;
    }
    // Explicit refresh restarts a stalled cursor; routine mail updates preserve
    // already loaded history so the reader does not lose their scroll position.
    if (sectionedImbox) {
      historyCursors.current.clear();
      historyLoaded.current = false;
      if (enabledSplits.length) void window.heyAgent.mail.refreshSplits().then((state) => { setSplitState(state); setSplitLoadError(undefined); }).catch((reason: unknown) => setSplitLoadError(reason instanceof Error ? reason.message : "Unable to refresh splits."));
    }
    await refresh();
  }, [refresh, sectionedImbox, enabledSplits.length, accountSplit, splitMail.refresh]);

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
      window.heyAgent.settings.get().then(setSettings).finally(() => setSettingsReady(true)),
      window.heyAgent.agent.getWorkspace().then(setAgentWorkspace).catch((reason: unknown) => setAgentError(reason instanceof Error ? reason.message : "Unable to start HEY Agent.")),
    ]);
    return () => { unsubscribeTheme(); unsubscribeAgent(); };
  }, []);

  useEffect(() => {
    let active = true;
    const receive = (state: MailSplitState) => { if (active) { setSplitState(state); setSplitLoadError(undefined); } };
    const unsubscribe = window.heyAgent.mail.subscribeSplits(receive);
    void window.heyAgent.mail.getSplits().then(receive).catch((reason: unknown) => {
      if (active) setSplitLoadError(reason instanceof Error ? reason.message : "Could not load split settings.");
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  useEffect(() => appSound.configure(settings.sound), [settings.sound]);
  useEffect(() => { document.documentElement.dataset.interfaceFont = settings.interfaceFont; }, [settings.interfaceFont]);
  useEffect(() => installSoundUnlock(), []);

  useEffect(() => {
    historyLoaded.current = false;
    historyCursors.current.clear();
    historyRequest.current = undefined;
    readerSequence.current = [];
    setLoadingHistory(false);
    setHistoryError(undefined);
    setRetainedActiveId(undefined);
    setVisibleSectionPostings([]);
    requestSequence.current.imbox = (requestSequence.current.imbox ?? 0) + 1;
    setMailboxes((current) => { const next = { ...current }; delete next.imbox; return next; });
  }, [paginatedImbox]);

  useEffect(() => {
    if (settingsReady && activeMailbox) void refreshMailbox(activeMailbox);
  }, [activeMailbox, refreshMailbox, settingsReady]);

  useEffect(() => {
    if (!settingsReady) return;
    const timer = setTimeout(() => {
      for (const box of MAILBOX_KEYS) {
        if (box !== "imbox") void refreshMailbox(box);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [refreshMailbox, settingsReady]);

  useEffect(() => {
    if (!loading && (!accountSplit || !splitMail.nextPage) && !readerOrigin && selected && mailbox && !mailbox.postings.some((posting) => posting.id === selected.id)) setSelected(undefined);
  }, [loading, accountSplit, splitMail.nextPage, mailbox, readerOrigin, selected]);

  useEffect(() => {
    if (!selected?.topicId) return;
    let cancelled = false;
    void loadThread(selected.topicId, { reportError: true }).then((loaded) => {
      if (!loaded || cancelled) return;
      const postings = mailbox?.postings ?? [];
      const index = postings.findIndex((posting) => posting.id === selected.id);
      // Opt-in background work, one neighbor at a time. Detached search/library
      // readers must never prefetch an unrelated mailbox's first item.
      if (settings.mailCache.enabled && settings.mailCache.prefetch && !readerOrigin && index >= 0) {
        void (async () => {
          for (const neighbor of [postings[index + 1], postings[index - 1]]) {
            if (cancelled) return;
            if (neighbor?.topicId) await prefetchThread(neighbor.topicId);
          }
        })();
      }
    });
    return () => { cancelled = true; };
  }, [loadThread, prefetchThread, mailbox, selected?.id, selected?.topicId, readerOrigin, settings.mailCache.enabled, settings.mailCache.prefetch]);

  // Start warming the keyboard-highlighted row before Enter, without opening an
  // iframe or marking mail seen. Debouncing skips rows passed during key repeat.
  useEffect(() => {
    if (!settings.mailCache.enabled || !settings.mailCache.prefetch || selected || readTogether || threadListing || searchOpen) return;
    const posting = mailbox?.postings.find((item) => item.id === highlightedId);
    if (!posting?.topicId || posting.kind === "bundle") return;
    const timer = setTimeout(() => void prefetchThread(posting.topicId!), 200);
    return () => clearTimeout(timer);
  }, [highlightedId, mailbox, prefetchThread, selected, readTogether, threadListing, searchOpen, settings.mailCache.enabled, settings.mailCache.prefetch]);

  useEffect(() => {
    if (!readTogether) return;
    let cancelled = false;
    let cursor = 0;
    const topics = readTogetherPostings.flatMap((posting) => posting.topicId && (!readTogetherThreadsRef.current[posting.topicId] || !threadCache.isFresh(posting.topicId)) ? [posting.topicId] : []);
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
  }, [loadThread, readTogether, readTogetherPostings, threadCache]);

  useEffect(() => {
    if (!activeMailbox || sectionedImbox || !mailbox?.postings.length) return;
    setMailboxCursor((current) => current[activeMailbox] && mailbox.postings.some((posting) => posting.id === current[activeMailbox])
      ? current
      : { ...current, [activeMailbox]: mailbox.postings[0]!.id });
  }, [activeMailbox, mailbox, sectionedImbox]);

  useEffect(() => {
    const timers = new Map<MailboxKey, ReturnType<typeof setTimeout>>();
    let disposed = false;
    let resyncVersion = 0;
    const unsubscribe = window.heyAgent.mail.subscribe((change) => {
      if (change.change === "deleted" && change.postingId) {
        const id = change.postingId;
        setMailboxes((current) => Object.fromEntries(Object.entries(current).map(([key, box]) => [key,
          box && (change.box && key !== change.box.key ? box : { ...box, postings: box.postings.filter((posting) => posting.id !== id) }),
        ])));
      }
      if (change.change === "added" && change.isNew && document.hidden) appSound.play("notification", "notification");
      if (change.topicId) {
        if (!reconciliationSequences.current.has(change.topicId)) {
          threadCache.invalidate(change.topicId, true);
          setThreadCacheRevision((value) => value + 1);
          if (visibleTopicIds.current.has(change.topicId)) {
            void loadThread(change.topicId, { force: true, reportError: true }).then((thread) => {
              if (thread && visibleTopicIds.current.has(change.topicId!)) setReadTogetherThreads((current) => ({ ...current, [change.topicId!]: thread }));
            });
          }
        }
      }
      if (change.change === "resync") {
        threadCache.invalidate(undefined, true, reconciliationSequences.current.keys());
        const version = ++resyncVersion;
        const topics = [...visibleTopicIds.current].filter((id) => !reconciliationSequences.current.has(id));
        let cursor = 0;
        const next = async () => {
          while (!disposed && version === resyncVersion) {
            const id = topics[cursor++];
            if (!id) return;
            const thread = await loadThread(id, { force: true, reportError: true });
            if (!disposed && thread && visibleTopicIds.current.has(id)) setReadTogetherThreads((current) => ({ ...current, [id]: thread }));
          }
        };
        void Promise.all(Array.from({ length: Math.min(3, topics.length) }, next));
        for (const box of MAILBOX_KEYS) void refreshMailbox(box);
      }
      if (!change.box) return;
      const box = change.box.key as MailboxKey;
      if (!MAILBOX_KEYS.includes(box)) return;
      const current = timers.get(box);
      if (current) clearTimeout(current);
      timers.set(box, setTimeout(() => void refreshMailbox(box), 120));
    });
    return () => { disposed = true; for (const timer of timers.values()) clearTimeout(timer); unsubscribe(); };
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
    const sources = new Set([activeMailbox, ...postings.map(postingSource)]);
    for (const source of sources) requestSequence.current[source] = (requestSequence.current[source] ?? 0) + 1;
    setLoadingMailboxes((current) => ({ ...current, ...Object.fromEntries([...sources].map((source) => [source, false])) }));
    setMailboxes((current) => applyOptimisticMailMutation(current, activeMailbox, undefined, request).mailboxes);
    splitMail.apply(request);
    void window.heyAgent.mail.mutate(request).then(() => {
      if (accountSplit) void splitMail.refresh();
    }).catch((reason: unknown) => {
      appSound.play("error", "mail");
      setNotice({ message: reason instanceof Error ? reason.message : "HEY could not mark these conversations as read." });
      setMailboxes((current) => applyOptimisticMailMutation(current, activeMailbox, undefined, { operation: "unseen", postingIds }).mailboxes);
      splitMail.apply({ operation: "unseen", postingIds });
      setSelected((current) => current && postingIds.includes(current.id) ? { ...current, seen: false } : current);
      void refresh();
    });
  }, [activeMailbox, accountSplit, refresh, postingSource, splitMail.apply, splitMail.refresh]);

  const selectPosting = useCallback((posting: ImboxPosting, audible = true) => {
    if (sectionedImbox) {
      if (!selected || readerOrigin) readerSequence.current = navigationPostings.map((item) => item.id);
      const active = (accountSplit ? groupAccountSplitMailboxes(sectionMailboxes) : groupSectionedImbox(sectionMailboxes)).active;
      setRetainedActiveId(active.some((item) => item.id === posting.id) ? posting.id : undefined);
    }
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
  }, [activeMailbox, accountSplit, loadThreadListing, markOpenedSeen, navigationPostings, readerOrigin, sectionedImbox, sectionMailboxes, selected]);

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

  const mutate = useCallback(async (request: MailMutationRequest, onUndo?: (undo?: MailMutationRequest) => void): Promise<boolean> => {
    const completing = request.operation === "done";
    if (completing && mutationBusy.current) return false;
    if (request.operation === "move" && mailbox?.postings.some((posting) => posting.kind === "bundle" && request.postingIds.includes(posting.id))) {
      setNotice({ message: "Open the contact bundle and select individual conversations to move." });
      return false;
    }
    const selectionCount = request.postingIds.length;
    const selection = selectionCount === 1 ? "this conversation" : `${selectionCount} conversations`;
    if (request.operation === "spam" && !await confirmAction(`Mark ${selection} as spam? This also trains HEY's filters.`, "Mark as spam")) return false;
    if (request.operation === "trash") {
      const ids = new Set(request.postingIds);
      const rows = sectionedImbox ? navigationPostings : mailbox?.postings ?? [];
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
    const advancesReader = Boolean(selected && request.postingIds.includes(selected.id) && (completing || READER_TRIAGE_OPERATIONS.has(request.operation)));
    const removedIds = new Set(request.postingIds);
    const groups = sectionedImbox ? (accountSplit ? groupAccountSplitMailboxes(sectionMailboxes, retainedActiveId) : groupSectionedImbox(sectionMailboxes, retainedActiveId)) : undefined;
    const remainingActive = groups ? new Set(Object.entries(groups).filter(([key]) => key !== "previouslySeen").flatMap(([, rows]) => rows.map((posting) => posting.id))) : undefined;
    const sequence = sectionedImbox ? navigationPostings.filter((posting) => !completing || remainingActive?.has(posting.id)) : mailbox?.postings ?? [];
    const nextId = cursorAfterRemoval(sequence, selected?.id ?? highlightedId, removedIds);
    const nextPosting = advancesReader && selected ? (sectionedImbox ? sequence.find((posting) => posting.id === nextId) : nextPostingInSequence(sequence, selected.id)) : undefined;
    const optimistic = applyOptimisticMailMutation(accountSplit ? sectionMailboxes : mailboxes, activeMailbox, highlightedId, request);
    const sourceBox = request.sourceBox ?? activeMailbox;
    const changedSources = accountSplit ? MAILBOX_KEYS : sectionedImbox ? ["imbox", "laterbox", "asidebox"] as MailboxKey[] : sourceBox ? [sourceBox] : [];
    for (const box of changedSources) {
      // An older mailbox read must not paint over the immediate local result.
      requestSequence.current[box] = (requestSequence.current[box] ?? 0) + 1;
      setLoadingMailboxes((current) => ({ ...current, [box]: false }));
    }
    setMailboxes((current) => applyOptimisticMailMutation(current, activeMailbox, highlightedId, request).mailboxes);
    splitMail.apply(request);
    if (sectionedImbox && (completing || advancesReader)) {
      setRetainedActiveId(undefined);
      setMailboxCursor((current) => ({ ...current, imbox: nextId }));
    } else if (activeMailbox && optimistic.removedFromActiveMailbox) setMailboxCursor((current) => ({ ...current, [activeMailbox]: optimistic.nextCursor }));
    if (advancesReader) {
      if (nextPosting) selectPosting(nextPosting, false);
      else setSelected(undefined);
    } else if (["move", "bubble", "bubble-pop", "unseen", "trash", "spam"].includes(request.operation)) setSelected(undefined);
    if (completing) mutationBusy.current = true;
    try {
      const result = await window.heyAgent.mail.mutate(request);
      onUndo?.(result.undo);
      appSound.play(request.operation === "spam" ? "warning" : "success", "mail");
      setNotice({ message: result.message, ...(result.undo ? { undo: result.undo } : {}) });
      await refresh();
      if (completing && !advancesReader) requestAnimationFrame(() => {
        const target = nextId ? document.getElementById(`mail-row-${nextId}`) : document.querySelector<HTMLElement>('.imbox-panel:not([hidden]) .sectioned-imbox-heading button');
        target?.focus({ preventScroll: true });
      });
      return true;
    } catch (reason) {
      appSound.play("error", "mail");
      setNotice({ message: reason instanceof Error ? reason.message : "HEY could not update this conversation." });
      await refresh();
      return false;
    } finally {
      if (completing) mutationBusy.current = false;
    }
  }, [activeMailbox, accountSplit, highlightedId, mailbox, mailboxes, refresh, selectPosting, selected, trash.enqueue, navigationPostings, retainedActiveId, sectionedImbox, sectionMailboxes, splitMail.apply]);

  const runBulkCommand = useCallback(async (id: ShortcutId) => {
    if (!activeMailbox || bulkSelectedIds.length === 0 || bulkMutating) return;
    const postings = mailbox?.postings.filter((posting) => bulkSelectedIds.includes(posting.id)) ?? [];
    const request = bulkMutationRequest(id, bulkSelectedIds, activeMailbox, mailbox?.postings);
    const requests = sectionedImbox ? sectionedActionRequests(id, postings, sectionMailboxes, accountSplit) : request ? [request] : [];
    if (!requests.length) {
      if (sectionedImbox && id === "seen") setNotice({ message: "Open contact bundles and finish their individual conversations." });
      return;
    }
    setBulkMutating(true);
    try {
      const undos: MailMutationRequest[] = [];
      for (const request of requests) {
        if (!await mutate(request, (undo) => { if (undo) undos.unshift(undo); })) {
          if (undos.length) setNotice({ message: "Some conversations were updated before an action failed. You can undo the completed updates.", undo: undos });
          return;
        }
        setBulkSelectedIds((current) => current.filter((id) => !request.postingIds.includes(id)));
      }
      if (requests.length > 1 && undos.length) setNotice({ message: `${postings.length} conversations updated.`, undo: undos });
      setBulkSelectedIds([]);
      setReadTogether(undefined);
      setReadTogetherThreads({});
    } finally {
      setBulkMutating(false);
    }
  }, [activeMailbox, bulkMutating, bulkSelectedIds, mailbox, mutate, sectionedImbox, sectionMailboxes, accountSplit]);

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
    const postings = navigationPostings;
    if (postings.length === 0) return;
    const current = postings.findIndex((posting) => posting.id === selected?.id);
    const start = current < 0 ? (delta > 0 ? -1 : postings.length) : current;
    const next = postings[Math.min(Math.max(start + delta, 0), postings.length - 1)];
    if (next && next.id !== selected?.id) {
      appSound.play("hover", "interface", { cooldownMs: 70, retrigger: "restart" });
      selectPosting(next, false);
    }
  }, [navigationPostings, selectPosting, selected]);

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
    readerSequence.current = [];
    setRetainedActiveId(undefined);
    selectionRange.current = undefined;
    appSound.play("press", "interface");
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    listingRequestSequence.current += 1;
    setCompactNavigationExpanded(false);
    if (["settings", "sessions"].includes(route) && window.matchMedia("(max-width: 980px)").matches) setAgentRailOpen(false);
    setActive(route); setSelected(undefined); setReaderOrigin(undefined); setThreadListing(undefined); setSetAsideGroupTarget(undefined); setMissingAgentObject(undefined); setSearchOpen(false); setBulkSelectedIds([]); setBulkComposerOpen(false); setReadTogether(undefined); setReadTogetherThreads({});
    if (route === "imbox") {
      setImboxSection(section);
      if (section === "previous") setImboxSectionRequest((value) => value + 1);
    }
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
          else void window.heyAgent.agent.attach(agentWorkspace.activeTabId, { kind: "hey-thread", id: posting.topicId, title: posting.subject, subtitle: posting.sender.name, ...(!readerOrigin && activeMailbox ? { sourceBox: postingSource(posting) } : {}) }).then(setAgentWorkspace).catch((reason: unknown) => setNotice({ message: reason instanceof Error ? reason.message : "Unable to attach the selected email." }));
        }
      }
      if (tool.artifact?.status === "complete") {
        if (tool.artifact.refresh.includes("mail")) {
          setAgentMailRefreshToken((value) => value + 1);
          if (sectionedImbox) for (const box of ["imbox", "laterbox", "asidebox"] as const) void refreshMailbox(box);
          else if (activeMailbox) void refreshMailbox(activeMailbox);
        }
        if (tool.artifact.refresh.includes("calendar")) setAgentCalendarRefreshToken((value) => value + 1);
      }
    }
  }, [activeMailbox, agentWorkspace, highlightedId, mailbox, navigate, readerOrigin, refreshMailbox, selected, setNavigationRailTarget, postingSource, sectionedImbox]);

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
    const requests = Array.isArray(notice.undo) ? notice.undo : [notice.undo];
    setNotice(undefined);
    for (const request of requests) if (request.operation === "undo-done") {
      for (const box of ["imbox", "laterbox", "asidebox"] as const) requestSequence.current[box] = (requestSequence.current[box] ?? 0) + 1;
      setLoadingMailboxes({});
      setMailboxes((current) => applyOptimisticMailMutation(current, activeMailbox, highlightedId, request).mailboxes);
      splitMail.apply(request);
      if (sectionedImbox && !selected) setMailboxCursor((current) => ({ ...current, imbox: request.postingIds[0] }));
    }
    try {
      const messages: string[] = [];
      for (const request of requests) messages.push((await window.heyAgent.mail.mutate(request)).message);
      appSound.play("undo", "mail");
      setNotice({ message: [...new Set(messages)].join(" ") || "Mail action undone." });
      await refresh();
    } catch (reason) {
      appSound.play("error", "mail");
      setNotice({ message: reason instanceof Error ? reason.message : "HEY could not undo that action." });
      await refresh();
    }
  }, [notice, refresh, activeMailbox, highlightedId, sectionedImbox, selected, splitMail.apply]);

  const highlightedPosting = mailbox ? postingAtCursor(sectionedImbox ? navigationPostings : mailbox.postings, highlightedId) : undefined;
  const actionPosting = readerOrigin ? undefined : selected ?? highlightedPosting;
  const contextualPosting = selected ?? highlightedPosting;
  const agentContextPostings = useMemo(() => bulkSelectedIds.length > 0
    ? (mailbox?.postings ?? []).filter((posting) => bulkSelectedIds.includes(posting.id))
    : contextualPosting ? [contextualPosting] : [], [bulkSelectedIds, contextualPosting, mailbox?.postings]);
  const agentContextAttachments = useMemo(() => sectionedImbox && !readerOrigin
    ? agentContextPostings.flatMap((posting) => { const attachment = attachmentForPosting(posting, postingSource(posting)); return attachment ? [attachment] : []; })
    : attachmentsForPostings(agentContextPostings, readerOrigin ? undefined : activeMailbox), [activeMailbox, agentContextPostings, readerOrigin, sectionedImbox, postingSource]);
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
    const clearingActive = sectionedImbox && selected?.id === retainedActiveId && selected?.seen;
    const postingId = clearingActive ? cursorAfterRemoval(navigationPostings, selected?.id, new Set([selected!.id])) : selected?.id ?? readTogether?.postingIds[0];
    if (clearingActive) setMailboxCursor((current) => ({ ...current, imbox: postingId }));
    setRetainedActiveId(undefined);
    readerSequence.current = [];
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
  }, [readTogether, readerOrigin, selected, navigationPostings, retainedActiveId, sectionedImbox]);

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
    if (id === "split-add") { openAddToSplit(); return; }
    if (id === "split-create" || id === "split-manage") { openSplitManager(id === "split-create" ? {} : undefined); return; }
    if (id === "split-create-person" || id === "split-create-domain") {
      const target = selected ?? highlightedPosting;
      const draft = target && splitDraftFromPosting(target, id === "split-create-person" ? "person" : "domain", window.heyAgent.profiles.current.active?.email);
      if (draft) openSplitManager(draft);
      return;
    }
    if (id.startsWith("split-go:")) { chooseSplit(id.slice("split-go:".length), true); return; }
    if (id === "split-next" || id === "split-previous") {
      const index = splitIds.indexOf(splitId);
      chooseSplit(splitIds[(index + (id === "split-next" ? 1 : -1) + splitIds.length) % splitIds.length]!, true);
      return;
    }
    if (id === "undo-trash") { if (notice?.undo) void undo(); else void undoTrash(); return; }
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
      const posting = postingAtCursor(sectionedImbox ? navigationPostings : mailbox.postings, highlightedId);
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
      const posting = postingAtCursor(sectionedImbox ? navigationPostings : mailbox.postings, highlightedId);
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
      const attachment = attachmentForPosting(selected, readerOrigin || !selected ? undefined : postingSource(selected));
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
    const target = selected ?? (mailbox ? postingAtCursor(sectionedImbox ? navigationPostings : mailbox.postings, highlightedId) : undefined);
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
    if (id === "seen") {
      const request = sectionedImbox ? sectionedDoneRequest([target], sectionMailboxes, accountSplit) : { operation: "seen" as const, postingIds: [target.id] };
      if (!request) { setNotice({ message: "Open this contact bundle and finish individual conversations." }); return; }
      if (!selected && !sectionedImbox) setImboxSection("previous");
      void mutate(request);
      return;
    }
    const toggle = mailToggle(id, [target.id], postingSource(target), [target]);
    if (toggle) void mutate(toggle.request);
    if (id === "stop-ignoring") void mutate({ operation: "stop-ignoring", postingIds: [target.id] });
    if (id === "trash") void mutate({ operation: "trash", postingIds: [target.id], sourceBox: postingSource(target) });
  }, [activeMailbox, agentRailOpen, agentWorkspace, bulkSelectedIds, closeReader, highlightedId, launchHelper, mailbox, moveCursor, moveThreadSelection, mutate, navigate, navigation.overlay, openBulkOrganizer, openReadTogether, readTogether, readerOrigin, runAgentContextCommand, runBulkCommand, selectPosting, selected, toggleBulkSelection, toggleNavigation, undoTrash, undo, notice?.undo, navigationPostings, postingSource, sectionedImbox, sectionMailboxes, openSplitManager, openAddToSplit, accountSplit, chooseSplit, highlightedPosting, splitIds, splitId]);

  const availableCommands = useMemo(() => {
    const applicable = shortcuts.filter((command) => {
      if (command.id.startsWith("split-")) {
        if (command.id === "split-add") return bulkSelectedIds.length > 0 || Boolean((selected ?? highlightedPosting)?.topicId && /^\d+$/.test((selected ?? highlightedPosting)!.id));
        if (command.id === "split-create" || command.id === "split-manage") return true;
        if (isSplitNavigationCommand(command.id)) return sectionedImbox && enabledSplits.length > 0 && !selected && !readTogether && !threadListing;
        if (command.id === "split-create-person" || command.id === "split-create-domain") return Boolean((selected ?? highlightedPosting) && splitDraftFromPosting((selected ?? highlightedPosting)!, "person", window.heyAgent.profiles.current.active?.email));
      }
      return (command.id !== "undo-trash" || trash.items.length > 0 || Boolean(notice?.undo)) && (command.scope === "global"
      || command.scope === "mailbox" && Boolean(activeMailbox)
      || command.scope === "bulk" && bulkSelectedIds.length > 0 && (command.id !== "reply-together" || bulkSelectedIds.length >= 2)
      || command.scope === "conversation" && Boolean(actionPosting) && (bulkSelectedIds.length === 0 || isBulkMutationCommand(command.id))
      || command.scope === "reader" && Boolean(selected || readTogether)
      || command.scope === "session" && Boolean(agentWorkspace));
    });
    const validForMailbox = bulkSelectedIds.length > 0 && activeMailbox
      ? applicable.filter((command) => !isBulkMutationCommand(command.id) || (sectionedImbox
        ? sectionedActionRequests(command.id, mailbox?.postings.filter((posting) => bulkSelectedIds.includes(posting.id)) ?? [], sectionMailboxes, accountSplit).length > 0
        : Boolean(bulkMutationRequest(command.id, bulkSelectedIds, activeMailbox))))
      : applicable;
    const helperCommands: ShortcutDefinition[] = contextualHelpers.map((helper) => ({ id: helperCommandId(helper.id), label: helperCommandLabel(helper, agentContextAttachments.length), keys: [], display: "", scope: "agent-context" as const }));
    const contextualCommands = prioritizeBulkCommands(validForMailbox, bulkSelectedIds.length).map((command) => {
      if (command.id === "undo-trash" && notice?.undo) return { ...command, label: "Undo last mail action" };
      if (sectionedImbox && command.id === "seen") return { ...command, label: bulkSelectedIds.length ? `Done · ${bulkSelectedIds.length} selected` : accountSplit ? "Done" : "Done — move to Previously Seen" };
      if (!activeMailbox) return command;
      const ids = bulkSelectedIds.length ? bulkSelectedIds : actionPosting ? [actionPosting.id] : [];
      const source = bulkSelectedIds.length && sectionedImbox ? sectionedSelectionSource(sectionMailboxes, bulkSelectedIds, accountSplit)
        : !bulkSelectedIds.length && actionPosting ? postingSource(actionPosting) : activeMailbox;
      const toggle = mailToggle(command.id, ids, source, bulkSelectedIds.length ? mailbox?.postings : actionPosting ? [actionPosting] : []);
      const label = command.id === "aside" ? (toggle?.active ? "Set Aside: remove" : "Set Aside") : toggle?.label;
      return toggle ? { ...command, label: `${label}${bulkSelectedIds.length ? ` · ${bulkSelectedIds.length} selected` : ""}` } : command;
    });
    const splitCommands: ShortcutDefinition[] = enabledSplits.length ? splitIds.map((id) => ({ id: `split-go:${id}`, label: `Go to split: ${id === "all" ? "All" : id === "remaining" ? "Remaining" : enabledSplits.find((split) => split.id === id)!.name}`, keys: [], display: "", scope: "global" })) : [];
    return [...helperCommands, ...contextCommands, ...contextualCommands, ...splitCommands];
  }, [activeMailbox, actionPosting, highlightedPosting, accountSplit, agentContextAttachments.length, agentWorkspace, bulkSelectedIds, contextCommands, contextualHelpers, mailbox, readTogether, selected, shortcuts, trash.items.length, notice?.undo, postingSource, sectionedImbox, sectionMailboxes, enabledSplits, splitIds, threadListing]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isShortcutEvent(event, true)) return;
      const splitNavigation = canNavigateSplits(event, sectionedImbox && enabledSplits.length > 0 && !selected && !readTogether && !threadListing && !composer && !splitManager && !addingToSplit && !commandsOpen && !navigation.overlay);
      const eventCommands = availableCommands.filter((command) => !isSplitNavigationCommand(command.id) || splitNavigation);
      const editableTarget = isEditingEvent(event) || isLocalKeyboardEvent(event);
      if (editableTarget && chord.current) {
        clearTimeout(chord.current.timer); chord.current = undefined; setChordHint(undefined);
      }
      // Never cancel the browser's editing behavior or dispatch mailbox actions
      // from an editor/dialog, including when focus is on its toolbar.
      if (isDialogKeyboardEvent(event) || editableTarget && isNativeEditingShortcut(event)) return;
      if (event.repeat && !eventCommands.some((item) => matchesShortcut(event, item))) return;
      if (bulkComposerOpen || organizer || splitManager || addingToSplit) return;
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
        const editableCommand = eventCommands.find((item) => matchesShortcut(event, item));
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
        const completion = eventCommands.find((item) => completesShortcutChord(pending.first, event, item));
        if (completion) { event.preventDefault(); runCommand(completion.id); return; }
      }
      const command = eventCommands.find((item) => matchesShortcut(event, item));
      if (!command) {
        const starter = eventCommands.find((item) => startsShortcutChord(event, item));
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
  }, [availableCommands, bulkComposerOpen, bulkSelectedIds.length, closeReader, composer, navigation.overlay, notice?.bulkUndoId, organizer, readTogether, runCommand, undo, undoTrash, trash.items.length, selected, mailbox, selectPosting, sectionedImbox, enabledSplits.length, splitManager, addingToSplit, threadListing, commandsOpen]);

  const newChat = () => {
    setAgentError(undefined); setAgentDraftSeed(undefined);
    void window.heyAgent.agent.newSession().then((workspace) => { appSound.play("open", "interface"); setAgentWorkspace(workspace); setAgentRailOpen(true); }).catch((reason: unknown) => { appSound.play("error", "agent"); setAgentError(reason instanceof Error ? reason.message : "Unable to create a session."); });
  };
  const continueReplyInAgent = useCallback(async (posting: ImboxPosting, draft: string) => {
    const attachment = attachmentForPosting(posting, postingSource(posting));
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
  }, [postingSource, settings.helpers.enabled, startMailHelper]);

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
      threadCache.invalidate(topicId, true);
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
    if (accountSplit) void splitMail.refresh();
    if (sectionedImbox) for (const box of ["imbox", "laterbox", "asidebox"] as const) void refreshMailbox(box);
    else if (activeMailbox) void refreshMailbox(activeMailbox);
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
      if (accountSplit) await splitMail.refresh();
    } catch (reason) {
      appSound.play("error", "mail");
      setNotice({ message: reason instanceof Error ? reason.message : "HEY could not update this Set Aside group." });
    } finally {
      setSetAsideGroupBusy(false);
    }
  }, [refreshMailbox, setAsideGroupBusy, accountSplit, splitMail.refresh]);

  const openDetachedPosting = useCallback((posting: ImboxPosting, origin: "bundle" | "library") => {
    appSound.play("open", "interface");
    setSelected(posting);
    setReaderOrigin(origin);
  }, []);

  const selectedIndex = selected ? navigationPostings.findIndex((posting) => posting.id === selected.id) : -1;
  const hasPrevious = selectedIndex > 0;
  const hasNext = selectedIndex >= 0 && selectedIndex < navigationPostings.length - 1;
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
  const addSelectedToSplit = selected && /^\d+$/.test(selected.id) && selected.topicId && selected.kind !== "bundle"
    ? <button type="button" onClick={() => openAddToSplit([selected.id])}><ListFilter size={14} /> Add to split</button> : undefined;

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
              : readerOrigin && selected ? <ThreadPanel posting={selected} thread={selectedThread} threadError={selectedThreadError} sourceLabel={readerOrigin === "search" ? "Search results" : readerOrigin === "agent" ? "HEY Agent result" : readerOrigin === "bundle" ? threadListing?.listing?.title ?? "Bundle" : libraryReaderTitle} onOrganize={/^\d+$/.test(selected.id) || /^\d+$/.test(selected.topicId ?? "") ? () => setOrganizer({ postings: [selected] }) : undefined} helperActions={mailHelperActions} onHelperAction={runCommand} onRefresh={() => undefined} onRetryThread={() => selected.topicId && void loadThread(selected.topicId, { force: true, reportError: true })} replyRequest={0} onClose={closeReader} onPrevious={() => undefined} onNext={() => undefined} hasPrevious={false} hasNext={false} supplementalActions={addSelectedToSplit} showTraversal={false} onOpenObject={(object) => void openAgentObject(object)} />
              : activeMailbox ? <>
              <ImboxView
                key={`${activeMailbox}:${sectionedImbox ? splitId : "hey"}`}
                mailboxKey={activeMailbox} showSenderAvatars={settings.showSenderAvatars}
                sectioned={sectionedImbox} accountSplit={accountSplit} sectionMailboxes={viewSectionMailboxes}
                retainedActiveId={selected?.id === retainedActiveId ? retainedActiveId : undefined}
                profileKey={`${window.heyAgent.profiles.current.active?.key ?? "default"}${sectionedImbox && splitId !== "all" ? `:split:${splitId}` : ""}`}
                initialHistoryCollapsed={splitId !== "all"}
                pagingPaused={Boolean(commandsOpen || splitManager || addingToSplit || composer || searchOpen || organizer)}
                onManageSplits={() => openSplitManager()}
                onAddToSplit={openAddToSplit}
                splitTabs={sectionedImbox && enabledSplits.length > 0 ? <>
                  <SplitInboxTabs splits={splitState.splits} selectedId={splitId} counts={splitCounts} onSelect={chooseSplit} onManage={() => openSplitManager()} onCreate={() => openSplitManager({})} />
                  {(splitLoadError || Object.keys(splitState.errors).length > 0) && <div className="sectioned-imbox-pagination-error" role="status"><span>{splitLoadError ?? "Some split labels could not sync."}</span><button type="button" className="toolbar-button" onClick={() => openSplitManager()}>Review</button><button type="button" className="toolbar-button" onClick={() => { void window.heyAgent.mail.refreshSplits().then(setSplitState).catch((reason: unknown) => setSplitLoadError(reason instanceof Error ? reason.message : "Unable to refresh splits.")); }}>Retry</button></div>}
                </> : undefined}
                onLayoutChange={(layout) => void updateImboxLayout(layout)} onVisiblePostingsChange={updateVisibleSectionPostings}
                onLoadMore={accountSplit ? () => { if (splitMail.nextPage) void splitMail.loadMore(); else void splitMail.refresh(true); } : loadMoreHistory} loadingMore={accountSplit ? splitMail.loadingMore : loadingHistory} loadMoreError={accountSplit ? splitMail.error : historyError}
                result={mailbox} overview={activeMailbox === "imbox" ? overview : undefined} loading={loading}
                searchRequest={0} focusSection={imboxSection} focusSectionRequest={imboxSectionRequest}
                selectedId={highlightedId} bulkSelectedIds={bulkSelectedIds} bulkBusy={bulkMutating || setAsideGroupBusy}
                commandPaletteOpen={commandsOpen} onSelect={selectPosting}
                onHighlight={(id) => setMailboxCursor((current) => current[activeMailbox] === id ? current : { ...current, [activeMailbox]: id })}
                onToggleSelection={toggleBulkSelection} onBulkAction={runCommand} helperActions={mailHelperActions}
                onReadTogether={openReadTogether} onReplyTogether={() => setBulkComposerOpen(true)}
                onOrganizeSelection={openBulkOrganizer} onClearSelection={() => setBulkSelectedIds([])}
                onRefresh={() => void refreshFromToolbar()} onNavigate={navigate} setAsideGroupTarget={setAsideGroupTarget}
                onSetAsideGroup={(request) => void updateSetAsideGroup(request)} hidden={Boolean(selected || readTogether || threadListing)} />
              {threadListing ? <ThreadListingView listing={threadListing.listing} loading={threadListing.loading} error={threadListing.error} onBack={() => { listingRequestSequence.current += 1; setThreadListing(undefined); }} onOpen={(posting) => openDetachedPosting(posting, "bundle")} onRetry={() => void loadThreadListing(threadListing.kind, threadListing.id, true)} onShowAll={threadListing.kind === "bundle" && threadListing.listing?.contact.id ? () => void loadThreadListing("contact", threadListing.listing!.contact.id!) : undefined} />
                : readTogether && readTogetherItems.length > 0 ? <ReadTogetherView ref={readTogetherRef} items={readTogetherItems} sourceLabel={MAILBOX_LABELS[activeMailbox]} skippedCount={readTogether.skippedCount} onClose={closeReader} onRetryThread={(topicId) => void loadThread(topicId, { force: true, reportError: true }).then((thread) => { if (thread) setReadTogetherThreads((current) => ({ ...current, [topicId]: thread })); })} onOpenObject={(object) => void openAgentObject(object)} />
                : selected && <ThreadPanel posting={selected} thread={selectedThread} threadError={selectedThreadError} sourceLabel={MAILBOX_LABELS[postingSource(selected)]} supplementalActions={<>{sectionedImbox && <button type="button" data-tooltip={accountSplit ? "Done" : "Done — move to Previously Seen"} data-shortcut-id="seen" onClick={() => runCommand("seen")}><Check size={14} /> Done</button>}{addSelectedToSplit}</>} mailActions={{ sourceBox: postingSource(selected), onMutate: (request) => void mutate(request), onForward: () => { appSound.play("forward", "interface"); setComposer({ mode: "forward", posting: selected }); }, onMailChanged: replyComplete }} onOrganize={() => setOrganizer({ postings: [selected] })} helperActions={mailHelperActions} onHelperAction={runCommand} onRefresh={() => void refresh()} onRetryThread={() => selected.topicId && void loadThread(selected.topicId, { force: true, reportError: true })} replyRequest={replyRequest} replyDraftSeed={replyDraftSeed?.postingId === selected.id ? replyDraftSeed : undefined} onContinueInAgent={(draft) => void continueReplyInAgent(selected, draft)} continueInAgentLabel={settings.helpers.enabled.includes("reply-coach") ? "Reply Coach" : "Continue in agent"} onClose={closeReader} onPrevious={() => moveThreadSelection(-1)} onNext={() => moveThreadSelection(1)} hasPrevious={hasPrevious} hasNext={hasNext} onOpenObject={(object) => void openAgentObject(object)} />}
            </>
              : active === "screener" ? <ScreenerView onNotice={(message) => setNotice({ message })} onOpenObject={(object) => void openAgentObject(object)} />
              : active === "drafts" ? <DraftsView onNotice={(message) => setNotice({ message })} target={draftAgentTarget} onTargetMissing={markAgentObjectMissing} refreshToken={agentMailRefreshToken} />
              : active === "calendar" ? <CalendarView onReturnMail={() => navigate("imbox")} onNotice={(message) => setNotice({ message })} target={calendarAgentTarget} onTargetMissing={markAgentObjectMissing} onActiveEvent={setCalendarHelperEvent} onHelperWindow={setCalendarHelperWindow} helpers={contextualHelpers.filter((helper) => helper.id !== "meeting-prep" && helper.surfaces.includes("calendar"))} onRunHelper={launchHelper} onMeetingPrep={startMeetingPrep} meetingPrepEnabled={settings.helpers.enabled.includes("meeting-prep")} meetingPrepBusy={startingHelpers.has("meeting-prep")} refreshToken={agentCalendarRefreshToken} />
              : active === "library" ? null
              : active === "settings" ? <SettingsView settings={settings} theme={theme} onSettings={setSettings} onRunHelper={launchHelper} onEditHelper={() => { if (window.matchMedia("(max-width: 980px)").matches) setAgentRailOpen(false); }} onManageSplits={() => openSplitManager()} runnableHelpers={contextualHelpers.map((helper) => helper.id)} busyHelpers={startingHelpers} />
              : active === "sessions" ? <SessionHistory workspace={agentWorkspace} onWorkspace={setAgentWorkspace} onOpen={() => { setAgentDraftSeed(undefined); setAgentRailOpen(true); setAgentFocusRequest((value) => value + 1); }} />
              : <UnsupportedView active={active} onReturn={() => setActive("imbox")} />}
            {!agentRailOpen ? <RailMorphButton rail="agent" open={false} className="agent-rail-reopen" aria-label="Show HEY Agent" data-tooltip="Show HEY Agent" data-shortcut={agentShortcut} data-tooltip-side="left" onClick={() => { appSound.play("snap", "interface"); setAgentRailOpen(true); }} /> : null}
          </div>
          {agentRailOpen ? <aside className="panel agent-rail" aria-label="HEY Agent">
            {agentWorkspace ? <AgentPane workspace={agentWorkspace} onWorkspace={setAgentWorkspace} posting={selected} contextAttachments={agentContextAttachments} unavailableContextCount={agentContextPostings.filter((posting) => !posting.topicId).length} mailbox={readerOrigin ? undefined : selected ? postingSource(selected) : activeMailbox} initialDraft={agentDraftSeed?.tabId === agentWorkspace.activeTabId ? agentDraftSeed.text : undefined} focusRequest={agentFocusRequest} onInitialDraftConsumed={consumeAgentDraftSeed} onUseInComposer={!readerOrigin && selected ? useAgentDraftInReply : undefined} onClose={() => { appSound.play("drop", "interface"); setAgentRailOpen(false); }} closeShortcut={agentShortcut} sound={settings.sound} onOpenObject={(object) => void openAgentObject(object)} />
              : <div className="agent-rail-loading"><Sparkles size={20} /><strong>Starting HEY Agent</strong><span>{agentError ?? "Restoring your local sessions…"}</span></div>}
          </aside> : null}
        </div>
      </div>
      {composer && <MailComposer mode={composer.mode} posting={composer.posting} initialTo={composer.initialTo} onClose={() => setComposer(undefined)} onComplete={mailComplete} />}
      {bulkComposerOpen && <BulkReplyComposer postingIds={bulkSelectedIds} onClose={() => setBulkComposerOpen(false)} onComplete={bulkReplyComplete} />}
      {organizer && <MailOrganizer postings={organizer.postings} initialKind={organizer.initialKind} onClose={() => setOrganizer(undefined)} onNotice={(message) => setNotice({ message })} onOpenObject={(object) => void openAgentObject(object)} />}
      {searchOpen && <MailSearch hidden={readerOrigin === "search"} onOpen={(posting) => { appSound.play("open", "interface"); setSelected(posting); setReaderOrigin("search"); }} onClose={() => { appSound.play("close", "interface"); setSearchOpen(false); if (readerOrigin === "search") { setSelected(undefined); setReaderOrigin(undefined); } }} />}
      {commandsOpen && <CommandPalette commands={availableCommands} onRun={runCommand} onClose={() => { appSound.play("close", "interface"); setCommandsOpen(false); }} />}
      {addingToSplit && !splitManager && <AddToSplitDialog postings={addingToSplit} splits={splitState.splits}
        ownEmail={window.heyAgent.profiles.current.active?.email}
        onCreate={() => openSplitManager({})} onClose={() => setAddingToSplit(undefined)}
        onAdd={async (request) => {
          const next = await window.heyAgent.mail.addToSplit(request);
          setSplitState(next);
          if (accountSplit) await splitMail.refresh();
          setNotice({ message: `Added to ${next.splits.find((split) => split.id === request.splitId)?.name ?? "split"}.` });
          setBulkSelectedIds([]);
        }} />}
      {splitManager && <SplitInboxManager splits={splitState.splits} labels={splitLabels} initialDraft={splitManager.draft}
        errors={{ ...splitState.errors, ...(splitLoadError ? { _load: splitLoadError } : {}), ...(splitLabelsError ? { _labels: splitLabelsError } : {}) }}
        onPreview={(draft) => window.heyAgent.mail.previewSplit(draft)} onSave={saveSplit}
        onRemove={async (id) => { setSplitState(await window.heyAgent.mail.removeSplit(id)); }}
        onClose={() => setSplitManager(undefined)} />}
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
