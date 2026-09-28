import type { ImboxPosting } from "../../shared/contracts";
import { isHeyId, normalizeAddToSplit, type AddToSplitRequest } from "../../shared/mail-splits";
import { splitDraftFromPosting } from "./split-mailbox";

export type SplitAdditionMode = "conversation" | "person" | "domain";

export function splitAdditionForPostings(splitId: string, postings: ImboxPosting[], mode: SplitAdditionMode, ownEmail?: string): AddToSplitRequest {
  if (!postings.length || postings.some((posting) => !isHeyId(posting.id) || !posting.topicId || posting.kind === "bundle")) throw new Error("Choose individual mail conversations before adding them to a split.");
  const postingIds = [...new Set(postings.map((posting) => posting.id))];
  if (postingIds.length > 100) throw new Error("Add up to 100 conversations at a time.");
  if (mode === "conversation") return normalizeAddToSplit({ splitId, postingIds });
  const drafts = postings.map((posting) => splitDraftFromPosting(posting, mode, ownEmail?.trim()));
  if (drafts.some((draft) => !draft)) throw new Error("Some selected conversations have no person’s email address. Add only these conversations instead.");
  const values = [...new Set(drafts.flatMap((draft) => mode === "person" ? draft!.people ?? [] : draft!.domains ?? []).map((value) => value.trim().toLowerCase()))];
  return normalizeAddToSplit({ splitId, postingIds, ...(mode === "person" ? { people: values } : { domains: values }) });
}
