import { contextBridge, ipcRenderer } from "electron";
import type { AccountProfilesState, HeyAgentApi } from "../shared/contracts";

const current: AccountProfilesState = ipcRenderer.sendSync("profiles:current");
const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, current.token, ...args);

const api: HeyAgentApi = {
  profiles: { current, switchAccount: (key) => invoke("profiles:switch", key), acknowledgeWrites: () => invoke("profiles:acknowledge-writes"), retry: () => invoke("profiles:retry") },
  system: {
    getStatus: () => invoke("system:get-status"),
    openHeyUrl: (url) => invoke("system:open-hey-url", url),
    openExternalUrl: (url) => invoke("system:open-external-url", url),
  },
  mail: {
    listImbox: () => invoke("mail:list-imbox"),
    listMailbox: (box) => invoke("mail:list-mailbox", box),
    search: (request) => invoke("mail:search", request),
    searchFilters: () => invoke("mail:search-filters"),
    getOrganization: (target) => invoke("mail:get-organization", target),
    updateOrganization: (request) => invoke("mail:update-organization", request),
    listScreener: () => invoke("mail:list-screener"),
    getOverview: () => invoke("mail:get-overview"),
    decideScreener: (request) => invoke("mail:decide-screener", request),
    listLibrary: (kind) => invoke("mail:list-library", kind),
    readLibrarySource: (kind, id) => invoke("mail:read-library-source", kind, id),
    listLibraryThreads: (kind, id, page) => invoke("mail:list-library-threads", kind, id, page),
    showContact: (id) => invoke("mail:show-contact", id),
    readBundle: (id) => invoke("mail:read-bundle", id),
    listContactThreads: (id) => invoke("mail:list-contact-threads", id),
    updateSetAsideGroup: (request) => invoke("mail:update-set-aside-group", request),
    listDrafts: () => invoke("mail:list-drafts"),
    showDraft: (id) => invoke("mail:show-draft", id),
    editDraft: (request) => invoke("mail:edit-draft", request),
    sendDraft: (id) => invoke("mail:send-draft", id),
    deleteDraft: (id) => invoke("mail:delete-draft", id),
    getReplyContext: (postingId) => invoke("mail:reply-context", postingId),
    readThread: (topicId) => invoke("mail:read-thread", topicId),
    openAttachment: (topicId, attachmentId) => invoke("mail:open-attachment", topicId, attachmentId),
    previewCalendarInvite: (topicId, attachmentId) => invoke("mail:preview-calendar-invite", topicId, attachmentId),
    saveAttachment: (topicId, attachmentId) => invoke("mail:save-attachment", topicId, attachmentId),
    mutate: (request) => invoke("mail:mutate", request),
    queueTrash: (id, request) => invoke("mail:queue-trash", id, request),
    cancelTrash: (id) => invoke("mail:cancel-trash", id),
    pauseTrash: (id, paused) => invoke("mail:pause-trash", id, paused),
    send: (request) => invoke("mail:send", request),
    previewBulkReply: (postingIds) => invoke("mail:bulk-reply-preview", postingIds),
    sendBulkReply: (request) => invoke("mail:bulk-reply-send", request),
    undoBulkReply: (deliveryId) => invoke("mail:bulk-reply-undo", deliveryId),
    unbundleContact: (contactId) => invoke("mail:unbundle-contact", contactId),
    selectAttachments: () => invoke("mail:select-attachments"),
    listSenders: () => invoke("mail:list-senders"),
    importAttachments: (files) => invoke("mail:import-attachments", files),
    pasteAttachments: () => invoke("mail:paste-attachments"),
    describeAttachments: (paths) => invoke("mail:describe-attachments", paths),
    removeComposerAttachments: (paths) => invoke("mail:remove-composer-attachments", paths),
    subscribe: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, change: Parameters<typeof listener>[0]) => listener(change);
      ipcRenderer.on("mail:changed", handler);
      return () => ipcRenderer.removeListener("mail:changed", handler);
    },
  },
  calendar: {
    list: (request) => invoke("calendar:list", request),
    search: (request) => invoke("calendar:search", request),
    create: (request) => invoke("calendar:create", request),
    update: (request) => invoke("calendar:update", request),
    delete: (id) => invoke("calendar:delete", id),
    listTodos: (request) => invoke("calendar:todos:list", request),
    createTodo: (request) => invoke("calendar:todos:create", request),
    completeTodo: (request) => invoke("calendar:todos:complete", request),
    deleteTodo: (id) => invoke("calendar:todos:delete", id),
    listHabits: (date) => invoke("calendar:habits:list", date),
    writeHabit: (request) => invoke("calendar:habits:write", request),
    completeHabit: (request) => invoke("calendar:habits:complete", request),
    deleteHabit: (id) => invoke("calendar:habits:delete", id),
    listJournal: (request) => invoke("calendar:journal:list", request),
    readJournal: (date) => invoke("calendar:journal:read", date),
    writeJournal: (request) => invoke("calendar:journal:write", request),
    listTimeTracks: (limit) => invoke("calendar:time:list", limit),
    currentTimeTrack: () => invoke("calendar:time:current"),
    listTimeCategories: () => invoke("calendar:time:categories"),
    startTimeTrack: () => invoke("calendar:time:start"),
    stopTimeTrack: (request) => invoke("calendar:time:stop", request),
    updateTimeTrack: (request) => invoke("calendar:time:update", request),
    deleteTimeTrack: (id) => invoke("calendar:time:delete", id),
    createTimeCategory: (title) => invoke("calendar:time:category-create", title),
    renameTimeCategory: (id, title) => invoke("calendar:time:category-rename", id, title),
    deleteTimeCategory: (id) => invoke("calendar:time:category-delete", id),
    exportTimeTracks: () => invoke("calendar:time:export"),
  },
  settings: {
    get: () => invoke("settings:get"),
    update: (update) => invoke("settings:update", update),
    reset: () => invoke("settings:reset"),
  },
  writing: {
    listModels: (refresh) => invoke("writing:list-models", refresh),
    generate: (request) => invoke("writing:generate", request),
    cancel: (id) => invoke("writing:cancel", id),
  },
  theme: {
    current: () => invoke("theme:current"),
    subscribe: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, theme: Parameters<typeof listener>[0]) => listener(theme);
      ipcRenderer.on("theme:changed", handler);
      return () => ipcRenderer.removeListener("theme:changed", handler);
    },
  },
  agent: {
    getWorkspace: () => invoke("agent:get-workspace"),
    send: (tabId, message) => invoke("agent:send", tabId, message),
    abort: (tabId) => invoke("agent:abort", tabId),
    newSession: (request) => invoke("agent:new-session", request),
    activateSession: (tabId) => invoke("agent:activate-session", tabId),
    closeSession: (tabId) => invoke("agent:close-session", tabId),
    openChat: (chatId) => invoke("agent:open-chat", chatId),
    renameSession: (sessionId, title) => invoke("agent:rename-session", sessionId, title),
    archiveSession: (sessionId, archived) => invoke("agent:archive-session", sessionId, archived),
    deleteSession: (sessionId) => invoke("agent:delete-session", sessionId),
    attach: (tabId, attachment) => invoke("agent:attach", tabId, attachment),
    attachMany: (tabId, attachments) => invoke("agent:attach-many", tabId, attachments),
    attachFiles: (tabId) => invoke("agent:attach-files", tabId),
    attachSelection: (tabId) => invoke("agent:attach-selection", tabId),
    detach: (tabId, attachmentId) => invoke("agent:detach", tabId, attachmentId),
    respondToUi: (tabId, response) => invoke("agent:respond-ui", tabId, response),
    continueInTerminal: (tabId) => invoke("agent:continue-terminal", tabId),
    prepareHandoff: (tabId) => invoke("agent:handoff-prepare", tabId),
    copyHandoff: (request) => invoke("agent:handoff-copy", request),
    launchHandoff: (request) => invoke("agent:handoff-launch", request),
    listChats: () => invoke("agent:list-chats"),
    subscribe: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, snapshot: Parameters<typeof listener>[0]) => listener(snapshot);
      ipcRenderer.on("agent:changed", handler);
      return () => ipcRenderer.removeListener("agent:changed", handler);
    },
  },
};

contextBridge.exposeInMainWorld("heyAgent", api);
