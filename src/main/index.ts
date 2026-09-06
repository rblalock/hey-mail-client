import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import type {
  AgentAttachment, AgentMailContext, AgentUiResponse, BulkReplySendRequest, ComposerWritingRequest, MailDraftUpdate, MailMutationRequest, MailSendRequest,
  MailboxKey, MailLibraryKind, MailOrganizationMutationRequest, MailOrganizationTarget, MailSearchRequest, NewAgentSessionRequest, ScreenerDecisionRequest, SetAsideGroupMutationRequest,
} from "../shared/contracts";
import { helperAcceptsContextCount, helperById, isHelperId } from "../shared/helpers";
import { localFileAttachments, localSelectionAttachment, MAX_AGENT_ATTACHMENTS, normalizeAgentAttachment } from "./agent-attachments";
import { AgentSessionManager } from "./agent-session-manager";
import { AgentHandoffs } from "./agent-handoff";
import { assertHandoffAction } from "../shared/handoff";
import { ChatStore } from "./chat-store";
import { createCalendarEvent, deleteCalendarEvent, isCalendarEventCreateRequest, isCalendarEventUpdateRequest, isCalendarWindowRequest, listCalendarWindow, updateCalendarEvent } from "./hey-calendar";
import { isCalendarSearchRequest, searchCalendar } from "./hey-calendar-search";
import { completeCalendarHabit, completeCalendarTodo, createCalendarTimeCategory, createCalendarTodo, currentCalendarTimeTrack, deleteCalendarHabit, deleteCalendarTimeCategory, deleteCalendarTimeTrack, deleteCalendarTodo, exportCalendarTimeTracks, isCalendarHabitCompletionRequest, isCalendarHabitWriteRequest, isCalendarJournalWriteRequest, isCalendarTimeStopRequest, isCalendarTimeTrackUpdateRequest, isCalendarTodoCompletionRequest, isCalendarTodoCreateRequest, listCalendarHabits, listCalendarJournal, listCalendarTimeCategories, listCalendarTimeTracks, listCalendarTodos, readCalendarJournal, renameCalendarTimeCategory, startCalendarTimeTrack, stopCalendarTimeTrack, updateCalendarTimeTrack, writeCalendarHabit, writeCalendarJournal } from "./hey-calendar-recordings";
import { decideScreener, deleteDraft, editDraft, getMailOrganization, getMailOverview, getReplyContext, listContactThreads, listDrafts, listImbox, listLibrary, listMailbox, listScreener, listSearchFilters, mutateMail, previewBulkReply, readBundle, readLibrarySource, readThread, searchMail, sendBulkReply, sendDraft, sendMail, showContact, showDraft, unbundleContact, undoBulkReply, updateMailOrganization, updateSetAsideGroup } from "./hey";
import { HeyWatcher } from "./hey-watch";
import { resolveAppPaths } from "./paths";
import { probeRuntimes } from "./runtime";
import { SettingsStore } from "./settings-store";
import { updateSettingsFromIpc } from "./settings-update";
import { PiWritingService } from "./pi-writing";
import { desktopRuntimePath } from "./process";
import { currentTheme } from "./theme";
import { ThemeWatcher } from "./theme-watcher";
import { installWindowZoom } from "./window-zoom";
import { AccountProfiles } from "./account-profiles";
import { profileRequest } from "./profile-process";
import { HeyAccountScope } from "../../resources/hey-account-scope.mjs";
import { acknowledgeHeyWrites, pendingHeyWrites } from "../../resources/hey-write-receipts.mjs";

process.env.PATH = desktopRuntimePath();
const paths = resolveAppPaths();
for (const directory of [paths.config, paths.data, paths.state, paths.workspace]) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}

app.setName("HEY Agent");
app.setPath("userData", paths.config);
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
if (/^\d{4,5}$/.test(process.env.HEY_AGENT_DEBUG_PORT ?? "")) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.HEY_AGENT_DEBUG_PORT);
}

let mainWindow: BrowserWindow | null = null;
app.on("second-instance", () => {
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.show();
  mainWindow?.focus();
});
const settingsStore = new SettingsStore(join(paths.config, "settings.json"));
const writing = new PiWritingService(paths.workspace, process.env);
const piExtensionPath = app.isPackaged ? join(process.resourcesPath, "hey-agent-pi-extension.mjs") : join(app.getAppPath(), "resources", "hey-agent-pi-extension.mjs");
const helperRoot = app.isPackaged ? join(process.resourcesPath, "helpers") : join(app.getAppPath(), "resources", "helpers");
const profiles = new AccountProfiles(paths);
let agent: AgentSessionManager;
let handoffs: AgentHandoffs;
let accountContext: ReturnType<typeof profileRequest.getStore>;
let pendingWrites = 0;
let switchingProfile = false;
const themeWatcher = new ThemeWatcher((theme) => mainWindow?.webContents.send("theme:changed", theme));
let heyWatcher: HeyWatcher | undefined;

function bindProfile(): void {
  agent?.stop(); heyWatcher?.stop();
  const profile = profiles.state.active;
  if (!profile) { accountContext = undefined; return; }
  const token = profiles.state.token;
  const directories = profiles.directories(profile.key);
  const env = { ...process.env, HEY_ACCOUNT_ID: profile.accountId, HEY_BASE_URL: profile.server, HEY_NONINTERACTIVE: "1", HEY_AGENT_ACCOUNT_ID: profile.accountId, HEY_AGENT_ACCOUNT_SERVER: profile.server, HEY_AGENT_WRITE_RECEIPTS: join(directories.state, "pending-writes") };
  accountContext = { scope: new HeyAccountScope(profile.accountId, profile.server), env };
  const context = accountContext;
  agent = new AgentSessionManager(directories.workspace, new ChatStore(join(directories.state, "chats.json")), (topicId): Promise<AgentMailContext> => profileRequest.run(context, async () => {
    const thread = await readThread(topicId);
    const contacts = [...new Map(thread.entries.map((entry) => [entry.sender.email ?? entry.sender.name, entry.sender])).values()];
    return { topicId, subject: thread.subject, contacts, entries: thread.entries };
  }), env, piExtensionPath, helperRoot);
  const profileAgent = agent;
  handoffs = new AgentHandoffs(profile, (tabId) => profileAgent.handoffSnapshot(tabId), env);
  agent.subscribe((workspace) => { if (profiles.state.token === token) mainWindow?.webContents.send("agent:changed", workspace); });
  heyWatcher = new HeyWatcher((change) => { if (profiles.state.token === token) mainWindow?.webContents.send("mail:changed", change); }, env);
  void heyWatcher.start();
}

function assertTrusted(event: IpcMainInvokeEvent): void {
  const trusted = mainWindow?.webContents;
  if (!trusted || event.sender.id !== trusted.id || event.senderFrame !== trusted.mainFrame) {
    throw new Error("Rejected IPC from an untrusted renderer.");
  }
}

function handle(channel: string, action: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, async (event, token, ...args) => {
    assertTrusted(event);
    if (token !== profiles.state.token) throw new Error("This account view has expired. Reopen the account before continuing.");
    const scoped = /^(mail:|agent:|calendar:|writing:generate|writing:cancel)/.test(channel);
    if (!scoped) return action(event, ...args);
    profiles.assertToken(token);
    if (!accountContext) throw new Error("The account workspace is unavailable. Restart the app.");
    if (switchingProfile) throw new Error("An account switch is in progress.");
    const readOnly = /^(mail:(list-|get-|read-|show-|search|reply-context|bulk-reply-preview)|calendar:(list|search|habits:list|todos:list|journal:(list|read)|time:(list|current|categories))|agent:(get-workspace|list-chats))/.test(channel);
    if (!readOnly) pendingWrites++;
    try {
      const result = await profileRequest.run(accountContext, () => action(event, ...args));
      profiles.assertToken(token);
      return result;
    } finally { if (!readOnly) pendingWrites--; }
  });
}

function registerIpc(): void {
  ipcMain.on("profiles:current", (event) => {
    try { assertTrusted(event as unknown as IpcMainInvokeEvent); event.returnValue = profiles.state; }
    catch { event.returnValue = { token: "", accounts: [], error: "Untrusted account view." }; }
  });
  handle("profiles:switch", async (_event, key) => {
    if (typeof key !== "string") throw new Error("Select a linked account.");
    if (switchingProfile || pendingWrites || agent?.isBusy()) throw new Error("Finish or stop the current agent or writing task, and let pending changes finish before switching accounts.");
    if (accountContext && pendingHeyWrites(accountContext.env.HEY_AGENT_WRITE_RECEIPTS!).length) throw new Error("A HEY change needs checking. Verify its outcome in HEY before switching or retrying it.");
    switchingProfile = true;
    try {
      await profiles.select(key);
      bindProfile();
      // A new preload captures a new immutable profile token; old callbacks cannot retarget work.
      mainWindow?.reload();
    } finally { switchingProfile = false; }
  });
  handle("profiles:acknowledge-writes", () => {
    if (!profiles.state.active || !accountContext || switchingProfile || pendingWrites || agent?.isBusy()) throw new Error("Finish or stop the current task first.");
    acknowledgeHeyWrites(accountContext.env.HEY_AGENT_WRITE_RECEIPTS!);
  });
  handle("profiles:retry", async () => {
    if (switchingProfile || pendingWrites || agent?.isBusy()) throw new Error("Finish the current task before refreshing accounts.");
    switchingProfile = true;
    try { await profiles.initialize(); bindProfile(); mainWindow?.reload(); }
    finally { switchingProfile = false; }
  });
  handle("system:get-status", async () => ({
    paths,
    runtimes: await probeRuntimes(process.env, piExtensionPath),
  }));
  handle("system:open-hey-url", async (_event, url) => {
    if (typeof url !== "string" || !isTrustedHeyUrl(url)) throw new Error("Invalid HEY application link.");
    await shell.openExternal(url);
  });
  handle("system:open-external-url", async (_event, url) => {
    if (typeof url !== "string" || !isSafeExternalUrl(url)) throw new Error("Invalid external link.");
    await shell.openExternal(url);
  });
  handle("mail:list-imbox", () => listImbox());
  handle("mail:list-mailbox", (_event, box) => {
    if (typeof box !== "string") throw new Error("A HEY mailbox is required.");
    return listMailbox(box as MailboxKey);
  });
  handle("mail:search", (_event, request) => {
    if (!isMailSearchRequest(request)) throw new Error("A valid HEY search is required.");
    return searchMail(request);
  });
  handle("mail:search-filters", () => listSearchFilters());
  handle("mail:get-organization", (_event, target) => {
    if (!isOrganizationTarget(target)) throw new Error("Invalid HEY conversation organization target.");
    return getMailOrganization(target);
  });
  handle("mail:update-organization", (_event, request) => {
    if (!isOrganizationMutation(request)) throw new Error("Invalid HEY conversation organization action.");
    return updateMailOrganization(request);
  });
  handle("mail:list-screener", () => listScreener());
  handle("mail:get-overview", () => getMailOverview());
  handle("mail:list-library", (_event, kind) => {
    if (kind !== "contacts" && kind !== "labels" && kind !== "collections") throw new Error("Invalid HEY library.");
    return listLibrary(kind as MailLibraryKind);
  });
  handle("mail:read-library-source", (_event, kind, id) => {
    if (kind !== "labels" && kind !== "collections") throw new Error("Invalid HEY library source.");
    return readLibrarySource(kind, assertNumericId(id, kind === "labels" ? "label" : "collection"));
  });
  handle("mail:show-contact", (_event, id) => showContact(assertNumericId(id, "contact")));
  handle("mail:read-bundle", (_event, id) => readBundle(assertNumericId(id, "bundle")));
  handle("mail:list-contact-threads", (_event, id) => listContactThreads(assertNumericId(id, "contact")));
  handle("mail:update-set-aside-group", (_event, request) => {
    if (!isSetAsideGroupMutation(request)) throw new Error("Invalid HEY Set Aside group action.");
    return updateSetAsideGroup(request);
  });
  handle("mail:list-drafts", () => listDrafts());
  handle("mail:show-draft", (_event, id) => showDraft(assertNumericId(id, "draft")));
  handle("mail:edit-draft", (_event, request) => {
    if (!isDraftUpdate(request)) throw new Error("Invalid HEY draft update.");
    return editDraft(request);
  });
  handle("mail:send-draft", (_event, id) => sendDraft(assertNumericId(id, "draft")));
  handle("mail:delete-draft", (_event, id) => deleteDraft(assertNumericId(id, "draft")));
  handle("mail:reply-context", (_event, postingId) => getReplyContext(assertNumericId(postingId, "posting")));
  handle("mail:decide-screener", (_event, request) => {
    if (!isScreenerDecision(request)) throw new Error("Invalid Screener decision.");
    return decideScreener(request);
  });
  handle("mail:read-thread", (_event, topicId) => {
    if (typeof topicId !== "string") throw new Error("A HEY topic ID is required.");
    return readThread(topicId, process.env, { includeHtml: true });
  });
  handle("mail:mutate", (_event, request) => {
    if (!isMailMutation(request)) throw new Error("Invalid HEY mail action.");
    return mutateMail(request);
  });
  handle("mail:send", (_event, request) => {
    if (!isMailSendRequest(request)) throw new Error("Invalid HEY message.");
    return sendMail(request);
  });
  handle("mail:bulk-reply-preview", (_event, postingIds) => {
    if (!isPostingIdSelection(postingIds, 2)) throw new Error("Select at least two HEY conversations.");
    return previewBulkReply(postingIds);
  });
  handle("mail:bulk-reply-send", (_event, request) => {
    if (!isBulkReplySendRequest(request)) throw new Error("Invalid HEY bulk reply.");
    return sendBulkReply(request);
  });
  handle("mail:bulk-reply-undo", (_event, deliveryId) => undoBulkReply(assertNumericId(deliveryId, "bulk reply")));
  handle("mail:unbundle-contact", (_event, contactId) => {
    if (typeof contactId !== "string" || !/^\d+$/.test(contactId)) throw new Error("Invalid HEY contact ID.");
    return unbundleContact(contactId);
  });
  handle("mail:select-attachments", async () => {
    if (!mainWindow) return [];
    const selection = await dialog.showOpenDialog(mainWindow, { properties: ["openFile", "multiSelections"] });
    return selection.canceled ? [] : selection.filePaths;
  });
  handle("calendar:list", (_event, request) => {
    if (!isCalendarWindowRequest(request)) throw new Error("A valid HEY Calendar window is required.");
    return listCalendarWindow(request);
  });
  handle("calendar:search", (_event, request) => {
    if (!isCalendarSearchRequest(request)) throw new Error("A Calendar search term is required.");
    return searchCalendar(request);
  });
  handle("calendar:create", (_event, request) => {
    if (!isCalendarEventCreateRequest(request)) throw new Error("A valid HEY Calendar event is required.");
    return createCalendarEvent(request);
  });
  handle("calendar:update", (_event, request) => {
    if (!isCalendarEventUpdateRequest(request)) throw new Error("A valid HEY Calendar event update is required.");
    return updateCalendarEvent(request);
  });
  handle("calendar:delete", (_event, id) => deleteCalendarEvent(assertNumericId(id, "Calendar event")));
  handle("calendar:todos:list", (_event, request) => {
    if (!isCalendarWindowRequest(request, 42)) throw new Error("A valid Calendar week is required.");
    return listCalendarTodos(request);
  });
  handle("calendar:todos:create", (_event, request) => {
    if (!isCalendarTodoCreateRequest(request)) throw new Error("A valid Sometime This Week todo is required.");
    return createCalendarTodo(request);
  });
  handle("calendar:todos:complete", (_event, request) => {
    if (!isCalendarTodoCompletionRequest(request)) throw new Error("A valid todo completion is required.");
    return completeCalendarTodo(request);
  });
  handle("calendar:todos:delete", (_event, id) => deleteCalendarTodo(assertNumericId(id, "todo")));
  handle("calendar:habits:list", (_event, date) => {
    if (!isCalendarWindowRequest({ startsOn: date, endsOn: date })) throw new Error("A valid habit week is required.");
    return listCalendarHabits(date as string);
  });
  handle("calendar:habits:write", (_event, request) => {
    if (!isCalendarHabitWriteRequest(request)) throw new Error("A valid habit is required.");
    return writeCalendarHabit(request);
  });
  handle("calendar:habits:complete", (_event, request) => {
    if (!isCalendarHabitCompletionRequest(request)) throw new Error("A valid habit completion is required.");
    return completeCalendarHabit(request);
  });
  handle("calendar:habits:delete", (_event, id) => deleteCalendarHabit(assertNumericId(id, "habit")));
  handle("calendar:journal:list", (_event, request) => {
    if (!isCalendarWindowRequest(request, 42)) throw new Error("A valid Journal window is required.");
    return listCalendarJournal(request);
  });
  handle("calendar:journal:read", (_event, date) => {
    if (!isCalendarWindowRequest({ startsOn: date, endsOn: date })) throw new Error("A valid Journal day is required.");
    return readCalendarJournal(date as string);
  });
  handle("calendar:journal:write", (_event, request) => {
    if (!isCalendarJournalWriteRequest(request)) throw new Error("A valid Journal entry is required.");
    return writeCalendarJournal(request);
  });
  handle("calendar:time:list", (_event, limit) => {
    if (limit !== undefined && limit !== "all" && (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 500)) throw new Error("A valid time-track limit is required.");
    return listCalendarTimeTracks(limit as number | "all" | undefined);
  });
  handle("calendar:time:current", () => currentCalendarTimeTrack());
  handle("calendar:time:categories", () => listCalendarTimeCategories());
  handle("calendar:time:start", () => startCalendarTimeTrack());
  handle("calendar:time:stop", (_event, request) => {
    if (!isCalendarTimeStopRequest(request)) throw new Error("A valid time-tracking category is required.");
    return stopCalendarTimeTrack(request);
  });
  handle("calendar:time:update", (_event, request) => {
    if (!isCalendarTimeTrackUpdateRequest(request)) throw new Error("A valid time-track update is required.");
    return updateCalendarTimeTrack(request);
  });
  handle("calendar:time:delete", (_event, id) => deleteCalendarTimeTrack(assertNumericId(id, "time track")));
  handle("calendar:time:category-create", (_event, title) => createCalendarTimeCategory(assertBoundedTitle(title, "time tracking category")));
  handle("calendar:time:category-rename", (_event, id, title) => renameCalendarTimeCategory(assertNumericId(id, "time tracking category"), assertBoundedTitle(title, "time tracking category")));
  handle("calendar:time:category-delete", (_event, id) => deleteCalendarTimeCategory(assertNumericId(id, "time tracking category")));
  handle("calendar:time:export", async () => {
    if (!mainWindow) return { cancelled: true };
    const choice = await dialog.showSaveDialog(mainWindow, { title: "Export tracked time", defaultPath: "hey-time-tracking.csv", filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (choice.canceled || !choice.filePath) return { cancelled: true };
    await exportCalendarTimeTracks(choice.filePath);
    return { cancelled: false, path: choice.filePath };
  });
  handle("theme:current", () => currentTheme());
  handle("settings:get", () => settingsStore.get());
  handle("settings:update", (_event, update) => updateSettingsFromIpc(settingsStore, update));
  handle("settings:reset", () => settingsStore.reset());
  handle("writing:list-models", (_event, refresh) => {
    if (refresh !== undefined && typeof refresh !== "boolean") throw new Error("Invalid model refresh request.");
    return writing.listModels(refresh);
  });
  handle("writing:generate", async (_event, request) => {
    if (!isComposerWritingRequest(request)) throw new Error("Invalid writing request.");
    const settings = await settingsStore.get();
    return writing.generate(request, settings.ai.quickUsesGeneral ? settings.ai.general : settings.ai.quick);
  });
  handle("writing:cancel", (_event, id) => {
    if (typeof id !== "string" || !/^[a-zA-Z0-9:_-]{1,160}$/.test(id)) throw new Error("Invalid writing request ID.");
    writing.cancel(id);
  });
  handle("agent:get-workspace", () => agent.getWorkspace());
  handle("agent:send", (_event, tabId, message) => {
    if (typeof tabId !== "string" || tabId.length > 100) throw new Error("Invalid HEY Agent tab.");
    if (typeof message !== "string" || message.length > 20_000) throw new Error("Invalid HEY Agent message.");
    return agent.send(tabId, message);
  });
  handle("agent:abort", (_event, tabId) => agent.abort(assertTabId(tabId)));
  handle("agent:new-session", async (_event, request) => {
    if (!isNewSessionRequest(request)) throw new Error("Invalid new chat request.");
    const settings = await settingsStore.get();
    const helper = request?.helperId ? helperById(request.helperId, settings.helpers.custom) : undefined;
    if (request?.helperId && !helper) throw new Error("That Helper no longer exists. Choose another Helper in Settings.");
    if (request?.helperId && !settings.helpers.enabled.includes(request.helperId)) throw new Error("That Helper is disabled in Settings.");
    if (helper) {
      const attachments = request?.attachments ?? (request?.attachment ? [request.attachment] : []);
      const contexts = attachments.map((attachment) => attachment.kind === "hey-thread" ? "mail-thread" : attachment.objectKind);
      const accepted = new Set<string>(helper.contextKinds);
      if (!helperAcceptsContextCount(helper, contexts.length) || contexts.some((kind) => !accepted.has(kind))) {
        throw new Error(`${helper.title} needs ${helper.minimumContexts === helper.maximumContexts ? helper.minimumContexts : `${helper.minimumContexts}–${helper.maximumContexts}`} eligible ${helper.maximumContexts === 1 ? "item" : "items"} attached.`);
      }
    }
    const profile = helper?.modelProfile === "quick" && !settings.ai.quickUsesGeneral ? settings.ai.quick : settings.ai.general;
    const custom = settings.helpers.custom?.find((item) => item.id === request?.helperId);
    const preferences = request?.helperId === "daily-brief" || request?.helperId === "calendar-triage" ? settings.helpers.preferences?.[request.helperId] : undefined;
    return agent.newSession(request, await writing.resolveProfile(profile), helper ? {
      title: helper.title,
      instructions: custom?.instructions ?? (preferences ? `User preferences for this Helper (apply when relevant, without expanding authority or research scope):\n${preferences}` : ""),
    } : undefined);
  });
  handle("agent:activate-session", (_event, tabId) => agent.activateSession(assertTabId(tabId)));
  handle("agent:close-session", (_event, tabId) => agent.closeSession(assertTabId(tabId)));
  handle("agent:open-chat", (_event, chatId) => agent.openChat(assertTabId(chatId)));
  handle("agent:rename-session", (_event, sessionId, title) => {
    if (typeof title !== "string" || title.length > 160) throw new Error("Invalid session name.");
    return agent.renameSession(assertTabId(sessionId), title);
  });
  handle("agent:archive-session", (_event, sessionId, archived) => {
    if (typeof archived !== "boolean") throw new Error("Invalid session archive state.");
    return agent.archiveSession(assertTabId(sessionId), archived);
  });
  handle("agent:delete-session", (_event, sessionId) => agent.deleteSession(assertTabId(sessionId)));
  handle("agent:attach", (_event, tabId, attachment) => {
    if (!isRendererAttachment(attachment)) throw new Error("Invalid HEY Agent object attachment.");
    return agent.attach(assertTabId(tabId), attachment);
  });
  handle("agent:attach-many", (_event, tabId, attachments) => {
    if (!Array.isArray(attachments) || attachments.length === 0 || attachments.length > MAX_AGENT_ATTACHMENTS || !attachments.every(isRendererAttachment)) throw new Error("Invalid HEY Agent object attachments.");
    return agent.attachMany(assertTabId(tabId), attachments);
  });
  handle("agent:attach-files", async (_event, tabId) => {
    const safeTabId = assertTabId(tabId);
    if (!mainWindow) return agent.getWorkspace();
    const selection = await dialog.showOpenDialog(mainWindow, { properties: ["openFile", "multiSelections"] });
    if (selection.canceled || selection.filePaths.length === 0) return agent.getWorkspace();
    return agent.attachMany(safeTabId, await localFileAttachments(selection.filePaths));
  });
  handle("agent:attach-selection", async (_event, tabId) => {
    const attachment = localSelectionAttachment(clipboard.selection ? await clipboard.selection.readText() : "");
    return agent.attach(assertTabId(tabId), attachment);
  });
  handle("agent:detach", (_event, tabId, attachmentId) => {
    if (typeof attachmentId !== "string" || attachmentId.length > 300) throw new Error("Invalid HEY Agent attachment ID.");
    return agent.detach(assertTabId(tabId), attachmentId);
  });
  handle("agent:respond-ui", (_event, tabId, response) => {
    if (!isUiResponse(response)) throw new Error("Invalid HEY Agent response.");
    return agent.respondToUi(assertTabId(tabId), response);
  });
  handle("agent:continue-terminal", (_event, tabId) => agent.continueInTerminal(assertTabId(tabId)));
  handle("agent:handoff-prepare", (_event, tabId) => handoffs.prepare(assertTabId(tabId)));
  handle("agent:handoff-copy", (_event, request) => {
    assertHandoffAction(request);
    return handoffs.copy(request, (text) => clipboard.writeText(text));
  });
  handle("agent:handoff-launch", (_event, request) => {
    assertHandoffAction(request);
    return handoffs.launch(request);
  });
  handle("agent:list-chats", () => agent.listChats());
}

function isMailMutation(value: unknown): value is MailMutationRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<MailMutationRequest>;
  return ["move", "bubble", "seen", "unseen", "trash", "spam", "ignore", "stop-ignoring"].includes(request.operation ?? "")
    && Array.isArray(request.postingIds)
    && request.postingIds.length > 0
    && request.postingIds.length <= 100
    && request.postingIds.every((id) => typeof id === "string" && /^\d+$/.test(id))
    && (request.destination === undefined || typeof request.destination === "string")
    && (request.sourceBox === undefined || typeof request.sourceBox === "string")
    && (request.bubbleSchedule === undefined || ["now", "tomorrow", "weekend", "next-week"].includes(request.bubbleSchedule));
}

function isSetAsideGroupMutation(value: unknown): value is SetAsideGroupMutationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Partial<SetAsideGroupMutationRequest>;
  const ids = request.postingIds;
  return ["create", "add", "remove", "delete"].includes(request.action ?? "")
    && (ids === undefined || isPostingIdSelection(ids))
    && (request.groupId === undefined || /^\d+$/.test(request.groupId))
    && (request.action === "delete" ? Boolean(request.groupId) && ids === undefined : Boolean(ids?.length))
    && (request.action !== "add" || Boolean(request.groupId));
}

function isMailSearchRequest(value: unknown): value is MailSearchRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Partial<MailSearchRequest>;
  const text = [request.query, request.required, request.any, request.none, request.exact, request.from, request.to, request.subject, request.date, request.box, request.label, request.attachment];
  return text.every((item) => item === undefined || typeof item === "string")
    && (request.page === undefined || Number.isInteger(request.page));
}

function isOrganizationTarget(value: unknown): value is MailOrganizationTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const target = value as Partial<MailOrganizationTarget>;
  const validSelection = (items: unknown): items is string[] => Array.isArray(items)
    && items.length <= 100
    && new Set(items).size === items.length
    && items.every((item) => typeof item === "string" && /^\d+$/.test(item));
  return (target.postingIds === undefined || validSelection(target.postingIds))
    && (target.topicIds === undefined || validSelection(target.topicIds))
    && Boolean(target.postingIds?.length || target.topicIds?.length);
}

function isOrganizationMutation(value: unknown): value is MailOrganizationMutationRequest {
  if (!isOrganizationTarget(value)) return false;
  const request = value as Partial<MailOrganizationMutationRequest>;
  return (request.kind === "labels" || request.kind === "collections")
    && (request.action === "add" || request.action === "remove" || request.action === "create")
    && (request.targetId === undefined || typeof request.targetId === "string")
    && (request.name === undefined || typeof request.name === "string");
}

function isPostingIdSelection(value: unknown, minimum = 1): value is string[] {
  return Array.isArray(value)
    && value.length >= minimum
    && value.length <= 100
    && new Set(value).size === value.length
    && value.every((id) => typeof id === "string" && /^\d+$/.test(id));
}

function isBulkReplySendRequest(value: unknown): value is BulkReplySendRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<BulkReplySendRequest>;
  return isPostingIdSelection(request.postingIds, 2)
    && typeof request.body === "string"
    && Array.isArray(request.attachments)
    && request.attachments.every((path) => typeof path === "string");
}

function isTrustedHeyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "app.hey.com";
  } catch { return false; }
}

function isSafeExternalUrl(value: string): boolean {
  if (value.length > 4_096) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:" || url.protocol === "tel:";
  } catch { return false; }
}


function isMailSendRequest(value: unknown): value is MailSendRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<MailSendRequest>;
  return ["compose", "reply", "forward"].includes(request.mode ?? "")
    && typeof request.body === "string"
    && Array.isArray(request.attachments)
    && request.attachments.every((path) => typeof path === "string")
    && [request.topicId, request.to, request.cc, request.bcc, request.subject].every((item) => item === undefined || typeof item === "string")
    && (request.saveAsDraft === undefined || typeof request.saveAsDraft === "boolean");
}

function isScreenerDecision(value: unknown): value is ScreenerDecisionRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<ScreenerDecisionRequest>;
  return typeof request.id === "string" && /^\d+$/.test(request.id)
    && (request.decision === "approve" || request.decision === "deny")
    && (request.destination === undefined || typeof request.destination === "string")
    && (request.seen === undefined || typeof request.seen === "boolean")
    && (request.spam === undefined || typeof request.spam === "boolean");
}

function assertNumericId(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error(`Invalid HEY ${label} ID.`);
  return value;
}

function assertBoundedTitle(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) throw new Error(`Invalid HEY ${label}.`);
  return value.trim();
}

function isDraftUpdate(value: unknown): value is MailDraftUpdate {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<MailDraftUpdate>;
  return typeof request.id === "string" && /^\d+$/.test(request.id)
    && [request.subject, request.to, request.cc, request.bcc, request.body].every((item) => item === undefined || typeof item === "string");
}

function assertTabId(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 100) throw new Error("Invalid HEY Agent tab.");
  return value;
}

function isRendererAttachment(value: unknown): value is AgentAttachment {
  const attachment = normalizeAgentAttachment(value);
  return attachment?.kind === "hey-thread" || attachment?.kind === "hey-object";
}

function isNewSessionRequest(value: unknown): value is NewAgentSessionRequest {
  if (value === undefined) return true;
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<NewAgentSessionRequest>;
  return (request.name === undefined || (typeof request.name === "string" && request.name.length <= 160))
    && (request.helperId === undefined || isHelperId(request.helperId))
    && (request.attachment === undefined || isRendererAttachment(request.attachment))
    && (request.attachments === undefined || (Array.isArray(request.attachments) && request.attachments.length > 0 && request.attachments.length <= MAX_AGENT_ATTACHMENTS && request.attachments.every(isRendererAttachment)))
    && !(request.attachment && request.attachments);
}

function isComposerWritingRequest(value: unknown): value is ComposerWritingRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Partial<ComposerWritingRequest>;
  const validText = (candidate: unknown, limit: number) => candidate === undefined || typeof candidate === "string" && candidate.length <= limit && !candidate.includes("\0");
  return typeof request.id === "string" && /^[a-zA-Z0-9:_-]{1,160}$/.test(request.id)
    && ["draft", "rewrite", "shorten", "friendlier", "improve", "continue", "custom"].includes(request.operation ?? "")
    && ["compose", "reply", "forward"].includes(request.mode ?? "")
    && typeof request.draft === "string" && request.draft.length <= 24_000 && !request.draft.includes("\0")
    && validText(request.selectedText, 12_000)
    && validText(request.instruction, 4_000)
    && validText(request.subject, 500)
    && validText(request.recipients, 1_000)
    && validText(request.threadContext, 24_000);
}

function isUiResponse(value: unknown): value is AgentUiResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<AgentUiResponse>;
  return typeof response.id === "string"
    && response.id.length <= 300
    && (response.value === undefined || (typeof response.value === "string" && response.value.length <= 100_000))
    && (response.confirmed === undefined || typeof response.confirmed === "boolean")
    && (response.cancelled === undefined || typeof response.cancelled === "boolean");
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: "#111111",
    autoHideMenuBar: true,
    title: "HEY Agent",
    icon: app.isPackaged ? join(process.resourcesPath, "icon.png") : join(app.getAppPath(), "resources", "icon.png"),
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  installWindowZoom(mainWindow.webContents);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  if (!ownsInstance) return;
  if (app.isPackaged) {
    try { console.info("HEY Agent build", readFileSync(join(process.resourcesPath, "build-info.json"), "utf8").trim()); }
    catch { console.info(`HEY Agent ${app.getVersion()}`); }
  }
  registerIpc();
  await profiles.initialize();
  bindProfile();
  createWindow();
  void themeWatcher.start();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  themeWatcher.stop();
  heyWatcher?.stop();
  agent?.stop();
});
