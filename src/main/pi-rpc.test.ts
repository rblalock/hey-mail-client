import { describe, expect, it, vi } from "vitest";
import { buildPiRpcArgs, HEY_AGENT_SYSTEM_PROMPT, JsonLineDecoder, parseHeyAppAction, parseHeyApproval, parseHeyArtifact, PiRpcSession } from "./pi-rpc";

describe("Pi JSONL decoding", () => {
  it("splits only on LF and preserves Unicode line separators", () => {
    const decoder = new JsonLineDecoder();
    const source = '{"text":"one\u2028two\u2029three"}\n{"text":"four"}\n';
    const bytes = Buffer.from(source);
    const lines = [
      ...decoder.push(bytes.subarray(0, 17)),
      ...decoder.push(bytes.subarray(17)),
      ...decoder.end(),
    ];
    expect(lines).toEqual(['{"text":"one\u2028two\u2029three"}', '{"text":"four"}']);
  });
});

describe("Pi Helper startup", () => {
  it("sends thread references through RPC without starting Pi or reading email bodies", async () => {
    const session = new PiRpcSession({ id: "refs", title: "Chat", workingDirectory: "/synthetic", attachments: [
      { kind: "hey-thread", id: "42", title: "Planning", subtitle: "Maya" },
      { kind: "hey-thread", id: "43", title: "Budget", subtitle: "Robin" },
    ] });
    const internals = session as unknown as { ensureStarted(): Promise<void>; request(value: Record<string, unknown>): Promise<Record<string, unknown>>; persist(): Promise<void> };
    vi.spyOn(internals, "ensureStarted").mockResolvedValue();
    vi.spyOn(internals, "persist").mockResolvedValue();
    const request = vi.spyOn(internals, "request").mockResolvedValue({});
    await session.send("Compare them");
    const prompt = request.mock.calls.find(([value]) => value.type === "prompt")?.[0].message;
    expect(prompt).toContain('"topic_id":"42"');
    expect(prompt).toContain('"topic_id":"43"');
    expect(prompt).toContain("references only, not message bodies");
    expect(session.peekSnapshot().timeline[0]).toMatchObject({ role: "user", text: "Compare them" });
  });
  it("injects captured personal instructions as one argument, preserving normal Pi tools and approvals", () => {
    const instructions = "Summarize in two bullets.\nLiteral text: --tools bash; $(not-a-command)";
    const args = buildPiRpcArgs({ helperInstructions: { title: "Project notes", instructions }, extensionPath: "/app/hey-agent-pi-extension.mjs", modelProfile: { model: { provider: "openai", modelId: "fast" }, thinking: "low" } }, "/sessions/existing.jsonl");
    expect(args[3]).toContain(HEY_AGENT_SYSTEM_PROMPT);
    expect(args[3]).toContain(`Active Helper: Project notes\n${instructions}`);
    expect(args[3]).toContain("do not grant new permissions");
    expect(args).not.toContain("--tools");
    expect(args).not.toContain("--no-tools");
    expect(args).not.toContain("--skill");
    expect(args.slice(4)).toEqual(["--provider", "openai", "--model", "fast", "--thinking", "low", "--extension", "/app/hey-agent-pi-extension.mjs", "--session", "/sessions/existing.jsonl"]);
  });

  it("retains personal identity even before Pi connects and refuses missing instructions", async () => {
    const helperInstructions = { title: "Project notes", instructions: "Summarize only decisions." };
    const session = new PiRpcSession({ id: "personal", title: "Project notes", workingDirectory: "/tmp/synthetic", helperId: "custom-project", helperInstructions });
    helperInstructions.instructions = "Changed outside this session.";
    expect(session.peekSnapshot().helperInstructions?.instructions).toBe("Summarize only decisions.");
    const missing = new PiRpcSession({ id: "missing", title: "Project notes", workingDirectory: "/tmp/synthetic", helperId: "custom-project" });
    await expect(missing.getSnapshot()).rejects.toThrow("Helper instructions are unavailable");
  });
  it("adds one explicit skill without disabling Pi's normal skill discovery", () => {
    expect(buildPiRpcArgs({
      extensionPath: "/app/hey-agent-pi-extension.mjs",
      skillPath: "/app/helpers/meeting-prep",
      modelProfile: { thinking: "low" },
    })).toEqual(["--mode", "rpc", "--system-prompt", HEY_AGENT_SYSTEM_PROMPT, "--thinking", "low", "--extension", "/app/hey-agent-pi-extension.mjs", "--skill", "/app/helpers/meeting-prep"]);
    expect(HEY_AGENT_SYSTEM_PROMPT).toContain("Do not assume the user is asking about a repository");
    expect(HEY_AGENT_SYSTEM_PROMPT).toContain("read it before answering");
    expect(HEY_AGENT_SYSTEM_PROMPT).toContain("hey-agent://mail/threads/ID");
    expect(HEY_AGENT_SYSTEM_PROMPT).toContain("hey-agent://mail/contacts/ID");
    expect(HEY_AGENT_SYSTEM_PROMPT).toContain("hey-agent://calendar/events/ID?date=YYYY-MM-DD");
    expect(HEY_AGENT_SYSTEM_PROMPT).toContain("hey-agent://calendar/dates/YYYY-MM-DD");
    expect(HEY_AGENT_SYSTEM_PROMPT).toContain("email address to the same native contact URL instead of mailto");
    expect(HEY_AGENT_SYSTEM_PROMPT).toContain("never invent an object ID");
  });

  it("shows the user's request while Pi is still starting", async () => {
    const session = new PiRpcSession({
      id: "helper-session",
      title: "Reply Coach · Launch review",
      workingDirectory: "/tmp/hey-agent-test",
      helperId: "reply-coach",
      env: { HOME: "", PATH: "" },
    });


    const pending = session.send("Write the reply");
    const snapshot = session.peekSnapshot();

    expect(snapshot.status).toBe("starting");
    expect(snapshot.timeline).toMatchObject([
      { kind: "message", role: "user", text: "Write the reply" },
      { kind: "run", state: "running", tools: [] },
    ]);
    await expect(pending).rejects.toThrow("Pi is not installed");
  });
});

describe("Pi HEY extension contracts", () => {
  it("parses a native object artifact and rejects external links", () => {
    expect(parseHeyArtifact({ details: { heyAgent: {
      version: 1,
      status: "complete",
      impact: "external",
      operation: "event add",
      summary: "Planning was added.",
      refresh: ["calendar", "unknown"],
      objects: [
        { kind: "calendar-event", id: "42", title: "Planning", deepLink: "hey-agent://calendar/events/42" },
        { kind: "calendar-habit", id: "12", title: "Take a walk", deepLink: "hey-agent://calendar/habits/12" },
        { kind: "mail-bundle", id: "77", title: "Maya bundle", deepLink: "hey-agent://mail/bundles/77" },
        { kind: "set-aside-group", id: "9", title: "Set Aside group", deepLink: "hey-agent://mail/set-aside/groups/9" },
        { kind: "calendar-event", id: "43", title: "Bad", deepLink: "https://example.com" },
      ],
    } } })).toEqual(expect.objectContaining({
      summary: "Planning was added.",
      refresh: ["calendar"],
      objects: [
        { kind: "calendar-event", id: "42", title: "Planning", deepLink: "hey-agent://calendar/events/42" },
        { kind: "calendar-habit", id: "12", title: "Take a walk", deepLink: "hey-agent://calendar/habits/12" },
        { kind: "mail-bundle", id: "77", title: "Maya bundle", deepLink: "hey-agent://mail/bundles/77" },
        { kind: "set-aside-group", id: "9", title: "Set Aside group", deepLink: "hey-agent://mail/set-aside/groups/9" },
      ],
    }));
  });

  it("extracts structured approval fields without showing the machine marker", () => {
    const approval = { version: 1, impact: "external", title: "Review HEY action", summary: "Create Planning?", fields: [{ label: "Date", value: "2026-09-03" }], command: "hey event add Planning" };
    const encoded = Buffer.from(JSON.stringify(approval)).toString("base64url");
    expect(parseHeyApproval(`Create Planning?\n\n__HEY_AGENT_APPROVAL_V1__${encoded}`)).toEqual({ message: "Create Planning?", approval });
  });

  it("extracts an editable approval from an editor prefill", () => {
    const approval = {
      version: 1,
      impact: "external",
      title: "Review HEY action",
      summary: "Reply to the conversation.",
      fields: [{ label: "Thread", value: "42" }],
      command: 'hey reply 42 -m "Original reply"',
      editable: { label: "Message", value: "Original reply", commandPrefix: "hey reply 42 -m ", commandSuffix: "", required: true },
    };
    const encoded = Buffer.from(JSON.stringify(approval)).toString("base64url");
    expect(parseHeyApproval(`Original reply\n\n__HEY_AGENT_APPROVAL_V1__${encoded}`)).toEqual({ message: "Original reply", approval });
  });

  it("parses only supported app presentation actions", () => {
    expect(parseHeyAppAction({ details: { heyAgentApp: { version: 1, action: "navigate", target: "calendar", summary: "Open calendar." } } })).toEqual({ version: 1, action: "navigate", target: "calendar", summary: "Open calendar." });
    expect(parseHeyAppAction({ details: { heyAgentApp: { version: 1, action: "attach-current-email", target: "current", summary: "Attach current." } } })).toEqual({ version: 1, action: "attach-current-email", target: "current", summary: "Attach current." });
    expect(parseHeyAppAction({ details: { heyAgentApp: { version: 1, action: "click", target: "#send", summary: "Click." } } })).toBeUndefined();
  });
});
