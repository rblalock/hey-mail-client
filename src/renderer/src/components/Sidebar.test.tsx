import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Sidebar from "./Sidebar";

const noop = () => {};
const base = { active: "imbox", chats: [], collapsed: false, shortcuts: [], onNavigate: noop, onCompose: noop, onNewChat: noop, onOpenChat: noop, onArchiveChat: noop, onToggleCollapsed: noop };

describe("sidebar unread count", () => {
  it("distinguishes a loaded unread prefix from a complete count", () => {
    const partial = load(renderToStaticMarkup(<Sidebar {...base} imboxCount={25} imboxCountPartial />));
    expect(partial(".nav-count").text()).toBe("25+");
    expect(partial(".nav-count").attr("title")).toContain("At least 25 unread");
    const complete = load(renderToStaticMarkup(<Sidebar {...base} imboxCount={25} />));
    expect(complete(".nav-count").text()).toBe("25");
  });

  it("does not claim an empty Imbox before reaching its unread section", () => {
    const $ = load(renderToStaticMarkup(<Sidebar {...base} imboxCount={0} imboxCountPartial />));
    expect($(".nav-count").text()).toBe("…");
    const empty = load(renderToStaticMarkup(<Sidebar {...base} imboxCount={0} />));
    expect(empty(".nav-count")).toHaveLength(0);
  });
});
