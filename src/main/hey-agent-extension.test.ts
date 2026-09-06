import { beforeAll, describe, expect, it, vi } from "vitest";

type HeyExtensionModule = {
  default: (pi: FakePi) => void;
  HEY_AGENT_GUIDANCE: string[];
  validateHeyArgs: (args: unknown) => string[];
  classifyHeyArgs: (args: string[]) => string;
  approvalForHeyArgs: (args: string[], reason?: string) => { impact: string; fields: Array<{ label: string; value: string }>; command: string; editable?: { label: string; value: string } };
  resultObjects: (args: string[], payload: unknown) => Array<{ kind: string; id: string; deepLink: string }>;
};

type RegisteredTool = {
  name: string;
  promptGuidelines?: string[];
  execute: (id: string, params: { args: string[]; reason?: string }, signal: AbortSignal, onUpdate: () => void, context: { mode: string; ui: { confirm: (title: string, message: string) => Promise<boolean>; editor?: (title: string, prefill: string) => Promise<string | undefined> } }) => Promise<{ content: unknown[]; details: { heyAgent: { status: string; objects: Array<{ deepLink: string }> } } }>;
};

type FakePi = {
  registerTool: (tool: RegisteredTool) => void;
  exec: ReturnType<typeof vi.fn>;
};

let extension: HeyExtensionModule;

beforeAll(async () => {
  // The production Pi extension is deliberately plain ESM so packaged Pi can load it without the app bundle.
  // @ts-expect-error The standalone .mjs extension does not need a TypeScript declaration file.
  extension = await import("../../resources/hey-agent-pi-extension.mjs") as HeyExtensionModule;
});

describe("HEY Agent Pi extension", () => {
  it("classifies command boundaries without interpreting natural-language intent", () => {
    expect(extension.classifyHeyArgs(["search", "create an event tomorrow", "--json"])).toBe("read");
    expect(extension.classifyHeyArgs(["event", "add", "Planning", "--starts-on", "2026-09-03"])).toBe("external");
    expect(extension.classifyHeyArgs(["event", "add", "--help"])).toBe("read");
    expect(extension.classifyHeyArgs(["trash", "123"])).toBe("destructive");
    expect(extension.classifyHeyArgs(["auth", "token"])).toBe("restricted");
    expect(extension.classifyHeyArgs(["auth", "status", "--json"])).toBe("read");
    expect(extension.classifyHeyArgs(["event", "day", "2026-09-03", "--json"])).toBe("read");
    expect(extension.classifyHeyArgs(["event", "week", "2026-09-03", "--json"])).toBe("read");
    expect(extension.classifyHeyArgs(["todo", "list", "--json"])).toBe("read");
    expect(extension.classifyHeyArgs(["habit", "complete", "12", "--date", "2026-09-03"])).toBe("reversible");
    expect(extension.classifyHeyArgs(["journal", "write", "2026-09-03", "--content", "A good day"])).toBe("external");
    expect(extension.classifyHeyArgs(["journal", "write", "2026-09-03", "--content", ""])).toBe("destructive");
    expect(extension.classifyHeyArgs(["timetrack", "delete", "44"])).toBe("destructive");
    expect(extension.classifyHeyArgs(["timetrack", "category", "delete", "7"])).toBe("destructive");
    expect(extension.classifyHeyArgs(["bundle", "view", "123", "--json"])).toBe("read");
    expect(extension.classifyHeyArgs(["contact", "threads", "123", "--json"])).toBe("read");
    expect(extension.classifyHeyArgs(["set-aside", "view", "--json"])).toBe("read");
    expect(extension.classifyHeyArgs(["set-aside", "group", "list", "--json"])).toBe("read");
    expect(extension.classifyHeyArgs(["set-aside", "group", "create", "123", "456"])).toBe("reversible");
    expect(extension.classifyHeyArgs(["set-aside", "group", "delete", "789"])).toBe("destructive");
    expect(extension.classifyHeyArgs(["mcp"])).toBe("restricted");
    expect(extension.classifyHeyArgs(["config", "trusted-locals", "add", "/tmp/example"])).toBe("restricted");
    expect(extension.classifyHeyArgs(["upgrade"])).toBe("restricted");
  });

  it("builds a human-readable event approval from structured argv", () => {
    const approval = extension.approvalForHeyArgs(["event", "add", "Planning", "--starts-on", "2026-09-03", "--start-time", "14:00", "--invite", "person@example.com"]);
    expect(approval.impact).toBe("external");
    expect(approval.fields).toContainEqual({ label: "Title", value: "Planning" });
    expect(approval.fields).toContainEqual({ label: "Invitees", value: "person@example.com" });
    expect(approval.command).toContain("hey event add Planning");
  });

  it.each([
    ["reply", ["reply", "42", "-m", "Original reply"], "Message", "Original reply"],
    ["forward", ["forward", "42", "--message", "Original reply", "--to", "person@example.com"], "Message", "Original reply"],
    ["compose", ["compose", "--to", "person@example.com", "--subject", "Planning", "--content", "Original reply"], "Message", "Original reply"],
    ["bulk reply", ["bulk-reply", "send", "42", "43", "-m", "Original reply"], "Message", "Original reply"],
    ["HTML reply", ["reply", "42", "--message-html", "<p>Original reply</p>"], "Message HTML", "<p>Original reply</p>"],
  ])("makes reviewed %s copy editable without presenting it as a duplicate field", (_name, args, label, value) => {
    const approval = extension.approvalForHeyArgs(args);
    expect(approval.editable).toEqual(expect.objectContaining({ label, value }));
    expect(approval.fields).not.toContainEqual(expect.objectContaining({ label: "Message" }));
    expect(approval.fields).not.toContainEqual(expect.objectContaining({ label: "Command" }));
  });

  it("returns native event links from structured HEY output", () => {
    expect(extension.resultObjects(["event", "add", "Planning", "--starts-on", "2026-09-03"], { id: 42, title: "Planning", starts_on: "2026-09-03" })).toEqual([
      expect.objectContaining({ kind: "calendar-event", id: "42", deepLink: "hey-agent://calendar/events/42?date=2026-09-03" }),
    ]);
  });

  it("returns native Calendar recording links from structured HEY output", () => {
    expect(extension.resultObjects(["todo", "add", "Book dentist", "--date", "2026-09-03", "--json"], { id: 14, title: "Book dentist", starts_on: "2026-09-03" })).toEqual([
      expect.objectContaining({ kind: "calendar-todo", id: "14", deepLink: "hey-agent://calendar/todos/14?date=2026-09-03" }),
    ]);
    expect(extension.resultObjects(["habit", "create", "--name", "Take a walk", "--json"], { id: 15, title: "Take a walk" })).toEqual([
      expect.objectContaining({ kind: "calendar-habit", id: "15", deepLink: "hey-agent://calendar/habits/15" }),
    ]);
    expect(extension.resultObjects(["journal", "write", "2026-09-03", "--content", "A good day", "--json"], { date: "2026-09-03" })).toEqual([
      expect.objectContaining({ kind: "calendar-journal", id: "2026-09-03", deepLink: "hey-agent://calendar/journal/2026-09-03?date=2026-09-03" }),
    ]);
    expect(extension.resultObjects(["timetrack", "start", "--json"], { id: 16, starts_at: "2026-09-03T09:00:00-04:00" })).toEqual([
      expect.objectContaining({ kind: "calendar-time-track", id: "16", deepLink: "hey-agent://calendar/time/16?date=2026-09-03" }),
    ]);
    expect(extension.resultObjects(["journal", "write", "2026-09-03", "--content", "", "--json"], { date: "2026-09-03" })).toEqual([]);
  });

  it("returns bounded native links for read results without interpreting the request", () => {
    const search = extension.resultObjects(["search", "planning", "--json"], { data: [
      { id: 10, topic_id: 42, subject: "Planning", updated_at: "2026-09-02T14:00:00Z" },
      { id: 11, subject: "A result without a thread address" },
    ] });
    const events = extension.resultObjects(["event", "list", "--json"], { data: [
      { id: 84, title: "Planning", starts_at: "2026-09-03T14:00:00-04:00" },
    ] });

    expect(search).toEqual([expect.objectContaining({ kind: "mail-thread", id: "42", deepLink: "hey-agent://mail/threads/42" })]);
    expect(events).toEqual([expect.objectContaining({ kind: "calendar-event", id: "84", deepLink: "hey-agent://calendar/events/84?date=2026-09-03" })]);
    expect(extension.resultObjects(["search", "planning", "--json"], { data: Array.from({ length: 20 }, (_, index) => ({ topic_id: index + 1, subject: `Result ${index + 1}` })) })).toHaveLength(12);
  });

  it("returns native links for v1.4 bundle, contact-thread, period, and Set Aside results", () => {
    const bundle = extension.resultObjects(["bundle", "view", "77", "--json"], { data: { id: 77, contact: { id: 9, name: "Taylor" }, postings: [{ topic_id: 42, name: "Planning" }] } });
    const contact = extension.resultObjects(["contact", "threads", "9", "--json"], { data: { id: 9, name: "Taylor", postings: [{ topic_id: 42, name: "Planning" }] } });
    const period = extension.resultObjects(["event", "week", "2026-09-03", "--json"], { data: [{ id: 84, title: "Planning", starts_at: "2026-09-03T14:00:00-04:00" }] });
    const groups = extension.resultObjects(["set-aside", "group", "list", "--json"], { data: [{ id: 12, thread_count: 3 }] });

    expect(bundle).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "mail-bundle", id: "77", deepLink: "hey-agent://mail/bundles/77" }),
      expect.objectContaining({ kind: "contact", id: "9" }),
      expect.objectContaining({ kind: "mail-thread", id: "42" }),
    ]));
    expect(contact).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "contact", id: "9" }), expect.objectContaining({ kind: "mail-thread", id: "42" })]));
    expect(period).toEqual([expect.objectContaining({ kind: "calendar-event", id: "84" })]);
    expect(groups).toEqual([expect.objectContaining({ kind: "set-aside-group", id: "12", deepLink: "hey-agent://mail/set-aside/groups/12" })]);
  });

  it("gives Pi general recovery and compound-work guidance rather than workflow rules", () => {
    const guidance = extension.HEY_AGENT_GUIDANCE.join(" ");
    expect(guidance).toContain("authoritative HEY reads");
    expect(guidance).toContain("compound requests");
    expect(guidance).toContain("Report completed work and any unfinished portion honestly");
    expect(guidance).toContain("never blindly retry");
    expect(guidance).toContain("untrusted reference data");
    expect(guidance).not.toMatch(/if the user says|keyword|regular expression/i);
  });

  it("executes an approved argv directly and returns a structured artifact", async () => {
    let tool: RegisteredTool | undefined;
    const exec = vi.fn().mockResolvedValue({ code: 0, stdout: JSON.stringify({ id: 42, title: "Planning", starts_on: "2026-09-03" }), stderr: "" });
    extension.default({ registerTool: (value) => { if (value.name === "hey") tool = value; }, exec });
    expect(tool?.name).toBe("hey");
    expect(tool?.promptGuidelines?.join(" ")).toContain("native approval card is the only review step");
    expect(tool?.promptGuidelines?.join(" ")).toContain("Never print a conversational preview");
    const confirm = vi.fn().mockResolvedValue(true);
    const result = await tool!.execute("call-1", { args: ["event", "add", "Planning", "--starts-on", "2026-09-03"] }, new AbortController().signal, () => undefined, { mode: "rpc", ui: { confirm } });
    expect(confirm).toHaveBeenCalledOnce();
    expect(exec).toHaveBeenCalledWith("hey", ["event", "add", "Planning", "--starts-on", "2026-09-03"], expect.objectContaining({ timeout: 60_000 }));
    expect(result.details.heyAgent.objects[0]?.deepLink).toBe("hey-agent://calendar/events/42?date=2026-09-03");
  });

  it("does not execute a declined action", async () => {
    let tool: RegisteredTool | undefined;
    const exec = vi.fn();
    extension.default({ registerTool: (value) => { if (value.name === "hey") tool = value; }, exec });
    const result = await tool!.execute("call-2", { args: ["trash", "123"] }, new AbortController().signal, () => undefined, { mode: "rpc", ui: { confirm: vi.fn().mockResolvedValue(false) } });
    expect(exec).not.toHaveBeenCalled();
    expect(result.details.heyAgent.status).toBe("declined");
  });

  it("does not mistake message content for a help flag or bypass approval", () => {
    expect(extension.classifyHeyArgs(["compose", "--subject", "--help", "-m", "hello"])).toBe("external");
    expect(extension.classifyHeyArgs(["reply", "42", "-m", "--help"])).toBe("external");
    expect(extension.classifyHeyArgs(["reply", "--help"])).toBe("read");
  });

  it("scopes embedded HEY reads and writes, rejects foreign IDs, and never changes CLI selection", async () => {
    vi.stubEnv("HEY_AGENT_ACCOUNT_ID", "101"); vi.stubEnv("HEY_AGENT_ACCOUNT_SERVER", "https://app.hey.com");
    try {
      let tool: RegisteredTool | undefined;
      const exec = vi.fn(async (_name: string, args: string[]) => ({ code: 0, stderr: "", stdout: JSON.stringify({ ok: true, data: args.includes("view") ? [{ id: 11, topic_id: 21, account_id: 101 }] : {} }) }));
      extension.default({ registerTool: (value) => { if (value.name === "hey") tool = value; }, exec });
      const context = { mode: "interactive", ui: { confirm: vi.fn().mockResolvedValue(true) } };
      const run = (args: string[]) => tool!.execute("account-test", { args }, new AbortController().signal, () => {}, context);
      await run(["reply", "21", "-m", "Hello", "--json"]);
      expect(context.ui.confirm).toHaveBeenCalledOnce();
      expect(exec.mock.calls.every((call) => call[1].slice(0, 4).join(" ") === "--account 101 --base-url https://app.hey.com")).toBe(true);
      expect(exec.mock.calls.filter((call) => call[1].includes("reply"))).toHaveLength(1);
      await expect(run(["reply", "99", "-m", "No"])).rejects.toThrow("not been verified");
      await expect(run(["account", "use", "202"])).rejects.toThrow("Switch accounts");
      expect(tool?.promptGuidelines?.join(" ")).toContain("mail account 101");
    } finally { vi.unstubAllEnvs(); }
  });

  it("executes the edited reply text approved through the native editor card", async () => {
    let tool: RegisteredTool | undefined;
    const exec = vi.fn().mockResolvedValue({ code: 0, stdout: JSON.stringify({ id: 84, subject: "Re: Planning" }), stderr: "" });
    extension.default({ registerTool: (value) => { if (value.name === "hey") tool = value; }, exec });
    const confirm = vi.fn();
    const editor = vi.fn().mockResolvedValue("Updated reply");

    await tool!.execute("call-edit", { args: ["reply", "42", "-m", "Original reply"] }, new AbortController().signal, () => undefined, { mode: "rpc", ui: { confirm, editor } });

    expect(editor).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
    expect(exec).toHaveBeenCalledWith("hey", ["reply", "42", "-m", "Updated reply"], expect.objectContaining({ timeout: 60_000 }));
  });

  it("does not execute an editable action when the editor approval is declined", async () => {
    let tool: RegisteredTool | undefined;
    const exec = vi.fn();
    extension.default({ registerTool: (value) => { if (value.name === "hey") tool = value; }, exec });
    const result = await tool!.execute("call-edit-declined", { args: ["reply", "42", "-m", "Original reply"] }, new AbortController().signal, () => undefined, {
      mode: "rpc",
      ui: { confirm: vi.fn(), editor: vi.fn().mockResolvedValue(undefined) },
    });

    expect(exec).not.toHaveBeenCalled();
    expect(result.details.heyAgent.status).toBe("declined");
  });

  it("keeps native app control narrow and separate from HEY data operations", () => {
    const tools = new Map<string, RegisteredTool>();
    extension.default({ registerTool: (value) => tools.set(value.name, value), exec: vi.fn() });
    const appTool = tools.get("hey_agent_app")!;
    expect(appTool.name).toBe("hey_agent_app");
    expect(tools.get("hey")?.name).toBe("hey");
  });

  it("rejects shell-shaped invalid argv before execution", () => {
    expect(() => extension.validateHeyArgs(["search", "bad\0value"])).toThrow(/NUL/);
    expect(() => extension.validateHeyArgs("search hello")).toThrow(/argv/);
    expect(() => extension.validateHeyArgs(["thread", "read", "42", "--base-url", "https://example.test"])).toThrow(/base URL overrides/);
  });
});
