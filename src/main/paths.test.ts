import { describe, expect, it } from "vitest";
import { resolveAppPaths } from "./paths";

describe("resolveAppPaths", () => {
  it("uses the XDG layout and keeps the default working directory out of config", () => {
    expect(resolveAppPaths({}, "/home/alex")).toEqual({
      config: "/home/alex/.config/hey-agent-app",
      data: "/home/alex/.local/share/hey-agent-app",
      state: "/home/alex/.local/state/hey-agent-app",
      workspace: "/home/alex/.local/share/hey-agent-app/workspace",
    });
  });

  it("uses only absolute XDG overrides", () => {
    expect(resolveAppPaths({
      XDG_CONFIG_HOME: "/config",
      XDG_DATA_HOME: "relative-data",
      XDG_STATE_HOME: "/state",
    }, "/home/alex")).toMatchObject({
      config: "/config/hey-agent-app",
      data: "/home/alex/.local/share/hey-agent-app",
      state: "/state/hey-agent-app",
    });
  });
});
