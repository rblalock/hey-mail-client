import { isHeyId } from "../shared/mail-splits";
import { listLibrary, organizationMutationCommand } from "./hey";
import { findExecutable, profileRequest, runFile } from "./profile-process";

type SplitLabel = { id: string; name: string };
const unconfirmed = "Split label creation could not be confirmed. Refresh and choose the existing HEY label before retrying.";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function confirmedMutation(stdout: string): Record<string, unknown> {
  const payload = object(JSON.parse(stdout));
  if (payload.ok !== true) throw new Error("Split label change was not confirmed by HEY.");
  return object(payload.data);
}

function returnedLabelId(data: Record<string, unknown>): string | undefined {
  const raw = data.id ?? object(data.label).id;
  if (raw === undefined) return undefined;
  const id = typeof raw === "number" && Number.isSafeInteger(raw) ? String(raw) : raw;
  if (!isHeyId(id)) throw new Error(unconfirmed);
  return id;
}

/**
 * Called inside the runtime's serialized write queue. Captures the profile before
 * any await; neither executable lookup nor follow-up reads use a later account.
 * HEY 1.7 creates-and-files a label but returns data:null, requiring list read-back.
 */
export async function createSplitLabel(inputName: string, postingIds: string[]): Promise<SplitLabel> {
  const name = inputName.trim();
  if (!name || name.startsWith("-") || name.length > 120 || /[\x00-\x1f\x7f]/.test(name)) {
    throw new Error("Split label names must be 1–120 characters and cannot start with a dash.");
  }
  if (!postingIds.length || postingIds.length > 100 || new Set(postingIds).size !== postingIds.length || postingIds.some((id) => !isHeyId(id))) {
    throw new Error("Split labeling requires valid, unique HEY posting IDs.");
  }
  const context = profileRequest.getStore();
  if (!context) throw new Error("Split labeling requires an active account.");

  return profileRequest.run(context, async () => {
    const executable = await findExecutable("hey", context.env);
    if (!executable) throw new Error("Split labeling requires the HEY CLI.");
    const labels = await listLibrary("labels", context.env);
    const matches = labels.items.filter((item) => item.title === name);
    if (matches.length > 1) throw new Error("Split label name is ambiguous. Choose the existing label explicitly.");
    if (matches[0]) {
      const existing = matches[0];
      if (!isHeyId(existing.id)) throw new Error("Split label returned an invalid ID. Refresh and choose a label.");
      const args = organizationMutationCommand({ kind: "labels", action: "add", targetId: existing.id, postingIds });
      const result = await runFile(executable, args, { env: context.env, timeoutMs: 30_000 });
      confirmedMutation(result.stdout);
      return { id: existing.id, name: existing.title };
    }

    try {
      const args = organizationMutationCommand({ kind: "labels", action: "create", name, postingIds });
      const result = await runFile(executable, args, { env: context.env, timeoutMs: 30_000 });
      const id = returnedLabelId(confirmedMutation(result.stdout));
      const refreshed = await listLibrary("labels", context.env);
      // Prefer a returned ID if a future CLI supplies one. Never substitute a
      // same-name label when that authoritative ID is missing from the read-back.
      const confirmed = refreshed.items.filter((item) => item.title === name && (!id || item.id === id));
      if (confirmed.length !== 1 || !isHeyId(confirmed[0]!.id)) throw new Error(unconfirmed);
      return { id: confirmed[0]!.id, name: confirmed[0]!.title };
    } catch (cause) {
      // No create retry: the server may have committed before the response failed.
      // The caller retains the pending creation until it can resolve/link a label.
      throw new Error(unconfirmed, { cause });
    }
  });
}
