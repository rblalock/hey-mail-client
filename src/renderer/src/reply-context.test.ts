import { describe, expect, it } from "vitest";
import { REPLY_CONTEXT_RESTART_MESSAGE, replyContextIssue } from "./reply-context";

describe("reply recipient capability errors", () => {
  it("turns a stale preload method into a restart instruction", () => {
    expect(replyContextIssue(new TypeError("window.heyAgent.mail.getReplyContext is not a function"))).toEqual({
      message: REPLY_CONTEXT_RESTART_MESSAGE,
      retryable: false,
    });
  });

  it("turns a stale main-process handler into a restart instruction", () => {
    expect(replyContextIssue(new Error("No handler registered for 'mail:reply-context'"))).toEqual({
      message: REPLY_CONTEXT_RESTART_MESSAGE,
      retryable: false,
    });
  });

  it("keeps ordinary recipient lookup failures retryable without exposing internals", () => {
    expect(replyContextIssue(new Error("request failed with private diagnostic details"))).toEqual({
      message: "HEY couldn't load the reply recipients. You can still reply using HEY's default recipients.",
      retryable: true,
    });
  });
});
