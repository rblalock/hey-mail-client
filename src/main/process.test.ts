import { describe, expect, it } from "vitest";
import { desktopRuntimePath } from "./process";

describe("graphical runtime discovery", () => {
  it("preserves user command precedence and makes local tools available to child agents", () => {
    expect(desktopRuntimePath({ HOME: "/home/example", PATH: "/custom/bin:/usr/bin:/usr/bin" }).split(":"))
      .toEqual(["/custom/bin", "/usr/bin", "/home/example/.local/bin", "/home/example/.local/share/mise/shims", "/home/example/.cargo/bin", "/usr/local/bin", "/bin"]);
  });
});
