import type { AgentThreadAttachment, ImboxPosting, MailboxKey } from "../../shared/contracts";
import type { ShortcutDefinition } from "./shortcuts";

export const MAX_CONTEXTUAL_MAIL_ATTACHMENTS = 25;

export function attachmentForPosting(posting?: ImboxPosting, mailbox?: MailboxKey): AgentThreadAttachment | undefined {
  if (!posting?.topicId) return undefined;
  return {
    kind: "hey-thread",
    id: posting.topicId,
    title: posting.subject,
    subtitle: posting.sender.name,
    ...(mailbox ? { sourceBox: mailbox } : {}),
  };
}

export function attachmentsForPostings(postings: ImboxPosting[], mailbox?: MailboxKey): AgentThreadAttachment[] {
  const attachments = postings.map((posting) => attachmentForPosting(posting, mailbox)).filter((item): item is AgentThreadAttachment => Boolean(item));
  return [...new Map(attachments.map((attachment) => [attachment.id, attachment])).values()];
}

export function unattachedMailContext(attachments: AgentThreadAttachment[], attached: Array<{ kind: string; id: string }>): AgentThreadAttachment[] {
  const keys = new Set(attached.map((attachment) => `${attachment.kind}:${attachment.id}`));
  return attachments.filter((attachment) => !keys.has(`${attachment.kind}:${attachment.id}`));
}

export function contextualAgentCommands(count: number, hasActiveSession: boolean, allAttached: boolean): ShortcutDefinition[] {
  if (count < 1) return [];
  const plural = count > 1;
  const subject = plural ? `${count} conversations` : "this conversation";
  const commands: ShortcutDefinition[] = [];

  if (hasActiveSession && allAttached) commands.push({ id: "agent-focus-context", label: `Ask HEY Agent about ${subject}`, keys: [], display: "", scope: "agent-context" });
  commands.push({ id: "agent-start-context", label: `Start new chat with ${subject}`, keys: [], display: "", scope: "agent-context" });
  if (hasActiveSession && !allAttached) commands.push({ id: "agent-add-context", label: `Add ${subject} to current chat`, keys: [], display: "", scope: "agent-context" });
  if (plural) {
    commands.push({ id: "agent-summarize-selection", label: `Summarize ${subject}`, keys: [], display: "", scope: "agent-context" });
    commands.push({ id: "agent-replies-selection", label: `Find what needs a reply in ${subject}`, keys: [], display: "", scope: "agent-context" });
  }
  return commands;
}

export function contextualAgentPrompt(id: "agent-summarize-selection" | "agent-replies-selection", count: number): string {
  if (id === "agent-summarize-selection") return `Summarize the ${count} attached HEY conversations. Call out decisions, commitments, dates, and open questions.`;
  return `Review the ${count} attached HEY conversations. Identify which ones need a reply, why, and the next step for each. Do not send or modify anything.`;
}

export function continueReplyPrompt(draft: string): string {
  const trimmed = draft.trim();
  return trimmed
    ? `Help me finish this reply to the attached HEY conversation. Preserve my intent and do not send it.\n\nCurrent draft:\n${trimmed}`
    : "Help me draft a reply to the attached HEY conversation. Do not send it.";
}
