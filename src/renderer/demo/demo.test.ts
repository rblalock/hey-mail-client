import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createServer, resolveConfig } from "vite";
import { demoFontPlugin } from "../../../electron.vite.config";

describe("dev-only demo font", () => {
  it.each(["demo", "development"])("injects assets only in demo mode (%s)", async (mode) => {
    const server = await createServer({
      configFile: false,
      root: resolve("src/renderer"),
      plugins: [demoFontPlugin(mode)],
      server: { middlewareMode: true, watch: null, ws: false },
    });
    try {
      const html = await server.transformIndexHtml("/", "<html><head></head><body></body></html>");
      for (const asset of ["demo.css", "FlowRounded-Regular.ttf", "tooltips.js"]) {
        expect(html.includes(`/demo/${asset}`)).toBe(mode === "demo");
        expect((await readFile(resolve("src/renderer/demo", asset))).length).toBeGreaterThan(0);
      }
    } finally {
      await server.close();
    }
  });

  it.each(["demo", "production"])("disables the plugin for builds, even with mode %s", async (mode) => {
    const config = await resolveConfig({ configFile: false, plugins: [demoFontPlugin(mode)] }, "build", mode);
    expect(config.plugins.some((plugin) => plugin.name === "dev-demo-font")).toBe(false);
  });
});
