import { describe, expect, it } from "vitest";
import { filterCommands, nextCommandIndex } from "./CommandPalette";
import { SHORTCUTS } from "../shortcuts";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import CommandPalette from "./CommandPalette";
import type { ShortcutDefinition } from "../shortcuts";

const helperCommands: ShortcutDefinition[] = [
  { id: "helper-daily-brief", label: "Daily Brief", display: "", keys: [], scope: "global" },
  { id: "helper-custom-proof", label: "My custom assistant", display: "", keys: [], scope: "global" },
];

describe("command palette keyboard navigation", () => {
  it("wraps through long command lists in either direction", () => {
    expect(nextCommandIndex(11, 1, 12)).toBe(0);
    expect(nextCommandIndex(0, -1, 12)).toBe(11);
  });

  it("stays stable when filtering returns no commands", () => {
    expect(nextCommandIndex(4, 1, 0)).toBe(0);
  });

  it("ranks the intended action above incidental substring matches", () => {
    expect(filterCommands(SHORTCUTS, "set").map((command) => command.id).slice(0, 2)).toEqual(["aside", "nav-aside"]);
  });

  it("finds built-in and personal Helpers by their visible category", () => {
    expect(filterCommands([...SHORTCUTS, ...helperCommands], "helpers").map((command) => command.id)).toEqual(helperCommands.map((command) => command.id));
  });

  it("labels Helpers separately from keyboard shortcuts and ordinary commands", () => {
    const html = renderToStaticMarkup(createElement(CommandPalette, { commands: [...helperCommands, SHORTCUTS[0]!], onRun: () => {}, onClose: () => {} }));
    expect(html.match(/class="command-kind">Helper/g)).toHaveLength(2);
    expect(html).not.toContain('<kbd>Helper</kbd>');
    expect(html).toContain(`<kbd>${SHORTCUTS[0]!.display}</kbd>`);
  });
});
