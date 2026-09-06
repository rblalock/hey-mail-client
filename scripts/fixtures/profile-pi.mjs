#!/usr/bin/env node
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
if (!process.env.HEY_AGENT_PROFILE_SMOKE_ROOT) throw new Error("Only for the isolated profile smoke test.");
appendFileSync(join(process.env.HEY_AGENT_PROFILE_SMOKE_ROOT, "pi-calls.jsonl"), JSON.stringify({ account: process.env.HEY_AGENT_ACCOUNT_ID, cwd: process.cwd(), args: process.argv.slice(2) }) + "\n");
const output = (value) => console.log(JSON.stringify(value));
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.type === "prompt") output({ type: "agent_start" });
  if (request.type === "abort") output({ type: "agent_end" });
  output({ type: "response", id: request.id, command: request.type, success: true, data: request.type === "get_messages" ? { messages: [] } : request.type === "get_available_models" ? { models: [] } : {} });
});
