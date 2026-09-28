import type { MailCompletionState, MailMutationRequest, MailMutationResult } from "../shared/contracts";

const COMPLETION_BOXES = new Set(["imbox", "laterbox", "asidebox", "feedbox", "trailbox", "bubblebox"]);
const validId = (id: unknown): id is string => typeof id === "string" && /^[1-9]\d{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n;

/** Completion snapshots always describe the state before Done, including for Undo. */
export function completionState(request: MailMutationRequest): MailCompletionState[] {
  const ids = request.postingIds;
  if (!["done", "undo-done"].includes(request.operation)
    || !Array.isArray(ids) || ids.length < 1 || ids.length > 100
    || ids.some((id) => !validId(id))
    || new Set(ids).size !== ids.length) throw new Error("Invalid HEY Done selection.");
  if (request.destination !== undefined || request.sourceBox !== undefined || request.bubbleSchedule !== undefined) {
    throw new Error("Done requires each conversation's original state.");
  }
  const states = request.completion;
  if (!Array.isArray(states) || states.length !== ids.length) throw new Error("Done requires each conversation's original state.");
  const selected = new Set(ids);
  const seenIds = new Set<string>();
  for (const state of states) {
    if (!state || typeof state !== "object" || Array.isArray(state)
      || !selected.has(state.id) || seenIds.has(state.id)
      || !COMPLETION_BOXES.has(state.sourceBox)
      || typeof state.seen !== "boolean" || typeof state.bubbledUp !== "boolean"
      || state.bubbledUp && state.sourceBox !== "imbox"
      || state.boxGroupId !== undefined && (state.sourceBox !== "asidebox" || !validId(state.boxGroupId))) throw new Error("Invalid HEY Done state.");
    seenIds.add(state.id);
  }
  return states.map((state) => ({ id: state.id, sourceBox: state.sourceBox, seen: state.seen, bubbledUp: state.bubbledUp, ...(state.boxGroupId ? { boxGroupId: state.boxGroupId } : {}) }));
}

type CompletionStep = { command: string[]; compensate: string[] };
type CompletionRunner = (args: string[]) => Promise<unknown>;
const command = (...args: string[]) => [...args, "--json"];

function isMissingGroup(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
  if (value.code === "not_found") return true;
  for (const output of [value.stdout, value.stderr]) {
    if (typeof output !== "string") continue;
    try { if (JSON.parse(output).code === "not_found") return true; } catch { /* Not a CLI error envelope. */ }
  }
  return false;
}

async function restoreGroups(states: MailCompletionState[], run: CompletionRunner, bestEffort = false): Promise<{ notices: string[]; failed: boolean }> {
  const groups = new Map<string, string[]>();
  for (const state of states) {
    if (state.boxGroupId) groups.set(state.boxGroupId, [...(groups.get(state.boxGroupId) ?? []), state.id]);
  }
  const notices: string[] = [];
  let failed = false;
  if (!groups.size) return { notices, failed };
  // The scoped list both verifies group ownership and distinguishes a deleted group
  // from a group that this process has never seen. Never recreate after an auth error.
  const listed = await run(command("set-aside", "group", "list"));
  if (!Array.isArray(listed)) throw new Error("HEY did not return the Set Aside group list.");
  const groupIds = listed.map((group: unknown) => {
    const id = group && typeof group === "object" && "id" in group ? group.id : group;
    const text = typeof id === "number" ? String(id) : id;
    if (!validId(text)) throw new Error("HEY returned an invalid Set Aside group.");
    return text;
  });
  const existing = new Set(groupIds);
  for (const [groupId, ids] of groups) {
    try {
      if (existing.has(groupId)) {
        try { await run(command("set-aside", "group", "add", ...ids, "--to", groupId)); continue; }
        catch (error) { if (!isMissingGroup(error)) throw error; }
      }
      if (ids.length >= 2) {
        await run(command("set-aside", "group", "create", ...ids));
        notices.push(`The original Set Aside group no longer exists; ${ids.length} returning conversations were regrouped in a new group.`);
      } else {
        notices.push("The original Set Aside group no longer exists; its returning conversation is ungrouped in Set Aside.");
      }
    } catch (error) {
      if (!bestEffort) throw error;
      failed = true;
    }
  }
  return { notices, failed };
}

function completionSteps(state: MailCompletionState, undo: boolean): CompletionStep[] {
  const steps: CompletionStep[] = [];
  const returnsToImbox = state.sourceBox === "laterbox" || state.sourceBox === "asidebox";
  if (undo) {
    if (returnsToImbox) steps.push({ command: command("move", state.id, "--to", state.sourceBox), compensate: command("move", state.id, "--to", "imbox") });
    if (state.bubbledUp) steps.push({ command: command("bubble", "up", state.id, "--now"), compensate: command("bubble", "pop", state.id) });
    // Bubble Up can affect read state, so restore read state after restoring the bubble.
    steps.push({ command: command(state.seen ? "seen" : "unseen", state.id), compensate: command("seen", state.id) });
  } else {
    if (state.bubbledUp) steps.push({ command: command("bubble", "pop", state.id), compensate: command("bubble", "up", state.id, "--now") });
    if (returnsToImbox) steps.push({ command: command("move", state.id, "--to", "imbox"), compensate: command("move", state.id, "--to", state.sourceBox) });
    steps.push({ command: command("seen", state.id), compensate: command(state.seen ? "seen" : "unseen", state.id) });
  }
  return steps;
}

/** Run through the existing profile-scoped executor; no synthetic CLI Done command exists. */
export async function completeMail(request: MailMutationRequest, run: CompletionRunner): Promise<MailMutationResult> {
  const states = completionState(request);
  const undo = request.operation === "undo-done";
  const attempted: CompletionStep[] = [];
  const notices: string[] = [];
  try {
    for (const state of states) {
      for (const step of completionSteps(state, undo)) {
        // A failed process can have applied its write before the response was lost.
        attempted.push(step);
        await run(step.command);
      }
    }
    if (undo) {
      notices.push(...(await restoreGroups(states, run)).notices);
      for (const state of states.filter((state) => state.boxGroupId)) await run(command(state.seen ? "seen" : "unseen", state.id));
    }
  } catch (error) {
    // Undo compensation returns mail to its completed state, so its earlier group
    // restoration notices no longer describe where those conversations will be.
    if (undo) notices.length = 0;
    let compensationFailed = false;
    for (const step of attempted.reverse()) {
      try { await run(step.compensate); } catch { compensationFailed = true; }
    }
    const affected = states.filter((state) => attempted.some((step) => step.command.includes(state.id)));
    if (!undo) {
      try {
        const restored = await restoreGroups(affected, run, true);
        compensationFailed ||= restored.failed;
        notices.push(...restored.notices);
      } catch { compensationFailed = true; }
    }
    // Bubble and group restoration can affect seen state. Reapply snapshots last.
    for (const state of affected) {
      try { await run(command(undo || state.seen ? "seen" : "unseen", state.id)); } catch { compensationFailed = true; }
    }
    const detail = error instanceof Error ? error.message : "HEY did not confirm the change.";
    throw new Error(`${undo ? "Undo" : "Done"} was not completed. ${compensationFailed ? "Some changes may remain; restoring the previous state also failed." : "Restoring the previous state was attempted."} ${notices.length ? `${notices.join(" ")} ` : ""}Refresh and check these conversations before retrying. ${detail}`);
  }
  return {
    message: undo ? `${notices.length ? "Conversations restored." : "Done undone."}${notices.length ? ` ${notices.join(" ")}` : ""}` : `${states.length === 1 ? "Conversation" : `${states.length} conversations`} marked done.`,
    ...(undo ? {} : { undo: { operation: "undo-done" as const, postingIds: states.map((state) => state.id), completion: states } }),
  };
}
