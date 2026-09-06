import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// Interrupted or unconfirmed writes leave a receipt, surviving app/Pi restarts.
// No mail bodies are stored. Only explicit user acknowledgment clears unknown outcomes.
export function beginHeyWrite(directory, command) {
  if (!directory) return undefined;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, `${randomUUID()}.json`);
  writeFileSync(file, JSON.stringify({ command: command.slice(0, 2), startedAt: new Date().toISOString() }), { mode: 0o600, flag: "wx" });
  return file;
}
export function completeHeyWrite(file) { if (file) unlinkSync(file); }
export function pendingHeyWrites(directory) {
  try { return readdirSync(directory).filter((name) => /^[a-f0-9-]+\.json$/.test(name)); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}
export function acknowledgeHeyWrites(directory) {
  for (const name of pendingHeyWrites(directory)) unlinkSync(join(directory, name));
}
export function isMailWrite(args) {
  const [root, action, sub] = args;
  if (["search", "box", "thread", "bundle"].includes(root)) return false;
  if (root === "bulk-reply") return action !== "preview";
  if (root === "contact" && (["show", "threads"].includes(action) || action === "note" && sub === "show")) return false;
  if (root === "set-aside" && (action === "view" || action === "group" && ["view", "list"].includes(sub))) return false;
  return !["list", "show", "view", "history"].includes(action);
}
