import { beforeEach, describe, expect, it, vi } from "vitest";
import { listMailbox, parseThreadJson, readThread, sendMail } from "./hey";
import { listCalendarWindow } from "./hey-calendar";
import { listCalendarTodos } from "./hey-calendar-recordings";
import { searchCalendar } from "./hey-calendar-search";
import { runFile, runFileWithInput } from "./profile-process";

vi.mock("./profile-process", () => ({ findExecutable: vi.fn(async () => "/synthetic/hey"), runFile: vi.fn(), runFileWithInput: vi.fn() }));
const response = (data: unknown) => ({ stdout: JSON.stringify({ ok: true, data }), stderr: "" });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runFileWithInput).mockResolvedValue(response({ id: 12 }));
});

describe("HEY CLI 1.7 compatibility", () => {
  it.each([[1, "unavailable"], [3, "needs-auth"]])("keeps mail and Calendar readers consistent for CLI exit %s", async (code, status) => {
    vi.mocked(runFile).mockRejectedValue(Object.assign(new Error("failed to load auth token"), { code }));
    const window = { startsOn: "2026-09-26", endsOn: "2026-09-26" };
    const results = await Promise.all([listMailbox("imbox"), listCalendarWindow(window), listCalendarTodos(window), searchCalendar({ query: "planning" })]);
    for (const result of results) expect(result.status).toBe(status);
  });
  it("sends the complete edited reply envelope once, without leaving an intermediate draft", async () => {
    await sendMail({ mode: "reply", topicId: "42", to: " person@example.test ", cc: "", bcc: "private@example.test", body: "A paragraph", attachments: ["/synthetic/image.png"] });
    expect(runFile).not.toHaveBeenCalled();
    expect(runFileWithInput).toHaveBeenCalledExactlyOnceWith("/synthetic/hey", ["reply", "42", "--replace-recipients", "--to", "person@example.test", "--bcc", "private@example.test", "--attach", "/synthetic/image.png", "--json"], "A paragraph", expect.anything());
  });
  it("saves exact reply recipients and attachments in a single draft call", async () => {
    const saved = await sendMail({ mode: "reply", topicId: "42", to: "", cc: "person@example.test", bcc: "", body: "Draft", attachments: ["/synthetic/report.pdf"], saveAsDraft: true });
    expect(saved).toMatchObject({ disposition: "draft", draftId: "12" });
    expect(runFileWithInput).toHaveBeenCalledExactlyOnceWith("/synthetic/hey", ["reply", "42", "--replace-recipients", "--cc", "person@example.test", "--attach", "/synthetic/report.pdf", "--draft", "--json"], "Draft", expect.anything());
    expect(runFile).not.toHaveBeenCalled();
  });
  it("leaves HEY's reply prefill alone when the user did not edit recipients", async () => {
    await sendMail({ mode: "reply", topicId: "42", body: "Thanks", attachments: [] });
    expect(runFileWithInput).toHaveBeenCalledExactlyOnceWith("/synthetic/hey", ["reply", "42", "--json"], "Thanks", expect.anything());
  });
  it("rejects an empty edited envelope before any mail operation", async () => {
    await expect(sendMail({ mode: "reply", topicId: "42", to: " ", cc: "", bcc: "", body: "Thanks", attachments: [] })).rejects.toThrow("At least one reply recipient");
    expect(runFile).not.toHaveBeenCalled();
    expect(runFileWithInput).not.toHaveBeenCalled();
  });
  it("uses the actual send-as sender rather than its account creator", () => {
    const thread = parseThreadJson("42", response({ entries: [{ id: 1, sender: { name: "Billing", email_address: "billing@example.test" }, creator: { name: "Owner", email_address: "owner@example.test" }, alternative_sender_name: "Owner" }] }).stdout);
    expect(thread.entries[0]?.sender).toEqual({ name: "Billing", email: "billing@example.test" });
    const addressOnly = parseThreadJson("42", response({ entries: [{ id: 1, sender: { name: "", email_address: "billing@example.test" }, creator: { name: "Owner" } }] }).stdout);
    expect(addressOnly.entries[0]?.sender).toEqual({ name: "billing@example.test", email: "billing@example.test" });
  });
  it("merges addressed HTML From headers without putting the address in the display name twice", async () => {
    vi.mocked(runFile).mockImplementation(async (_command, args) => {
      if (args[0] === "attachment") return response([]);
      if (args.includes("--html")) return { stdout: '<article data-entry-id="1"><header><div>From: Billing &lt;billing@example.test&gt; — 2026-09-26T12:00:00Z</div><div>To: Alex &lt;alex@example.test&gt;</div></header><p>Invoice</p></article>', stderr: "" };
      return response({ entries: [{ id: 1, sender: { name: "Billing", email_address: "billing@example.test" }, plain_text: "Invoice" }] });
    });
    expect((await readThread("42", process.env, { includeHtml: true })).entries[0]).toMatchObject({ sender: { name: "Billing", email: "billing@example.test" }, body: "Invoice" });
  });
});
