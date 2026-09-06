import { useEffect, useRef, useState } from "react";
import type { ImboxPosting, ImboxResult, MailboxKey } from "../../shared/contracts";

type VisitStorage = Pick<Storage, "getItem" | "setItem">;
export const paperTrailVisitKey = (profile: string) => `hey-agent:paper-trail-visit:v1:${profile}`;

// Independent of draft storage: a failed visit write must never block account switching.
export function beginPaperTrailVisit(storage: VisitStorage, profile: string, now: number): { cutoff: number; saved: boolean } {
  let cutoff = now;
  try {
    const raw = storage.getItem(paperTrailVisitKey(profile));
    const previous: unknown = raw === null ? undefined : JSON.parse(raw);
    if (typeof previous === "number" && Number.isFinite(previous) && previous > 0 && previous <= now) cutoff = previous;
  } catch { /* A missing or corrupt baseline starts a fresh visit. */ }
  try {
    storage.setItem(paperTrailVisitKey(profile), JSON.stringify(now));
    return { cutoff, saved: true };
  } catch { return { cutoff, saved: false }; }
}

// Preserve HEY's ordering. If dates do not form a single boundary, omit the line
// rather than imply that an older row is new (or move rows under the cursor).
export function paperTrailVisitBoundary(postings: Pick<ImboxPosting, "createdAt">[], cutoff: number | undefined): number | undefined {
  if (cutoff === undefined) return undefined;
  const isNew = (posting: Pick<ImboxPosting, "createdAt">) => Date.parse(posting.createdAt) > cutoff;
  const firstOld = postings.findIndex((posting) => !isNew(posting));
  const boundary = firstOld === -1 ? postings.length : firstOld;
  if (boundary === 0 || postings.slice(boundary).some(isNew)) return undefined;
  return boundary;
}

export function usePaperTrailVisit(mailboxKey: MailboxKey, result: ImboxResult | undefined, hidden: boolean, loading: boolean) {
  const profile = typeof window === "undefined" ? undefined : window.heyAgent?.profiles?.current.active?.key;
  const entry = useRef<{ profile: string; initialResult: ImboxResult | undefined; started: boolean } | undefined>(undefined);
  const [visit, setVisit] = useState<{ profile: string; cutoff: number; saved: boolean }>();
  useEffect(() => {
    if (mailboxKey !== "trailbox" || !profile) { entry.current = undefined; setVisit(undefined); return; }
    if (entry.current?.profile !== profile) {
      // App refreshes every mailbox on entry. Do not count its cached first render
      // before that request has succeeded; an unavailable refresh is not a visit.
      entry.current = { profile, initialResult: result, started: false };
      return;
    }
    if (entry.current.started || entry.current.initialResult === result || hidden || loading || result?.boxKey !== mailboxKey || result.status !== "ready") return;
    // The ref survives StrictMode's effect replay and hiding the list to read a thread.
    entry.current.started = true;
    const now = Date.now();
    let next = { cutoff: now, saved: false };
    try { next = beginPaperTrailVisit(localStorage, profile, now); } catch { /* Storage itself may be unavailable. */ }
    setVisit({ profile, ...next });
  }, [mailboxKey, profile, hidden, loading, result]);
  return mailboxKey === "trailbox" && visit?.profile === profile ? visit : undefined;
}
