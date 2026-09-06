import type { MailThread } from "../../shared/contracts";

const DEFAULT_RETRY_DELAYS = [100, 250, 500, 1_000, 2_000, 4_000];

type ReconciliationOptions = {
  retryDelays?: number[];
  wait?: (delayMs: number) => Promise<void>;
};

export function hasNewThreadEntry(previous: MailThread, next: MailThread): boolean {
  if (next.entries.length > previous.entries.length) return true;
  const previousIds = new Set(previous.entries.map((entry) => entry.id));
  return next.entries.some((entry) => !previousIds.has(entry.id));
}

export async function readThreadUntilAdvanced(
  previous: MailThread,
  read: () => Promise<MailThread>,
  options: ReconciliationOptions = {},
): Promise<MailThread> {
  const retryDelays = options.retryDelays ?? DEFAULT_RETRY_DELAYS;
  const wait = options.wait ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  let latest = await read();
  if (hasNewThreadEntry(previous, latest)) return latest;

  for (const delay of retryDelays) {
    await wait(delay);
    latest = await read();
    if (hasNewThreadEntry(previous, latest)) return latest;
  }
  return latest;
}
