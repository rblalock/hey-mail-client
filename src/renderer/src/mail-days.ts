import type { ImboxPosting } from "../../shared/contracts";

export function mailDayHeaders(postings: Pick<ImboxPosting, "id" | "createdAt">[], now = new Date()): Map<string, string> {
  const today = now.toDateString();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toDateString();
  const headers = new Map<string, string>();
  let previous: string | undefined;
  // Only annotate boundaries: never sort or regroup HEY's ordering under the cursor.
  for (const posting of postings) {
    const date = new Date(posting.createdAt);
    const key = Number.isNaN(date.getTime()) ? "unknown" : date.toDateString();
    if (key !== previous) {
      headers.set(posting.id, key === "unknown" ? "Date unavailable" : key === today ? "Today" : key === yesterday ? "Yesterday"
        : new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) }).format(date));
    }
    previous = key;
  }
  return headers;
}
