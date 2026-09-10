export type RuntimeId = "hey" | "pi" | "hey-auth" | "hey-skill" | "hey-agent-extension";

export type RuntimeProbe = {
  id: RuntimeId;
  label: string;
  executable?: string;
  version?: string;
  status: "ready" | "missing" | "error";
  detail?: string;
};

export type AppPaths = {
  config: string;
  data: string;
  state: string;
  workspace: string;
};

export type SystemStatus = {
  paths: AppPaths;
  runtimes: RuntimeProbe[];
};

export type MailContact = {
  id?: string;
  name: string;
  email?: string;
  kind?: string;
  avatarUrl?: string;
  avatarBackgroundColor?: string;
  initials?: string;
};

export type ImboxPosting = {
  id: string;
  topicId?: string;
  kind?: string;
  boxGroupId?: string;
  appUrl?: string;
  subject: string;
  summary: string;
  seen: boolean;
  bubbledUp?: boolean;
  createdAt: string;
  contacts: MailContact[];
  addressedContacts?: MailContact[];
  sender: MailContact;
  visibleEntryCount: number;
};

export type MailboxKey = "imbox" | "feedbox" | "trailbox" | "asidebox" | "laterbox" | "bubblebox";

export type CalendarSummary = {
  id: string;
  name: string;
  kind?: string;
  color?: string;
  external?: boolean;
  owned?: boolean;
  personal?: boolean;
  ownerEmailAddress?: string;
  writable?: boolean;
};

export type CalendarReminder = {
  id?: string;
  label: string;
  summary?: string;
  remindAt?: string;
  durationSeconds?: number;
};

export type CalendarPerson = {
  name: string;
  email?: string;
  status?: string;
};

export type CalendarEvent = {
  id: string;
  occurrenceId?: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  recurring: boolean;
  highlighted?: boolean;
  timeZone?: string;
  calendar: CalendarSummary;
  description?: string;
  location?: string;
  linkUrl?: string;
  editUrl?: string;
  attachedEntryId?: string;
  reminders: CalendarReminder[];
  organizer?: CalendarPerson;
  attendees: CalendarPerson[];
  attendanceSummary?: string;
  joinLink?: { title?: string; url: string };
};

export type CalendarRepeat = "every_day" | "every_weekday" | "every_week" | "every_other_week" | "every_day_of_month" | "every_year";

export type CalendarEventCreateRequest = {
  title: string;
  calendarId: string;
  startsOn: string;
  endsOn?: string;
  allDay: boolean;
  startTime?: string;
  endTime?: string;
  timeZone?: string;
  location?: string;
  link?: string;
  notes?: string;
  invites?: string[];
  reminders?: string[];
  repeat?: CalendarRepeat;
  repeatUntil?: string;
  countdown?: number;
  countdownUnit?: "days" | "weeks" | "months";
  circle?: boolean;
};

export type CalendarEventCreateResult = {
  message: string;
  eventId?: string;
};

export type MailCalendarInvite = {
  title: string;
  when: string;
  location?: string;
  organizer?: string;
  copy?: CalendarEventCreateRequest;
  notice?: string;
};

export type CalendarEventUpdateRequest = {
  id: string;
  lookupDate: string;
  title?: string;
  startsOn?: string;
  endsOn?: string;
  allDay?: boolean;
  startTime?: string;
  endTime?: string;
  timeZone?: string;
  location?: string;
  link?: string;
  notes?: string;
  invites?: string[];
  reminders?: string[];
  repeat?: CalendarRepeat;
  repeatUntil?: string;
  countdown?: number;
  countdownUnit?: "days" | "weeks" | "months";
  circle?: boolean;
};

export type CalendarEventMutationResult = {
  message: string;
};

export type CalendarWindowRequest = {
  startsOn: string;
  endsOn: string;
  calendarId?: string;
};

export type CalendarWindowResult = {
  status: "ready" | "needs-auth" | "unavailable";
  startsOn: string;
  endsOn: string;
  calendars: CalendarSummary[];
  events: CalendarEvent[];
  detail?: string;
};

export const CALENDAR_SEARCH_KINDS = ["event", "todo", "journal", "time"] as const;
export type CalendarSearchKind = typeof CALENDAR_SEARCH_KINDS[number];

export type CalendarSearchRequest = {
  query: string;
};

export type CalendarSearchItem = {
  kind: CalendarSearchKind;
  id: string;
  title: string;
  date: string;
  detail?: string;
};

export type CalendarSearchResult = {
  status: "ready" | "needs-auth" | "unavailable";
  query: string;
  items: CalendarSearchItem[];
  unavailableSources: CalendarSearchKind[];
  detail?: string;
};

export type CalendarTodo = {
  id: string;
  title: string;
  startsOn: string;
  completedAt?: string;
};

export type CalendarTodoCreateRequest = { title: string; date?: string };
export type CalendarTodoCompletionRequest = { id: string; completed: boolean };

export const CALENDAR_HABIT_COLORS = ["blue", "red", "gold", "green", "teal", "purple", "pink", "brown"] as const;
export type CalendarHabitColor = typeof CALENDAR_HABIT_COLORS[number];
export const CALENDAR_HABIT_ICONS = ["weights", "art", "baseball", "basketball", "bed", "bicycle", "brain", "camera", "cat", "church", "clean", "cook", "dog", "football", "fruit", "game", "garden", "guitar", "heart", "hydrate", "meditate", "money", "music", "piano", "pill", "plant", "read", "run", "smoke", "soccer", "study", "swim", "tea", "toothbrush", "tree", "tv", "vegetable", "walk", "water", "write", "yoga", "heat", "ice", "lotus", "breathe", "drink", "star"] as const;
export type CalendarHabitIcon = typeof CALENDAR_HABIT_ICONS[number];

export type CalendarHabit = {
  id: string;
  name: string;
  icon: CalendarHabitIcon;
  color: CalendarHabitColor;
  days: number[];
  completedDates: string[];
};

export type CalendarHabitWriteRequest = {
  id?: string;
  name: string;
  icon: CalendarHabitIcon;
  color: CalendarHabitColor;
  days: number[];
};
export type CalendarHabitCompletionRequest = { id: string; date: string; completed: boolean };

export type CalendarJournalEntry = {
  id?: string;
  date: string;
  content: string;
};
export type CalendarJournalWriteRequest = { date: string; content: string };

export type CalendarTimeTrack = {
  id: string;
  startsAt: string;
  endsAt?: string;
  stoppedAt?: string;
  notes?: string;
  category?: string;
};
export type CalendarTimeCategory = { id: string; title: string };
export type CalendarTimeTrackUpdateRequest = { id: string; start?: string; end?: string; category?: string; notes?: string };
export type CalendarTimeStopRequest = { category?: string };

export type CalendarReadResult<T> = {
  status: "ready" | "needs-auth" | "unavailable";
  data: T;
  detail?: string;
};

export type ImboxResult = {
  status: "ready" | "needs-auth" | "unavailable";
  boxKey: MailboxKey;
  boxName: string;
  nextPage?: string;
  postings: ImboxPosting[];
  detail?: string;
};

export type MailThreadListing = {
  kind: "bundle" | "contact";
  id: string;
  title: string;
  contact: MailContact;
  nextPage?: string;
  postings: ImboxPosting[];
};

export type SetAsideGroupMutationRequest = {
  action: "create" | "add" | "remove" | "delete";
  postingIds?: string[];
  groupId?: string;
};

export type BubbleSchedule = "now" | "tomorrow" | "weekend" | "next-week";

export type MailOperation = "move" | "bubble" | "bubble-pop" | "seen" | "unseen" | "trash" | "spam" | "ignore" | "stop-ignoring";

export type MailMutationRequest = {
  operation: MailOperation;
  postingIds: string[];
  destination?: MailboxKey;
  sourceBox?: MailboxKey;
  bubbleSchedule?: BubbleSchedule;
};

export type MailMutationResult = {
  message: string;
  undo?: MailMutationRequest;
};

export type MailComposerMode = "compose" | "reply" | "forward";

export type MailSendRequest = {
  mode: MailComposerMode;
  topicId?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body: string;
  attachments: string[];
  saveAsDraft?: boolean;
};

export type MailSendResult = {
  disposition: "sent" | "draft";
  message: string;
  draftId?: string;
};

export type BulkReplyPreviewItem = {
  entryId: string;
  topicId: string;
  subject: string;
  to: MailContact[];
  cc: MailContact[];
  bcc: MailContact[];
};

export type BulkReplyPreview = {
  postingIds: string[];
  items: BulkReplyPreviewItem[];
};

export type BulkReplySendRequest = {
  postingIds: string[];
  body: string;
  attachments: string[];
};

export type BulkReplySendResult = {
  message: string;
  replyCount: number;
  deliveryId?: string;
  delayed: boolean;
};

export type BulkReplyUndoResult = {
  message: string;
  undone: boolean;
};

export type MailReplyContext = {
  to: MailContact[];
  cc: MailContact[];
  bcc: MailContact[];
};

export type MailWatchChange = {
  change: "ready" | "disconnected" | "added" | "updated" | "deleted" | "resync";
  at?: string;
  box?: { id: string; key: string; name: string };
  postingId?: string;
  topicId?: string;
  isNew?: boolean;
};

export type MailSearchOption = {
  value: string;
  title: string;
};

export type MailSearchFilters = {
  boxes: MailSearchOption[];
  dates: MailSearchOption[];
  labels: MailSearchOption[];
  attachments: MailSearchOption[];
};

export type MailSearchRequest = {
  query?: string;
  required?: string;
  any?: string;
  none?: string;
  exact?: string;
  from?: string;
  to?: string;
  subject?: string;
  date?: string;
  box?: string;
  label?: string;
  attachment?: string;
  page?: number;
};

export type MailSearchResult = {
  query: string;
  page: number;
  hasMore: boolean;
  postings: ImboxPosting[];
};

export type MailOrganizationKind = "labels" | "collections";

export type MailOrganizationTarget = {
  postingIds?: string[];
  topicIds?: string[];
};

export type MailOrganizationItem = {
  id: string;
  name: string;
  summary?: string;
  membership: "none" | "some" | "all";
  memberCount: number;
};

export type MailOrganization = {
  labels: MailOrganizationItem[];
  collections: MailOrganizationItem[];
};

export type MailOrganizationMutationRequest = MailOrganizationTarget & {
  kind: MailOrganizationKind;
  action: "add" | "remove" | "create";
  targetId?: string;
  name?: string;
};

export type ScreenerEntry = {
  id: string;
  topicId: string;
  sender: MailContact;
  subject: string;
  summary: string;
};

export type ScreenerResult = {
  status: "ready" | "needs-auth" | "unavailable";
  entries: ScreenerEntry[];
  detail?: string;
};

export type MailOverview = {
  screener: ScreenerResult;
  replyLater: {
    count: number;
    latest?: ImboxPosting;
  };
};

export type ScreenerDecisionRequest = {
  id: string;
  decision: "approve" | "deny";
  destination?: MailboxKey;
  seen?: boolean;
  spam?: boolean;
};

export type MailLibraryKind = "contacts" | "labels" | "collections";

export type MailLibraryItem = {
  id: string;
  title: string;
  subtitle?: string;
  detail?: string;
  contact?: MailContact;
};

export type MailLibraryResult = {
  kind: MailLibraryKind;
  items: MailLibraryItem[];
};

export type MailLibrarySourceResult = {
  kind: Exclude<MailLibraryKind, "contacts">;
  id: string;
  title: string;
  totalCount: number;
  nextPage?: string;
  postings: ImboxPosting[];
};

export type MailContactDetail = MailContact & {
  id: string;
  email: string;
  aliases: string[];
  note: string;
  status?: string;
  clearanceId?: string;
  domain?: string;
  editAppUrl?: string;
  domainAppUrl?: string;
  updatedAt?: string;
};

export type ShortcutProfile = "hey" | "superhuman" | "custom";
export const INTERFACE_FONT_IDS = ["instrument", "system", "system-mono"] as const;
export type InterfaceFont = typeof INTERFACE_FONT_IDS[number];
export function isInterfaceFont(value: unknown): value is InterfaceFont {
  return typeof value === "string" && INTERFACE_FONT_IDS.some((font) => font === value);
}

export const SOUND_PACKS = ["minimal", "soft", "glass", "arcade", "mechanical", "organic", "dreamy", "scifi", "rubber", "cinematic", "studio", "zen"] as const;
export type SoundPack = typeof SOUND_PACKS[number];

export type SoundSettings = {
  enabled: boolean;
  pack: SoundPack;
  volume: number;
  interfaceSounds: boolean;
  mailSounds: boolean;
  agentSounds: boolean;
  agentLoops: boolean;
  notificationSounds: boolean;
};

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  enabled: true,
  pack: "zen",
  volume: 0.3,
  interfaceSounds: true,
  mailSounds: true,
  agentSounds: true,
  agentLoops: true,
  notificationSounds: false,
};

export type AppSettings = {
  version: 1;
  interfaceFont: InterfaceFont;
  showSenderAvatars: boolean;
  shortcutProfile: ShortcutProfile;
  customShortcuts: Record<string, string[]>;
  sound: SoundSettings;
  ai: AiSettings;
  helpers: HelperSettings;
};

export type AppSettingsUpdate = {
  shortcutEdit?: { id: string; bindings: string[] | null };
  interfaceFont?: InterfaceFont;
  showSenderAvatars?: boolean;
  shortcutProfile?: ShortcutProfile;
  customShortcuts?: Record<string, string[]>;
  sound?: Partial<SoundSettings>;
  ai?: Partial<AiSettings>;
  helpers?: Partial<HelperSettings>;
};

export type HelperSettings = {
  catalogVersion: 2;
  enabled: import("./helpers").HelperId[];
  custom?: import("./helpers").CustomHelper[];
  preferences?: Partial<Record<"daily-brief" | "calendar-triage", string>>;
};

export type MailDraft = {
  id: string;
  subject: string;
  to: string;
  cc: string;
  bcc: string;
  body: string;
  updatedAt?: string;
  scheduledAt?: string;
};

export type MailDraftUpdate = {
  id: string;
  subject?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  body?: string;
};

export type MailAttachment = {
  id: string;
  messageId: string;
  filename: string;
  contentType: string;
  byteSize?: number;
};

export type ThreadEntry = {
  id: string;
  sender: MailContact;
  occurredAt: string;
  body: string;
  html?: string;
  remoteHtml?: string;
  hasRemoteContent?: boolean;
  htmlPresentation?: "card" | "document";
  attachments?: MailAttachment[];
};

export type MailThread = {
  topicId: string;
  subject: string;
  entries: ThreadEntry[];
  attachmentsError?: string;
};

export type ThemeSnapshot = {
  name: string;
  mode: "light" | "dark";
  fontFamily?: string;
  colors: Record<string, string>;
};

export type AgentModel = {
  id: string;
  name: string;
  provider: string;
};

export const AGENT_THINKING_LEVELS = ["inherit", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type AgentThinkingLevel = typeof AGENT_THINKING_LEVELS[number];

export type AgentModelSelection = {
  provider: string;
  modelId: string;
};

export type AgentModelProfile = {
  model?: AgentModelSelection;
  thinking: AgentThinkingLevel;
};

export type AiSettings = {
  general: AgentModelProfile;
  quickUsesGeneral: boolean;
  quick: AgentModelProfile;
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  general: { thinking: "inherit" },
  quickUsesGeneral: true,
  quick: { thinking: "inherit" },
};

export type AgentModelCatalogItem = AgentModel & {
  contextWindow?: number;
  maxTokens?: number;
  reasoning: boolean;
  images: boolean;
  inputCost?: number;
  outputCost?: number;
};

export type ComposerWritingOperation = "draft" | "rewrite" | "shorten" | "friendlier" | "improve" | "continue" | "custom";

export type ComposerWritingRequest = {
  id: string;
  operation: ComposerWritingOperation;
  mode: MailComposerMode;
  draft: string;
  selectedText?: string;
  instruction?: string;
  subject?: string;
  recipients?: string;
  threadContext?: string;
};

export type ComposerWritingResult = {
  id: string;
  text: string;
  model?: AgentModel;
};

export type AgentMessage = {
  kind: "message";
  id: string;
  role: "user" | "assistant" | "notice";
  text: string;
  state?: "streaming" | "complete" | "error";
};

export const AGENT_OBJECT_KINDS = ["calendar-date", "calendar-event", "calendar-todo", "calendar-habit", "calendar-journal", "calendar-time-track", "draft", "mail-thread", "mail-bundle", "set-aside-group", "contact", "collection", "label", "mailbox"] as const;
export type AgentObjectKind = typeof AGENT_OBJECT_KINDS[number];
export function isAgentObjectKind(value: unknown): value is AgentObjectKind {
  return typeof value === "string" && (AGENT_OBJECT_KINDS as readonly string[]).includes(value);
}

export type AgentObjectLink = {
  kind: AgentObjectKind;
  id: string;
  title: string;
  subtitle?: string;
  deepLink: string;
};

export type AgentToolArtifact = {
  version: 1;
  status: "complete" | "declined";
  impact: "read" | "reversible" | "external" | "destructive" | "broad";
  operation?: string;
  summary: string;
  objects: AgentObjectLink[];
  refresh: Array<"mail" | "calendar">;
};

export type AgentAppAction = {
  version: 1;
  action: "navigate" | "set-agent-rail" | "set-navigation-rail" | "attach-current-email";
  target: string;
  summary: string;
};

export type AgentApprovalField = {
  label: string;
  value: string;
};

export type AgentApprovalEditableField = AgentApprovalField & {
  commandPrefix: string;
  commandSuffix: string;
  required: boolean;
};

export type AgentActionApproval = {
  version: 1;
  impact: "external" | "destructive" | "broad";
  title: string;
  summary: string;
  fields: AgentApprovalField[];
  command?: string;
  editable?: AgentApprovalEditableField;
};

export type AgentToolActivity = {
  id: string;
  technicalName: string;
  label: string;
  target?: string;
  state: "running" | "complete" | "error";
  detail?: string[];
  error?: string;
  startedAt: string;
  durationMs?: number;
  artifact?: AgentToolArtifact;
  appAction?: AgentAppAction;
};

export type AgentRun = {
  kind: "run";
  id: string;
  state: "running" | "complete" | "error";
  startedAt: string;
  durationMs?: number;
  tools: AgentToolActivity[];
};

export type AgentTimelineItem = AgentMessage | AgentRun;

export type AgentThreadAttachment = {
  kind: "hey-thread";
  id: string;
  title: string;
  subtitle?: string;
  sourceBox?: MailboxKey;
};

export type AgentObjectAttachment = {
  kind: "hey-object";
  objectKind: AgentObjectKind;
  id: string;
  title: string;
  subtitle?: string;
  deepLink: string;
};

export type AgentLocalFileAttachment = {
  kind: "local-file";
  id: string;
  title: string;
  path: string;
  size: number;
  modifiedAt: string;
};

export type AgentLocalSelectionAttachment = {
  kind: "local-selection";
  id: string;
  title: string;
  subtitle?: string;
  text: string;
};

export type AgentNativeAttachment = AgentThreadAttachment | AgentObjectAttachment;
export type AgentAttachment = AgentNativeAttachment | AgentLocalFileAttachment | AgentLocalSelectionAttachment;

export type AgentUiRequest = {
  id: string;
  method: "select" | "confirm" | "input" | "editor";
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  heyAction?: AgentActionApproval;
};

export type AgentSnapshot = {
  tabId: string;
  title: string;
  status: "idle" | "starting" | "ready" | "running" | "error" | "stopped";
  workingDirectory: string;
  model?: AgentModel;
  sessionId?: string;
  sessionFile?: string;
  sessionName?: string;
  timeline: AgentTimelineItem[];
  attachments: AgentAttachment[];
  helperId?: import("./helpers").HelperId;
  helperInstructions?: import("./helpers").HelperSessionInstructions;
  pendingUiRequest?: AgentUiRequest;
  error?: string;
};

export type AgentTab = {
  id: string;
  title: string;
  status: AgentSnapshot["status"];
  sessionId?: string;
  attachments: AgentAttachment[];
  helperId?: import("./helpers").HelperId;
};

export type AgentWorkspace = {
  activeTabId: string;
  tabs: AgentTab[];
  activeSession: AgentSnapshot;
  chats: AgentChatLink[];
  archivedChats: AgentChatLink[];
};

export type AgentMailContext = {
  topicId: string;
  subject: string;
  contacts: MailContact[];
  entries: ThreadEntry[];
};

export type AgentUiResponse = {
  id: string;
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
};

export type AgentChatLink = {
  id: string;
  sessionId?: string;
  sessionFile?: string;
  title: string;
  topicIds: string[];
  attachments: AgentAttachment[];
  helperId?: import("./helpers").HelperId;
  helperInstructions?: import("./helpers").HelperSessionInstructions;
  workingDirectory: string;
  updatedAt: string;
  archivedAt?: string;
};

export type NewAgentSessionRequest = {
  name?: string;
  helperId?: import("./helpers").HelperId;
  attachment?: AgentNativeAttachment;
  attachments?: AgentNativeAttachment[];
};

export type MailAccountProfile = { key: string; accountId: string; name: string; email: string; server: string };
export type AccountProfilesState = { token: string; accounts: MailAccountProfile[]; active?: MailAccountProfile; error?: string; needsSelection?: boolean };

export type HeyAgentApi = {
  profiles: {
    current: AccountProfilesState;
    switchAccount(key: string): Promise<void>;
    acknowledgeWrites(): Promise<void>;
    retry(): Promise<void>;
  };
  system: {
    getStatus(): Promise<SystemStatus>;
    openHeyUrl(url: string): Promise<void>;
    openExternalUrl(url: string): Promise<void>;
  };
  mail: {
    listImbox(): Promise<ImboxResult>;
    listMailbox(box: MailboxKey): Promise<ImboxResult>;
    search(request: MailSearchRequest): Promise<MailSearchResult>;
    searchFilters(): Promise<MailSearchFilters>;
    getOrganization(target: MailOrganizationTarget): Promise<MailOrganization>;
    updateOrganization(request: MailOrganizationMutationRequest): Promise<{ message: string }>;
    listScreener(): Promise<ScreenerResult>;
    getOverview(): Promise<MailOverview>;
    decideScreener(request: ScreenerDecisionRequest): Promise<{ message: string }>;
    listLibrary(kind: MailLibraryKind): Promise<MailLibraryResult>;
    readLibrarySource(kind: Exclude<MailLibraryKind, "contacts">, id: string): Promise<MailLibrarySourceResult>;
    showContact(id: string): Promise<MailContactDetail>;
    readBundle(id: string): Promise<MailThreadListing>;
    listContactThreads(id: string): Promise<MailThreadListing>;
    updateSetAsideGroup(request: SetAsideGroupMutationRequest): Promise<{ message: string; groupId?: string }>;
    listDrafts(): Promise<MailDraft[]>;
    showDraft(id: string): Promise<MailDraft>;
    editDraft(request: MailDraftUpdate): Promise<{ message: string }>;
    sendDraft(id: string): Promise<{ message: string }>;
    deleteDraft(id: string): Promise<{ message: string }>;
    getReplyContext(postingId: string): Promise<MailReplyContext>;
    readThread(topicId: string): Promise<MailThread>;
    openAttachment(topicId: string, attachmentId: string): Promise<void>;
    previewCalendarInvite(topicId: string, attachmentId: string): Promise<MailCalendarInvite>;
    saveAttachment(topicId: string, attachmentId: string): Promise<{ cancelled: boolean }>;
    mutate(request: MailMutationRequest): Promise<MailMutationResult>;
    send(request: MailSendRequest): Promise<MailSendResult>;
    previewBulkReply(postingIds: string[]): Promise<BulkReplyPreview>;
    sendBulkReply(request: BulkReplySendRequest): Promise<BulkReplySendResult>;
    undoBulkReply(deliveryId: string): Promise<BulkReplyUndoResult>;
    unbundleContact(contactId: string): Promise<{ message: string }>;
    selectAttachments(): Promise<string[]>;
    subscribe(listener: (change: MailWatchChange) => void): () => void;
  };
  calendar: {
    list(request: CalendarWindowRequest): Promise<CalendarWindowResult>;
    search(request: CalendarSearchRequest): Promise<CalendarSearchResult>;
    create(request: CalendarEventCreateRequest): Promise<CalendarEventCreateResult>;
    update(request: CalendarEventUpdateRequest): Promise<CalendarEventMutationResult>;
    delete(id: string): Promise<CalendarEventMutationResult>;
    listTodos(request: CalendarWindowRequest): Promise<CalendarReadResult<CalendarTodo[]>>;
    createTodo(request: CalendarTodoCreateRequest): Promise<CalendarEventMutationResult & { id?: string }>;
    completeTodo(request: CalendarTodoCompletionRequest): Promise<CalendarEventMutationResult>;
    deleteTodo(id: string): Promise<CalendarEventMutationResult>;
    listHabits(date: string): Promise<CalendarReadResult<CalendarHabit[]>>;
    writeHabit(request: CalendarHabitWriteRequest): Promise<CalendarEventMutationResult & { id?: string }>;
    completeHabit(request: CalendarHabitCompletionRequest): Promise<CalendarEventMutationResult>;
    deleteHabit(id: string): Promise<CalendarEventMutationResult>;
    listJournal(request: CalendarWindowRequest): Promise<CalendarReadResult<CalendarJournalEntry[]>>;
    readJournal(date: string): Promise<CalendarReadResult<CalendarJournalEntry | null>>;
    writeJournal(request: CalendarJournalWriteRequest): Promise<CalendarEventMutationResult>;
    listTimeTracks(limit?: number | "all"): Promise<CalendarReadResult<CalendarTimeTrack[]>>;
    currentTimeTrack(): Promise<CalendarReadResult<CalendarTimeTrack | null>>;
    listTimeCategories(): Promise<CalendarReadResult<CalendarTimeCategory[]>>;
    startTimeTrack(): Promise<CalendarEventMutationResult & { id?: string }>;
    stopTimeTrack(request: CalendarTimeStopRequest): Promise<CalendarEventMutationResult>;
    updateTimeTrack(request: CalendarTimeTrackUpdateRequest): Promise<CalendarEventMutationResult>;
    deleteTimeTrack(id: string): Promise<CalendarEventMutationResult>;
    createTimeCategory(title: string): Promise<CalendarEventMutationResult & { id?: string }>;
    renameTimeCategory(id: string, title: string): Promise<CalendarEventMutationResult>;
    deleteTimeCategory(id: string): Promise<CalendarEventMutationResult>;
    exportTimeTracks(): Promise<{ cancelled: boolean; path?: string }>;
  };
  settings: {
    get(): Promise<AppSettings>;
    update(update: AppSettingsUpdate): Promise<AppSettings>;
    reset(): Promise<AppSettings>;
  };
  writing: {
    listModels(refresh?: boolean): Promise<AgentModelCatalogItem[]>;
    generate(request: ComposerWritingRequest): Promise<ComposerWritingResult>;
    cancel(id: string): Promise<void>;
  };
  theme: {
    current(): Promise<ThemeSnapshot>;
    subscribe(listener: (theme: ThemeSnapshot) => void): () => void;
  };
  agent: {
    getWorkspace(): Promise<AgentWorkspace>;
    send(tabId: string, message: string): Promise<void>;
    abort(tabId: string): Promise<void>;
    newSession(request?: NewAgentSessionRequest): Promise<AgentWorkspace>;
    activateSession(tabId: string): Promise<AgentWorkspace>;
    closeSession(tabId: string): Promise<AgentWorkspace>;
    openChat(chatId: string): Promise<AgentWorkspace>;
    renameSession(sessionId: string, title: string): Promise<AgentWorkspace>;
    archiveSession(sessionId: string, archived: boolean): Promise<AgentWorkspace>;
    deleteSession(sessionId: string): Promise<AgentWorkspace>;
    attach(tabId: string, attachment: AgentNativeAttachment): Promise<AgentWorkspace>;
    attachMany(tabId: string, attachments: AgentNativeAttachment[]): Promise<AgentWorkspace>;
    attachFiles(tabId: string): Promise<AgentWorkspace>;
    attachSelection(tabId: string): Promise<AgentWorkspace>;
    detach(tabId: string, attachmentId: string): Promise<AgentWorkspace>;
    respondToUi(tabId: string, response: AgentUiResponse): Promise<void>;
    continueInTerminal(tabId: string): Promise<void>;
    prepareHandoff(tabId: string): Promise<import("./handoff").AgentHandoff>;
    copyHandoff(request: import("./handoff").HandoffAction): Promise<void>;
    launchHandoff(request: import("./handoff").HandoffAction): Promise<void>;
    listChats(): Promise<AgentChatLink[]>;
    subscribe(listener: (workspace: AgentWorkspace) => void): () => void;
  };
};
