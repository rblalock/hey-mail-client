import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ChatStore } from "./chat-store";

describe("ChatStore", () => {
  it("round-trips captured instructions and drops malformed instruction payloads", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hey-agent-chat-store-"));
    try {
      const file = join(directory, "workspace.json");
      const store = new ChatStore(file);
      const link = { id: "personal", title: "Project notes", helperId: "custom-project" as const, helperInstructions: { title: "Project notes", instructions: "Summarize decisions." }, topicIds: [], attachments: [], workingDirectory: directory, updatedAt: "2026-09-04T12:00:00Z" };
      await store.upsert(link);
      expect((await new ChatStore(file).list())[0]).toMatchObject({ helperId: link.helperId, helperInstructions: link.helperInstructions });
      await store.upsert({ ...link, helperInstructions: { ...link.helperInstructions, instructions: "bad\0data" } });
      expect((await store.list())[0]?.helperInstructions).toBeUndefined();
      expect((await store.list())[0]?.helperId).toBe("custom-project");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("persists the reversible archived session marker", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hey-agent-chat-store-"));
    try {
      const store = new ChatStore(join(directory, "workspace.json"));
      await store.upsert({
        id: "synthetic-session",
        title: "Project notes",
        topicIds: [],
        attachments: [],
        workingDirectory: "/tmp/synthetic-workspace",
        updatedAt: "2026-08-29T12:00:00.000Z",
        archivedAt: "2026-08-29T13:00:00.000Z",
      });

      await expect(store.list()).resolves.toEqual([expect.objectContaining({
        id: "synthetic-session",
        archivedAt: "2026-08-29T13:00:00.000Z",
      })]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("preserves a thread's mailbox source for contextual session starters", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hey-agent-chat-store-"));
    try {
      const store = new ChatStore(join(directory, "workspace.json"));
      await store.upsert({
        id: "mail-session",
        title: "Reading notes",
        topicIds: ["42"],
        attachments: [{ kind: "hey-thread", id: "42", title: "A useful article", sourceBox: "feedbox" }],
        workingDirectory: "/tmp/synthetic-workspace",
        updatedAt: "2026-08-29T12:00:00.000Z",
      });

      await expect(store.list()).resolves.toEqual([expect.objectContaining({
        attachments: [expect.objectContaining({ sourceBox: "feedbox" })],
      })]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("preserves attached native HEY objects without treating them as topics", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hey-agent-chat-store-"));
    try {
      const store = new ChatStore(join(directory, "workspace.json"));
      await store.upsert({
        id: "calendar-session",
        title: "Planning",
        topicIds: [],
        attachments: [
          { kind: "hey-object", objectKind: "calendar-event", id: "event-42", title: "Planning", deepLink: "hey-agent://calendar/events/event-42?date=2026-09-03" },
          { kind: "hey-object", objectKind: "mail-bundle", id: "bundle-7", title: "Maya bundle", deepLink: "hey-agent://mail/bundles/bundle-7" },
          { kind: "hey-object", objectKind: "set-aside-group", id: "group-9", title: "Set Aside group", deepLink: "hey-agent://mail/set-aside/groups/group-9" },
        ],
        workingDirectory: "/tmp/synthetic-workspace",
        updatedAt: "2026-09-02T12:00:00.000Z",
      });

      await expect(store.list()).resolves.toEqual([expect.objectContaining({
        topicIds: [],
        attachments: [
          expect.objectContaining({ kind: "hey-object", objectKind: "calendar-event", id: "event-42" }),
          expect.objectContaining({ kind: "hey-object", objectKind: "mail-bundle", id: "bundle-7" }),
          expect.objectContaining({ kind: "hey-object", objectKind: "set-aside-group", id: "group-9" }),
        ],
      })]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("preserves a known Helper identity and drops an unknown one", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hey-agent-chat-store-"));
    try {
      const file = join(directory, "workspace.json");
      const store = new ChatStore(file);
      await store.upsert({
        id: "helper-session",
        title: "Meeting Prep",
        helperId: "meeting-prep",
        topicIds: [],
        attachments: [{ kind: "hey-object", objectKind: "calendar-event", id: "42", title: "Planning", deepLink: "hey-agent://calendar/events/42?date=2026-09-03" }],
        workingDirectory: "/tmp/synthetic-workspace",
        updatedAt: "2026-09-03T12:00:00.000Z",
      });
      await expect(new ChatStore(file).list()).resolves.toEqual([expect.objectContaining({ helperId: "meeting-prep" })]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("restores local files and selected text as session attachments", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hey-agent-chat-store-"));
    try {
      const store = new ChatStore(join(directory, "workspace.json"));
      await store.upsert({
        id: "local-context-session",
        title: "Project brief",
        topicIds: [],
        attachments: [
          { kind: "local-file", id: "local-file:synthetic", title: "brief.txt", path: "/tmp/synthetic/brief.txt", size: 42, modifiedAt: "2026-09-03T12:00:00.000Z" },
          { kind: "local-selection", id: "local-selection:synthetic", title: "Selected text", subtitle: "18 characters", text: "A selected passage." },
        ],
        workingDirectory: "/tmp/synthetic-workspace",
        updatedAt: "2026-09-03T12:00:00.000Z",
      });

      await expect(store.list()).resolves.toEqual([expect.objectContaining({
        topicIds: [],
        attachments: [
          expect.objectContaining({ kind: "local-file", path: "/tmp/synthetic/brief.txt" }),
          expect.objectContaining({ kind: "local-selection", text: "A selected passage." }),
        ],
      })]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
