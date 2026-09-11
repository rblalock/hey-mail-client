import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LibraryConversations from "./LibraryConversations";

describe("Library conversation loading presentation", () => {
  it.each(["contacts", "labels", "collections"] as const)("does not mistake loading %s for an empty list", (kind) => {
    const $ = load(renderToStaticMarkup(<LibraryConversations kind={kind} id="12" onOpen={() => {}} />));
    expect($("[aria-busy=true]")).toHaveLength(1);
    expect($("[role=status]").text()).toBe("Loading conversations…");
    expect($.text()).not.toContain("No conversations here yet");
    expect($("button[aria-label='Refresh conversations']").attr("disabled")).toBeDefined();
    expect($("input").attr("aria-label")).toBe("Filter loaded conversations");
  });
});
