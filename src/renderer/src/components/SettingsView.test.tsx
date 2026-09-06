import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_AI_SETTINGS, DEFAULT_SOUND_SETTINGS, type AppSettings } from "../../../shared/contracts";
import { DEFAULT_ENABLED_HELPERS, HELPER_CATALOG_VERSION } from "../../../shared/helpers";
import SettingsView from "./SettingsView";

const settings: AppSettings = {
  version: 1, showSenderAvatars: false, interfaceFont: "system-mono", shortcutProfile: "hey", customShortcuts: {},
  sound: DEFAULT_SOUND_SETTINGS, ai: DEFAULT_AI_SETTINGS,
  helpers: { catalogVersion: HELPER_CATALOG_VERSION, enabled: DEFAULT_ENABLED_HELPERS },
};
const noop = () => {};
const markup = () => load(renderToStaticMarkup(<SettingsView settings={settings} onSettings={noop} onRunHelper={noop} onEditHelper={noop} runnableHelpers={[]} busyHelpers={new Set()} />));

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
  it("starts with seven compact headers linked to hidden, preserved panels", () => {
    const $ = markup();
    const headers = $(".settings-section-toggle");
    expect(headers).toHaveLength(7);
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
});
