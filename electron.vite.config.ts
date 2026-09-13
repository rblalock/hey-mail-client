import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { Plugin } from "vite";

export function demoFontPlugin(mode: string): Plugin {
  return {
    name: "dev-demo-font",
    apply: "serve",
    transformIndexHtml: () => mode === "demo" ? [
      { tag: "link", attrs: { rel: "preload", href: "/demo/FlowRounded-Regular.ttf", as: "font", type: "font/ttf", crossorigin: "anonymous" }, injectTo: "head" },
      { tag: "link", attrs: { rel: "stylesheet", href: "/demo/demo.css" }, injectTo: "head" },
      { tag: "script", attrs: { type: "module", src: "/demo/tooltips.js" }, injectTo: "head" },
    ] : [],
  };
}

export default defineConfig(({ mode }) => ({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
        "@shared": resolve("src/shared"),
      },
    },
    plugins: [react(), tailwindcss(), demoFontPlugin(mode)],
  },
}));
