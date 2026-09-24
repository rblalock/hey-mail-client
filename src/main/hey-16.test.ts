import { beforeEach, describe, expect, it, vi } from "vitest";
import { draftEditCommand, editDraft, parseDraftJson, parseThreadJson, sendMail } from "./hey";
import { parseThreadHtmlDocument } from "./email-html";
import { eventEditCommand, isCalendarEventUpdateRequest, parseCalendarWindow } from "./hey-calendar";
import { supportedHeyVersion } from "./runtime";
import { runFile, runFileWithInput } from "./profile-process";

vi.mock("./profile-process", () => ({ findExecutable: vi.fn(async () => "/synthetic/hey"), runFile: vi.fn(), runFileWithInput: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runFile).mockResolvedValue({ stdout: JSON.stringify({ data: { id: 12, body: "original" } }), stderr: "" });
  vi.mocked(runFileWithInput).mockResolvedValue({ stdout: JSON.stringify({ summary: "Sent" }), stderr: "" });
});

describe("HEY CLI 1.6 compatibility", () => {
  it("reads the new multiline header without swallowing recipients", () => {
    const parsed = parseThreadHtmlDocument('<article data-entry-id="1"><header><div>From: Alex — 2026-09-24T12:00:00Z</div><div>To: Casey &lt;casey@example.test&gt;</div></header><p>Hello</p></article>');
    expect(parsed.get("1")).toMatchObject({ senderName: "Alex", occurredAt: "2026-09-24T12:00:00Z" });
    expect(JSON.stringify(parsed.get("1"))).not.toContain("casey@example.test");
  });
  it("retains known-empty recipients and inbound delivery aliases separately", () => {
    const thread = parseThreadJson("9", JSON.stringify({ data: [{ id: 1, recipients: { to: [], cc: [], bcc: [] }, received_via: [{ email_address: "alex+demo@example.test" }] }, { id: 2 }] }));
    expect(thread.entries[0]).toMatchObject({ recipients: { to: [], cc: [], bcc: [] }, receivedVia: ["alex+demo@example.test"] });
    expect(thread.entries[1]?.recipients).toBeUndefined();
    expect(parseDraftJson(JSON.stringify({ data: { id: 1, from: "team@example.test" } })).from).toBe("team@example.test");
  });
  it("passes changed draft bodies explicitly even alongside other field flags", async () => {
    expect(draftEditCommand({ id: "12", subject: "Changed", body: "--account all" })).toEqual(["draft", "edit", "12", "--subject", "Changed", "--message", "--account all", "--json"]);
    await editDraft({ id: "12", subject: "Changed", body: "new body" });
    expect(vi.mocked(runFile).mock.calls.at(-1)?.[1]).toContain("--message");
    expect(runFileWithInput).not.toHaveBeenCalled();
  });
  it("preserves original HTML and attachments for unchanged bodies", async () => {
    vi.mocked(runFile).mockResolvedValue({ stdout: JSON.stringify({ data: { id: 12, body: "Hello\n📎 report.pdf" } }), stderr: "" });
    await editDraft({ id: "12", to: "casey@example.test", body: "Hello\n📎 report.pdf" });
    expect(vi.mocked(runFile).mock.calls.at(-1)?.[1]).toEqual(["draft", "edit", "12", "--to", "casey@example.test", "--json"]);
    await expect(editDraft({ id: "12", body: "new body" })).rejects.toThrow("preserve");
  });
  it("sends uploads with the selected sender and optional name tag exclusion", async () => {
    await sendMail({ mode: "compose", from: "team@example.test", noNameTag: true, to: "casey@example.test", subject: "Hello", body: "A paragraph", attachments: ["/synthetic/image.png"] });
    expect(vi.mocked(runFileWithInput).mock.calls[0]?.slice(1, 3)).toEqual([["compose", "--to", "casey@example.test", "--subject", "Hello", "--from", "team@example.test", "--no-name-tag", "--attach", "/synthetic/image.png", "--json"], "A paragraph"]);
    await expect(sendMail({ mode: "reply", topicId: "1", from: "team@example.test", body: "Hi", attachments: [] })).rejects.toThrow("new messages");
  });
  it("requires unambiguous recurring edit scope and an explicit future schedule", () => {
    const update = { id: "48", lookupDate: "2026-09-24", occurrenceId: "48_2026-09-24", applyTo: "current" as const, title: "Moved" };
    expect(isCalendarEventUpdateRequest(update)).toBe(true);
    expect(eventEditCommand(update)).toContain("--occurrence");
    expect(eventEditCommand(update)).not.toContain("--allow-plain-notes");
    expect(isCalendarEventUpdateRequest({ ...update, applyTo: "future" })).toBe(false);
    expect(isCalendarEventUpdateRequest({ ...update, repeat: "every_week" })).toBe(false);
    expect(isCalendarEventUpdateRequest({ ...update, applyTo: "future", repeat: "every_week" })).toBe(true);
    expect(isCalendarEventUpdateRequest({ ...update, occurrenceId: "49_2026-09-24" })).toBe(false);
    expect(isCalendarEventUpdateRequest({ ...update, countdown: 0 })).toBe(true);
  });
  it("keeps the series and realized recording IDs distinct", () => {
    const result = parseCalendarWindow('{"data":[]}', JSON.stringify({ data: [{ id: 50, parent_id: 48, recording_id: 50, occurrence_id: "48_2026-09-24", starts_at: "2026-09-24T12:00:00Z", ends_at: "2026-09-24T13:00:00Z" }] }), { startsOn: "2026-09-24", endsOn: "2026-09-24" });
    expect(result.events[0]).toMatchObject({ id: "50", seriesId: "48", recordingId: "50" });
  });
  it("detects outdated runtime versions", () => {
    expect(supportedHeyVersion("hey version 1.4.3")).toBe(false);
    expect(supportedHeyVersion("hey version 1.6.0")).toBe(true);
    expect(supportedHeyVersion("hey version 2.0.0")).toBe(true);
    expect(supportedHeyVersion("unknown")).toBe(false);
  });
});
