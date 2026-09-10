import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { describe, expect, it } from "vitest";
import TrashUndoToast from "./TrashUndoToast";
import type { PendingTrash } from "../use-trash-queue";

describe("trash notification", () => {
  const item: PendingTrash = { id: "one", request: { operation: "trash", postingIds: ["1", "2"] }, remaining: 5000, deadline: Date.now() + 5000, paused: true };
  const render = (value = item) => load(renderToStaticMarkup(<TrashUndoToast item={value} undo={async () => true} pause={async () => {}} />));
  it("announces bulk trash and provides a keyboard-discoverable Undo without taking focus", () => {
    const $ = render();
    expect($("[role=status]").text()).toBe("2 conversations moved to Trash");
    expect($("button").text()).toContain("Undo");
    expect($("button").attr("aria-keyshortcuts")).toContain("Control+Z");
    expect($("[autofocus]")).toHaveLength(0);
    expect($(".trash-undo-countdown").attr("aria-hidden")).toBe("true");
  });
  it("does not promise Undo after the cancellation window expires", () => {
    const $ = render({ ...item, paused: false, deadline: Date.now() - 1 });
    expect($("button").text()).toBe("Saving…");
    expect($("button").attr("disabled")).toBeDefined();
  });
});
