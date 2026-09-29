import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ReadTogetherView, { type ReadTogetherItem } from "./ReadTogetherView";

vi.mock("./ThreadPanel", () => ({ default: ({ posting }: ReadTogetherItem) => <div data-mounted-topic={posting.topicId}><h1>{posting.subject}</h1></div> }));

const items: ReadTogetherItem[] = Array.from({ length: 20 }, (_, index) => ({ posting: {
  id: String(index + 1), topicId: String(index + 101), subject: `Selected conversation ${index + 1}`,
  summary: "Synthetic mail", seen: false, createdAt: "2026-09-29T12:00:00Z", sender: { name: "Example Sender" }, contacts: [], visibleEntryCount: 1,
} }));

describe("Read Together initial rendering", () => {
  it("mounts only the first two readers while retaining every selected title and navigation shell", () => {
    const $ = load(renderToStaticMarkup(<ReadTogetherView items={items} sourceLabel="Inbox" skippedCount={0} onClose={() => {}} onRetryThread={() => {}} />));
    expect($(".read-together-item")).toHaveLength(20);
    expect($("[data-mounted-topic]").map((_, element) => $(element).attr("data-mounted-topic")).get()).toEqual(["101", "102"]);
    expect($(".read-together-item h1").map((_, element) => $(element).text()).get()).toEqual(items.map(({ posting }) => posting.subject));
    expect($("button[aria-label='Next selected conversation']").attr("disabled")).toBeUndefined();
    expect($("button[aria-label='Previous selected conversation']").attr("disabled")).toBeDefined();
  });

  it("handles a single selected conversation without placeholder readers", () => {
    const $ = load(renderToStaticMarkup(<ReadTogetherView items={items.slice(0, 1)} sourceLabel="Inbox" skippedCount={0} onClose={() => {}} onRetryThread={() => {}} />));
    expect($(".read-together-item")).toHaveLength(1);
    expect($("[data-mounted-topic]")).toHaveLength(1);
    expect($("button[aria-label='Next selected conversation']").attr("disabled")).toBeDefined();
  });
});
