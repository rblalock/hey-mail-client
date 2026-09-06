import type { AgentAttachment, AgentThreadAttachment, MailboxKey } from "../../shared/contracts";

export type AgentStarter = {
  label: string;
  prompt: string;
};

function conversationTitle(attachment: AgentAttachment): string {
  return attachment.title.trim() || "the attached conversation";
}

function forConversation(request: string, attachment: AgentAttachment): string {
  return `${request} for the attached HEY conversation “${conversationTitle(attachment)}”.`;
}

function replyStarter(attachment: AgentThreadAttachment): AgentStarter {
  const recipient = attachment.subtitle?.trim();
  return {
    label: recipient ? `Draft a reply to ${recipient}` : "Draft a reply",
    prompt: forConversation(recipient ? `Draft a concise reply to ${recipient}` : "Draft a concise reply", attachment),
  };
}

function singleConversationStarters(attachment: AgentThreadAttachment, mailbox?: MailboxKey): AgentStarter[] {
  if (mailbox === "feedbox") {
    return [
      { label: "Give me the key points", prompt: forConversation("Give me the key points", attachment) },
      { label: "What is worth remembering?", prompt: forConversation("Tell me what is worth remembering", attachment) },
      { label: "Turn this into next steps", prompt: forConversation("Turn the useful ideas into practical next steps", attachment) },
    ];
  }
  if (mailbox === "trailbox") {
    return [
      { label: "Summarize the important details", prompt: forConversation("Summarize the important details", attachment) },
      { label: "Pull out dates and references", prompt: forConversation("Pull out the dates, amounts, and reference numbers", attachment) },
      { label: "What should I keep track of?", prompt: forConversation("Tell me what I should keep track of", attachment) },
    ];
  }
  if (mailbox === "asidebox") {
    return [
      { label: "Summarize this for later", prompt: forConversation("Summarize this so I can return to it later", attachment) },
      { label: "Pull out what matters", prompt: forConversation("Pull out the details that matter", attachment) },
      { label: "Make this actionable", prompt: forConversation("Help me turn this into something actionable", attachment) },
    ];
  }
  if (mailbox === "bubblebox") {
    return [
      { label: "Catch me up", prompt: forConversation("Catch me up", attachment) },
      { label: "What changed?", prompt: forConversation("Tell me what changed and what remains unresolved", attachment) },
      { label: "Help me choose the next step", prompt: forConversation("Help me choose the next step", attachment) },
    ];
  }
  if (mailbox === "laterbox") {
    return [
      { label: "Remind me what needs a reply", prompt: forConversation("Remind me what needs a reply", attachment) },
      { label: "Show me the unresolved points", prompt: forConversation("Show me the unresolved points", attachment) },
      replyStarter(attachment),
    ];
  }
  return [
    { label: "Catch me up", prompt: forConversation("Catch me up", attachment) },
    { label: "What needs my attention?", prompt: forConversation("Tell me what needs my attention or response", attachment) },
    replyStarter(attachment),
  ];
}

export function agentStarters(attachments: AgentAttachment[], mailbox?: MailboxKey): AgentStarter[] {
  if (attachments.length === 0) return [];
  const onlyAttachment = attachments.length === 1 ? attachments[0]! : undefined;
  if (onlyAttachment?.kind === "hey-object") return [
    { label: `Open ${onlyAttachment.title}`, prompt: `Open the attached ${onlyAttachment.objectKind.replaceAll("-", " ")} in HEY Agent.` },
    { label: "Tell me about this", prompt: `Tell me about the attached ${onlyAttachment.objectKind.replaceAll("-", " ")} using authoritative HEY data.` },
    { label: "What can I do with it?", prompt: `What useful HEY actions can you perform on the attached ${onlyAttachment.objectKind.replaceAll("-", " ")}?` },
  ];
  if (onlyAttachment?.kind === "hey-thread") return singleConversationStarters(onlyAttachment, mailbox ?? onlyAttachment.sourceBox);
  if (onlyAttachment?.kind === "local-file") return [
    { label: "Summarize this file", prompt: `Read the attached local file “${conversationTitle(onlyAttachment)}” and summarize it.` },
    { label: "Find the key details", prompt: `Read the attached local file “${conversationTitle(onlyAttachment)}” and pull out its key details.` },
    { label: "Help me work with this", prompt: `Read the attached local file “${conversationTitle(onlyAttachment)}” and help me work with it.` },
  ];
  if (onlyAttachment?.kind === "local-selection") return [
    { label: "Summarize this selection", prompt: "Summarize the attached selected text." },
    { label: "Pull out action items", prompt: "Pull out any useful action items from the attached selected text." },
    { label: "Help me work with this", prompt: "Help me work with the attached selected text." },
  ];
  const count = attachments.length;
  if (attachments.every((attachment) => attachment.kind === "hey-thread")) return [
    { label: `Summarize these ${count} conversations`, prompt: `Summarize the ${count} attached HEY conversations.` },
    { label: "Find decisions and open questions", prompt: `Find the decisions and open questions across the ${count} attached HEY conversations.` },
    { label: "Help me work through the replies", prompt: `Help me work through the replies needed across the ${count} attached HEY conversations.` },
  ];
  return [
    { label: `Summarize these ${count} items`, prompt: `Summarize the ${count} attached items.` },
    { label: "Find decisions and open questions", prompt: `Find the decisions and open questions across the ${count} attached items.` },
    { label: "Help me work with these", prompt: `Help me work with the ${count} attached items.` },
  ];
}
