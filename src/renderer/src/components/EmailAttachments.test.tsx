import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import EmailAttachments from "./EmailAttachments";
import { attachmentSize, canOpenMailAttachment } from "../../../shared/mail-attachments";
import type { MailAttachment } from "../../../shared/contracts";

const file: MailAttachment = { id: "42:1", messageId: "42", filename: "review.pdf", contentType: "application/pdf", byteSize: 2048 };
describe("attachment cards (static rendering only)", () => {
  it("offers calendar preview and Save for embedded ICS files and Save for passes", () => {
    const html = renderToStaticMarkup(<EmailAttachments topicId="21" attachments={[
      { ...file, id: "42:e-embedded", filename: "invite.ics", contentType: "text/calendar" },
      { ...file, filename: "ticket.pkpass", contentType: "application/zip" },
    ]} />);
    expect(html).toContain("Preview event");
    expect(html).toContain('aria-label="Save invite.ics"');
    expect(html).toContain('aria-label="Save ticket.pkpass"');
    expect(html).not.toContain('aria-label="Open ticket.pkpass"');
  });
  it("shows the filename, size, and keyboard-accessible open/save buttons", () => {
    const html = renderToStaticMarkup(<EmailAttachments topicId="21" attachments={[file]} />);
    expect(html).toContain("review.pdf");
    expect(html).toContain("2 KB");
    expect(html).toContain('aria-label="Open review.pdf"');
    expect(html).toContain('aria-label="Save review.pdf"');
    expect(html).not.toContain("<a ");
  });
  it("renders no empty attachment section and escapes filenames", () => {
    expect(renderToStaticMarkup(<EmailAttachments topicId="21" attachments={[]} />)).toBe("");
    const html = renderToStaticMarkup(<EmailAttachments topicId="21" attachments={[{ ...file, filename: "<script>.pdf" }]} />);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;.pdf");
  });
  it.each(["launcher.desktop", "run.sh", "image.svg", "page.html", "review.pdf.exe"])("offers Save but never Open for %s", (filename) => {
    const attachment = { ...file, filename };
    expect(canOpenMailAttachment(attachment)).toBe(false);
    expect(renderToStaticMarkup(<EmailAttachments topicId="21" attachments={[attachment]} />)).not.toContain('aria-label="Open');
  });
  it("requires both a safe extension and matching content type", () => {
    expect(canOpenMailAttachment({ ...file, contentType: "application/x-executable" })).toBe(false);
    expect(canOpenMailAttachment(file)).toBe(true);
  });
  it("formats known sizes without inventing unknown sizes", () => {
    expect(attachmentSize(undefined)).toBe("");
    expect(attachmentSize(0)).toBe("0 B");
    expect(attachmentSize(1048576)).toBe("1.0 MB");
  });
});
