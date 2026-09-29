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
  it("publishes readable text and then rich HTML without waiting for slow attachments", async () => {
    let finishHtml!: (value: { stdout: string; stderr: string }) => void;
    let finishAttachments!: (value: { stdout: string; stderr: string }) => void;
    vi.mocked(runFile).mockImplementation(async (_command, args) => {
      if (args[0] === "attachment") return new Promise((resolve) => { finishAttachments = resolve; });
      if (args.includes("--html")) return new Promise((resolve) => { finishHtml = resolve; });
      return response({ entries: [{ id: 42, plain_text: "Readable before enrichment" }] });
    });
    const preview = vi.fn();
    const finished = vi.fn();
    const result = readThread("21", process.env, { includeHtml: true, onPreview: preview }).then((thread) => { finished(thread); return thread; });
    await vi.waitFor(() => expect(preview).toHaveBeenCalledWith(expect.objectContaining({ bodyLoading: true, attachmentsLoading: true })));
    expect(preview.mock.calls[0]?.[0].entries[0].body).toBe("Readable before enrichment");
    expect(finished).not.toHaveBeenCalled();
    finishHtml({ stdout: '<article data-entry-id="42"><style>p{color:red}</style><p>Rich body</p></article>', stderr: "" });
    await vi.waitFor(() => expect(preview.mock.calls.at(-1)?.[0].entries[0].html).toContain("Rich body"));
    expect(preview.mock.calls.at(-1)?.[0].attachmentsLoading).toBe(true);
    expect(finished).not.toHaveBeenCalled();
    finishAttachments(response([rawFile]));
    expect((await result).entries[0]?.attachments).toEqual([file]);
    expect((await result).attachmentsLoading).toBeUndefined();
    expect((await result).bodyLoading).toBeUndefined();
  });
  it("does not publish the generic attachment sentinel before an HTML wrapper is expanded", async () => {
    let finishHtml!: (value: { stdout: string; stderr: string }) => void;
    let jsonRead!: () => void;
    const didReadJson = new Promise<void>((resolve) => { jsonRead = resolve; });
    vi.mocked(runFile).mockImplementation(async (_command, args) => {
      if (args[0] === "attachment") return response([]);
      if (args.includes("--html")) return new Promise((resolve) => { finishHtml = resolve; });
      jsonRead(); return response([{ id: 42, body: "📎 attachment" }]);
    });
    const preview = vi.fn();
    const result = readThread("21", process.env, { includeHtml: true, onPreview: preview });
    await didReadJson;
    await Promise.resolve();
    expect(preview).not.toHaveBeenCalled();
    finishHtml({ stdout: '<article data-entry-id="42"><action-text-attachment content-type="text/html" content="&lt;p&gt;Actual receipt&lt;/p&gt;"></action-text-attachment></article>', stderr: "" });
    expect((await result).entries[0]?.html).toContain("Actual receipt");
    expect(preview.mock.calls.every(([value]) => value.entries[0].body !== "📎 attachment")).toBe(true);
  });
  it("keeps readable text and reports HTML failures independently of attachments", async () => {
    vi.mocked(runFile).mockImplementation(async (_command, args) => {
      if (args[0] === "attachment") return response([rawFile]);
      if (args.includes("--html")) throw Error("format read failed");
      return response([{ id: 42, body: "Readable fallback" }]);
    });
    const thread = await readThread("21", process.env, { includeHtml: true });
    expect(thread.bodyError).toContain("formatting couldn’t be loaded");
    expect(thread.entries[0]).toMatchObject({ body: "Readable fallback", attachments: [file] });
    expect(thread.attachmentsError).toBeUndefined();
  });
  it("reports an unreadable HTML wrapper explicitly instead of finalizing an attachment placeholder", async () => {
    vi.mocked(runFile).mockImplementation(async (_command, args) => {
      if (args[0] === "attachment") return response([]);
      if (args.includes("--html")) throw Error("offline");
      return response([{ id: 42, body: "📎 attachment" }]);
    });
    const preview = vi.fn();
    const thread = await readThread("21", process.env, { includeHtml: true, onPreview: preview });
    expect(thread.entries[0]?.body).toBe("");
    expect(thread.bodyError).toContain("message body couldn’t be loaded");
    expect(thread.attachmentsError).toBeUndefined();
    expect(preview).not.toHaveBeenCalled();
  });
  it("warns about genuinely missing files without assuming the CLI needs an upgrade", async () => {
    vi.mocked(runFile).mockImplementation(async (_command, args) => {
      if (args[0] === "attachment") return response([]);
      if (args.includes("--html")) return { stdout: '<article data-entry-id="42"><action-text-attachment content-type="text/calendar" filename="invite.ics"></action-text-attachment></article>', stderr: "" };
      return response({ entries: [{ id: 42, body: "Invitation" }] });
    });
    const result = await readThread("21", process.env, { includeHtml: true });
    expect(result.attachmentsError).toContain("Some attachment details are missing");
    expect(result.attachmentsError).not.toContain("upgrade");
  });
  it.each([false, true])("unwraps an HTML body with optional real files without a false attachment warning (file=%s)", async (hasFile) => {
    const body = '<h2>Weekly usage recap</h2><p>Your workspace summary.</p>'
      + (hasFile ? '<action-text-attachment content-type="application/pdf" filename="authorization.pdf"></action-text-attachment>' : "");
    const wrapped = '<action-text-attachment content-type="text/html" content="' + body.replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '"></action-text-attachment>';
    const trix = JSON.stringify({ contentType: "text/html", content: wrapped }).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    vi.mocked(runFile).mockImplementation(async (_command, args) => {
      if (args[0] === "attachment") return response(hasFile ? [rawFile] : []);
      if (args.includes("--html")) return { stdout: `<article data-entry-id="42"><figure data-trix-attachment="${trix}"></figure></article>`, stderr: "" };
      return response([{ id: 42, body: "📎 attachment" }]);
    });
    const result = await readThread("21", process.env, { includeHtml: true });
    expect(result.attachmentsError).toBeUndefined();
    expect(result.entries[0]?.html).toContain("Weekly usage recap");
    expect(result.entries[0]?.html).not.toContain("action-text-attachment");
    expect(result.entries[0]?.attachments).toEqual(hasFile ? [file] : []);
  });
  it("compares attachment names after the same filename normalization as the CLI metadata", async () => {
    vi.mocked(runFile).mockImplementation(async (_command, args) => {
      if (args[0] === "attachment") return response([{ ...rawFile, filename: "reports/authorization.pdf" }]);
      if (args.includes("--html")) return { stdout: '<article data-entry-id="42"><action-text-attachment content-type="application/pdf" filename="reports/authorization.pdf"></action-text-attachment></article>', stderr: "" };
      return response([{ id: 42, body: "Please review." }]);
    });
    const result = await readThread("21", process.env, { includeHtml: true });
    expect(result.attachmentsError).toBeUndefined();
    expect(result.entries[0]?.attachments).toEqual([file]);
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
