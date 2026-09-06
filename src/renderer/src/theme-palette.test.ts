import { describe, expect, it } from "vitest";
import type { ThemeSnapshot } from "../../shared/contracts";
import { deriveThemeVariables } from "./theme-palette";

function theme(mode: "light" | "dark", colors: Record<string, string>): ThemeSnapshot {
  return { name: "Test", mode, colors };
}

describe("Omarchy theme palette", () => {
  it("follows the selected system mono family and falls back when unavailable", () => {
    const selected = { ...theme("dark", {}), fontFamily: "JetBrainsMono Nerd Font" };
    expect(deriveThemeVariables(selected)["--app-mono"]).toBe('"JetBrainsMono Nerd Font", ui-monospace, monospace');
    expect(deriveThemeVariables({ ...selected, fontFamily: "Berkeley Mono" })["--app-mono"]).toBe('"Berkeley Mono", ui-monospace, monospace');
    expect(deriveThemeVariables(theme("dark", {}))["--app-mono"]).toBe("ui-monospace, monospace");
  });

  it("uses supplied structural tones without mixing warm foreground into dark surfaces", () => {
    const colors = {
      background: "#0e1720",
      dark_background: "#0b1118",
      lighter_background: "#262e36",
      selection: "#262e36",
      foreground: "#d5ceb1",
      muted: "#5f6469",
      accent: "#8fb1d7",
    };
    const variables = deriveThemeVariables(theme("dark", colors));
    const coolForeground = deriveThemeVariables(theme("dark", { ...colors, foreground: "#b9d8f1" }));

    expect(variables).toMatchObject({ "--canvas": "#0b1118", "--page": "#0e1720", "--hover-2": "#262e36" });
    expect(["--canvas", "--page", "--surface", "--field", "--hover", "--hover-2", "--line"]
      .map((property) => variables[property])).toEqual(["--canvas", "--page", "--surface", "--field", "--hover", "--hover-2", "--line"]
      .map((property) => coolForeground[property]));
  });

  it("rejects bright accent-like selection colors as large structural surfaces", () => {
    const variables = deriveThemeVariables(theme("dark", {
      background: "#030304",
      foreground: "#ac9f99",
      selection: "#ac664e",
      accent: "#ac664e",
    }));

    expect(variables["--hover-2"]).toBe("#252526");
    expect(variables["--surface"]).toBe("#0c0c0d");
  });

  it("rejects dark but strongly chromatic selection colors", () => {
    const variables = deriveThemeVariables(theme("dark", {
      background: "#101112",
      foreground: "#eee7df",
      selection: "#321919",
      accent: "#e06c5f",
    }));

    expect(variables["--hover-2"]).toBe("#303132");
  });

  it("keeps light surfaces bright while using selection for interaction depth", () => {
    const variables = deriveThemeVariables(theme("light", {
      background: "#fbfdff",
      dark_background: "#f1f6fa",
      lighter_background: "#ffffff",
      selection: "#cfe9fa",
      foreground: "#17364a",
      accent: "#287fc1",
    }));

    expect(variables).toMatchObject({ "--canvas": "#f1f6fa", "--page": "#fbfdff", "--surface": "#ffffff", "--hover-2": "#cfe9fa" });
  });
});
