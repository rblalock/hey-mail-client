import { describe, expect, it } from "vitest";
import { parseHeyArgs } from "../../resources/hey-cli-flags.mjs";
import { eventAddCommand, eventEditCommand } from "./hey-calendar";
import { todoCreateCommand, timeCategoryCreateCommand, timeCategoryRenameCommand } from "./hey-calendar-recordings";

describe("HEY bridge argv grammar", () => {
  it.each(["--help", "--account=all", "-x", "--"])("passes native Calendar titles as literal text: %s", (title) => {
    for (const args of [
      eventAddCommand({ title, calendarId: "1", startsOn: "2026-09-14", allDay: true }),
      eventEditCommand({ id: "2", lookupDate: "2026-09-14", title }),
      todoCreateCommand({ title }),
    ]) {
      const parsed = parseHeyArgs(args);
      expect(parsed.values("--title")).toEqual([title]);
      expect(parsed.has("--help")).toBe(false);
      expect(parsed.has("--account")).toBe(false);
      expect(parsed.has("--json")).toBe(true);
    }
    for (const args of [timeCategoryCreateCommand(title), timeCategoryRenameCommand("3", title)]) {
      const parsed = parseHeyArgs(args);
      expect(parsed.positionals.at(-1)).toBe(title);
      expect(parsed.has("--help")).toBe(false);
      expect(parsed.has("--account")).toBe(false);
      expect(parsed.has("--json")).toBe(true);
    }
  });
  it("keeps flag-shaped values opaque, including equals and separators", () => {
    const parsed = parseHeyArgs(["compose", "--subject", "--account=all", "-m", "--help", "--thread-id=42", "--draft=false"]);
    expect(parsed.positionals).toEqual(["compose"]);
    expect(parsed.values("--subject")).toEqual(["--account=all"]);
    expect(parsed.values("--message")).toEqual(["--help"]);
    expect(parsed.values("--thread-id")).toEqual(["42"]);
    expect(parsed.has("--help")).toBe(false);
    expect(parsed.has("--draft")).toBe(false);
    expect(parseHeyArgs(["journal", "write", "--", "--help"]).positionals).toEqual(["journal", "write", "--help"]);
    expect(parseHeyArgs(["journal", "write", "--content", "--", "--json"]).values("--content")).toEqual(["--"]);
  });
  it("honors last boolean value and canonical aliases", () => {
    expect(parseHeyArgs(["compose", "--draft", "--draft=false"]).has("--draft")).toBe(false);
    expect(parseHeyArgs(["journal", "write", "-c=--help"]).values("--content")).toEqual(["--help"]);
    expect(parseHeyArgs(["event", "add", "-t", "--json"]).has("--json")).toBe(false);
    expect(parseHeyArgs(["reply", "42", "--dry-run", "--dry-run=false"]).has("--dry-run")).toBe(false);
    expect(parseHeyArgs(["reply", "42", "--replace-recipients=false", "--replace-recipients"]).has("--replace-recipients")).toBe(true);
  });
  it.each([["--future-option", "--help"], ["-mh"], ["--content"], ["--draft=maybe"]])("rejects unsupported or incomplete syntax %j", (...args) => {
    expect(() => parseHeyArgs(["compose", ...args])).toThrow(/Unsupported|Missing|Invalid/);
  });
});
