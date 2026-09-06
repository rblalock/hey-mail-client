export const HELPER_IDS = ["meeting-prep", "follow-up-finder", "thread-recap", "reply-coach", "daily-brief", "calendar-triage"] as const;
export type BuiltinHelperId = typeof HELPER_IDS[number];
export type CustomHelperId = `custom-${string}`;
export type HelperId = BuiltinHelperId | CustomHelperId;
export const HELPER_CATALOG_VERSION = 2 as const;
export const MAX_CUSTOM_HELPERS = 50;
export const MAX_HELPER_INSTRUCTIONS = 12_000;

export type CustomHelper = {
  id: CustomHelperId;
  title: string;
  instructions: string;
  context: "any" | "mail" | "calendar";
  modelProfile: "general" | "quick";
};

// Captured by main when a run starts, never supplied by a new-session IPC caller.
export type HelperSessionInstructions = { title: string; instructions: string };

export type HelperContextKind = "calendar-event" | "calendar-date" | "mail-thread";

export type HelperDefinition = {
  id: HelperId;
  title: string;
  purpose: string;
  contextKinds: HelperContextKind[];
  surfaces: Array<"calendar" | "mail" | "commands">;
  modelProfile: "general" | "quick";
  skillDirectory?: string;
  starter: string;
  pluralStarter?: string;
  minimumContexts: number;
  maximumContexts: number;
  commandLabel: string;
  pluralCommandLabel?: string;
};

export const HELPERS: readonly HelperDefinition[] = [
  {
    id: "meeting-prep",
    title: "Meeting Prep",
    purpose: "Build a focused brief from the event and related mail.",
    contextKinds: ["calendar-event"],
    surfaces: ["calendar", "commands"],
    modelProfile: "general",
    skillDirectory: "meeting-prep",
    starter: "Prepare me for this meeting.",
    minimumContexts: 1,
    maximumContexts: 1,
    commandLabel: "Meeting Prep this event",
  },
  {
    id: "follow-up-finder",
    title: "Follow-up Finder",
    purpose: "Find commitments, unanswered questions, and useful next steps.",
    contextKinds: ["mail-thread"],
    surfaces: ["mail", "commands"],
    modelProfile: "general",
    skillDirectory: "follow-up-finder",
    starter: "Read the attached conversation and surface only the follow-ups that are still open.",
    pluralStarter: "Read the attached conversations and surface only the follow-ups that are still open.",
    minimumContexts: 1,
    maximumContexts: 12,
    commandLabel: "Find follow-ups in this conversation",
    pluralCommandLabel: "Find follow-ups in selected conversations",
  },
  {
    id: "thread-recap",
    title: "Thread Recap",
    purpose: "Turn conversation history into decisions, changes, and open loops.",
    contextKinds: ["mail-thread"],
    surfaces: ["mail", "commands"],
    modelProfile: "general",
    skillDirectory: "thread-recap",
    starter: "Read the attached conversation and recap its current state, decisions, commitments, and open loops.",
    pluralStarter: "Read the attached conversations together and recap their current state, decisions, commitments, and open loops.",
    minimumContexts: 1,
    maximumContexts: 12,
    commandLabel: "Recap this conversation",
    pluralCommandLabel: "Recap selected conversations",
  },
  {
    id: "reply-coach",
    title: "Reply Coach",
    purpose: "Shape a clear, useful reply without sending it.",
    contextKinds: ["mail-thread"],
    surfaces: ["mail", "commands"],
    modelProfile: "quick",
    skillDirectory: "reply-coach",
    starter: "Read the full attached conversation and write the complete reply its latest message needs. Return only the email body.",
    minimumContexts: 1,
    maximumContexts: 1,
    commandLabel: "Reply Coach this conversation",
  },
  {
    id: "daily-brief", title: "Daily Brief", purpose: "Your day, important mail, and next steps.",
    contextKinds: ["calendar-date"], surfaces: ["calendar", "commands"], modelProfile: "general",
    skillDirectory: "daily-brief", starter: "Prepare my daily brief for the attached date.",
    minimumContexts: 1, maximumContexts: 1, commandLabel: "Daily Brief",
  },
  {
    id: "calendar-triage", title: "Calendar Triage", purpose: "Review your schedule and work through what needs attention.",
    contextKinds: ["calendar-date"], surfaces: ["calendar", "commands"], modelProfile: "general",
    skillDirectory: "calendar-triage", starter: "Review the attached Calendar window and suggest useful next steps.",
    minimumContexts: 1, maximumContexts: 1, commandLabel: "Calendar Triage",
  },
] as const;

export const DEFAULT_ENABLED_HELPERS: HelperId[] = HELPERS.map((helper) => helper.id);

export function isHelperId(value: unknown): value is HelperId {
  return isBuiltinHelperId(value) || isCustomHelperId(value);
}

export function isBuiltinHelperId(value: unknown): value is BuiltinHelperId {
  return typeof value === "string" && (HELPER_IDS as readonly string[]).includes(value);
}

export function isCustomHelperId(value: unknown): value is CustomHelperId {
  return typeof value === "string" && /^custom-[a-z0-9-]{1,60}$/.test(value);
}

export function customHelperError(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Invalid Helper.";
  const item = value as Partial<CustomHelper>;
  if (!isCustomHelperId(item.id)) return "Invalid Helper ID.";
  if (typeof item.title !== "string" || !item.title.trim() || item.title.trim().length > 60 || /[\r\n\0]/.test(item.title)) return "Use a name of 1–60 characters.";
  if (typeof item.instructions !== "string" || !item.instructions.trim() || item.instructions.length > MAX_HELPER_INSTRUCTIONS || item.instructions.includes("\0")) return `Add instructions (up to ${MAX_HELPER_INSTRUCTIONS.toLocaleString("en-US")} characters).`;
  if (!["any", "mail", "calendar"].includes(item.context ?? "")) return "Choose Any, Mail, or Calendar context.";
  if (!["general", "quick"].includes(item.modelProfile ?? "")) return "Choose General or Quick.";
  return undefined;
}

export function customHelpersError(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length > MAX_CUSTOM_HELPERS) return `Keep up to ${MAX_CUSTOM_HELPERS} personal Helpers.`;
  const ids = new Set<string>();
  const names = new Set(HELPERS.map((helper) => helper.title.toLowerCase()));
  for (const item of value) {
    const error = customHelperError(item);
    if (error) return error;
    const helper = item as CustomHelper;
    const name = helper.title.trim().toLowerCase();
    if (ids.has(helper.id) || names.has(name)) return "A Helper with that name already exists. Choose another name.";
    ids.add(helper.id); names.add(name);
  }
  return undefined;
}

export function helperCatalog(custom: readonly CustomHelper[] = []): HelperDefinition[] {
  return [...HELPERS, ...custom.map((helper): HelperDefinition => ({
    id: helper.id, title: helper.title, purpose: helper.context === "any" ? "Personal Helper" : `${helper.context === "mail" ? "Mail" : "Calendar"} Helper`,
    contextKinds: helper.context === "mail" ? ["mail-thread"] : helper.context === "calendar" ? ["calendar-event", "calendar-date"] : ["mail-thread", "calendar-event", "calendar-date"],
    surfaces: helper.context === "mail" ? ["mail", "commands"] : helper.context === "calendar" ? ["calendar", "commands"] : ["mail", "calendar", "commands"],
    modelProfile: helper.modelProfile,
    starter: "Follow this Helper's instructions using the explicitly attached context. If essential information is missing, ask one focused question.",
    minimumContexts: helper.context === "any" ? 0 : 1, maximumContexts: helper.context === "calendar" ? 1 : 12,
    commandLabel: helper.title,
  }))];
}

export function helperById(id: BuiltinHelperId): HelperDefinition;
export function helperById(id: HelperId, custom?: readonly CustomHelper[]): HelperDefinition | undefined;
export function helperById(id: HelperId, custom: readonly CustomHelper[] = []): HelperDefinition | undefined {
  return helperCatalog(custom).find((helper) => helper.id === id);
}

export function helperAcceptsContextCount(helper: HelperDefinition, count: number): boolean {
  return count >= helper.minimumContexts && count <= helper.maximumContexts;
}

export function helperCommandId(id: HelperId): `helper-${HelperId}` {
  return `helper-${id}`;
}

export function helperIdFromCommand(value: string): HelperId | undefined {
  const id = value.startsWith("helper-") ? value.slice("helper-".length) : value;
  return isHelperId(id) ? id : undefined;
}

export function helperCommandLabel(helper: HelperDefinition, count: number): string {
  return count > 1 && helper.pluralCommandLabel ? helper.pluralCommandLabel : helper.commandLabel;
}

export function helperStarter(helper: HelperDefinition, count: number): string {
  return count > 1 && helper.pluralStarter ? helper.pluralStarter : helper.starter;
}
