import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsStore } from "./settings-store";
import { DEFAULT_ENABLED_HELPERS, HELPER_CATALOG_VERSION, type CustomHelper } from "../shared/helpers";

const roots: string[] = [];
const personal: CustomHelper = { id: "custom-project", title: "Project check-in", instructions: "Recap the attached mail. Do not send anything.", context: "mail", modelProfile: "quick" };
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("SettingsStore", () => {
  it("migrates old settings to text-only lists and ignores malformed avatar preferences", async () => {
    const root = await mkdtemp(join(tmpdir(), "hey-agent-settings-"));
    roots.push(root);
    const file = join(root, "settings.json");
    for (const saved of [{ interfaceFont: "system-mono" }, { showSenderAvatars: "true" }]) {
      await writeFile(file, JSON.stringify(saved));
      expect((await new SettingsStore(file).get()).showSenderAvatars).toBe(false);
    }
  });

  it("persists the system mono preference across restart and unrelated updates", async () => {
    const root = await mkdtemp(join(tmpdir(), "hey-agent-settings-"));
    roots.push(root);
    const file = join(root, "settings.json");
    await new SettingsStore(file).update({ interfaceFont: "system-mono" });
    const reopened = new SettingsStore(file);
    expect((await reopened.get()).interfaceFont).toBe("system-mono");
    expect((await reopened.update({ sound: { enabled: false } })).interfaceFont).toBe("system-mono");
    expect((await reopened.reset()).interfaceFont).toBe("instrument");
  });

  it("adds new built-ins once without re-enabling disabled Helpers", async () => {
    const root = await mkdtemp(join(tmpdir(), "hey-agent-settings-"));
    roots.push(root);
    const file = join(root, "settings.json");
    await writeFile(file, JSON.stringify({ helpers: { catalogVersion: 1, enabled: ["thread-recap"] } }));
    const store = new SettingsStore(file);
    expect((await store.get()).helpers.enabled).toEqual(["thread-recap", "daily-brief", "calendar-triage"]);
    await store.update({ helpers: { enabled: ["thread-recap", "calendar-triage"] } });
    expect((await new SettingsStore(file).get()).helpers.enabled).toEqual(["thread-recap", "calendar-triage"]);

    await writeFile(file, JSON.stringify({ helpers: { enabled: [] } }));
    expect((await store.get()).helpers.enabled).not.toContain("meeting-prep");
  });

  it("round-trips authored content, edits and preferences without resetting it", async () => {
    const root = await mkdtemp(join(tmpdir(), "hey-agent-settings-"));
    roots.push(root);
    const file = join(root, "settings.json");
    const store = new SettingsStore(file);
    await store.update({ helpers: { custom: [personal], enabled: [personal.id], preferences: { "calendar-triage": "I work 9–5 Eastern." } } });
    const saved = (await new SettingsStore(file).get()).helpers;
    expect(saved.custom).toEqual([personal]);
    expect(saved.enabled).toEqual([personal.id]);
    expect(saved.preferences).toEqual({ "calendar-triage": "I work 9–5 Eastern." });
    await store.update({ sound: { enabled: false } });
    expect((await store.reset()).helpers).toEqual(saved);

    const edited = { ...personal, title: "Project notes", instructions: "Summarize only decisions." };
    await store.update({ helpers: { custom: [edited] } });
    expect((await new SettingsStore(file).get()).helpers.custom).toEqual([edited]);
    await store.update({ helpers: { custom: [] } });
    expect((await store.get()).helpers).toMatchObject({ custom: [], enabled: [] });
  });

  it("rejects invalid or duplicate definitions without losing existing instructions", async () => {
    const root = await mkdtemp(join(tmpdir(), "hey-agent-settings-"));
    roots.push(root);
    const store = new SettingsStore(join(root, "settings.json"));
    await store.update({ helpers: { custom: [personal], enabled: [personal.id] } });
    await expect(store.update({ helpers: { custom: [personal, { ...personal, id: "custom-copy" }] } })).rejects.toThrow("already exists");
    await expect(store.update({ helpers: { custom: [{ ...personal, instructions: "" }] } })).rejects.toThrow("Add instructions");
    expect((await store.get()).helpers.custom).toEqual([personal]);
    // A rejected queued update must not poison later saves.
    await store.update({ helpers: { enabled: [] } });
    expect((await store.get()).helpers.enabled).toEqual([]);
  });
  it("persists shortcut profiles and custom aliases", async () => {
    const root = await mkdtemp(join(tmpdir(), "hey-agent-settings-"));
    roots.push(root);
    const file = join(root, "settings.json");
    const store = new SettingsStore(file);

    expect(await store.get()).toMatchObject({ version: 1, interfaceFont: "instrument", shortcutProfile: "hey", customShortcuts: {}, sound: { enabled: true, pack: "zen", volume: 0.3 }, ai: { general: { thinking: "inherit" }, quickUsesGeneral: true, quick: { thinking: "inherit" } }, helpers: { enabled: DEFAULT_ENABLED_HELPERS } });
    await store.update({ interfaceFont: "system", shortcutProfile: "custom", customShortcuts: { compose: ["v", "v", "ctrl+shift+n"] }, sound: { pack: "studio", volume: 0.45 }, ai: { general: { model: { provider: "anthropic", modelId: "claude-sonnet" }, thinking: "medium" }, quickUsesGeneral: false, quick: { model: { provider: "openai", modelId: "gpt-fast" }, thinking: "low" } }, helpers: { enabled: [] } });

    expect(await new SettingsStore(file).get()).toMatchObject({ version: 1, interfaceFont: "system", shortcutProfile: "custom", customShortcuts: { compose: ["v", "ctrl+shift+n"] }, sound: { enabled: true, pack: "studio", volume: 0.45 }, ai: { general: { model: { provider: "anthropic", modelId: "claude-sonnet" }, thinking: "medium" }, quickUsesGeneral: false, quick: { model: { provider: "openai", modelId: "gpt-fast" }, thinking: "low" } }, helpers: { enabled: [] } });
  });

  it("resets to HEY-like defaults without retaining custom bindings", async () => {
    const root = await mkdtemp(join(tmpdir(), "hey-agent-settings-"));
    roots.push(root);
    const store = new SettingsStore(join(root, "settings.json"));
    await store.update({ shortcutProfile: "superhuman", customShortcuts: { compose: ["v"] } });
    expect(await store.reset()).toMatchObject({ version: 1, interfaceFont: "instrument", shortcutProfile: "hey", customShortcuts: {}, sound: { enabled: true, pack: "zen", volume: 0.3 }, ai: { general: { thinking: "inherit" }, quickUsesGeneral: true, quick: { thinking: "inherit" } }, helpers: { enabled: DEFAULT_ENABLED_HELPERS } });
  });

  it("migrates old settings and clamps malformed sound preferences", async () => {
    const root = await mkdtemp(join(tmpdir(), "hey-agent-settings-"));
    roots.push(root);
    const file = join(root, "settings.json");
    const store = new SettingsStore(file);
    await writeFile(file, JSON.stringify({ version: 1, shortcutProfile: "hey", customShortcuts: {}, sound: { pack: "unknown", volume: 4, agentLoops: false } }));
    expect(await store.get()).toMatchObject({ interfaceFont: "instrument", sound: { volume: 1, pack: "zen", agentLoops: false, mailSounds: true } });

    await writeFile(file, JSON.stringify({ version: 1, shortcutProfile: "hey", customShortcuts: {} }));
    expect(await store.get()).toMatchObject({ sound: { enabled: true, pack: "zen", volume: 0.3 }, ai: { general: { thinking: "inherit" }, quickUsesGeneral: true, quick: { thinking: "inherit" } } });

    await writeFile(file, JSON.stringify({ version: 1, ai: { general: { model: { provider: "bad\nprovider", modelId: "x" }, thinking: "impossible" }, quickUsesGeneral: "no", quick: null } }));
    expect((await store.get()).ai).toEqual({ general: { thinking: "inherit" }, quickUsesGeneral: true, quick: { thinking: "inherit" } });

    await writeFile(file, JSON.stringify({ version: 1, helpers: { enabled: ["meeting-prep"] } }));
    expect((await store.get()).helpers).toMatchObject({ catalogVersion: HELPER_CATALOG_VERSION, enabled: DEFAULT_ENABLED_HELPERS });

    await writeFile(file, JSON.stringify({ version: 1, helpers: { catalogVersion: 1, enabled: ["meeting-prep"] } }));
    expect((await store.get()).helpers).toMatchObject({ catalogVersion: HELPER_CATALOG_VERSION, enabled: ["meeting-prep", "daily-brief", "calendar-triage"] });
  });
});
