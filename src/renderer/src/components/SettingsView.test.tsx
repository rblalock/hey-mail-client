import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_AI_SETTINGS, DEFAULT_MAIL_CACHE_SETTINGS, DEFAULT_SOUND_SETTINGS, type AppSettings } from "../../../shared/contracts";
import { DEFAULT_ENABLED_HELPERS, HELPER_CATALOG_VERSION } from "../../../shared/helpers";
import SettingsView from "./SettingsView";

const settings: AppSettings = {
  version: 1, showSenderAvatars: false, imboxLayout: "hey", interfaceFont: "system-mono", shortcutProfile: "hey", customShortcuts: {},
  sound: DEFAULT_SOUND_SETTINGS, ai: DEFAULT_AI_SETTINGS, mailCache: DEFAULT_MAIL_CACHE_SETTINGS,
  helpers: { catalogVersion: HELPER_CATALOG_VERSION, enabled: DEFAULT_ENABLED_HELPERS },
};
const noop = () => {};
const markup = (overrides: Partial<AppSettings> = {}) => load(renderToStaticMarkup(<SettingsView settings={{ ...settings, ...overrides }} onSettings={noop} onRunHelper={noop} onEditHelper={noop} runnableHelpers={[]} busyHelpers={new Set()} />));

describe("Settings accordion", () => {
  it("offers sender avatars as an opt-in Appearance switch", () => {
    const $ = markup();
    expect($("#settings-typography-toggle .settings-section-label").text()).toBe("Appearance");
    expect($("#settings-typography-content [role=switch][aria-label='Show sender avatars']").attr("aria-checked")).toBe("false");
  });
  it("offers a visibly styled creation button in Helpers", () => {
    const $ = markup();
    const create = $("#settings-helpers-content button.helper-create");
    expect(create.text()).toBe("New Helper");
    expect(create.attr("type")).toBe("button");
    expect(create.find("svg")).toHaveLength(1);
  });
  it("starts with eight compact headers linked to hidden, preserved panels", () => {
    const $ = markup();
    const headers = $(".settings-section-toggle");
    expect(headers).toHaveLength(8);
    headers.each((_, header) => {
      expect($(header).attr("aria-expanded")).toBe("false");
      const panel = $(`#${$(header).attr("aria-controls")}`);
      expect(panel.attr("hidden")).toBeDefined();
      expect(panel.attr("aria-labelledby")).toBe($(header).attr("id"));
      expect(panel.children().length).toBeGreaterThan(0);
    });
    expect($("button button")).toHaveLength(0);
  });

  it("offers all three font choices and shows the selected font in the summary", () => {
    const $ = markup();
    expect($("input[name='interface-font']")).toHaveLength(3);
    expect($("input[name='interface-font'][checked]").attr("value")).toBe("system-mono");
    expect($("#settings-typography-toggle .settings-section-summary").text()).toBe("System mono");
  });

  it("places opt-in mail caching after Appearance and disables its dependent controls", () => {
    const $ = markup();
    expect($(".settings-section-label").slice(0, 3).map((_, element) => $(element).text()).get()).toEqual(["Appearance", "Mail", "Keyboard shortcuts"]);
    expect($("#settings-mail-toggle .settings-section-summary").text()).toBe("HEY layout · Local cache off");
    const toggle = $("#settings-mail-content [role=switch][aria-label='Keep a local mail cache']");
    expect(toggle.attr("aria-checked")).toBe("false");
    expect(toggle.attr("disabled")).toBeUndefined();
    expect($("#mail-cache-size").attr("disabled")).toBeDefined();
    expect($("#mail-cache-retention").attr("disabled")).toBeDefined();
    expect($("#settings-mail-content [aria-label='Preload nearby emails']").attr("disabled")).toBeDefined();
  });

  it("keeps caching off when older settings do not include a mail cache preference", () => {
    const $ = markup({ mailCache: undefined });
    expect($("#settings-mail-content [aria-label='Keep a local mail cache']").attr("aria-checked")).toBe("false");
    expect($("#mail-cache-size option[selected]").val()).toBe("100");
    expect($("#mail-cache-retention option[selected]").val()).toBe("7");
    expect($("#settings-mail-content [aria-label='Preload nearby emails']").attr("aria-checked")).toBe("true");
    expect($("#settings-mail-content [aria-label='Preload nearby emails']").attr("disabled")).toBeDefined();
  });

  it("offers HEY and Sectioned Imbox layouts as an independent opt-in Mail preference", () => {
    const $ = markup();
    expect($("label[for='imbox-layout'] strong").text()).toBe("Imbox layout");
    expect($("#imbox-layout option").map((_, element) => $(element).text()).get()).toEqual(["HEY", "Sectioned"]);
    expect($("#imbox-layout option").map((_, element) => $(element).val()).get()).toEqual(["hey", "sectioned"]);
    expect($("#imbox-layout option[selected]").val()).toBe("hey");
    expect($("#imbox-layout").attr("disabled")).toBeUndefined();
    expect($("#imbox-layout").attr("aria-describedby")).toBe("imbox-layout-description");
    expect($("#imbox-layout-description").text()).toContain("Active, Reply Later, Set Aside, and Bubbled Up, with a quieter Previously Seen section");
  });

  it("reflects the saved Sectioned layout and defaults older settings to HEY", () => {
    const $ = markup({ imboxLayout: "sectioned" });
    expect($("#imbox-layout option[selected]").val()).toBe("sectioned");
    expect($("#settings-mail-toggle .settings-section-summary").text()).toBe("Sectioned layout · Local cache off");
    const older = markup({ imboxLayout: undefined });
    expect(older("#imbox-layout option[selected]").val()).toBe("hey");
  });

  it("exposes bounded, labeled cache choices when enabled", () => {
    const $ = markup({ mailCache: { enabled: true, maxSizeMb: 250, retentionDays: 30, prefetch: false } });
    expect($("#settings-mail-toggle .settings-section-summary").text()).toBe("HEY layout · Local cache · 250 MB");
    expect($("label[for='mail-cache-size'] span").text()).toBe("Maximum size");
    expect($("#mail-cache-size option").map((_, element) => $(element).val()).get()).toEqual(["50", "100", "250"]);
    expect($("#mail-cache-size option[selected]").val()).toBe("250");
    expect($("#mail-cache-size").attr("disabled")).toBeUndefined();
    expect($("label[for='mail-cache-retention'] span").text()).toBe("Keep cached mail for");
    expect($("#mail-cache-retention option").map((_, element) => $(element).val()).get()).toEqual(["1", "7", "30"]);
    expect($("#mail-cache-retention option[selected]").val()).toBe("30");
    expect($("#mail-cache-retention").attr("disabled")).toBeUndefined();
    expect($("#settings-mail-content [aria-label='Preload nearby emails']").attr("aria-checked")).toBe("false");
  });

  it("explains cache scope, deletion, and shared budget beside the controls", () => {
    const $ = markup();
    const text = $("#settings-mail-content").text();
    expect(text).toContain("email bodies and attachment details on this computer, not downloaded attachment files");
    expect(text).toContain("does not sync between computers");
    expect(text).toContain("Turning this off deletes the local cached copies");
    expect($("#mail-cache-budget").text()).toContain("shared across all accounts");
    expect($(".mail-cache-location dt").text()).toBe("Cache folder");
    expect($("#mail-cache-size").attr("aria-describedby")).toBe("mail-cache-budget");
    expect($("#settings-mail-content .mail-cache-usage [role=status]").text()).toBe("Checking cache usage…");
    expect($("#settings-mail-content button.secondary-button").text()).toBe("Clear cached mail");
  });
});
