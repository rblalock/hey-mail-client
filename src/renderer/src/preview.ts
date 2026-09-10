import { DEFAULT_SOUND_SETTINGS, type AgentWorkspace, type AppSettings, type CalendarEvent, type CalendarHabit, type CalendarJournalEntry, type CalendarSummary, type CalendarTimeCategory, type CalendarTimeTrack, type CalendarTodo, type HeyAgentApi, type ImboxPosting, type MailDraft, type ScreenerEntry, type ThemeSnapshot } from "../../shared/contracts";
import { DEFAULT_ENABLED_HELPERS, HELPER_CATALOG_VERSION, helperById, isCustomHelperId, type HelperId } from "../../shared/helpers";
import { addDays, eventOccursOn } from "./calendar";
import { validateCustomShortcuts } from "../../shared/shortcuts";

const now = Date.now();
const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
const previewParams = new URLSearchParams(window.location.search);
const previewLongEmail = previewParams.has("long-email");
const previewMailLinks = previewParams.has("mail-links");
const previewAgentContext = previewParams.has("agent-context");
const previewAgentActivity = previewParams.has("agent-activity");
const previewAgentComplete = previewParams.has("agent-complete");
const previewAgentMissing = previewParams.has("agent-missing");
const previewBundle = previewParams.has("bundle");
const previewSetAsideGroups = previewParams.has("set-aside-groups");
const previewRecurrence = previewParams.has("recurrence");
const previewCalendarCollisions = previewParams.has("calendar-collisions");
const previewThemeName = previewParams.get("theme");
const previewAvatar = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="40" fill="#c76e55"/><circle cx="40" cy="30" r="15" fill="#f4d8c8"/><path d="M14 77c3-19 13-28 26-28s23 9 26 28" fill="#342928"/></svg>')}`;

const previewThemes: Record<string, ThemeSnapshot> = {
  dusk: {
    name: "omalaunch-dusk",
    mode: "dark",
    fontFamily: "Berkeley Mono",
    colors: { accent: "#8fb1d7", selection: "#262e36", muted: "#5f6469", foreground: "#d5ceb1", background: "#0e1720", dark_background: "#0b1118", darker_background: "#070c10", lighter_background: "#262e36" },
  },
  dawn: {
    name: "omalaunch-dawn",
    mode: "light",
    fontFamily: "Berkeley Mono",
    colors: { accent: "#287fc1", selection: "#cfe9fa", foreground: "#17364a", background: "#fbfdff", dark_background: "#f1f6fa", lighter_background: "#ffffff" },
  },
};

const postings: ImboxPosting[] = [
  {
    id: "2001",
    topicId: "1001",
    subject: "Updated launch timeline and final decisions",
    summary: "I folded in yesterday’s feedback. The only open question is whether we keep the early access window…",
    seen: false,
    createdAt: minutesAgo(18),
    contacts: [{ id: "preview-maya", name: "Maya Chen", email: "maya@example.com", avatarUrl: previewAvatar, avatarBackgroundColor: "#c76e55", initials: "MC" }],
    sender: { id: "preview-maya", name: "Maya Chen", email: "maya@example.com", avatarUrl: previewAvatar, avatarBackgroundColor: "#c76e55", initials: "MC" },
    visibleEntryCount: 4,
  },
  {
    id: "2002",
    topicId: "1002",
    subject: "Invoice 1048 — design retainer",
    summary: "Attaching the August invoice and a summary of the work completed this cycle.",
    seen: false,
    createdAt: minutesAgo(64),
    contacts: [{ name: "Northline Studio", email: "hello@northline.example" }],
    sender: { name: "Northline Studio", email: "hello@northline.example" },
    visibleEntryCount: 2,
  },
  {
    id: "2003",
    topicId: "1003",
    subject: "Dinner next Thursday?",
    summary: "We’ll be in your neighborhood after six. Want to finally try that place on 9th?",
    seen: true,
    createdAt: minutesAgo(190),
    contacts: [{ name: "Drew & Sam", email: "drew@example.com" }],
    sender: { name: "Drew & Sam", email: "drew@example.com" },
    visibleEntryCount: 6,
  },
  {
    id: "2004",
    topicId: "1004",
    subject: "The customer interview notes are ready",
    summary: "There are three patterns worth discussing before we commit to the onboarding changes.",
    seen: true,
    createdAt: minutesAgo(1_440),
    contacts: [{ name: "Priya Rao", email: "priya@example.com" }],
    sender: { name: "Priya Rao", email: "priya@example.com" },
    visibleEntryCount: 3,
  },
  {
    id: "2005",
    topicId: "1005",
    subject: "Your reservation is confirmed",
    summary: "Reservation details for Friday, September 4 at 7:30 PM.",
    seen: true,
    createdAt: minutesAgo(2_880),
    contacts: [{ name: "Clover House", email: "reservations@clover.example" }],
    sender: { name: "Clover House", email: "reservations@clover.example" },
    visibleEntryCount: 1,
  },
];

const bundlePosting: ImboxPosting = {
  id: "2901",
  kind: "bundle",
  subject: "3 new emails from Maya Chen",
  summary: "Launch notes, scheduling details, and one quick follow-up.",
  seen: false,
  createdAt: minutesAgo(8),
  contacts: [postings[0]!.sender],
  sender: postings[0]!.sender,
  visibleEntryCount: 3,
};

const setAsidePostings = postings.map((posting, index) => ({
  ...posting,
  kind: "thread",
  boxGroupId: index < 2 ? "501" : index < 4 ? "502" : undefined,
}));

const screenerEntries: ScreenerEntry[] = [
  { id: "91", topicId: "1006", sender: { name: "Avery Brooks", email: "avery@example.com", initials: "AB", avatarBackgroundColor: "#8a5a44" }, subject: "A quick introduction", summary: "I wanted to reach out about the project…" },
  { id: "92", topicId: "1007", sender: { name: "Field Notes", email: "hello@fieldnotes.example", initials: "FN", avatarBackgroundColor: "#355e58" }, subject: "Your first field note", summary: "A short update from our team…" },
];

const previewCalendars: CalendarSummary[] = [
  { id: "301", name: "Personal", kind: "primary", color: "#ff765e", owned: true, personal: true, writable: false },
  { id: "302", name: "Work", kind: "calendar", color: "#5b8cff", owned: true, personal: false, external: false, writable: true },
  { id: "303", name: "Maybe", kind: "maybe", color: "#66b88a", owned: true, personal: false, external: false, writable: true },
];

const previewEvents: CalendarEvent[] = [
  { id: "401", title: "Launch day", startsAt: "2026-09-01", endsAt: "2026-09-02", allDay: true, recurring: false, calendar: previewCalendars[1]!, description: "The public launch window opens today. Keep the afternoon clear for customer replies.", reminders: [{ id: "1", label: "1 day before" }], attendees: [] },
  { id: "402", title: "Design review", startsAt: "2026-09-01T14:00:00-04:00", endsAt: "2026-09-01T15:00:00-04:00", allDay: false, recurring: false, timeZone: "America/New_York", calendar: previewCalendars[1]!, location: "Studio · North room", description: "Review the final interaction pass and settle the two remaining launch decisions.", linkUrl: "https://calendar.hey.com", reminders: [{ id: "2", label: "15 minutes before" }], organizer: { name: "Maya Chen", email: "maya@example.com" }, attendees: [{ name: "You", status: "accepted" }, { name: "Drew", status: "accepted" }], attendanceSummary: "2 attending", joinLink: { title: "Video call", url: "https://meet.example.com/design-review" } },
  { id: "403", title: "Dinner with Drew and Sam", startsAt: "2026-09-03T19:30:00-04:00", endsAt: "2026-09-03T21:00:00-04:00", allDay: false, recurring: false, calendar: previewCalendars[0]!, location: "Clover House", reminders: [{ id: "3", label: "1 hour before" }], attendees: [] },
  { id: "404", title: "Weekly planning · decisions, loose ends, and what comes next", startsAt: "2026-09-04T09:00:00-04:00", endsAt: "2026-09-04T09:45:00-04:00", allDay: false, recurring: true, calendar: previewCalendars[1]!, reminders: [], attendees: [] },
  { id: "405", title: "Walk the river trail", startsAt: "2026-09-05T10:00:00-04:00", endsAt: "2026-09-05T12:00:00-04:00", allDay: false, recurring: false, calendar: previewCalendars[2]!, location: "If the weather holds", reminders: [], attendees: [] },
];

export function previewApi(): HeyAgentApi {
  const accounts = [
    { key: "a".repeat(32), accountId: "101", name: "Alex Morgan", email: "alex@example.com", server: "https://app.hey.com" },
    { key: "b".repeat(32), accountId: "202", name: "Alex at Studio", email: "alex@studio.example", server: "https://app.hey.com" },
  ];
  if (new URLSearchParams(location.search).has("long-profile")) {
    accounts[0]!.name = "Alexandra Morgan-Worthington and the Studio Team";
    accounts[0]!.email = "alexandra.morgan-worthington@international-design-studio.example";
    accounts.splice(1);
  }
  const account = accounts.find((item) => item.key === localStorage.getItem("preview-profile")) ?? accounts[0]!;
  let settings: AppSettings = { version: 1, showSenderAvatars: false, interfaceFont: "instrument", shortcutProfile: "hey", customShortcuts: {}, sound: { ...DEFAULT_SOUND_SETTINGS }, ai: { general: { thinking: "inherit" }, quickUsesGeneral: true, quick: { thinking: "inherit" } }, helpers: { catalogVersion: HELPER_CATALOG_VERSION, enabled: [...DEFAULT_ENABLED_HELPERS] } };
  let mailDrafts: MailDraft[] = [{ id: "draft-1", subject: "Launch follow-up", to: "maya@example.com", cc: "", bcc: "", body: "Hi Maya,\n\nThe revised sequence looks good. I have one final question about Friday.", updatedAt: "2026-09-03T18:10:00-04:00" }];
  let calendarEvents = structuredClone(previewEvents);
  let calendarTodos: CalendarTodo[] = [
    { id: "601", title: "Return the library books", startsOn: "2026-09-01" },
    { id: "602", title: "Send Maya the launch photos", startsOn: "2026-09-02", completedAt: "2026-09-02T15:00:00-04:00" },
  ];
  let calendarHabits: CalendarHabit[] = [
    { id: "701", name: "Read for thirty minutes", icon: "read", color: "gold", days: [1, 2, 3, 4, 5], completedDates: ["2026-09-01"] },
    { id: "702", name: "Evening walk", icon: "walk", color: "green", days: [0, 2, 4, 6], completedDates: [] },
  ];
  let calendarJournal: CalendarJournalEntry[] = [{ id: "801", date: "2026-09-02", content: "The launch review felt focused today. We made the hard decisions early and left the afternoon open." }];
  let currentTimeTrack: CalendarTimeTrack | null = null;
  let calendarTimeTracks: CalendarTimeTrack[] = [
    { id: "901", startsAt: "2026-09-02T09:15:00-04:00", endsAt: "2026-09-02T10:05:00-04:00", category: "Client work", notes: "Reviewed the launch proposal" },
    { id: "902", startsAt: "2026-09-01T14:00:00-04:00", endsAt: "2026-09-01T15:25:00-04:00", category: "Planning" },
  ];
  let calendarTimeCategories: CalendarTimeCategory[] = [{ id: "1001", title: "Client work" }, { id: "1002", title: "Planning" }];
  if (previewRecurrence) {
    calendarEvents = [
      ...calendarEvents.filter((event) => event.id !== "404"),
      { ...previewEvents[3]!, occurrenceId: "404_2026-09-02", startsAt: "2026-09-02T09:00:00-04:00", endsAt: "2026-09-02T09:45:00-04:00" },
      { ...previewEvents[3]!, occurrenceId: "404_2026-09-04", startsAt: "2026-09-04T09:00:00-04:00", endsAt: "2026-09-04T09:45:00-04:00" },
    ];
  }
  if (previewCalendarCollisions) {
    calendarEvents = [
      { id: "451", title: "Company launch window", startsAt: "2026-09-01", endsAt: "2026-09-04", allDay: true, recurring: false, calendar: previewCalendars[1]!, reminders: [], attendees: [] },
      { id: "452", title: "Test4", startsAt: "2026-09-02", endsAt: "2026-09-02", allDay: true, recurring: false, calendar: previewCalendars[2]!, reminders: [], attendees: [] },
      { id: "453", title: "Test2", startsAt: "2026-09-02T09:00:00-04:00", endsAt: "2026-09-02T10:00:00-04:00", allDay: false, recurring: false, calendar: previewCalendars[2]!, reminders: [], attendees: [] },
      { id: "454", title: "Test5", startsAt: "2026-09-02T09:00:00-04:00", endsAt: "2026-09-02T10:00:00-04:00", allDay: false, recurring: false, calendar: previewCalendars[2]!, reminders: [], attendees: [] },
      { id: "455", title: "TEST EVENT", startsAt: "2026-09-02T10:00:00-04:00", endsAt: "2026-09-02T11:00:00-04:00", allDay: false, recurring: false, calendar: previewCalendars[2]!, reminders: [], attendees: [] },
      { id: "456", title: "TEST EVENT", startsAt: "2026-09-02T10:00:00-04:00", endsAt: "2026-09-02T11:00:00-04:00", allDay: false, recurring: false, calendar: previewCalendars[1]!, reminders: [], attendees: [] },
      { id: "457", title: "Test3", startsAt: "2026-09-02T11:00:00-04:00", endsAt: "2026-09-02T12:00:00-04:00", allDay: false, recurring: false, calendar: previewCalendars[2]!, reminders: [], attendees: [] },
    ];
  }
  const imboxPostings = previewParams.has("imbox-sections") ? [
    { ...postings[0]!, id: "2006", topicId: "1006", subject: "Contract questions to revisit", summary: "A reminder to review the remaining questions.", bubbledUp: true },
    { ...postings[2]!, id: "2007", topicId: "1007", subject: "Confirm the studio booking", summary: "Check the dates before confirming the booking.", bubbledUp: true },
    ...postings,
  ] : previewBundle ? [bundlePosting, ...postings] : postings;
  const previewOrganization = {
    labels: [
      { id: "701", name: "Launch", summary: "Launch planning and decisions", members: new Set(["2001"]) },
      { id: "702", name: "Receipts", summary: "Invoices and purchase records", members: new Set<string>() },
    ],
    collections: [
      { id: "801", name: "Fall launch", summary: "Threads for the upcoming release", members: new Set(["1001"]) },
      { id: "802", name: "Studio operations", summary: "Ongoing vendor coordination", members: new Set<string>() },
    ],
  };
  const organizationItems = (kind: "labels" | "collections", targetIds: string[]) => previewOrganization[kind].map((item) => {
    const memberCount = targetIds.filter((id) => item.members.has(id)).length;
    return { id: item.id, name: item.name, summary: item.summary, memberCount, membership: memberCount === 0 ? "none" as const : memberCount === targetIds.length ? "all" as const : "some" as const };
  });
  const agentAttachments = previewAgentContext
    ? [{ kind: "hey-thread" as const, id: "1001", title: "Updated launch timeline and final decisions", subtitle: "Maya Chen", sourceBox: "imbox" as const }]
    : [];
  const agentTimeline: AgentWorkspace["activeSession"]["timeline"] = previewAgentActivity ? [{
    kind: "run",
    id: "preview-run",
    state: previewAgentComplete ? "complete" : "running",
    startedAt: new Date(now - 4_200).toISOString(),
    ...(previewAgentComplete ? { durationMs: 4_100 } : {}),
    tools: [
      { id: "preview-tool-1", technicalName: "hey", label: "HEY · event list", target: "Find the calendar event from the selected conversation", state: "complete", detail: ['{"data":{"events":[]}}'], startedAt: new Date(now - 4_100).toISOString(), durationMs: 660, artifact: { version: 1, status: "complete", impact: "read", operation: "event list", summary: "0 events (2026-09-02 to 2026-09-02)", objects: [], refresh: [] } },
      { id: "preview-tool-2", technicalName: "hey", label: "HEY · event edit", target: "Check which calendar invitation needs correction", state: "complete", detail: ['{"data":{"id":"402","title":"Design review"}}'], startedAt: new Date(now - 3_300).toISOString(), durationMs: 10, artifact: { version: 1, status: "complete", impact: "external", operation: "event edit", summary: "Event time updated after review.", objects: [{ kind: "calendar-event", id: previewAgentMissing ? "999" : "402", title: previewAgentMissing ? "Removed planning review" : "Design review", subtitle: "September 1 · 2:00 PM", deepLink: `hey-agent://calendar/events/${previewAgentMissing ? "999" : "402"}?date=2026-09-01` }], refresh: ["calendar"] } },
      { id: "preview-tool-3", technicalName: "hey", label: "HEY · account list", target: "Check the linked HEY accounts for the invitation", state: "complete", detail: ['{"data":{"accounts":["Personal HEY","Work HEY"]}}'], startedAt: new Date(now - 3_100).toISOString(), durationMs: 212, artifact: { version: 1, status: "complete", impact: "read", operation: "account list", summary: "2 mail account filters", objects: [], refresh: [] } },
      { id: "preview-tool-4", technicalName: "mcp", label: "MCP", state: "complete", startedAt: new Date(now - 2_700).toISOString(), durationMs: 2 },
      { id: "preview-tool-5", technicalName: "hey", label: "HEY · calendar list", target: "Confirm which HEY calendars can receive this event", state: "complete", detail: ['{"data":{"calendars":["Personal","Work","Maybe","Shared","Birthdays"]}}'], startedAt: new Date(now - 2_500).toISOString(), durationMs: 254, artifact: { version: 1, status: "complete", impact: "read", operation: "calendar list", summary: "5 calendars", objects: [], refresh: [] } },
      ...(previewBundle ? [{ id: "preview-tool-bundle", technicalName: "hey", label: "HEY · bundle view", target: "Read the bundled conversations", state: "complete" as const, startedAt: new Date(now - 2_000).toISOString(), durationMs: 178, artifact: { version: 1 as const, status: "complete" as const, impact: "read" as const, operation: "bundle view", summary: "3 unseen conversations", objects: [{ kind: "mail-bundle" as const, id: "2901", title: "Maya Chen bundle", subtitle: "3 unseen conversations", deepLink: "hey-agent://mail/bundles/2901" }], refresh: ["mail" as const] } }] : []),
      ...(previewSetAsideGroups ? [{ id: "preview-tool-group", technicalName: "hey", label: "HEY · set-aside group view", target: "Open the Set Aside group", state: "complete" as const, startedAt: new Date(now - 1_700).toISOString(), durationMs: 124, artifact: { version: 1 as const, status: "complete" as const, impact: "read" as const, operation: "set-aside group view", summary: "2 conversations", objects: [{ kind: "set-aside-group" as const, id: "501", title: "Set Aside group", subtitle: "2 conversations", deepLink: "hey-agent://mail/set-aside/groups/501" }], refresh: ["mail" as const] } }] : []),
      ...(previewRecurrence ? [{ id: "preview-tool-period", technicalName: "hey", label: "HEY · event week", target: "Read recurring occurrences", state: "complete" as const, startedAt: new Date(now - 1_300).toISOString(), durationMs: 91, artifact: { version: 1 as const, status: "complete" as const, impact: "read" as const, operation: "event week", summary: "2 recurring occurrences", objects: [
        { kind: "calendar-event" as const, id: "404", title: "Weekly planning", subtitle: "September 2 · 9:00 AM", deepLink: "hey-agent://calendar/events/404?date=2026-09-02" },
        { kind: "calendar-event" as const, id: "404", title: "Weekly planning", subtitle: "September 4 · 9:00 AM", deepLink: "hey-agent://calendar/events/404?date=2026-09-04" },
      ], refresh: ["calendar" as const] } }] : []),
      { id: "preview-tool-6", technicalName: "hey", label: "HEY · event list", target: "Look for the invitation in the surrounding date range", state: previewAgentComplete ? "complete" : "running", startedAt: new Date(now - 900).toISOString(), ...(previewAgentComplete ? { durationMs: 183 } : {}) },
    ],
  }, ...(previewAgentComplete ? [{ kind: "message" as const, id: "preview-link-message", role: "assistant" as const, state: "complete" as const, text: "Maya’s [launch conversation](https://app.hey.com/topics/1001) has the latest decision. The related threads are under the [Launch label](hey-agent://mail/labels/701). She is free on [Thursday, September 3](hey-agent://calendar/dates/2026-09-03), and [Maya’s contact](hey-agent://contacts/preview-maya) is saved at [maya@example.com](mailto:maya@example.com). [unknown@example.com](mailto:unknown@example.com) is not in HEY Contacts." }] : [])] : [];
  const workspace: AgentWorkspace = {
    activeTabId: "preview-tab",
    tabs: [{ id: "preview-tab", title: "Launch follow-up", status: "ready", sessionId: "preview-session", attachments: agentAttachments }],
    activeSession: {
      tabId: "preview-tab",
      title: "Launch follow-up",
      status: "ready",
      workingDirectory: "/home/you/.local/share/hey-agent-app/workspace",
      model: { id: "default-model", name: "Your default model", provider: "Pi" },
      sessionId: "preview-session",
      sessionFile: "/home/you/.pi/agent/sessions/preview.jsonl",
      timeline: agentTimeline,
      attachments: agentAttachments,
    },
    chats: [
      { id: "preview-tab", sessionId: "preview-session", title: "Launch follow-up", topicIds: agentAttachments.map((attachment) => attachment.id), attachments: agentAttachments, workingDirectory: "/home/you/.local/share/hey-agent-app/workspace", updatedAt: "2026-08-29T12:00:00.000Z" },
      { id: "preview-history", title: "Planning notes", topicIds: [], attachments: [], workingDirectory: "/home/you/.local/share/hey-agent-app/workspace", updatedAt: "2026-08-28T12:00:00.000Z" },
    ],
    archivedChats: [
      { id: "preview-archived", title: "Finished research", topicIds: [], attachments: [], workingDirectory: "/home/you/.local/share/hey-agent-app/workspace", updatedAt: "2026-08-27T12:00:00.000Z", archivedAt: "2026-08-28T12:00:00.000Z" },
    ],
  };
  if (new URLSearchParams(window.location.search).has("session-history")) {
    workspace.chats.push(...Array.from({ length: 25 }, (_, index) => ({
      id: `history-${index}`, title: `Project review ${index + 1}`, topicIds: [], attachments: [],
      workingDirectory: "/synthetic", updatedAt: new Date(Date.UTC(2026, 7, 27 - index)).toISOString(),
    })));
  }
  const agentListeners = new Set<(workspace: AgentWorkspace) => void>();
  const emitAgentWorkspace = () => {
    const next = structuredClone(workspace);
    for (const listener of agentListeners) listener(next);
  };
  return {
    profiles: {
      current: { token: account.key, accounts, active: account },
      switchAccount: async (key) => { localStorage.setItem("preview-profile", key); window.location.reload(); },
      acknowledgeWrites: async () => {},
      retry: async () => { window.location.reload(); },
    },
    system: {
      getStatus: async () => ({
        paths: {
          config: "/home/you/.config/hey-agent-app",
          data: "/home/you/.local/share/hey-agent-app",
          state: "/home/you/.local/state/hey-agent-app",
          workspace: "/home/you/.local/share/hey-agent-app/workspace",
        },
        runtimes: [
          { id: "hey", label: "HEY CLI", executable: "/home/you/.local/bin/hey", version: "hey version 1.4.0", status: "ready" },
          { id: "pi", label: "Pi", executable: "/home/you/.local/bin/pi", version: "0.84.3", status: "ready" },
        ],
      }),
      openHeyUrl: async () => undefined,
      openExternalUrl: async () => undefined,
    },
    mail: {
      listImbox: async () => ({ status: "ready", boxKey: "imbox", boxName: "Imbox", postings: imboxPostings }),
      listMailbox: async (box) => ({ status: "ready", boxKey: box, boxName: box === "imbox" ? "Imbox" : box === "asidebox" ? "Set Aside" : "Mailbox", postings: box === "asidebox" && previewSetAsideGroups ? setAsidePostings : imboxPostings }),
      search: async (request) => ({ query: request.query ?? "", page: request.page ?? 1, hasMore: false, postings: postings.filter((posting) => `${posting.subject} ${posting.summary}`.toLowerCase().includes((request.query ?? "").toLowerCase())) }),
      searchFilters: async () => ({ boxes: [{ value: "imbox", title: "Imbox" }], dates: [{ value: "last_30_days", title: "Within the last 30 days" }], labels: [], attachments: [{ value: "pdfs", title: "PDFs" }] }),
      getOrganization: async (target) => ({
        labels: organizationItems("labels", target.postingIds ?? []),
        collections: organizationItems("collections", target.topicIds ?? []),
      }),
      updateOrganization: async (request) => {
        const members = request.kind === "labels" ? request.postingIds ?? [] : request.topicIds ?? [];
        const items = previewOrganization[request.kind];
        if (request.action === "create") {
          const nextId = String((request.kind === "labels" ? 700 : 800) + items.length + 1);
          items.push({ id: nextId, name: request.name ?? "Untitled", summary: "Created in preview", members: new Set(members) });
        } else {
          const item = items.find((candidate) => candidate.id === request.targetId);
          if (item) for (const member of members) request.action === "add" ? item.members.add(member) : item.members.delete(member);
        }
        return { message: `${members.length} ${members.length === 1 ? "conversation" : "conversations"} updated.` };
      },
      listScreener: async () => ({ status: "ready", entries: screenerEntries }),
      getOverview: async () => ({ screener: { status: "ready", entries: screenerEntries }, replyLater: { count: 3, latest: postings[0] } }),
      decideScreener: async () => ({ message: "Screener updated." }),
      listLibrary: async (kind) => ({ kind, items: kind === "contacts" ? postings.map((posting, index) => ({ id: String(index), title: posting.sender.name, subtitle: posting.sender.email, contact: posting.sender })) : [] }),
      readLibrarySource: async (kind, id) => ({ kind, id, title: kind === "labels" ? "Launch" : "Fall launch", totalCount: 3, postings: postings.slice(0, 3) }),
      showContact: async (id) => {
        const source = postings.flatMap((posting) => posting.contacts).find((contact) => contact.id === id) ?? postings[Number(id)]?.contacts[0];
        return { ...source, id, name: source?.name ?? "Contact", email: source?.email ?? "contact@example.com", aliases: [], note: "", status: "approved" };
      },
      readBundle: async (id) => ({ kind: "bundle", id, title: `Unseen from ${postings[0]?.sender.name ?? "Contact"}`, contact: postings[0]?.sender ?? { name: "Contact" }, postings: postings.slice(0, 3).map((posting) => ({ ...posting, kind: "thread" })) }),
      listContactThreads: async (id) => ({ kind: "contact", id, title: `All conversations with ${postings[0]?.sender.name ?? "Contact"}`, contact: postings[0]?.sender ?? { name: "Contact" }, postings: postings.slice(0, 5).map((posting) => ({ ...posting, kind: "thread" })) }),
      updateSetAsideGroup: async (request) => ({ message: request.action === "delete" ? "Set Aside group dissolved." : "Set Aside group updated.", ...(request.groupId ? { groupId: request.groupId } : {}) }),
      listDrafts: async () => structuredClone(mailDrafts),
      showDraft: async (id) => structuredClone(mailDrafts.find((draft) => draft.id === id) ?? { id, subject: "Draft", to: "maya@example.com", cc: "", bcc: "", body: "Draft message" }),
      editDraft: async (request) => { mailDrafts = mailDrafts.map((draft) => draft.id === request.id ? { ...draft, ...request, updatedAt: new Date().toISOString() } : draft); return { message: "Draft saved." }; },
      sendDraft: async (id) => { mailDrafts = mailDrafts.filter((draft) => draft.id !== id); return { message: "Draft sent." }; },
      deleteDraft: async (id) => { mailDrafts = mailDrafts.filter((draft) => draft.id !== id); return { message: "Draft deleted." }; },
      getReplyContext: async () => ({
        to: [{ id: "maya@example.com", name: "Maya Chen", email: "maya@example.com" }],
        cc: [],
        bcc: [],
      }),
      readThread: async (topicId) => ({
        topicId,
        subject: postings.find((posting) => posting.topicId === topicId)?.subject ?? "Conversation",
        entries: [
          {
            id: `${topicId}-entry-1`,
            sender: postings.find((posting) => posting.topicId === topicId)?.sender ?? { name: "Sender" },
            occurredAt: minutesAgo(310),
            body: "Here is the first pass. I kept it intentionally narrow so we can agree on the direction before filling in the details.",
          },
          {
            id: `${topicId}-entry-2`,
            sender: { name: "You" },
            occurredAt: minutesAgo(245),
            body: "The direction feels right. Please tighten the sequence and make the decision points easier to scan.",
          },
          {
            id: `${topicId}-entry-3`,
            sender: postings.find((posting) => posting.topicId === topicId)?.sender ?? { name: "Sender" },
            occurredAt: minutesAgo(96),
            body: "Done. I also moved the supporting notes below the core timeline so they do not interrupt the main story.",
          },
          {
            id: `${topicId}-entry-4`,
            sender: postings.find((posting) => posting.topicId === topicId)?.sender ?? { name: "Sender" },
            occurredAt: minutesAgo(18),
            body: Array.from({ length: 16 }, (_, index) => `Update ${index + 1}: The plan now has a clear owner, a concrete checkpoint, and one explicit decision to make.`).join("\n\n"),
            ...(previewMailLinks && topicId === "1001" ? {
              html: '<p>The details are in <a href="https://app.hey.com/topics/1002">the invoice conversation</a>. You can also follow up with <a href="mailto:maya@example.com">Maya Chen</a> or <a href="mailto:unknown@example.com">an outside guest</a>.</p>',
              htmlPresentation: "card" as const,
            } : {}),
            ...(previewLongEmail && topicId === "1001" ? {
              html: '<main style="height:17000px;padding:24px"><h1>Synthetic long email</h1><p>This preview fixture verifies that the conversation reader owns vertical scrolling.</p></main>',
              htmlPresentation: "document" as const,
            } : {}),
          },
        ],
      }),
      mutate: async (request) => ({ message: "Conversation updated.", undo: request.operation === "seen" ? { operation: "unseen", postingIds: request.postingIds } : undefined }),
      send: async (request) => ({ disposition: request.saveAsDraft ? "draft" : "sent", message: request.saveAsDraft ? "Draft saved in HEY." : "Message sent." }),
      previewBulkReply: async (postingIds) => ({
        postingIds,
        items: postingIds.map((postingId, index) => {
          const posting = postings.find((item) => item.id === postingId);
          return {
            entryId: `${postingId}-entry`,
            topicId: posting?.topicId ?? `${index + 1}`,
            subject: posting?.subject ?? "Conversation",
            to: [{ id: `${index + 1}`, name: `Example Recipient ${index + 1}`, email: `recipient${index + 1}@example.com` }],
            cc: [],
            bcc: [],
          };
        }),
      }),
      sendBulkReply: async (request) => ({ message: `${request.postingIds.length} separate replies are queued in HEY.`, replyCount: request.postingIds.length, deliveryId: "98765", delayed: true }),
      undoBulkReply: async () => ({ message: "Bulk reply recalled in HEY.", undone: true }),
      unbundleContact: async () => ({ message: "Mail from this contact will appear separately." }),
      selectAttachments: async () => [],
      openAttachment: async () => { throw new Error("Attachment opening is unavailable in the preview."); },
      previewCalendarInvite: async () => { throw new Error("Calendar attachment previews require HEY."); },
      saveAttachment: async () => ({ cancelled: true }),
      subscribe: () => () => undefined,
    },
    calendar: {
      list: async (request) => ({
        status: "ready",
        startsOn: request.startsOn,
        endsOn: request.endsOn,
        calendars: previewCalendars,
        events: calendarEvents.filter((event) => {
          if (request.calendarId && event.calendar.id !== request.calendarId) return false;
          for (let day = request.startsOn; day <= request.endsOn; day = addDays(day, 1)) {
            if (eventOccursOn(event, day)) return true;
          }
          return false;
        }),
      }),
      search: async (request) => {
        const query = request.query.trim().toLocaleLowerCase();
        const items = [
          ...calendarEvents.filter((event) => [event.title, event.description, event.location, event.calendar.name].some((value) => value?.toLocaleLowerCase().includes(query))).map((event) => ({ kind: "event" as const, id: event.id, title: event.title, date: event.startsAt.slice(0, 10), detail: event.calendar.name })),
          ...calendarTodos.filter((todo) => todo.title.toLocaleLowerCase().includes(query)).map((todo) => ({ kind: "todo" as const, id: todo.id, title: todo.title, date: todo.startsOn, detail: "Sometime This Week" })),
          ...calendarJournal.filter((entry) => entry.content.toLocaleLowerCase().includes(query)).map((entry) => ({ kind: "journal" as const, id: entry.id ?? entry.date, title: entry.content, date: entry.date, detail: "Journal" })),
          ...calendarTimeTracks.filter((track) => [track.notes, track.category].some((value) => value?.toLocaleLowerCase().includes(query))).map((track) => ({ kind: "time" as const, id: track.id, title: track.notes || track.category || "Tracked time", date: track.startsAt.slice(0, 10), detail: "Tracked time" })),
        ];
        return { status: "ready" as const, query: request.query.trim(), items, unavailableSources: [] };
      },
      create: async (request) => {
        const calendar = previewCalendars.find((item) => item.id === request.calendarId);
        if (!calendar?.writable) throw new Error("Choose a writable calendar.");
        const id = `preview-${Date.now()}`;
        calendarEvents = [...calendarEvents, {
          id,
          title: request.title,
          startsAt: request.allDay ? request.startsOn : `${request.startsOn}T${request.startTime}:00`,
          endsAt: request.allDay ? (request.endsOn ?? request.startsOn) : `${request.endsOn ?? request.startsOn}T${request.endTime ?? request.startTime}:00`,
          allDay: request.allDay,
          recurring: Boolean(request.repeat),
          timeZone: request.timeZone,
          calendar,
          description: request.notes,
          location: request.location,
          linkUrl: request.link,
          reminders: (request.reminders ?? []).map((label, index) => ({ id: `${index}`, label: `${label} before` })),
          attendees: (request.invites ?? []).map((email) => ({ name: email, email })),
          highlighted: request.circle,
        }];
        return { message: `“${request.title}” was added to HEY Calendar.`, eventId: id };
      },
      update: async (request) => {
        const original = calendarEvents.find((event) => event.id === request.id);
        if (!original?.calendar.writable) throw new Error("This event is read-only.");
        const scheduleChanged = request.startsOn !== undefined || request.endsOn !== undefined || request.allDay !== undefined || request.startTime !== undefined || request.endTime !== undefined || request.timeZone !== undefined;
        calendarEvents = calendarEvents.map((event) => {
          if (event.id !== request.id) return event;
          const allDay = request.allDay ?? event.allDay;
          const startsOn = request.startsOn ?? event.startsAt.slice(0, 10);
          const endsOn = request.endsOn ?? event.endsAt.slice(0, 10);
          const startTime = request.startTime ?? (event.allDay ? "09:00" : event.startsAt.slice(11, 16));
          const endTime = request.endTime ?? (event.allDay ? "10:00" : event.endsAt.slice(11, 16));
          return {
            ...event,
            ...(request.title === undefined ? {} : { title: request.title }),
            ...(scheduleChanged ? {
              startsAt: allDay ? startsOn : `${startsOn}T${startTime}:00`,
              endsAt: allDay ? endsOn : `${endsOn}T${endTime}:00`,
              allDay,
              timeZone: request.timeZone ?? event.timeZone,
            } : {}),
            ...(request.location === undefined ? {} : { location: request.location }),
            ...(request.link === undefined ? {} : { linkUrl: request.link }),
            ...(request.notes === undefined ? {} : { description: request.notes }),
            ...(request.invites === undefined ? {} : { attendees: request.invites.map((email) => ({ name: email, email })) }),
            ...(request.reminders === undefined ? {} : { reminders: request.reminders.map((label, index) => ({ id: `${index}`, label: `${label} before` })) }),
            ...(request.repeat === undefined ? {} : { recurring: true }),
            ...(request.circle === undefined ? {} : { highlighted: request.circle }),
          };
        });
        return { message: "Event updated in HEY Calendar." };
      },
      delete: async (id) => {
        const original = calendarEvents.find((event) => event.id === id);
        if (!original?.calendar.writable) throw new Error("This event is read-only.");
        calendarEvents = calendarEvents.filter((event) => event.id !== id);
        return { message: "Event deleted from HEY Calendar." };
      },
      listTodos: async (request) => ({ status: "ready", data: calendarTodos.filter((todo) => todo.startsOn >= request.startsOn && todo.startsOn <= request.endsOn) }),
      createTodo: async (request) => { const id = `todo-${Date.now()}`; calendarTodos = [...calendarTodos, { id, title: request.title, startsOn: request.date ?? "2026-09-02" }]; return { id, message: `“${request.title}” was added to Sometime This Week.` }; },
      completeTodo: async (request) => { calendarTodos = calendarTodos.map((todo) => todo.id === request.id ? { ...todo, completedAt: request.completed ? new Date().toISOString() : undefined } : todo); return { message: request.completed ? "Todo completed." : "Todo returned to Sometime This Week." }; },
      deleteTodo: async (id) => { calendarTodos = calendarTodos.filter((todo) => todo.id !== id); return { message: "Todo deleted." }; },
      listHabits: async () => ({ status: "ready", data: calendarHabits }),
      writeHabit: async (request) => { const id = request.id ?? `habit-${Date.now()}`; const previous = calendarHabits.find((item) => item.id === id); const habit = { id, name: request.name, icon: request.icon, color: request.color, days: request.days, completedDates: previous?.completedDates ?? [] }; calendarHabits = request.id ? calendarHabits.map((item) => item.id === request.id ? habit : item) : [...calendarHabits, habit]; return { id, message: request.id ? "Habit updated." : `“${request.name}” was added to your habits.` }; },
      completeHabit: async (request) => { calendarHabits = calendarHabits.map((habit) => habit.id === request.id ? { ...habit, completedDates: request.completed ? [...new Set([...habit.completedDates, request.date])].sort() : habit.completedDates.filter((date) => date !== request.date) } : habit); return { message: request.completed ? "Habit completed for this day." : "Habit completion removed for this day." }; },
      deleteHabit: async (id) => { calendarHabits = calendarHabits.filter((habit) => habit.id !== id); return { message: "Habit and its history deleted." }; },
      listJournal: async (request) => ({ status: "ready", data: calendarJournal.filter((entry) => entry.date >= request.startsOn && entry.date <= request.endsOn) }),
      readJournal: async (date) => ({ status: "ready", data: calendarJournal.find((entry) => entry.date === date) ?? null }),
      writeJournal: async (request) => { calendarJournal = request.content ? [...calendarJournal.filter((entry) => entry.date !== request.date), { id: calendarJournal.find((entry) => entry.date === request.date)?.id ?? `journal-${Date.now()}`, ...request }] : calendarJournal.filter((entry) => entry.date !== request.date); return { message: request.content ? "Journal entry saved." : "Journal entry removed." }; },
      listTimeTracks: async (limit = 100) => ({ status: "ready", data: limit === "all" ? calendarTimeTracks : calendarTimeTracks.slice(0, limit) }),
      currentTimeTrack: async () => ({ status: "ready", data: currentTimeTrack }),
      listTimeCategories: async () => ({ status: "ready", data: calendarTimeCategories }),
      startTimeTrack: async () => { const id = `track-${Date.now()}`; currentTimeTrack = { id, startsAt: new Date().toISOString() }; return { id, message: "Time tracking started." }; },
      stopTimeTrack: async (request) => { if (!currentTimeTrack) throw new Error("No time track is running."); calendarTimeTracks = [{ ...currentTimeTrack, endsAt: new Date().toISOString(), category: request.category }, ...calendarTimeTracks]; currentTimeTrack = null; return { message: request.category ? `Time tracking stopped and filed under “${request.category}”.` : "Time tracking stopped." }; },
      updateTimeTrack: async (request) => { calendarTimeTracks = calendarTimeTracks.map((track) => track.id === request.id ? { ...track, startsAt: request.start ?? track.startsAt, endsAt: request.end ?? track.endsAt, category: request.category ?? track.category, notes: request.notes ?? track.notes } : track); return { message: "Time track updated." }; },
      deleteTimeTrack: async (id) => { calendarTimeTracks = calendarTimeTracks.filter((track) => track.id !== id); return { message: "Time track deleted." }; },
      createTimeCategory: async (title) => { const id = `category-${Date.now()}`; calendarTimeCategories = [...calendarTimeCategories, { id, title }]; return { id, message: `“${title}” was added to time tracking.` }; },
      renameTimeCategory: async (id, title) => { calendarTimeCategories = calendarTimeCategories.map((category) => category.id === id ? { ...category, title } : category); return { message: `Category renamed to “${title}”.` }; },
      deleteTimeCategory: async (id) => { calendarTimeCategories = calendarTimeCategories.filter((category) => category.id !== id); return { message: "Time tracking category deleted." }; },
      exportTimeTracks: async () => ({ cancelled: false, path: "/tmp/hey-time-tracking.csv" }),
    },
    settings: {
      get: async () => settings,
      update: async ({ shortcutEdit, ...update }) => {
        const customShortcuts = { ...(update.customShortcuts ?? settings.customShortcuts) };
        if (shortcutEdit) {
          if (shortcutEdit.bindings === null) delete customShortcuts[shortcutEdit.id];
          else customShortcuts[shortcutEdit.id] = shortcutEdit.bindings;
          validateCustomShortcuts(customShortcuts);
        }
        settings = { ...settings, ...update, customShortcuts, sound: { ...settings.sound, ...update.sound }, ai: { ...settings.ai, ...update.ai }, helpers: { ...settings.helpers, ...update.helpers }, version: 1, shortcutProfile: update.shortcutProfile ?? settings.shortcutProfile }; return settings;
      },
      reset: async () => { settings = { version: 1, showSenderAvatars: false, interfaceFont: "instrument", shortcutProfile: "hey", customShortcuts: {}, sound: { ...DEFAULT_SOUND_SETTINGS }, ai: { general: { thinking: "inherit" }, quickUsesGeneral: true, quick: { thinking: "inherit" } }, helpers: settings.helpers }; return settings; },
    },
    writing: {
      listModels: async (_refresh) => [
        { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic", reasoning: true, images: true, contextWindow: 200_000, maxTokens: 64_000, inputCost: 1, outputCost: 5 },
        { id: "gpt-5.4-mini", name: "GPT-5.4 mini", provider: "openai-codex", reasoning: true, images: true, contextWindow: 400_000, maxTokens: 128_000 },
      ],
      generate: async (request) => ({ id: request.id, text: request.selectedText ? `Clearer: ${request.selectedText}` : request.draft ? `${request.draft.trim()}\n\nI’ll follow up with the final details tomorrow.` : "Thanks for reaching out. I’ll review this and get back to you tomorrow." }),
      cancel: async () => undefined,
    },
    theme: {
      current: async () => previewThemes[previewThemeName ?? ""] ?? ({
        name: "mars",
        mode: "dark",
        fontFamily: "Berkeley Mono",
        colors: {
          accent: "#FF6B4A",
          selection: "#4A2C2C",
          muted: "#AA4444",
          foreground: "#D9AFA7",
          background: "#000000",
        },
      }),
      subscribe: () => () => undefined,
    },
    agent: {
      getWorkspace: async () => workspace,
      send: async (_tabId, message) => {
        const helperId = workspace.activeSession.helperId as HelperId | undefined;
        if (!helperId) return;
        const mailObjects = workspace.activeSession.attachments
          .filter((attachment) => attachment.kind === "hey-thread")
          .map((attachment) => ({ kind: "mail-thread" as const, id: attachment.id, title: attachment.title, subtitle: attachment.subtitle, deepLink: `hey-agent://mail/threads/${attachment.id}` }));
        const fixture = isCustomHelperId(helperId) ? {
          target: "Read the explicitly attached context", operation: "thread read", summary: "Synthetic personal Helper result", objects: mailObjects,
          answer: `Personal Helper preview: ${workspace.activeSession.helperInstructions?.title ?? "Helper"}.\n\nThis is a synthetic result for testing the interface, not a model-generated answer.`,
        } : {
          "daily-brief": {
            target: "Read the selected day and relevant mail", operation: "event day", summary: "Day and sampled mail reviewed", objects: mailObjects,
            answer: "## Needs attention\n\n- Confirm the early-access window in [the launch conversation](hey-agent://mail/threads/1001).\n\n## Schedule\n\n- [Design review](hey-agent://calendar/events/402?date=2026-09-01) at 2:00 PM.\n\nSynthetic preview · Calendar, Imbox, and Reply Later sample.",
          },
          "calendar-triage": {
            target: "Review expanded Calendar occurrences", operation: "event week", summary: "Calendar window reviewed", objects: [],
            answer: "- [Design review](hey-agent://calendar/events/402?date=2026-09-01) and the launch check-in overlap by 30 minutes. Consider moving the check-in after 3:00 PM.\n- The all-day note is context, not a conflict.\n\nSynthetic preview · Active HEY calendars only. No changes made.",
          },
          "meeting-prep": {
            target: "Read the meeting and related mail",
            operation: "meeting prep",
            summary: "Meeting and related conversation reviewed",
            objects: [{ kind: "calendar-event" as const, id: "402", title: "Design review", subtitle: "2026-09-01", deepLink: "hey-agent://calendar/events/402?date=2026-09-01" }, { kind: "mail-thread" as const, id: "1001", title: "Updated launch timeline and final decisions", deepLink: "hey-agent://mail/threads/1001" }],
            answer: "## At a glance\n\n**Tuesday at 2:00 PM** in Studio · North room, organized by Maya. The goal is to settle the two remaining launch decisions.\n\n## What matters\n\nThe latest timeline incorporates yesterday’s feedback. The early-access window is the remaining decision.\n\n## Before the meeting\n\n- Choose a position on the early-access window.\n- Bring the final interaction pass.\n\n## Sources\n\n- [Design review](hey-agent://calendar/events/402?date=2026-09-01)\n- [Updated launch timeline and final decisions](hey-agent://mail/threads/1001)",
          },
          "follow-up-finder": {
            target: "Inspect the attached conversations for open loops",
            operation: "thread read",
            summary: `${mailObjects.length} conversation${mailObjects.length === 1 ? "" : "s"} reviewed`,
            objects: mailObjects,
            answer: "## You owe\n\n- Confirm whether the early-access window stays in the launch plan.\n\n## Waiting on others\n\n- Maya is sending the revised customer list before Friday.\n\n## Open questions\n\n- Who owns the final launch-day checklist?\n\n## Sources\n\n- [Updated launch timeline and final decisions](hey-agent://mail/threads/1001)",
          },
          "thread-recap": {
            target: "Read the attached conversation history",
            operation: "thread read",
            summary: `${mailObjects.length} conversation${mailObjects.length === 1 ? "" : "s"} recapped`,
            objects: mailObjects,
            answer: "## Current state\n\nThe revised launch sequence is agreed. The early-access window is the only unresolved decision.\n\n## Decisions and changes\n\n- Friday’s review moved to 2:00 PM.\n- Customer outreach will use the shorter sequence.\n\n## Owners and commitments\n\n- Maya will send the revised customer list.\n- You will decide the early-access window.\n\n## Open loops\n\n- Assign the final launch-day checklist.\n\n## Sources\n\n- [Updated launch timeline and final decisions](hey-agent://mail/threads/1001)",
          },
          "reply-coach": {
            target: "Read the conversation and shape the reply",
            operation: "thread read",
            summary: "Conversation reviewed",
            objects: mailObjects,
            answer: "Hi Maya,\n\nThis looks great. Let’s keep the early-access window in the launch plan, and I’ll take ownership of the final launch-day checklist.\n\nThanks!",
          },
        }[helperId];
        workspace.activeSession.timeline = [
          { kind: "message", id: "preview-helper-user", role: "user", text: message, state: "complete" },
          { kind: "run", id: "preview-helper-run", state: "complete", startedAt: new Date(now - 900).toISOString(), durationMs: 820, tools: [
            { id: "preview-helper-read", technicalName: "hey", label: "HEY · read", target: fixture.target, state: "complete", startedAt: new Date(now - 900).toISOString(), durationMs: 570, artifact: { version: 1, status: "complete", impact: "read", operation: fixture.operation, summary: fixture.summary, objects: fixture.objects, refresh: [] } },
          ] },
          { kind: "message", id: "preview-helper-answer", role: "assistant", state: "complete", text: fixture.answer },
        ];
        emitAgentWorkspace();
      },
      abort: async () => undefined,
      newSession: async (request = {}) => {
        const attachments = request.attachments ?? (request.attachment ? [request.attachment] : []);
        workspace.activeSession.attachments = structuredClone(attachments);
        workspace.activeSession.title = request.name ?? (attachments.length === 1 ? attachments[0]!.title : attachments.length > 1 ? `${attachments.length} conversations` : "New chat");
        workspace.activeSession.helperId = request.helperId;
        const authored = settings.helpers.custom?.find((helper) => helper.id === request.helperId);
        workspace.activeSession.helperInstructions = request.helperId ? { title: authored?.title ?? helperById(request.helperId)?.title ?? "Helper", instructions: authored?.instructions ?? "" } : undefined;
        const tab = workspace.tabs.find((item) => item.id === workspace.activeTabId);
        if (tab) { tab.attachments = structuredClone(attachments); tab.title = workspace.activeSession.title; tab.helperId = request.helperId; }
        return structuredClone(workspace);
      },
      activateSession: async () => workspace,
      closeSession: async () => workspace,
      openChat: async (chatId) => {
        const chat = workspace.chats.find((item) => item.id === chatId);
        if (!chat) throw new Error("That session could not be found.");
        workspace.activeTabId = chatId;
        if (!workspace.tabs.some((tab) => tab.id === chatId)) workspace.tabs.push({ id: chatId, title: chat.title, status: "ready", attachments: chat.attachments });
        workspace.activeSession = { tabId: chatId, title: chat.title, status: "ready", workingDirectory: chat.workingDirectory, attachments: chat.attachments, timeline: [] };
        return structuredClone(workspace);
      },
      renameSession: async () => workspace,
      archiveSession: async (sessionId, archived) => {
        const activeIndex = workspace.chats.findIndex((chat) => chat.id === sessionId);
        const archivedIndex = workspace.archivedChats.findIndex((chat) => chat.id === sessionId);
        if (archived && activeIndex >= 0) {
          const [chat] = workspace.chats.splice(activeIndex, 1);
          if (chat) workspace.archivedChats.unshift({ ...chat, archivedAt: new Date().toISOString() });
        } else if (!archived && archivedIndex >= 0) {
          const [chat] = workspace.archivedChats.splice(archivedIndex, 1);
          if (chat) {
            const { archivedAt: _archivedAt, ...rest } = chat;
            workspace.chats.unshift(rest);
          }
        }
        return structuredClone(workspace);
      },
      deleteSession: async (sessionId) => {
        workspace.chats = workspace.chats.filter((chat) => chat.id !== sessionId);
        workspace.archivedChats = workspace.archivedChats.filter((chat) => chat.id !== sessionId);
        return structuredClone(workspace);
      },
      attach: async (tabId, attachment) => {
        if (tabId === workspace.activeTabId && !workspace.activeSession.attachments.some((item) => item.kind === attachment.kind && item.id === attachment.id)) workspace.activeSession.attachments.push(attachment);
        const tab = workspace.tabs.find((item) => item.id === tabId);
        if (tab && !tab.attachments.some((item) => item.kind === attachment.kind && item.id === attachment.id)) tab.attachments.push(attachment);
        return structuredClone(workspace);
      },
      attachMany: async (tabId, attachments) => {
        for (const attachment of attachments) {
          if (tabId === workspace.activeTabId && !workspace.activeSession.attachments.some((item) => item.kind === attachment.kind && item.id === attachment.id)) workspace.activeSession.attachments.push(attachment);
          const tab = workspace.tabs.find((item) => item.id === tabId);
          if (tab && !tab.attachments.some((item) => item.kind === attachment.kind && item.id === attachment.id)) tab.attachments.push(attachment);
        }
        return structuredClone(workspace);
      },
      attachFiles: async (tabId) => {
        const attachment = { kind: "local-file" as const, id: "local-file:preview", title: "project-brief.pdf", path: "/home/you/Documents/project-brief.pdf", size: 148_220, modifiedAt: new Date(now).toISOString() };
        if (tabId === workspace.activeTabId && !workspace.activeSession.attachments.some((item) => item.id === attachment.id)) workspace.activeSession.attachments.push(attachment);
        const tab = workspace.tabs.find((item) => item.id === tabId);
        if (tab && !tab.attachments.some((item) => item.id === attachment.id)) tab.attachments.push(attachment);
        return structuredClone(workspace);
      },
      attachSelection: async (tabId) => {
        const attachment = { kind: "local-selection" as const, id: "local-selection:preview", title: "Selected text", subtitle: "96 characters", text: "The customer wants the revised project brief before next Wednesday's planning meeting." };
        if (tabId === workspace.activeTabId && !workspace.activeSession.attachments.some((item) => item.id === attachment.id)) workspace.activeSession.attachments.push(attachment);
        const tab = workspace.tabs.find((item) => item.id === tabId);
        if (tab && !tab.attachments.some((item) => item.id === attachment.id)) tab.attachments.push(attachment);
        return structuredClone(workspace);
      },
      detach: async (tabId, attachmentId) => {
        if (tabId === workspace.activeTabId) workspace.activeSession.attachments = workspace.activeSession.attachments.filter((item) => item.id !== attachmentId);
        const tab = workspace.tabs.find((item) => item.id === tabId);
        if (tab) tab.attachments = tab.attachments.filter((item) => item.id !== attachmentId);
        return structuredClone(workspace);
      },
      respondToUi: async () => undefined,
      continueInTerminal: async () => undefined,
      prepareHandoff: async () => ({
        id: "preview-handoff", title: "Launch timeline · synthetic preview", account: "alex@example.com",
        targets: [{ id: "pi", name: "Pi" }, { id: "codex", name: "Codex" }, { id: "hermes", name: "Hermes" }], terminalAvailable: true,
        prompt: "# Continue from HEY Agent\n\n## What I want you to do\nHelp me turn our launch decisions into a short project plan.\n\n## Source\nSynthetic preview · alex@example.com\n\n## Referenced items\nUpdated launch timeline and final decisions\nHEY Agent reference: hey-agent://mail/threads/1001\nRead: hey --account 100 --base-url https://app.hey.com thread read 1001 --json\n\n## Recent conversation\nUSER:\nWhat still needs a decision before we can launch?\n\nASSISTANT:\nMaya confirmed the revised dates. We still need to agree on the early-access window and who owns the customer announcement. No messages have been sent.\n\nThis preview uses synthetic data. Local paths and CLI commands are not accessible to web agents. Review before sharing.",
      }),
      copyHandoff: async () => undefined,
      launchHandoff: async () => undefined,
      listChats: async () => [],
      subscribe: (listener) => { agentListeners.add(listener); return () => agentListeners.delete(listener); },
    },
  };
}
