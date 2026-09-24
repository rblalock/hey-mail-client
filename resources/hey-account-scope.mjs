import { parseHeyArgs } from "./hey-cli-flags.mjs";

// Application-level mail isolation. Shared by native calls and the Pi HEY tool.
// Account filters are not authorization for arbitrary identity-owned object IDs.
const CALENDAR = new Set(["calendar", "event", "todo", "habit", "timetrack", "journal"]);
const POSTING = new Set(["move", "seen", "unseen", "trash", "spam", "ignore", "stop-ignoring"]);
const rawData = (stdout) => { const value = JSON.parse(stdout); if (value.ok === false) throw new Error(value.error || "HEY read failed."); return value.data ?? value; };
const rows = (data) => Array.isArray(data) ? data : data?.postings ?? data?.threads ?? data?.items ?? (data?.bubbled_up || data?.scheduled ? [...(data.bubbled_up ?? []), ...(data.scheduled ?? [])] : []);
const mailboxQueries = ["imbox", "feedbox", "trailbox", "laterbox", "bubblebox"].map((box) => ["box", "view", box, "--all", "--json"]);
mailboxQueries.push(["set-aside", "view", "--all", "--json"], ["search", "--in", "trash", "--all", "--json"]);

export class HeyAccountScope {
  constructor(accountId, server) {
    if (!/^\d+$/.test(accountId)) throw new Error("An individual HEY account is required.");
    this.accountId = accountId;
    this.server = new URL(server).origin;
    this.known = new Map();
  }
  remember(kind, id) {
    if (id !== undefined && id !== null) {
      if (!this.known.has(kind)) this.known.set(kind, new Set());
      this.known.get(kind).add(String(id));
    }
  }
  scopedArgs(args) { return ["--account", this.accountId, "--base-url", this.server, ...args]; }
  validate(args) {
    const parsed = parseHeyArgs(args);
    for (const option of parsed.options) {
      if (["--account", "--base-url", "--token", "--cookie", "--config", "--api-key", "--account-user-id"].includes(option.name)) throw new Error("Account and server overrides are not allowed in this profile.");
    }
    if (parsed.positionals[0] === "account" && !["list", "senders"].includes(parsed.positionals[1])) throw new Error("Switch accounts using the app's account control.");
  }
  learn(args, stdout) {
    let data;
    try { data = rawData(stdout); } catch { return; }
    const parsed = parseHeyArgs(args);
    const [root, action, sub] = parsed.positionals;
    const listed = rows(data);
    const check = (item) => {
      if (item?.account_id !== undefined && String(item.account_id) !== this.accountId) throw new Error("HEY returned mail from a different account. The result was not shown.");
    };
    if (CALENDAR.has(root)) return;
    // Check mail objects, not nested addressed contacts (which can belong elsewhere).
    if (data && !Array.isArray(data)) check(data);
    for (const item of listed) check(item);
    if (["box", "search", "bundle", "bubble"].includes(root) || root === "contact" && action === "threads" || ["label", "collection", "set-aside"].includes(root) && action === "view" || root === "set-aside" && sub === "view") {
      for (const item of listed) { this.remember("posting", item.id); this.remember("thread", item.topic_id); }
    }
    if (["contact", "draft", "label", "collection", "snippet", "clip", "workflow"].includes(root) && action === "list") for (const item of listed) this.remember(root, item.id);
    if (root === "screener" && ["list", "history"].includes(action)) for (const item of listed) { this.remember("clearance", item.id); this.remember("thread", item.topic_id); }
    if (root === "thread" && action === "read") for (const item of listed) this.remember("entry", item.id);
    if (root === "attachment" && action === "list") for (const item of listed) this.remember("attachment", item.id);
    if (root === "set-aside" && action === "group" && sub === "list") for (const item of listed) this.remember("group", typeof item === "object" ? item.id : item);
    if (root === "bulk-reply" && action === "send") this.remember("delivery", data.delivery?.id ?? data.scheduled_delivery?.id ?? data.bulk_reply_id ?? data.delivery_id ?? data.id);
    if (["compose", "reply"].includes(root) && parsed.has("--draft")) this.remember("draft", data.draft?.id ?? data.draft_id ?? data.id);
  }
  async require(kind, id, read) {
    if (!id) throw new Error("A mail object ID is required.");
    if (this.known.get(kind)?.has(String(id))) return;
    const queries = ["thread", "posting"].includes(kind) ? mailboxQueries
      : kind === "clearance" ? [["screener", "list", "--json"]]
      : kind === "group" ? [["set-aside", "group", "list", "--json"]]
      : ["contact", "draft", "label", "collection"].includes(kind) ? [[kind, "list", "--all", "--json"]]
      : ["snippet", "clip", "workflow"].includes(kind) ? [[kind, "list", "--json"]] : [];
    for (const query of queries) {
      const result = await read(this.scopedArgs(query));
      this.learn(query, result.stdout);
      if (this.known.get(kind)?.has(String(id))) return;
    }
    throw new Error(`This ${kind} has not been verified in the selected account. Find it in this account before continuing.`);
  }
  async prepare(args, read) {
    this.validate(args);
    const parsed = parseHeyArgs(args);
    const [root, action, sub] = parsed.positionals;
    const require = (kind, id) => this.require(kind, id, read);
    const flag = (name) => parsed.values(name).at(-1);
    const ids = (start) => parsed.positionals.slice(start).filter((value) => /^\d+$/.test(value));
    // Calendar is identity-wide. The wrapper still pins the server and environment.
    if (CALENDAR.has(root) || ["help", "commands", "version", "account", "doctor", "environment", "exit-codes", "linked-accounts", "output"].includes(root)) return this.scopedArgs(args);
    if (root === "auth" && action === "status") return this.scopedArgs(args);
    if (root === "box" && action === "view" && !["imbox", "feedbox", "trailbox", "laterbox", "asidebox", "bubblebox", "trashbox"].includes(sub)) throw new Error("Open a named mailbox in the selected account, not a box ID.");
    if (["search", "box"].includes(root)) return this.scopedArgs(args);
    if (root === "thread" || ["reply", "forward", "share", "unshare"].includes(root)) await require("thread", root === "thread" ? sub : action);
    else if (root === "compose") { for (const id of parsed.values("--thread-id")) await require("thread", id); }
    else if (POSTING.has(root) || root === "bubble" && action !== "list") { for (const id of ids(POSTING.has(root) ? 1 : 2)) await require("posting", id); }
    else if (root === "bulk-reply") { for (const id of ids(2)) await require(action === "undo" ? "delivery" : "posting", id); }
    else if (root === "attachment") await require(action === "list" ? "thread" : "attachment", sub);
    else if (root === "bundle") await require("posting", sub);
    else if (root === "contact") { if (!["add", "list"].includes(action)) await require("contact", action === "note" ? parsed.positionals[3] : sub); }
    else if (root === "draft") { if (action !== "list") for (const id of ids(2)) await require("draft", id); }
    else if (["label", "collection"].includes(root)) {
      if (["view", "update"].includes(action)) await require(root, sub);
      else if (["add", "remove", "create"].includes(action)) {
        if (root === "label" || action !== "create") for (const id of ids(2)) await require(root === "label" ? "posting" : "thread", id);
        const target = flag("--to") ?? flag("--from");
        if (target && target !== "all") await require(root, target);
      }
    } else if (root === "snippet") { if (!["list", "create"].includes(action)) await require("snippet", sub); }
    else if (root === "clip") { if (action !== "list") await require(action === "delete" ? "clip" : "entry", sub); }
    else if (root === "workflow") { if (!["list", "view"].includes(action)) throw new Error("Workflow changes are not available in account profiles yet."); if (action === "view") await require("workflow", sub); }
    else if (root === "screener") { if (!["list", "history"].includes(action)) { if (action === "clear") throw new Error("Screener clearing is unavailable in an isolated profile. Select senders to deny individually."); for (const id of ids(2)) await require("clearance", id); } }
    else if (root === "set-aside") {
      if (action === "group" && ["view", "delete"].includes(sub)) await require("group", parsed.positionals[3]);
      if (action === "group" && ["add", "remove", "create"].includes(sub)) { for (const id of ids(3)) await require("posting", id); if (flag("--to")) await require("group", flag("--to")); }
    } else if (root === "bubble" && action === "list") { /* scoped listing */ }
    else throw new Error("This command is not yet supported in an isolated mail profile.");
    return this.scopedArgs(args);
  }
}
