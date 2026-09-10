import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachmentFilename, cleanupMailAttachmentDownloads, downloadMailAttachment, listMailAttachments, parseMailAttachments, resolveMailAttachment, saveMailAttachment, validMailAttachmentId, withMailAttachments } from "./mail-attachments";
import { findExecutable, runFile } from "./profile-process";
import { readThread } from "./hey";
import type { MailThread } from "../shared/contracts";

vi.mock("./profile-process", () => ({ findExecutable: vi.fn(), runFile: vi.fn(), runFileWithInput: vi.fn() }));
const rawFile = { id: "42:1", message_id: 42, filename: "authorization.pdf", content_type: "application/pdf", byte_size: 4 };
const response = (data: unknown) => ({ stdout: JSON.stringify({ ok: true, data }), stderr: "" });
const file = parseMailAttachments(response([rawFile]).stdout)[0]!;
const thread: MailThread = { topicId: "21", subject: "Documents", entries: ["41", "42"].map((id) => ({ id, body: "Please review.", sender: { name: "Maya", initials: "M" }, occurredAt: "2026-09-09" })) };

beforeEach(() => { vi.resetAllMocks(); vi.mocked(findExecutable).mockResolvedValue("/test/hey"); });
afterEach(() => cleanupMailAttachmentDownloads());

describe("received attachment metadata", () => {
  it("accepts stable embedded IDs, including repeated embedded files, and rejects malformed selectors", async () => {
    const id = `42:e-${Buffer.alloc(32, 1).toString("base64url")}`;
    expect(validMailAttachmentId(id)).toBe(true);
    expect(validMailAttachmentId(`${id}.2`)).toBe(true);
    for (const invalid of [`${id}.1`, `${id}.0`, `${id}.02`, "42:e-short", "42:0", "0:1", "42:../file"]) expect(validMailAttachmentId(invalid)).toBe(false);
    vi.mocked(runFile).mockResolvedValue(response([{ ...rawFile, id }]));
    expect(await resolveMailAttachment("21", id)).toMatchObject({ id });
  });
  it("groups files by message, not by position in the conversation", () => {
    const result = withMailAttachments(thread, [file]);
    expect(result.entries[0]?.attachments).toEqual([]);
    expect(result.entries[1]?.attachments).toEqual([file]);
    expect(result.attachmentsError).toBeUndefined();
    expect(parseMailAttachments(response([rawFile, rawFile]).stdout)).toHaveLength(1);
  });
  it("warns when concurrent mail adds a file to a message not yet loaded", () => {
    expect(withMailAttachments({ ...thread, entries: [] }, [file]).attachmentsError).toContain("Reload");
  });
  it.each([{}, { ok: false, data: [] }, { ok: true, data: [{}] }, { ok: true, data: [{ ...rawFile, message_id: 100 }] }])("does not silently treat invalid metadata as no attachments: %j", (payload) => {
    expect(() => parseMailAttachments(JSON.stringify(payload))).toThrow();
  });
  it("supports empty lists and missing size/type", () => {
    expect(parseMailAttachments(response([]).stdout)).toEqual([]);
    expect(parseMailAttachments(response([{ ...rawFile, byte_size: -1, content_type: undefined }]).stdout)[0]).toMatchObject({ contentType: "application/octet-stream" });
    expect(parseMailAttachments(response([{ ...rawFile, byte_size: -1 }]).stdout)[0]?.byteSize).toBeUndefined();
  });
  it.each([["../../secret.pdf", "secret.pdf"], ["C:\\folder\\report.pdf", "report.pdf"], ["..", "attachment"], ["bad\u202efile.pdf\n", "badfile.pdf"]])("contains untrusted filename %s", (input, expected) => {
    expect(attachmentFilename(input)).toBe(expected);
  });
  it("lists through the profile-scoped CLI and validates identifiers first", async () => {
    vi.mocked(runFile).mockResolvedValue(response([rawFile]));
    expect(await listMailAttachments("21")).toEqual([file]);
    expect(runFile).toHaveBeenCalledWith("/test/hey", ["attachment", "list", "21", "--json"], expect.anything());
    await expect(resolveMailAttachment("21", "99:1")).rejects.toThrow("no longer available");
    vi.mocked(runFile).mockClear();
    await expect(resolveMailAttachment("--help", "42:1")).rejects.toThrow();
    await expect(resolveMailAttachment("21", "../42")).rejects.toThrow();
    expect(runFile).not.toHaveBeenCalled();
  });
});

describe("thread loading", () => {
  it("shows an actionable warning when an old CLI misses files embedded in HTML", async () => {
    vi.mocked(runFile).mockImplementation(async (_command, args) => {
      if (args[0] === "attachment") return response([]);
      if (args.includes("--html")) return { stdout: '<article data-entry-id="42"><action-text-attachment content-type="text/calendar" filename="invite.ics"></action-text-attachment></article>', stderr: "" };
      return response({ entries: [{ id: 42, body: "Invitation" }] });
    });
    expect((await readThread("21", process.env, { includeHtml: true })).attachmentsError).toContain("1.4.3");
  });
  it("combines body, rich HTML and attachment details without dropping any of them", async () => {
    vi.mocked(runFile).mockImplementation(async (_command, args) => {
      if (args[0] === "attachment") return response([rawFile]);
      if (args.includes("--html")) return { stdout: '<article data-entry-id="42"><header>Maya — 2026-09-09T12:00Z</header><style>p {color:red}</style><p>Review</p></article>', stderr: "" };
      return response({ entries: [{ id: 42, plain_text: "Review" }] });
    });
    const result = await readThread("21", process.env, { includeHtml: true });
    expect(result.entries[0]).toMatchObject({ body: "Review", attachments: [file] });
    expect(result.entries[0]?.html).toContain("Review");
  });
  it("keeps the email readable and surfaces attachment-list failures", async () => {
    vi.mocked(runFile).mockImplementation(async (_command, args) => {
      if (args[0] === "attachment") throw new Error("offline");
      return response({ entries: [{ id: 42, plain_text: "Review" }] });
    });
    const result = await readThread("21");
    expect(result.entries[0]?.body).toBe("Review");
    expect(result.attachmentsError).toContain("couldn’t be loaded");
  });
});

describe("attachment downloads", () => {
  function mockDownload(contents = "test") {
    vi.mocked(runFile).mockImplementation(async (_command, args) => {
      const path = args[args.indexOf("--output") + 1]!;
      await writeFile(path, contents);
      return response({ path });
    });
  }
  it("downloads into a private unique directory with no execute permissions and cleans up", async () => {
    mockDownload();
    const download = await downloadMailAttachment(file);
    expect(await readFile(download.path, "utf8")).toBe("test");
    expect((await stat(download.path)).mode & 0o777).toBe(0o600);
    expect((await stat(dirname(download.path))).mode & 0o777).toBe(0o700);
    expect(runFile).toHaveBeenCalledWith("/test/hey", ["attachment", "save", "42:1", "--output", download.path, "--json"], expect.anything());
    await download.cleanup();
    await expect(stat(dirname(download.path))).rejects.toThrow();
  });
  it("rejects incomplete downloads and removes staging files", async () => {
    mockDownload("x");
    await expect(downloadMailAttachment(file)).rejects.toThrow("incomplete");
    const args = vi.mocked(runFile).mock.calls[0]![1];
    await expect(stat(dirname(args[args.indexOf("--output") + 1]!))).rejects.toThrow();
  });
  it("does not replace an existing destination when the download fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hey-attachment-test-"));
    const destination = join(directory, "saved.pdf");
    try {
      await writeFile(destination, "original");
      mockDownload("x");
      await expect(saveMailAttachment(file, destination)).rejects.toThrow();
      expect(await readFile(destination, "utf8")).toBe("original");
      mockDownload();
      await saveMailAttachment(file, destination);
      expect(await readFile(destination, "utf8")).toBe("test");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
