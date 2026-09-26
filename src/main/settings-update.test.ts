import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { INTERFACE_FONT_IDS } from "../shared/contracts";
import { SettingsStore } from "./settings-store";
import { updateSettingsFromIpc } from "./settings-update";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("settings:update boundary", () => {
  it("defaults mail caching off, persists bounded choices, and resets to off", async () => {
    const root = await mkdtemp(join(tmpdir(), "hey-cache-settings-")); roots.push(root);
    const file = join(root, "settings.json"), store = new SettingsStore(file);
    expect((await store.get()).mailCache).toEqual({ enabled: false, maxSizeMb: 100, retentionDays: 7, prefetch: true });
    await updateSettingsFromIpc(store, { mailCache: { enabled: true, maxSizeMb: 50 } });
    await updateSettingsFromIpc(store, { mailCache: { retentionDays: 30, prefetch: false } });
    await updateSettingsFromIpc(store, { interfaceFont: "system" });
    expect((await new SettingsStore(file).get()).mailCache).toEqual({ enabled: true, maxSizeMb: 50, retentionDays: 30, prefetch: false });
    for (const mailCache of [null, [], { enabled: "yes" }, { prefetch: 1 }, { maxSizeMb: 0 }, { maxSizeMb: 99999 }, { retentionDays: 0 }, { retentionDays: "7" }]) {
      expect(() => updateSettingsFromIpc(store, { mailCache })).toThrow("Invalid HEY Agent settings.");
    }
    expect((await store.get()).mailCache.enabled).toBe(true);
    expect((await store.reset()).mailCache.enabled).toBe(false);
  });
  it("merges concurrent per-command edits and preserves valid settings on rejection", async () => {
    const root = await mkdtemp(join(tmpdir(), "hey-shortcut-ipc-")); roots.push(root);
    const file = join(root, "settings.json"), store = new SettingsStore(file);
    await Promise.all([
      updateSettingsFromIpc(store, { shortcutEdit: { id: "compose", bindings: ["v"] } }),
      updateSettingsFromIpc(store, { shortcutEdit: { id: "search", bindings: ["s"] } }),
    ]);
    expect((await new SettingsStore(file).get()).customShortcuts).toEqual({ compose: ["v"], search: ["s"] });
    for (const bindings of [["banana"], ["x"], ["g i x"], ["foo+k"]]) await expect(updateSettingsFromIpc(store, { shortcutEdit: { id: "compose", bindings } })).rejects.toThrow();
    expect((await store.get()).customShortcuts.compose).toEqual(["v"]);
    await updateSettingsFromIpc(store, { shortcutEdit: { id: "compose", bindings: [] } });
    expect((await new SettingsStore(file).get()).customShortcuts.compose).toEqual([]);
    await updateSettingsFromIpc(store, { shortcutEdit: { id: "compose", bindings: null } });
    expect((await store.get()).customShortcuts).toEqual({ search: ["s"] });
    await updateSettingsFromIpc(store, { shortcutEdit: { id: "nav-settings", bindings: ["g ,"] } });
    expect((await new SettingsStore(file).get()).customShortcuts["nav-settings"]).toEqual(["g ,"]);
  });
  it("defaults to text-only lists and persists either avatar choice without disturbing other settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "hey-settings-ipc-"));
    roots.push(root);
    const file = join(root, "settings.json");
    const store = new SettingsStore(file);
    expect((await store.get()).showSenderAvatars).toBe(false);
    for (const showSenderAvatars of [true, false]) {
      await updateSettingsFromIpc(store, { showSenderAvatars });
      await updateSettingsFromIpc(store, { interfaceFont: "system-mono" });
      expect((await new SettingsStore(file).get()).showSenderAvatars).toBe(showSenderAvatars);
    }
    for (const showSenderAvatars of ["true", 1, null, {}]) {
      expect(() => updateSettingsFromIpc(store, { showSenderAvatars })).toThrow("Invalid HEY Agent settings.");
    }
    expect((await store.get()).showSenderAvatars).toBe(false);
    await updateSettingsFromIpc(store, { showSenderAvatars: true });
    expect((await store.reset()).showSenderAvatars).toBe(false);
  });

  it.each(INTERFACE_FONT_IDS)("accepts and persists %s through the IPC update path", async (interfaceFont) => {
    const root = await mkdtemp(join(tmpdir(), "hey-settings-ipc-"));
    roots.push(root);
    const file = join(root, "settings.json");
    const store = new SettingsStore(file);
    expect((await updateSettingsFromIpc(store, { interfaceFont })).interfaceFont).toBe(interfaceFont);
    expect(JSON.parse(await readFile(file, "utf8")).interfaceFont).toBe(interfaceFont);
    expect((await new SettingsStore(file).get()).interfaceFont).toBe(interfaceFont);
  });

  it("rejects malformed updates without overwriting a saved mono preference", async () => {
    const root = await mkdtemp(join(tmpdir(), "hey-settings-ipc-"));
    roots.push(root);
    const store = new SettingsStore(join(root, "settings.json"));
    await updateSettingsFromIpc(store, { interfaceFont: "system-mono" });
    for (const update of [null, [], { interfaceFont: "unknown" }, { interfaceFont: 3 }, { sound: { volume: 2 } }, { ai: { quickUsesGeneral: "yes" } }, { helpers: { enabled: ["unknown"] } }]) {
      expect(() => updateSettingsFromIpc(store, update)).toThrow("Invalid HEY Agent settings.");
    }
    expect((await store.get()).interfaceFont).toBe("system-mono");
  });
});
