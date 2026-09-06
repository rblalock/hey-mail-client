import type { ImboxPosting, ScreenerEntry } from "../../shared/contracts";

export function screenerPosting(entry: ScreenerEntry): ImboxPosting {
  return {
    id: `screener-${entry.id}`,
    topicId: entry.topicId,
    appUrl: `https://app.hey.com/topics/${entry.topicId}`,
    subject: entry.subject,
    summary: entry.summary,
    seen: true,
    createdAt: "",
    contacts: [entry.sender],
    sender: entry.sender,
    visibleEntryCount: 1,
  };
}
