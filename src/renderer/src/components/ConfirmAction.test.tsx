import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { afterEach, describe, expect, it } from "vitest";
import ConfirmAction, { confirmAction, resolveConfirmation } from "./ConfirmAction";

describe("app-owned confirmation", () => {
  afterEach(() => resolveConfirmation(false));
  it("has a labelled dialog, explicit action, and cancellation", async () => {
    const decision = confirmAction("This trains the spam filter.", "Mark as spam");
    const $ = load(renderToStaticMarkup(<ConfirmAction />));
    expect($("dialog").attr("aria-labelledby")).toBe("confirm-action-title");
    expect($("#confirm-action-message").text()).toBe("This trains the spam filter.");
    expect($("button").map((_, button) => $(button).text()).get()).toEqual(["Cancel", "Mark as spam"]);
    expect($("button").eq(0).hasClass("secondary-button")).toBe(true);
    expect($("button").eq(1).hasClass("primary-button")).toBe(true);
    resolveConfirmation(false);
    await expect(decision).resolves.toBe(false);
    expect(renderToStaticMarkup(<ConfirmAction />)).toBe("");
  });
  it("does not stack repeated requests and proceeds only after explicit confirmation", async () => {
    const first = confirmAction("Delete?", "Delete draft");
    await expect(confirmAction("Delete?", "Delete draft")).resolves.toBe(false);
    resolveConfirmation(true);
    await expect(first).resolves.toBe(true);
  });
});
