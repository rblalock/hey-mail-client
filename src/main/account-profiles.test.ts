import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountProfiles } from "./account-profiles";
import { ChatStore } from "./chat-store";
import { SettingsStore } from "./settings-store";
import type { AppPaths, MailAccountProfile } from "../shared/contracts";

const first: MailAccountProfile = { key: "a".repeat(32), accountId: "101", name: "Alex", email: "alex@example.com", server: "https://app.hey.com" };
const second: MailAccountProfile = { ...first, key: "b".repeat(32), accountId: "202", email: "alex@studio.example" };
const directories: string[] = [];
async function fixture(accounts = [first, second]) {
  const directory = await mkdtemp(join(tmpdir(), "hey-profiles-")); directories.push(directory);
  const paths: AppPaths = { config: join(directory, "config"), state: join(directory, "state"), data: join(directory, "data"), workspace: join(directory, "workspace") };
  await mkdir(paths.state, { recursive: true });
  return { paths, profiles: new AccountProfiles(paths, async () => accounts) };
}
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("linked account profiles", () => {
  it("selects the one real account, retains selection on restart, and expires old requests", async () => {
    const { profiles, paths } = await fixture([first]);
    await profiles.initialize();
    expect(profiles.state.active).toEqual(first);
    const old = profiles.state.token;
    expect(profiles.assertToken(old)).toEqual(first);
    const restart = new AccountProfiles(paths, async () => [first, second]);
    await restart.initialize();
    expect(restart.state.active).toEqual(first);
    expect(() => restart.assertToken(old)).toThrow("expired");
    await restart.select(second.key);
    expect(restart.state.active).toEqual(second);
  });

  it("requires a choice for several accounts and rejects unknown profiles", async () => {
    const { profiles } = await fixture(); await profiles.initialize();
    expect(profiles.state.needsSelection).toBe(true);
    expect(profiles.state.active).toBeUndefined();
    await expect(profiles.select("all")).rejects.toThrow("no longer available");
    expect(() => profiles.directories("../outside")).toThrow("Invalid");
  });

  it("migrates old tabs, archived chats and transcript references once, to only the chosen account", async () => {
    const { profiles, paths } = await fixture();
    const legacy = { version: 2, chats: [{ id: "old", title: "Old chat", topicIds: ["12"], attachments: [], workingDirectory: paths.workspace, sessionFile: "/old/transcript.jsonl", updatedAt: "2026-09-01", archivedAt: "2026-09-02" }], openTabIds: ["old"], activeTabId: "old" };
    const source = JSON.stringify(legacy);
    await writeFile(join(paths.state, "chats.json"), source);
    await profiles.initialize(); await profiles.select(first.key);
    const owned = join(profiles.directories(first.key).state, "chats.json");
    expect(await readFile(owned, "utf8")).toBe(source);
    await profiles.select(second.key);
    expect(await new ChatStore(join(profiles.directories(second.key).state, "chats.json")).list()).toEqual([]);
    await profiles.select(first.key);
    expect(await readFile(owned, "utf8")).toBe(source);
    expect(await readFile(join(paths.state, "chats.json"), "utf8")).toBe(source);
  });

  it("isolates history but retains shared settings and custom Helpers", async () => {
    const { profiles, paths } = await fixture(); await profiles.initialize(); await profiles.select(first.key);
    const store = () => new ChatStore(join(profiles.directories(profiles.state.active!.key).state, "chats.json"));
    await store().upsert({ id: "a-chat", title: "Personal", topicIds: [], attachments: [], workingDirectory: profiles.directories(first.key).workspace, updatedAt: "2026-09-05" });
    const settings = new SettingsStore(join(paths.config, "settings.json"));
    await settings.update({ interfaceFont: "system-mono" });
    await profiles.select(second.key); expect(await store().list()).toEqual([]);
    expect((await settings.get()).interfaceFont).toBe("system-mono");
    await profiles.select(first.key); expect((await store().list()).map((chat) => chat.id)).toEqual(["a-chat"]);
  });

  it("does not fall back or expose history when the selected account disappears", async () => {
    const { profiles, paths } = await fixture([first]); await profiles.initialize();
    const restart = new AccountProfiles(paths, async () => [second]); await restart.initialize();
    expect(restart.state.active).toBeUndefined(); expect(restart.state.needsSelection).toBe(true);
    expect(restart.state.error).toContain("unavailable");
  });

  it("leaves corrupt indexes and unauthenticated data untouched", async () => {
    const { paths } = await fixture(); const file = join(paths.state, "profiles.json");
    await writeFile(file, "broken");
    const profiles = new AccountProfiles(paths, async () => [first]); await profiles.initialize();
    expect(profiles.state.active).toBeUndefined(); expect(profiles.state.error).toContain("left untouched");
    expect(await readFile(file, "utf8")).toBe("broken");
  });
});
