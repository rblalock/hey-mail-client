import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ThreadPanel from "./ThreadPanel";
import type { ImboxPosting, MailboxKey } from "../../../shared/contracts";
const noop = () => {};
const posting: ImboxPosting = { id: "1", topicId: "21", subject: "Example", summary: "", seen: true, createdAt: "", sender: { name: "Maya" }, contacts: [], visibleEntryCount: 1 };
describe("reader toggle presentation (static rendering only)", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("distinguishes Me and earlier messages, using addressing only on the matching latest entry", () => {
    vi.stubGlobal("window", { heyAgent: { profiles: { current: { active: { email: "alex@example.test" } } } } });
    const sender = { id: "7", name: "Alex", email: "alex@example.test", avatarUrl: "https://app.hey.com/avatars/alex.png" };
    const recipient = { name: "Maya", email: "maya@example.test" };
    const replyPosting = { ...posting, sender, contacts: [sender, recipient], addressedContacts: [recipient], visibleEntryCount: 2, createdAt: "2026-09-10T14:18:21Z" };
    const thread = { topicId: "21", subject: "Example", entries: [
      { id: "10", sender: recipient, occurredAt: "2026-09-10T13:55Z", body: "Can you confirm?" },
      { id: "11", sender: { id: "7", name: "Alex", email: "alex@example.test" }, occurredAt: "2026-09-10T14:18Z", body: "Confirmed" },
    ] };
    const $ = load(renderToStaticMarkup(<ThreadPanel posting={replyPosting} thread={thread} sourceLabel="Mail" onRefresh={noop} onRetryThread={noop} replyRequest={0} onClose={noop} onPrevious={noop} onNext={noop} hasPrevious={false} hasNext={false} />));
    expect($(".thread-history-label").text()).toBe("1 earlier message");
    expect($(".thread-entry[data-latest=true] .entry-sender strong").text()).toBe("Me");
    expect($(".thread-entry[data-latest=true] .entry-avatar img").attr("src")).toBe(sender.avatarUrl);
    expect($(".entry-recipient-summary").text()).toBe("→ Maya");
    expect($(".entry-recipient-details summary").text()).toBe("Recipients (1)");
    expect($(".entry-recipient-details li").text()).toBe("Maya <maya@example.test>");
    expect($(".thread-entry[data-latest=false] .entry-recipient-details")).toHaveLength(0);
    expect($("button.entry-disclosure").attr("aria-expanded")).toBe("false");
  });
  it.each([['asidebox', 'aside', 'Remove from Set Aside'], ['laterbox', 'later', 'Remove from Reply Later']] as const)("shows the active state in %s", (sourceBox: MailboxKey, id, label) => {
    const html = renderToStaticMarkup(<ThreadPanel posting={posting} sourceLabel="Mail" mailActions={{ sourceBox, onMutate: noop, onForward: noop, onMailChanged: noop }} onRefresh={noop} onRetryThread={noop} replyRequest={0} onClose={noop} onPrevious={noop} onNext={noop} hasPrevious={false} hasNext={false} />);
    const $ = load(html);
    const button = $(`.message-actions > button[data-shortcut-id=${id}]`);
    expect(button.attr("aria-pressed")).toBe("true");
    expect(button.attr("aria-label")).toBe(label);
    expect(button.attr("data-tooltip")).toBe(label);
    expect(button.attr("disabled")).toBeUndefined();
  });
});
