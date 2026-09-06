import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { localFileAttachments, localSelectionAttachment, MAX_LOCAL_SELECTION_LENGTH, normalizeAgentAttachment } from "./agent-attachments";

describe("agent attachments", () => {
  it("resolves selected files into durable, deduplicated metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hey-agent-attachment-"));
    const path = join(directory, "project brief.txt");
    try {
      await writeFile(path, "A synthetic project brief.");
      const attachments = await localFileAttachments([path, path]);

      expect(attachments).toHaveLength(1);
      expect(attachments[0]).toEqual(expect.objectContaining({
        kind: "local-file",
        title: "project brief.txt",
        path,
        size: 26,
      }));
      expect(attachments[0]?.id).toMatch(/^local-file:[a-f0-9]{64}$/);
      expect(normalizeAgentAttachment(attachments[0])).toEqual(attachments[0]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("captures selected text with stable identity and bounded storage", () => {
    const first = localSelectionAttachment("  A selected passage.  ");
    const again = localSelectionAttachment("A selected passage.");

    expect(first).toEqual(expect.objectContaining({ kind: "local-selection", title: "Selected text", text: "A selected passage." }));
    expect(first.id).toBe(again.id);
    expect(() => localSelectionAttachment("   ")).toThrow("Select some text");
    expect(() => localSelectionAttachment("x".repeat(MAX_LOCAL_SELECTION_LENGTH + 1))).toThrow("too large");
  });

  it("rejects forged or incomplete local attachment metadata", () => {
    expect(normalizeAgentAttachment({ kind: "local-file", id: "file", title: "file", path: "relative.txt", size: 1, modifiedAt: new Date().toISOString() })).toBeUndefined();
    expect(normalizeAgentAttachment({ kind: "local-selection", id: "selection", title: "Selected text", text: "" })).toBeUndefined();
  });
});
