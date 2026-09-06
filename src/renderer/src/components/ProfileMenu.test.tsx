import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AccountControl from "./AccountControl";
import ProfileMenu from "./ProfileMenu";

describe("profile footer", () => {
  it("exposes Settings through a named menu trigger, not a separate navigation row", () => {
    const $ = load(renderToStaticMarkup(<ProfileMenu onSettings={() => {}} active shortcut="G then ," />));
    const trigger = $("button[aria-label='Profile options']");
    expect(trigger.attr("aria-haspopup")).toBe("menu");
    expect(trigger.attr("aria-expanded")).toBe("false");
    expect(trigger.attr("data-active")).toBe("true");
    expect($("[role=menu]")).toHaveLength(0);
  });

  it("preserves the full name and email on hover for single and linked accounts", () => {
    const active = { key: "a".repeat(32), accountId: "101", name: "Alexandra Morgan-Worthington and the Studio Team", email: "alexandra.morgan-worthington@international-design-studio.example", server: "https://app.hey.com" };
    for (const linked of [false, true]) {
      const accounts = linked ? [active, { ...active, key: "b".repeat(32), accountId: "102" }] : [active];
      const $ = load(renderToStaticMarkup(<AccountControl state={{ token: "synthetic", active, accounts }} />));
      expect($(".account-row").attr("title")).toBe(`${active.name}\n${active.email}`);
      expect($(".account-copy strong").text()).toBe(active.name);
      expect($(".account-copy small").text()).toBe(active.email);
      expect($("button.account-row")).toHaveLength(linked ? 1 : 0);
    }
  });
});
