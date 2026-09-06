import type { ImboxPosting, MailOrganizationItem } from "../../shared/contracts";

function uniqueNumeric(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && /^\d+$/.test(value))))];
}

export function organizationTargets(postings: ImboxPosting[]): { postingIds: string[]; topicIds: string[] } {
  return {
    postingIds: uniqueNumeric(postings.map((posting) => posting.id)),
    topicIds: uniqueNumeric(postings.map((posting) => posting.topicId)),
  };
}

export function organizationToggleAction(item: MailOrganizationItem): "add" | "remove" {
  return item.membership === "all" ? "remove" : "add";
}

export function filterOrganizationItems(items: MailOrganizationItem[], query: string): MailOrganizationItem[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return items;
  return items.filter((item) => `${item.name} ${item.summary ?? ""}`.toLocaleLowerCase().includes(normalized));
}
