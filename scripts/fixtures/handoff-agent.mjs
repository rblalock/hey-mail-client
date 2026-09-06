#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { join } from "node:path";
const scratch = process.env.HEY_HANDOFF_SMOKE_ROOT;
if (!scratch?.includes("/hey-profile-smoke-")) throw new Error("Disposable handoff smoke only.");
if (process.argv.includes("--help")) {
  console.log("Codex CLI\nClaude Code\nHermes Agent --query-file\nStart the Cursor Agent\nGrok Build TUI");
} else {
  // Stand-in for xdg-terminal-exec. Records the argv; never executes a destination.
  appendFileSync(join(scratch, "handoff-launches.jsonl"), `${JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), account: process.env.HEY_ACCOUNT_ID, bridge: process.env.HEY_AGENT_WRITE_RECEIPTS })}\n`);
}
