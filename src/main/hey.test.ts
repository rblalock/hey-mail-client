import { describe, expect, it } from "vitest";
import { bulkReplyPreviewCommand, bulkReplySendCommand, bulkReplyUndoCommand, libraryCommand, librarySourceCommand, mailboxCommand, mutationCommand, normalizeHeyTimestamp, organizationMutationCommand, organizationViewCommand, parseBulkReplyPreviewJson, parseBulkReplySendJson, parseContactJson, parseDraftJson, parseDraftListJson, parseImboxJson, parseLibraryJson, parseLibrarySourceJson, parseReplyContextJson, parseScreenerJson, parseSearchFiltersJson, parseSearchJson, parseThreadJson, parseThreadListingJson, readableText, replyContextCommand, searchCommand, setAsideGroupCommand, threadCommand, threadListingCommand } from "./hey";

describe("HEY JSON parsing", () => {
  it("keeps the outgoing creator's identity and the actual addressed contacts together", () => {
    const creator = { id: 1, name: "Alex Example", email_address: "alex@example.test", contactable_type: "User", initials: "AE", avatar_url: "https://app.hey.com/avatars/1.png" };
    const recipient = { id: 2, name: "Membership", email_address: "membership@example.test", initials: "M" };
    const result = parseImboxJson(JSON.stringify({ data: { postings: [{ id: 10, creator, alternative_sender_name: "Alex Example", contacts: [creator, recipient], addressed_contacts: [recipient] }] } }));
    expect(result.postings[0]?.sender).toMatchObject({ id: "1", email: "alex@example.test", initials: "AE", avatarUrl: creator.avatar_url });
    expect(result.postings[0]?.addressedContacts).toEqual([{ id: "2", name: "Membership", email: "membership@example.test", initials: "M" }]);
    expect(parseImboxJson(JSON.stringify({ data: { postings: [{ id: 10 }] } })).postings[0]?.addressedContacts).toBeUndefined();
  });
  it("preserves returned Bubble Up status without inferring it from a schedule", () => {
    const result = parseImboxJson(JSON.stringify({ data: { postings: [
      { id: 1, bubbled_up: true },
      { id: 2, bubbled_up: true, seen: true },
      { id: 3, bubbled_up: false },
      { id: 4, bubble_up_schedule: { date: "2020-01-01" } },
      { id: 5, bubbled_up: "true" },
      { id: 6 },
    ] } }));
    expect(result.postings.map((posting) => posting.bubbledUp)).toEqual([true, true, undefined, undefined, undefined, undefined]);
    expect(result.postings[1]?.seen).toBe(true);
  });

  it("preserves the distinct posting and topic IDs", () => {
    const result = parseImboxJson(JSON.stringify({
      ok: true,
      data: {
        name: "Imbox",
        postings: [{
          id: 12,
          topic_id: 34,
          app_url: "https://app.hey.com/topics/34",
          name: "Launch decision",
          summary: "One question remains.",
          seen: false,
          created_at: "2026-08-28T09:00:00Z",
          contacts: [{ id: 7, name: "Maya", email_address: "maya@example.com", avatar_url: "https://app.hey.com/avatars/7.svg", avatar_background_color: "#345678", initials: "M" }],
          visible_entry_count: 2,
        }],
      },
    }));

    expect(result.postings[0]).toMatchObject({
      id: "12",
      topicId: "34",
      appUrl: "https://app.hey.com/topics/34",
      subject: "Launch decision",
      contacts: [{ id: "7", name: "Maya", email: "maya@example.com", avatarUrl: "https://app.hey.com/avatars/7.svg", avatarBackgroundColor: "#345678", initials: "M" }],
      sender: { id: "7", name: "Maya", email: "maya@example.com", avatarUrl: "https://app.hey.com/avatars/7.svg", avatarBackgroundColor: "#345678", initials: "M" },
    });
    expect(result.boxKey).toBe("imbox");
  });

  it("loads complete mailbox listings rather than only the first cursor page", () => {
    expect(mailboxCommand("feedbox")).toEqual(["box", "view", "feedbox", "--all", "--json"]);
    expect(mailboxCommand("asidebox")).toEqual(["set-aside", "view", "--all", "--json"]);
  });

  it("preserves HEY bundle and Set Aside group identity on mailbox rows", () => {
    const result = parseImboxJson(JSON.stringify({ data: { postings: [{ id: 12, kind: "bundle", box_group_id: 41, name: "Updates", contacts: [{ id: 7, name: "Maya" }] }] } }), "asidebox");
    expect(result.postings[0]).toMatchObject({ id: "12", kind: "bundle", boxGroupId: "41" });
  });

  it("uses HEY's dedicated Bubble Up command instead of treating it as a box move", () => {
    expect(mutationCommand({ operation: "bubble", postingIds: ["12"], bubbleSchedule: "tomorrow" })).toEqual(["bubble", "up", "12", "--tomorrow", "--json"]);
    expect(mutationCommand({ operation: "bubble-pop", postingIds: ["12", "13"] })).toEqual(["bubble", "pop", "12", "13", "--json"]);
    expect(mutationCommand({ operation: "stop-ignoring", postingIds: ["12"] })).toEqual(["stop-ignoring", "12", "--json"]);
  });

  it("accepts HEY's array-shaped thread response", () => {
    const result = parseThreadJson("34", JSON.stringify({
      ok: true,
      data: [{
        id: 99,
        creator: { id: 7, name: "Maya", email_address: "maya@example.com" },
        created_at: "2026-08-28T09:00:00Z",
        body: "The body",
      }],
    }));

    expect(result).toMatchObject({
      topicId: "34",
      entries: [{ id: "99", sender: { name: "Maya" }, body: "The body" }],
    });
  });

  it("treats HEY's timezone-less timestamps as UTC", () => {
    expect(normalizeHeyTimestamp("2026-08-28T20:33")).toBe("2026-08-28T20:33Z");
    expect(normalizeHeyTimestamp("2026-08-28T20:33:00-04:00")).toBe("2026-08-28T20:33:00-04:00");
  });

  it("uses the external actor instead of the account owner for mailbox rows", () => {
    const result = parseImboxJson(JSON.stringify({ data: { postings: [{
      id: 12,
      name: "Pull request update",
      summary: "build-agent[bot] left a comment on the pull request",
      contacts: [
        { name: "Account Owner", email_address: "owner@example.com", contactable_type: "User" },
        { name: "Notification Relay", email_address: "notifications@example.com", contactable_type: "Service" },
      ],
    }] } }));
    expect(result.postings[0]?.sender).toMatchObject({ name: "build-agent[bot]", email: "notifications@example.com", kind: "Service" });
  });

  it("uses an invitation actor from the summary instead of a referenced contact", () => {
    const result = parseImboxJson(JSON.stringify({ data: { postings: [{
      id: 12,
      name: "You have an invitation",
      summary: "Taylor Example, Product lead is waiting for your response",
      contacts: [{ name: "Referenced Contact", email_address: "relay@example.com", contactable_type: "Person" }],
    }] } }));
    expect(result.postings[0]?.sender).toMatchObject({ name: "Taylor Example", email: "relay@example.com", kind: "Person" });
  });

  it("uses HEY's alternative sender for a thread entry even when its contact is a Person", () => {
    const result = parseThreadJson("34", JSON.stringify({ data: [{
      id: 99,
      creator: { name: "Referenced Contact", email_address: "relay@example.com", contactable_type: "Person" },
      alternative_sender_name: "Taylor Example",
      body: "The body",
    }] }));
    expect(result.entries[0]?.sender).toMatchObject({ name: "Taylor Example", email: "relay@example.com", kind: "Person" });
  });

  it("requests original HTML separately from the structured thread metadata", () => {
    expect(threadCommand("34")).toEqual(["thread", "read", "34", "--json"]);
    expect(threadCommand("34", "html")).toEqual(["thread", "read", "34", "--html"]);
  });

  it("turns escaped HTML and entities into readable plain text", () => {
    const anchor = String.raw`\<a href="https://x.com/benln/status/123?s=43&amp;t=token">https://x.com/benln/status/123?s=43&amp;t=token\</a>`;
    expect(readableText(`${anchor}\nSent from my iPhone`)).toBe("https://x.com/benln/status/123?s=43&t=token\nSent from my iPhone");

    const result = parseImboxJson(JSON.stringify({ data: { postings: [{
      id: 1,
      name: "Shared link",
      summary: anchor,
    }] } }));
    expect(result.postings[0]?.summary).toBe("https://x.com/benln/status/123?s=43&t=token");
  });

  it("preserves Markdown autolinks instead of mistaking them for HTML tags", () => {
    const result = parseThreadJson("34", JSON.stringify({ data: [{ id: 99, body: "<https://kody.video/>" }] }));
    expect(result.entries[0]?.body).toBe("https://kody.video/");
  });

  it("preserves HEY Markdown hard breaks in message bodies", () => {
    const result = parseThreadJson("34", JSON.stringify({ data: [{
      id: 99,
      body: "https://example.com/reference  \nAlex Example",
    }] }));
    expect(result.entries[0]?.body).toBe("https://example.com/reference  \nAlex Example");
  });

  it("normalizes HEY search results without confusing topic and posting IDs", () => {
    const result = parseSearchJson({ query: "launch", page: 2 }, JSON.stringify({ data: [{ id: 12, topic_id: 34, subject: "Launch", updated_at: "2026-08-28T10:00:00Z", messages: [{ sender: { name: "Maya", email_address: "maya@example.com" }, summary: "Ready" }] }], meta: { page: 2 } }));
    expect(result.postings[0]).toMatchObject({ id: "12", topicId: "34", subject: "Launch", summary: "Ready" });
    expect(result.page).toBe(2);
  });

  it("uses service actors in search results instead of the service account owner", () => {
    const result = parseSearchJson({ query: "automation" }, JSON.stringify({ data: [{
      id: 12,
      topic_id: 34,
      subject: "Repository update",
      messages: [
        {
          created_at: "2026-08-29T20:00:00Z",
          creator: { name: "Service Account", email_address: "notifications@example.com", contactable_type: "Service" },
          alternative_sender_name: "build-agent[bot]",
          summary: "Automated update ready",
        },
        {
          created_at: "2026-08-29T19:00:00Z",
          creator: { name: "Older Service Account", email_address: "notifications@example.com", contactable_type: "Service" },
          summary: "Earlier update",
        },
      ],
    }] }));
    expect(result.postings[0]).toMatchObject({
      sender: { name: "build-agent[bot]", email: "notifications@example.com", kind: "Service" },
      summary: "Automated update ready",
      createdAt: "2026-08-29T20:00:00Z",
    });
  });

  it("builds refined page-based searches without shell interpolation", () => {
    expect(searchCommand({ query: "launch plan", required: "timeline budget", any: "approve decide", none: "cancelled", exact: "final decision", from: "avery@example.com", to: "team@example.com", subject: "decision", date: "last_30_days", box: "imbox", label: "Project Alpha", attachment: "pdfs", page: 3 })).toEqual([
      "search", "launch plan", "--required", "timeline budget", "--any", "approve decide", "--none", "cancelled", "--exact", "final decision", "--from", "avery@example.com", "--to", "team@example.com", "--subject", "decision", "--date", "last_30_days", "--in", "imbox", "--label", "Project Alpha", "--attachment", "pdfs", "--page", "3", "--json",
    ]);
    expect(searchCommand({ from: "avery@example.com" })).toEqual(["search", "--from", "avery@example.com", "--json"]);
    expect(() => searchCommand({ query: "\ninvalid" })).toThrow("Invalid HEY search query");
  });

  it("normalizes HEY-provided search filter labels and values", () => {
    expect(parseSearchFiltersJson(JSON.stringify({ data: {
      boxes: [{ title: "Imbox", value: "imbox" }],
      dates: [{ title: "Last 7 days", value: "last_7_days" }],
      labels: [{ title: "Project", value: "Project" }],
      attachments: [{ title: "PDFs", value: "pdfs" }],
    } }))).toEqual({
      boxes: [{ title: "Imbox", value: "imbox" }],
      dates: [{ title: "Last 7 days", value: "last_7_days" }],
      labels: [{ title: "Project", value: "Project" }],
      attachments: [{ title: "PDFs", value: "pdfs" }],
    });
  });

  it("keeps label posting IDs and Collection topic IDs distinct", () => {
    expect(organizationViewCommand("labels", "41")).toEqual(["label", "view", "41", "--all", "--ids-only"]);
    expect(organizationViewCommand("collections", "52")).toEqual(["collection", "view", "52", "--all", "--quiet", "--jq", ".postings[].topic_id"]);
    expect(organizationMutationCommand({ kind: "labels", action: "add", postingIds: ["101", "102"], topicIds: ["201", "202"], targetId: "41" })).toEqual(["label", "add", "101", "102", "--to", "41", "--json"]);
    expect(organizationMutationCommand({ kind: "collections", action: "remove", postingIds: ["101", "102"], topicIds: ["201", "202"], targetId: "52" })).toEqual(["collection", "remove", "201", "202", "--from", "52", "--json"]);
    expect(organizationMutationCommand({ kind: "labels", action: "create", postingIds: ["101", "102"], topicIds: ["201", "202"], name: "Project Alpha" })).toEqual(["label", "create", "Project Alpha", "101", "102", "--json"]);
    expect(organizationMutationCommand({ kind: "collections", action: "create", postingIds: ["101", "102"], topicIds: ["201", "202"], name: "Project Alpha" })).toEqual(["collection", "create", "Project Alpha", "--json"]);
  });

  it("normalizes Screener IDs and actors through the same identity contract as mailboxes", () => {
    const result = parseScreenerJson(JSON.stringify({ data: [{
      id: 91,
      topic_id: 501,
      name: "Notification Relay",
      alternative_sender_name: "Taylor Example",
      email_address: "relay@example.com",
      subject: "Hello",
      summary: "Can we talk?",
    }] }));
    expect(result.entries[0]).toMatchObject({ id: "91", topicId: "501", sender: { name: "Taylor Example", email: "relay@example.com" }, subject: "Hello" });
  });

  it("normalizes contacts, labels, and collections into one library contract", () => {
    expect(parseLibraryJson("contacts", JSON.stringify({ data: [{ id: 7, name: "Maya", email_address: "maya@example.com", avatar_url: "https://app.hey.com/avatars/7.svg", initials: "M" }] })).items[0]).toEqual({
      id: "7",
      title: "Maya",
      subtitle: "maya@example.com",
      contact: { id: "7", name: "Maya", email: "maya@example.com", avatarUrl: "https://app.hey.com/avatars/7.svg", initials: "M" },
    });
    expect(parseLibraryJson("collections", JSON.stringify({ data: [{ id: 8, name: "Launch", summary: "Planning" }] })).items[0]).toEqual({ id: "8", title: "Launch", subtitle: "Planning" });
  });

  it("loads every page of contacts for Library and recipient suggestions", () => {
    expect(libraryCommand("contacts")).toEqual(["contact", "list", "--all", "--json"]);
  });

  it("loads a compact authoritative preview for labels and Collections", () => {
    expect(librarySourceCommand("labels", "7")).toEqual(["label", "view", "7", "--limit", "4", "--json"]);
    expect(librarySourceCommand("collections", "8")).toEqual(["collection", "view", "8", "--limit", "4", "--json"]);
    expect(parseLibrarySourceJson("labels", JSON.stringify({ data: {
      id: 7,
      name: "Launch",
      total_count: 5,
      next_page: "cursor-2",
      postings: [{ id: 12, topic_id: 34, name: "Launch decision", summary: "Ready", created_at: "2026-09-03T12:00:00Z", contacts: [{ name: "Maya" }] }],
    } }))).toMatchObject({ kind: "labels", id: "7", title: "Launch", totalCount: 5, nextPage: "cursor-2", postings: [{ id: "12", topicId: "34", subject: "Launch decision" }] });
  });

  it("normalizes contact details for the Library detail view", () => {
    expect(parseContactJson(JSON.stringify({ data: {
      id: 7,
      name: "Maya",
      email_address: "maya@example.com",
      avatar_url: "https://app.hey.com/avatars/7.svg",
      avatar_background_color: "#345678",
      initials: "M",
      aliases: [{ email_address: "m@example.org" }],
      note: "Met at Launch Week",
      clearance: { id: 91, status: "approved" },
      edit_app_url: "https://app.hey.com/contacts/7/edit",
      domain: { address: "example.com", app_url: "https://app.hey.com/domains/12" },
      updated_at: "2026-08-28T10:00:00Z",
    } }))).toEqual({
      id: "7",
      name: "Maya",
      email: "maya@example.com",
      avatarUrl: "https://app.hey.com/avatars/7.svg",
      avatarBackgroundColor: "#345678",
      initials: "M",
      aliases: ["m@example.org"],
      note: "Met at Launch Week",
      status: "approved",
      clearanceId: "91",
      domain: "example.com",
      editAppUrl: "https://app.hey.com/contacts/7/edit",
      domainAppUrl: "https://app.hey.com/domains/12",
      updatedAt: "2026-08-28T10:00:00Z",
    });
  });

  it("reads bundle and contact thread listings without changing HEY preferences", () => {
    expect(threadListingCommand("bundle", "77")).toEqual(["bundle", "view", "77", "--all", "--json"]);
    expect(threadListingCommand("contact", "9")).toEqual(["contact", "threads", "9", "--all", "--json"]);
    expect(parseThreadListingJson("bundle", JSON.stringify({ data: { contact: { id: 9, name: "Maya", email_address: "maya@example.com" }, postings: [{ id: 12, topic_id: 42, name: "Planning", contacts: [{ id: 9, name: "Maya" }] }] } }), "77")).toMatchObject({
      kind: "bundle", id: "77", title: "Unseen from Maya", contact: { id: "9", name: "Maya" }, postings: [{ id: "12", topicId: "42", subject: "Planning" }],
    });
    expect(parseThreadListingJson("contact", JSON.stringify({ data: { id: 9, name: "Maya", email_address: "maya@example.com", entries_title: "All threads with Maya", postings: [] } }))).toMatchObject({ kind: "contact", id: "9", title: "All threads with Maya", postings: [] });
  });

  it("builds exact Set Aside group commands with the correct identifier kinds", () => {
    expect(setAsideGroupCommand({ action: "create", postingIds: ["12", "13"] })).toEqual(["set-aside", "group", "create", "12", "13", "--json"]);
    expect(setAsideGroupCommand({ action: "add", postingIds: ["12"], groupId: "41" })).toEqual(["set-aside", "group", "add", "12", "--to", "41", "--json"]);
    expect(setAsideGroupCommand({ action: "remove", postingIds: ["12"] })).toEqual(["set-aside", "group", "remove", "12", "--json"]);
    expect(setAsideGroupCommand({ action: "delete", groupId: "41" })).toEqual(["set-aside", "group", "delete", "41", "--json"]);
  });

  it("normalizes draft lists and editable draft content", () => {
    expect(parseDraftListJson(JSON.stringify({ data: [{ id: 4, subject: "Launch", to: [{ email_address: "maya@example.com" }], updated_at: "2026-08-28T10:00:00Z" }] }))[0]).toMatchObject({ id: "4", subject: "Launch", to: "maya@example.com" });
    expect(parseDraftJson(JSON.stringify({ data: { id: 4, subject: "Launch", body: "Ready" } }))).toMatchObject({ id: "4", body: "Ready" });
  });

  it("loads the TUI-equivalent reply recipient preview by posting ID", () => {
    expect(replyContextCommand("1238421187")).toEqual(["bulk-reply", "preview", "1238421187", "--json"]);
    expect(parseReplyContextJson(JSON.stringify({ data: [{
      to: [{ id: 1, name: "Alex Example", email_address: "alex@example.com" }],
      cc: [{ id: 2, name: "Casey Example", email_address: "casey@example.com" }],
      bcc: [],
    }] }))).toEqual({
      to: [{ id: "1", name: "Alex Example", email: "alex@example.com" }],
      cc: [{ id: "2", name: "Casey Example", email: "casey@example.com" }],
      bcc: [],
    });
  });

  it("previews every selected conversation by posting ID with exact recipients", () => {
    expect(bulkReplyPreviewCommand(["101", "202"])).toEqual(["bulk-reply", "preview", "101", "202", "--json"]);
    expect(parseBulkReplyPreviewJson(["101", "202"], JSON.stringify({ data: [
      {
        id: 501,
        topic_id: 601,
        topic_name: "First decision",
        to: [{ id: 1, name: "Example Recipient One", email_address: "one@example.com" }],
        cc: [{ id: 2, name: "Example Recipient Two", email_address: "two@example.com" }],
        bcc: [],
      },
      {
        id: 502,
        topic_id: 602,
        topic_name: "Second decision",
        to: [{ id: 3, name: "Example Recipient Three", email_address: "three@example.com" }],
        cc: [],
        bcc: [{ id: 4, name: "Example Recipient Four", email_address: "four@example.com" }],
      },
    ] }))).toEqual({
      postingIds: ["101", "202"],
      items: [
        {
          entryId: "501",
          topicId: "601",
          subject: "First decision",
          to: [{ id: "1", name: "Example Recipient One", email: "one@example.com" }],
          cc: [{ id: "2", name: "Example Recipient Two", email: "two@example.com" }],
          bcc: [],
        },
        {
          entryId: "502",
          topicId: "602",
          subject: "Second decision",
          to: [{ id: "3", name: "Example Recipient Three", email: "three@example.com" }],
          cc: [],
          bcc: [{ id: "4", name: "Example Recipient Four", email: "four@example.com" }],
        },
      ],
    });
  });

  it("pipes one message to HEY bulk reply and preserves the delayed undo ID", () => {
    expect(bulkReplySendCommand({ postingIds: ["101", "202"], body: "Thanks for the update.", attachments: ["/tmp/report.pdf"] })).toEqual([
      "bulk-reply", "send", "101", "202", "--attach", "/tmp/report.pdf", "--json",
    ]);
    expect(parseBulkReplySendJson(JSON.stringify({ summary: "2 replies queued.", data: { reply_count: 2, bulk_reply_id: 98765, delayed: true } }))).toEqual({
      message: "2 replies queued.",
      replyCount: 2,
      deliveryId: "98765",
      delayed: true,
    });
    expect(bulkReplyUndoCommand("98765")).toEqual(["bulk-reply", "undo", "98765", "--json"]);
  });

  it("rejects duplicate or single-conversation bulk sends", () => {
    expect(() => bulkReplyPreviewCommand(["101", "101"])).toThrow("Invalid HEY posting selection");
    expect(() => bulkReplySendCommand({ postingIds: ["101"], body: "Hello", attachments: [] })).toThrow("Select at least two HEY conversations");
  });
});
