export type ReplyContextIssue = {
  message: string;
  retryable: boolean;
};

export const REPLY_CONTEXT_RESTART_MESSAGE = "Restart HEY Agent to edit To, Cc, or Bcc. You can still reply using HEY's default recipients.";

export function replyContextIssue(reason: unknown): ReplyContextIssue {
  const detail = reason instanceof Error ? reason.message : String(reason ?? "");
  const boundaryMismatch = /getReplyContext is not a function|no handler registered.*mail:reply-context/i.test(detail);
  if (boundaryMismatch) return { message: REPLY_CONTEXT_RESTART_MESSAGE, retryable: false };
  return {
    message: "HEY couldn't load the reply recipients. You can still reply using HEY's default recipients.",
    retryable: true,
  };
}
