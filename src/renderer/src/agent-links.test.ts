import { describe, expect, it } from "vitest";
import { emailAddressFromMailto, nativeAgentObjectFromHref, safeAgentMarkdownUrl } from "./agent-links";

describe("agent links", () => {
  it("opens canonical HEY topic URLs as native mail conversations", () => {
    expect(nativeAgentObjectFromHref("https://app.hey.com/topics/2116329294", "Open the email in HEY")).toEqual({
      kind: "mail-thread",
      id: "2116329294",
      title: "Open the email in HEY",
      deepLink: "hey-agent://mail/threads/2116329294",
    });
  });

  it("accepts native object links and preserves their date", () => {
    expect(nativeAgentObjectFromHref("hey-agent://calendar/events/42?date=2026-09-03", "Planning")).toEqual({
      kind: "calendar-event",
      id: "42",
      title: "Planning",
      deepLink: "hey-agent://calendar/events/42?date=2026-09-03",
    });
    expect(safeAgentMarkdownUrl("hey-agent://calendar/events/42?date=2026-09-03")).toBe("hey-agent://calendar/events/42?date=2026-09-03");
    expect(nativeAgentObjectFromHref("hey-agent://calendar/dates/2026-09-03", "Thursday")).toEqual({
      kind: "calendar-date",
      id: "2026-09-03",
      title: "Thursday",
      deepLink: "hey-agent://calendar/dates/2026-09-03",
    });
  });

  it("normalizes concise Pi links to canonical native routes", () => {
    expect(nativeAgentObjectFromHref("hey-agent://contacts/216337717", "Rick Blalock")).toEqual({
      kind: "contact",
      id: "216337717",
      title: "Rick Blalock",
      deepLink: "hey-agent://mail/contacts/216337717",
    });
    expect(nativeAgentObjectFromHref("hey-agent://threads/2116329294", "Conversation")).toEqual({
      kind: "mail-thread",
      id: "2116329294",
      title: "Conversation",
      deepLink: "hey-agent://mail/threads/2116329294",
    });
  });

  it("leaves unrelated HEY pages external and rejects unsafe schemes", () => {
    expect(nativeAgentObjectFromHref("https://app.hey.com/settings")).toBeUndefined();
    expect(safeAgentMarkdownUrl("https://app.hey.com/settings")).toBe("https://app.hey.com/settings");
    expect(safeAgentMarkdownUrl("javascript:alert(1)")).toBe("");
  });

  it("extracts one address from a mailto link for contact resolution", () => {
    expect(emailAddressFromMailto("mailto:alex%40example.com")).toBe("alex@example.com");
    expect(emailAddressFromMailto("mailto:one@example.com,two@example.com")).toBeUndefined();
    expect(emailAddressFromMailto("https://example.com")).toBeUndefined();
  });
});
