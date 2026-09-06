#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { join } from "node:path";
if (!process.env.HEY_AGENT_PROFILE_SMOKE_ROOT) throw new Error("Only for the isolated profile smoke test.");
const args = process.argv.slice(2);
appendFileSync(join(process.env.HEY_AGENT_PROFILE_SMOKE_ROOT, "hey-calls.jsonl"), JSON.stringify(args) + "\n");
const selected = args.includes("--account") ? args[args.indexOf("--account") + 1] : "all";
const command = args[0] === "--account" ? args.slice(4) : args;
const [root, action] = command;
const account = selected === "202" ? 202 : 101;
const posting = { id: account + 1, topic_id: account + 2, account_id: account, name: `Mail for ${account}`, subject: `Mail for ${account}`, created_at: "2026-09-05T10:00:00Z", contacts: [], seen: false };
let data = [];
if (root === "auth") data = { authenticated: true, base_url: "https://app.hey.com", mail_account: "all" };
else if (root === "account") data = [{ id: "all", name: "All Accounts" }, ...[101, 202].map((id) => ({ id, name: `Account ${id}`, email: `${id}@example.com`, status: "active" }))];
else if (root === "box" && action === "view" || root === "set-aside" && action === "view") data = { name: "Imbox", postings: [posting] };
else if (root === "search") { if (action === "slow") await new Promise((resolve) => setTimeout(resolve, 600)); data = [posting]; }
else if (root === "compose") { await new Promise((resolve) => setTimeout(resolve, 300)); if (command.includes("Uncertain")) { console.error("Synthetic transport interruption"); process.exit(1); } data = { id: 999, message: "Synthetic message accepted" }; }
else if (root === "thread") data = [{ id: account + 3, body: "Synthetic mail body", creator: { name: "Fixture" } }];
else if (root === "watch") { setInterval(() => {}, 1000); }
else if (root === "bubble") data = { scheduled: [], bubbled_up: [] };
if (root !== "watch") console.log(JSON.stringify({ ok: true, data }));
