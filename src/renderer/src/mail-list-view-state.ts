import { PREVIOUSLY_SEEN_BATCH } from "./sectioned-imbox";

/** Kept by the account-scoped parent, not in persistent mail storage. */
export type MailListViewState = {
  scrollTop: number;
  seenLimit: number;
  query?: string;
  initialized?: boolean;
  highlightedId?: string;
};

export function createMailListViewState(): MailListViewState {
  return { scrollTop: 0, seenLimit: PREVIOUSLY_SEEN_BATCH };
}

/** A scroll gesture may cross sparse pages, but never scan an entire mailbox. */
export class SplitHistoryIntent {
  private remaining = 0;
  private visible = new Set<string>();

  begin(visibleIds: readonly string[]): void {
    if (this.remaining && !visibleIds.some((id) => !this.visible.has(id))) return;
    this.remaining = 6;
    this.visible = new Set(visibleIds);
  }

  consume(visibleIds: readonly string[]): boolean {
    if (visibleIds.some((id) => !this.visible.has(id))) this.cancel();
    if (!this.remaining) return false;
    this.remaining -= 1;
    return true;
  }

  cancel(): void { this.remaining = 0; this.visible.clear(); }
}
