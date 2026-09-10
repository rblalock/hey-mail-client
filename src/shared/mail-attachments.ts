import type { MailAttachment } from "./contracts";

export function isCalendarAttachment(file: MailAttachment): boolean {
  return /\.ics$/i.test(file.filename) && ["text/calendar", "application/ics", "application/octet-stream"].includes(file.contentType.split(";")[0]!.trim().toLowerCase());
}

// Only hand passive file formats to the desktop. Other files can still be saved.
export function canOpenMailAttachment(attachment: MailAttachment): boolean {
  const extension = attachment.filename.split(".").pop()?.toLowerCase();
  const types: Record<string, string[]> = {
    pdf: ["application/pdf"],
    png: ["image/png"], jpg: ["image/jpeg"], jpeg: ["image/jpeg"],
    gif: ["image/gif"], webp: ["image/webp"],
    txt: ["text/plain"], csv: ["text/csv", "text/plain"],
  };
  return !!extension && (types[extension]?.includes(attachment.contentType.toLowerCase()) ?? false);
}

export function attachmentSize(bytes: number | undefined): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
